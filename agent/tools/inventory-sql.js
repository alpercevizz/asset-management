// ── Envanter sağlayıcı: SQL (SQLite | PostgreSQL) ────────────────────────────
// INVENTORY_PROVIDER=sql iken kullanılır. Baserow ile AYNI fonksiyon imzası + dönüş
// şekli ({count,results,next,previous} vb.) → çağıranlar (server/agent/anomaly/insight)
// hiç değişmez. Baserow'dan bağımsız, veri kurumun kendi veritabanında kalır.
const { db } = require('../../db');
const { computeStats } = require('./inventory-baserow'); // istatistik hesabı ortak

// Yazılabilir sütun beyaz listesi (bilinmeyen payload alanları sessizce atılır)
const ASSET_COLS = new Set([
  'hostname', 'serial_number', 'brand', 'model', 'cpu', 'cpu_cores', 'cpu_threads',
  'ram_gb', 'storage_gb', 'os', 'os_arch', 'ip_address', 'mac_address', 'username',
  'gpu', 'gpu_ram_gb', 'uptime_days', 'domain', 'last_seen', 'status', 'collector_ver',
  'category', 'location', 'warranty_expiry', 'org_id', 'created_on',
]);
const SEARCH_COLS = ['hostname', 'serial_number', 'username', 'brand', 'model', 'ip_address', 'mac_address'];

function clean(data) {
  const out = {};
  for (const k of Object.keys(data || {})) if (ASSET_COLS.has(k)) out[k] = data[k];
  return out;
}
function getById(id) { return db()('assets').where({ id }).first(); }

async function getAllAssets({ orgId, page = 1, size = 200, filterField, filterValue } = {}) {
  const k = db();
  const base = () => {
    let q = k('assets');
    if (orgId) q = q.where('org_id', orgId);
    if (filterField && filterValue && ASSET_COLS.has(filterField)) {
      q = q.whereRaw(`LOWER(CAST(?? AS ${k.client.dialect === 'sqlite3' || k.client.dialect === 'sqlite' ? 'TEXT' : 'TEXT'})) LIKE ?`,
        [filterField, `%${String(filterValue).toLowerCase()}%`]);
    }
    return q;
  };
  const [{ c }] = await base().count({ c: '*' });
  const results = await base().orderBy('id').limit(Math.max(1, Number(size) || 200)).offset((Math.max(1, page) - 1) * (Number(size) || 200));
  return { count: Number(c), results, next: null, previous: null };
}

async function searchAssets({ orgId, query }) {
  const k = db();
  const q = k('assets');
  if (orgId) q.where('org_id', orgId);
  const term = `%${String(query || '').toLowerCase()}%`;
  q.where((b) => { SEARCH_COLS.forEach((col, i) => b[i === 0 ? 'whereRaw' : 'orWhereRaw'](`LOWER(CAST(?? AS TEXT)) LIKE ?`, [col, term])); });
  const results = await q.orderBy('id').limit(100);
  return { count: results.length, results };
}

async function getAssetBySerial({ orgId, serialNumber }) {
  const q = db()('assets').where({ serial_number: serialNumber });
  if (orgId) q.andWhere('org_id', orgId);
  return (await q.first()) || null;
}

async function createAsset(data) {
  const k = db();
  const row = clean(data);
  if (!row.created_on) row.created_on = new Date().toISOString();
  const ret = await k('assets').insert(row).returning('id');
  const id = ret && ret[0] && typeof ret[0] === 'object' ? ret[0].id : ret[0];
  return getById(id);
}

async function updateAsset(rowId, data) {
  const k = db();
  await k('assets').where({ id: rowId }).update(clean(data));
  return getById(rowId);
}

async function getStats(orgId) {
  const q = db()('assets');
  if (orgId) q.where('org_id', orgId);
  const assets = await q.select('*'); // istatistik için TÜM kayıtlar (Baserow'un 200 tavanından iyi)
  return computeStats(assets, assets.length);
}

module.exports = { getAllAssets, searchAssets, getAssetBySerial, createAsset, updateAsset, getStats };
