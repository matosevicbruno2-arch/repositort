import { google } from 'googleapis';
import { config } from '../config.js';
import { computeDashboard } from '../lib/dashboard.js';

export { computeDashboard };

/** Dohvaća vrijednosti svih listova tablice. */
async function readGrids(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.sheetId,
    fields: 'properties.title,sheets.properties.title',
  });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  if (!titles.length) return { title: meta.data.properties?.title || '', grids: [] };

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.sheetId,
    ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return {
    title: meta.data.properties?.title || '',
    grids: (res.data.valueRanges || []).map((v) => v.values || []),
  };
}

export async function loadDashboard(auth) {
  const { title, grids } = await readGrids(auth);
  return computeDashboard(grids, title);
}
