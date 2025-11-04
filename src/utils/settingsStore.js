import db from '../database/db.js';

async function ensureSettingsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.warn('ensureSettingsTable failed:', e.message);
  }
}

async function getSetting(key, fallback = null) {
  try {
    await ensureSettingsTable();
    const res = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
    if (!res.rows[0]) return fallback;
    // Value is stored as JSONB, so it's already parsed by pg
    return res.rows[0].value;
  } catch (e) {
    console.warn('getSetting failed:', e.message);
    return fallback;
  }
}

async function setSetting(key, value) {
  try {
    await ensureSettingsTable();
    // Ensure value is JSON-serializable for JSONB column
    const jsonValue = JSON.stringify(value);
    await db.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2::jsonb,NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, jsonValue]
    );
    return true;
  } catch (e) {
    console.error('setSetting failed:', e.message);
    return false;
  }
}

async function getAllSettings() {
  try {
    await ensureSettingsTable();
    const res = await db.query('SELECT key, value FROM settings');
    const out = {};
    for (const row of res.rows) out[row.key] = row.value;
    return out;
  } catch (e) {
    console.warn('getAllSettings failed:', e.message);
    return {};
  }
}

export default { ensureSettingsTable, getSetting, setSetting, getAllSettings };
