-- ──────────────────────────────────────────────────────────────────────────────
-- Atomic admin write verbs (SECURITY DEFINER RPCs).
--
-- The admin console issued each verb as 2–3 independent PostgREST calls with no
-- transaction boundary, so a mid-sequence failure left inconsistent state:
-- an orphaned open cycle, an active_cycle_id pointing at a closed/deleted
-- cycle, or a half-done delete. These functions wrap each verb in a single
-- transaction (a plpgsql function body is atomic), so it all commits or none
-- of it does.
--
-- DEFINER functions bypass RLS, so each one re-checks is_admin() first — that
-- is the authorization gate (mirrors the table RLS policies). The event row is
-- upserted via UPDATE-then-INSERT so we don't depend on a named ON CONFLICT
-- constraint existing on brand_sale_events (it predates the migrations folder).
--
-- The client (admin.html) calls these via /rest/v1/rpc and FALLS BACK to the
-- legacy multi-step path if they're absent, so applying this migration is not
-- a hard prerequisite — but it removes the whole half-commit bug class.
-- Apply 20260622_admin_log_allow_deleted.sql first (admin_delete_cycle logs
-- action='deleted').
-- ──────────────────────────────────────────────────────────────────────────────

-- Internal helper: upsert the today review-log row.
CREATE OR REPLACE FUNCTION _admin_log(p_brand_id text, p_action text, p_cycle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE admin_review_log SET action = p_action, cycle_id = p_cycle_id
    WHERE brand_id = p_brand_id AND reviewed_date = CURRENT_DATE;
  IF NOT FOUND THEN
    INSERT INTO admin_review_log (brand_id, reviewed_date, action, cycle_id)
      VALUES (p_brand_id, CURRENT_DATE, p_action, p_cycle_id);
  END IF;
END $$;

-- confirm_start: open a new verified cycle (rejects future dates + double-open).
CREATE OR REPLACE FUNCTION admin_confirm_start(
  p_brand_id text, p_start_date date, p_max_discount_pct int, p_sale_type text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cycle_id uuid;
  v_sale_type text := COALESCE(p_sale_type, 'percent_off');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_start_date > CURRENT_DATE THEN RAISE EXCEPTION 'start date cannot be in the future'; END IF;
  IF EXISTS (SELECT 1 FROM brand_sale_cycles WHERE brand_id = p_brand_id AND end_date IS NULL) THEN
    RAISE EXCEPTION 'brand already has an open sale cycle';
  END IF;

  INSERT INTO brand_sale_cycles (brand_id, start_date, max_discount_pct, sale_type, source)
    VALUES (p_brand_id, p_start_date, p_max_discount_pct, v_sale_type, 'admin')
    RETURNING id INTO v_cycle_id;

  UPDATE brand_sale_events
    SET active_cycle_id = v_cycle_id, last_verified_status = true,
        last_verified_date = CURRENT_DATE, sale_type = v_sale_type
    WHERE brand_id = p_brand_id;
  IF NOT FOUND THEN
    INSERT INTO brand_sale_events (brand_id, active_cycle_id, last_verified_status, last_verified_date, sale_type)
      VALUES (p_brand_id, v_cycle_id, true, CURRENT_DATE, v_sale_type);
  END IF;

  PERFORM _admin_log(p_brand_id, 'confirmed_start', v_cycle_id);
  RETURN v_cycle_id;
END $$;

-- confirm_end: close the open cycle + clear the event.
CREATE OR REPLACE FUNCTION admin_confirm_end(p_brand_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cycle_id uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT id INTO v_cycle_id FROM brand_sale_cycles
    WHERE brand_id = p_brand_id AND end_date IS NULL
    ORDER BY start_date DESC LIMIT 1;
  IF v_cycle_id IS NOT NULL THEN
    UPDATE brand_sale_cycles SET end_date = CURRENT_DATE WHERE id = v_cycle_id;
  END IF;
  UPDATE brand_sale_events
    SET active_cycle_id = NULL, last_verified_status = false,
        last_verified_date = CURRENT_DATE, sale_type = NULL
    WHERE brand_id = p_brand_id;
  PERFORM _admin_log(p_brand_id, 'confirmed_end', v_cycle_id);
  RETURN v_cycle_id;
END $$;

-- confirm_on / confirm_off: reaffirm state (off also clears the FK).
CREATE OR REPLACE FUNCTION admin_confirm_status(p_brand_id text, p_on boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_on THEN
    UPDATE brand_sale_events SET last_verified_status = true, last_verified_date = CURRENT_DATE
      WHERE brand_id = p_brand_id;
    PERFORM _admin_log(p_brand_id, 'confirmed_on', NULL);
  ELSE
    UPDATE brand_sale_events SET last_verified_status = false, last_verified_date = CURRENT_DATE,
        active_cycle_id = NULL
      WHERE brand_id = p_brand_id;
    PERFORM _admin_log(p_brand_id, 'confirmed_off', NULL);
  END IF;
END $$;

-- edit: update the cycle + denormalised event fields.
CREATE OR REPLACE FUNCTION admin_edit_cycle(
  p_brand_id text, p_cycle_id uuid, p_start_date date, p_max_discount_pct int, p_sale_type text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale_type text := COALESCE(p_sale_type, 'percent_off');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_start_date > CURRENT_DATE THEN RAISE EXCEPTION 'start date cannot be in the future'; END IF;
  IF p_cycle_id IS NOT NULL THEN
    UPDATE brand_sale_cycles
      SET start_date = p_start_date, max_discount_pct = p_max_discount_pct, sale_type = v_sale_type
      WHERE id = p_cycle_id;
  END IF;
  UPDATE brand_sale_events
    SET max_discount_pct = p_max_discount_pct, sale_type = v_sale_type, last_verified_date = CURRENT_DATE
    WHERE brand_id = p_brand_id;
  PERFORM _admin_log(p_brand_id, 'edited', p_cycle_id);
END $$;

-- delete: clear the event, remove the cycle, log it — atomically.
CREATE OR REPLACE FUNCTION admin_delete_cycle(p_brand_id text, p_cycle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE brand_sale_events
    SET active_cycle_id = NULL, last_verified_status = false, last_verified_date = CURRENT_DATE,
        max_discount_pct = NULL, sale_type = NULL
    WHERE brand_id = p_brand_id;
  DELETE FROM brand_sale_cycles WHERE id = p_cycle_id;
  PERFORM _admin_log(p_brand_id, 'deleted', p_cycle_id);
END $$;

-- PostgREST exposes these to authenticated callers; each re-checks is_admin().
GRANT EXECUTE ON FUNCTION admin_confirm_start(text, date, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_confirm_end(text)                     TO authenticated;
GRANT EXECUTE ON FUNCTION admin_confirm_status(text, boolean)         TO authenticated;
GRANT EXECUTE ON FUNCTION admin_edit_cycle(text, uuid, date, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_cycle(text, uuid)              TO authenticated;
-- _admin_log is internal — not granted to any client role.
REVOKE ALL ON FUNCTION _admin_log(text, text, uuid) FROM PUBLIC;
