/**
 * Tide → Google Sheets writer
 *
 * Writes today's scrape results into the "SeerScores" tab of your Google Sheet.
 * Each run upserts one column: today's date as the header, with a sale signal
 * per brand row (TRUE / FALSE / ERROR).
 *
 * Setup (one-time):
 *   1. Create a Google Cloud service account.
 *   2. Share your Google Sheet with the service account email (Editor).
 *   3. Download the service account JSON key.
 *   4. In your repo, add a GitHub Actions secret named GOOGLE_CREDENTIALS
 *      containing the full JSON key (stringified).
 *   5. Set SHEET_ID in your .env or GitHub Actions env vars.
 *
 * Sheet structure expected:
 *   Row 1: headers — col A = "Brand ID", col B = "Brand Name", col C+ = dates (YYYY-MM-DD)
 *   Row 2+: one row per brand
 *
 * This writer will:
 *   - Find or create today's date column
 *   - Write TRUE / FALSE / ERROR into each brand's row for that date
 */

import { google } from 'googleapis';

const SHEET_ID    = process.env.SHEET_ID;
const SHEET_TAB   = 'SeerScores';
const BRAND_ID_COL = 0; // column A

export async function pushToSheets(results) {
  if (!SHEET_ID) {
    console.warn('[Sheets] SHEET_ID not set — skipping Sheets push');
    return;
  }

  // Auth via service account credentials from env
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) {
    throw new Error('GOOGLE_CREDENTIALS env var not set');
  }

  const credentials = JSON.parse(credentialsJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const today  = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // ── Read current sheet state ──────────────────────────────────────────────
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A1:ZZ1`, // header row only
  });

  const headerRow = readRes.data.values?.[0] ?? [];

  // Find or allocate today's column
  let todayColIdx = headerRow.indexOf(today);
  if (todayColIdx === -1) {
    todayColIdx = headerRow.length; // append new column
  }

  // ── Read brand ID column ──────────────────────────────────────────────────
  const brandColRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:A`,
  });

  const brandIdRows = brandColRes.data.values ?? [];

  // Build a map: brandId → sheet row index (0-based)
  const brandRowMap = {};
  for (let i = 1; i < brandIdRows.length; i++) {
    const id = brandIdRows[i]?.[0];
    if (id) brandRowMap[id] = i;
  }

  // ── Build batch update ────────────────────────────────────────────────────
  const valueUpdates = [];

  // Set header for today's column
  const todayColLetter = columnIndexToLetter(todayColIdx);
  valueUpdates.push({
    range: `${SHEET_TAB}!${todayColLetter}1`,
    values: [[today]],
  });

  for (const result of results) {
    const rowIdx = brandRowMap[result.id];
    if (rowIdx === undefined) {
      console.warn(`[Sheets] Brand ID "${result.id}" not found in sheet — skipping`);
      continue;
    }

    // Sheet rows are 1-indexed; rowIdx is 0-based (row 0 = header)
    const sheetRow = rowIdx + 1;
    const cellRef  = `${SHEET_TAB}!${todayColLetter}${sheetRow}`;

    let value;
    if (result.error) {
      value = 'ERROR';
    } else {
      value = result.onSale ? 'TRUE' : 'FALSE';
    }

    valueUpdates.push({
      range: cellRef,
      values: [[value]],
    });
  }

  // ── Write in one batch ────────────────────────────────────────────────────
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: valueUpdates,
    },
  });

  console.log(`[Sheets] Wrote ${results.length} results to column ${todayColLetter} (${today})`);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function columnIndexToLetter(idx) {
  // 0 → A, 25 → Z, 26 → AA, etc.
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}
