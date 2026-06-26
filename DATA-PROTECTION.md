# Data protection — do not reset the Tide data

The verified sale data in this project is the core asset and is **not regenerable**.
Since the scraper was removed (Jun 2026), every sale cycle, discount %, and
verified on/off state came from a human confirming it in the admin console.
Simulated/seed rows are mixed in, but **anything actually entered must survive.**

Two layers stop a reset — one at commit time, one at run time.

## 1. Runtime guard (database) — the real blocker

`supabase/migrations/20260626_protect_data_from_reset.sql` installs triggers that
refuse, on the protected tables:

| Operation | Tables |
|---|---|
| `TRUNCATE` | `brand_sale_cycles`, `brand_sale_events`, `centre_seer_scores`, `user_reports`, `community_signals`, `centres`, `brands` |
| bulk `DELETE` (> 5 rows in one statement) | `brand_sale_cycles`, `brand_sale_events`, `centre_seer_scores` |
| wiping `centres.tide_history` to empty | `centres` |

**Run it once in the Supabase SQL editor** (project `vrezzwadwzrmumjpdgge`) to
activate — same as every other migration here. Idempotent.

It does **not** block: normal pipeline writes (`score.js` only upserts and writes
a full history array), single-row admin corrections, or account-deletion
cascades into `user_reports`.

### Overriding on purpose (e.g. dropping simulated rows)

In the **same transaction**, before the destructive statement:

```sql
BEGIN;
-- always snapshot first:
CREATE TABLE centre_seer_scores_archive_20260626 AS SELECT * FROM centre_seer_scores;
SET LOCAL app.allow_data_reset = 'yes-i-really-mean-it';
DELETE FROM centre_seer_scores WHERE ...;
COMMIT;
```

`SET LOCAL` means the permission evaporates at `COMMIT` — it can never leak into a
later statement or another session.

Verify the guard is live (read-only):

```sql
SELECT tgname, tgrelid::regclass AS "table"
FROM pg_trigger WHERE tgname LIKE 'zzz_guard%' ORDER BY 2, 1;
```

## 2. Commit-time guard (repo) — the tripwire

`scripts/guard-no-data-reset.mjs` scans SQL/JS for destructive statements against
the protected tables and **fails** unless the file carries an explicit
`-- DATA-RESET-ACK: <reason>` line (it still warns even then). This is what stops
a "reset to a clean baseline" migration — written by a person or an AI agent —
from ever landing.

- **Local hook:** enable once per clone — `git config core.hooksPath .githooks`.
  (`.githooks/pre-commit` scans staged files.)
- **CI backstop:** `.github/workflows/guard-data.yml` runs the full scan on every
  push/PR, so a commit made without the hook (web editor, agent, fresh clone) is
  still caught.
- **Manual:** `npm run guard`.

## Measuring readiness

`npm run readiness` (needs `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`, read-only)
reports scale, history depth in days, carry-forward ratio, sale-episode health,
and crowd volume — with a per-axis grade. Use it to track when the dataset
becomes forecast-ready (target: ≥30 brands with ≥2 sale cycles, ≥180-day median
history).
