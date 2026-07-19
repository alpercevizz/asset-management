// ── Lisans sağlayıcı: SQL (SQLite | PostgreSQL) ──────────────────────────────
const { db } = require('../../db');
const { computeLicenseStats } = require('./licenses-baserow');

const LIC_COLS = new Set([
  'hostname', 'serial_number', 'software_name', 'software_version', 'publisher',
  'license_type', 'license_status', 'license_key', 'username', 'location',
  'install_date', 'expiry_date', 'last_seen', 'org_id',
]);
function clean(data) { const o = {}; for (const k of Object.keys(data || {})) if (LIC_COLS.has(k)) o[k] = data[k]; return o; }
function getById(id) { return db()('licenses').where({ id }).first(); }

async function getAllLicenses({ page = 1, size = 200, filterField, filterValue } = {}) {
  const k = db();
  const base = () => {
    let q = k('licenses');
    if (filterField && filterValue && LIC_COLS.has(filterField)) q = q.whereRaw(`LOWER(CAST(?? AS TEXT)) LIKE ?`, [filterField, `%${String(filterValue).toLowerCase()}%`]);
    return q;
  };
  const [{ c }] = await base().count({ c: '*' });
  const results = await base().orderBy('id').limit(Math.max(1, Number(size) || 200)).offset((Math.max(1, page) - 1) * (Number(size) || 200));
  return { count: Number(c), results, next: null, previous: null };
}
async function findLicense({ hostname, softwareName }) {
  return (await db()('licenses').where({ hostname, software_name: softwareName }).first()) || null;
}
async function createLicense(data) {
  const k = db();
  const ret = await k('licenses').insert(clean(data)).returning('id');
  const id = ret && ret[0] && typeof ret[0] === 'object' ? ret[0].id : ret[0];
  return getById(id);
}
async function updateLicense(rowId, data) {
  await db()('licenses').where({ id: rowId }).update(clean(data));
  return getById(rowId);
}
async function upsertLicense(data) {
  const existing = await findLicense({ hostname: data.hostname, softwareName: data.software_name });
  if (existing) { await updateLicense(existing.id, { ...data, last_seen: new Date().toISOString() }); return { action: 'updated', id: existing.id }; }
  const created = await createLicense({ ...data, last_seen: new Date().toISOString() });
  return { action: 'created', id: created.id };
}
async function getLicensesByHostname(hostname) {
  return db()('licenses').where({ hostname }).limit(200);
}
async function bulkUpsertLicenses({ hostname, serial_number, username, location, software }) {
  const now = new Date().toISOString();
  const existingRows = await getLicensesByHostname(hostname);
  const existingMap = {};
  for (const row of existingRows) existingMap[row.software_name] = row;
  const out = [];
  for (const sw of software) {
    const payload = { hostname, serial_number: serial_number || hostname, username: username || '', location: location || '', ...sw, last_seen: now };
    const existing = existingMap[sw.software_name];
    if (existing) { await updateLicense(existing.id, payload); out.push({ action: 'updated', id: existing.id }); }
    else { const c = await createLicense(payload); out.push({ action: 'created', id: c.id }); }
  }
  return out;
}
async function getLicenseStats() {
  const licenses = await db()('licenses').select('*');
  return computeLicenseStats(licenses, licenses.length);
}

module.exports = { getAllLicenses, findLicense, createLicense, updateLicense, upsertLicense, getLicensesByHostname, bulkUpsertLicenses, getLicenseStats };
