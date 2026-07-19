// ── Lisans sağlayıcı: BASEROW ────────────────────────────────────────────────
const axios = require('axios');

const licenseClient = axios.create({
  baseURL: process.env.BASEROW_API_URL || 'https://api.baserow.io',
  headers: { Authorization: `Token ${process.env.BASEROW_API_TOKEN}`, 'Content-Type': 'application/json' },
});
const TABLE_ID = process.env.BASEROW_LICENSE_TABLE_ID || '624';

async function getAllLicenses({ page = 1, size = 200, filterField, filterValue } = {}) {
  const params = { page, size, user_field_names: true };
  if (filterField && filterValue) params[`filter__${filterField}__contains`] = filterValue;
  const res = await licenseClient.get(`/api/database/rows/table/${TABLE_ID}/`, { params });
  return res.data;
}
async function findLicense({ hostname, softwareName }) {
  const params = { user_field_names: true, filter__hostname__equal: hostname, filter__software_name__equal: softwareName, size: 1 };
  const res = await licenseClient.get(`/api/database/rows/table/${TABLE_ID}/`, { params });
  return res.data.results?.[0] || null;
}
async function createLicense(data) {
  const res = await licenseClient.post(`/api/database/rows/table/${TABLE_ID}/?user_field_names=true`, data);
  return res.data;
}
async function updateLicense(rowId, data) {
  const res = await licenseClient.patch(`/api/database/rows/table/${TABLE_ID}/${rowId}/?user_field_names=true`, data);
  return res.data;
}
async function upsertLicense(data) {
  const existing = await findLicense({ hostname: data.hostname, softwareName: data.software_name });
  if (existing) { await updateLicense(existing.id, { ...data, last_seen: new Date().toISOString() }); return { action: 'updated', id: existing.id }; }
  const created = await createLicense({ ...data, last_seen: new Date().toISOString() });
  return { action: 'created', id: created.id };
}
async function getLicensesByHostname(hostname) {
  const params = { user_field_names: true, filter__hostname__equal: hostname, size: 200 };
  const res = await licenseClient.get(`/api/database/rows/table/${TABLE_ID}/`, { params });
  return res.data.results || [];
}
async function bulkUpsertLicenses({ hostname, serial_number, username, location, software }) {
  const now = new Date().toISOString();
  const existingRows = await getLicensesByHostname(hostname);
  const existingMap = {};
  for (const row of existingRows) existingMap[row.software_name] = row;
  return Promise.all(software.map(async (sw) => {
    const payload = { hostname, serial_number: serial_number || hostname, username: username || '', location: location || '', ...sw, last_seen: now };
    const existing = existingMap[sw.software_name];
    if (existing) { await updateLicense(existing.id, payload); return { action: 'updated', id: existing.id }; }
    const created = await createLicense(payload);
    return { action: 'created', id: created.id };
  }));
}
async function getLicenseStats() {
  const data = await getAllLicenses({ size: 200 });
  return computeLicenseStats(data.results || [], data.count);
}
function computeLicenseStats(licenses, count) {
  const stats = { total: count || licenses.length, by_status: {}, by_type: {}, by_software: {}, unlicensed: 0, expiring_soon: 0 };
  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  for (const lic of licenses) {
    if (!lic.software_name) continue;
    const status = lic.license_status || 'Unknown';
    stats.by_status[status] = (stats.by_status[status] || 0) + 1;
    const type = lic.license_type || 'Unknown';
    stats.by_type[type] = (stats.by_type[type] || 0) + 1;
    stats.by_software[lic.software_name] = (stats.by_software[lic.software_name] || 0) + 1;
    if (status === 'Unlicensed') stats.unlicensed++;
    if (lic.expiry_date) { const exp = new Date(lic.expiry_date); if (!isNaN(exp) && exp < thirtyDays && exp > new Date()) stats.expiring_soon++; }
  }
  return stats;
}

module.exports = { getAllLicenses, findLicense, createLicense, updateLicense, upsertLicense, getLicensesByHostname, bulkUpsertLicenses, getLicenseStats, computeLicenseStats };
