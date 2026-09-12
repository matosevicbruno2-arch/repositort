import { google } from 'googleapis';
import { config } from '../config.js';
import { computeDashboard } from '../lib/dashboard.js';
import { prepareJobRow } from '../lib/newjob.js';

export { computeDashboard };

/** Dohvaća vrijednosti svih listova tablice, uz podatke o listovima. */
async function readGrids(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.sheetId,
    fields: 'properties.title,sheets.properties(sheetId,title)',
  });
  const props = (meta.data.sheets || []).map((s) => s.properties);
  const title = meta.data.properties?.title || '';
  if (!props.length) return { title, grids: [], sheets: [] };

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.sheetId,
    ranges: props.map((p) => `'${p.title.replace(/'/g, "''")}'`),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return {
    title,
    sheets: props,
    grids: (res.data.valueRanges || []).map((v) => v.values || []),
  };
}

export async function loadDashboard(auth) {
  const { title, grids } = await readGrids(auth);
  return computeDashboard(grids, title);
}

/**
 * Upisuje novi posao u tablicu "Radovi".
 *
 * Redak se ubacuje točno iza zadnjeg retka te tablice, a ne na kraj lista, jer
 * ispod mogu stajati druge tablice. Zato prvo ide insertDimension (pomakne sve
 * ispod za jedan redak), pa upis vrijednosti u oslobođeni redak.
 */
export async function appendJob(auth, posao) {
  const sheets = google.sheets({ version: 'v4', auth });
  const { grids, sheets: props } = await readGrids(auth);
  const plan = prepareJobRow(grids, posao);
  const sheet = props[plan.gridIndex];
  if (!sheet) {
    const err = new Error('List s tablicom "Radovi" nije pronađen.');
    err.code = 'sheet_structure';
    throw err;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.sheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: sheet.sheetId,
              dimension: 'ROWS',
              startIndex: plan.insertAtRow,
              endIndex: plan.insertAtRow + 1,
            },
            inheritFromBefore: true, // preuzmi oblikovanje retka iznad
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `'${sheet.title.replace(/'/g, "''")}'!${plan.a1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [plan.values] },
  });

  return { id: plan.id, redak: plan.insertAtRow + 1, list: sheet.title };
}
