const axios = require('axios');

const baserowClient = axios.create({
  baseURL: process.env.BASEROW_API_URL || 'https://api.baserow.io',
  headers: {
    Authorization: `Token ${process.env.BASEROW_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

const TABLE_ID = process.env.BASEROW_TABLE_ID;

// ── Her sorguya org_id filtresi eklenir (multi-tenancy) ───────────────────────
// Baserow tek sayfada max 200 kayıt döner. size>200 istenirse İÇ DÖNGÜ ile
// sayfalanır ve tüm sonuçlar tek dizide birleştirilir → binlerce cihaz destek.
// Güvenlik tavanı: MAX_PAGES (varsayılan 50 → 10.000 kayıt) sonsuz döngüyü önler.
const BASEROW_PAGE_MAX = 200;
async function getAllAssets({ orgId, page = 1, size = 200, filterField, filterValue } = {}) {
  const need = Math.max(1, Number(size) || BASEROW_PAGE_MAX);
  // Tek sayfa yeter → mevcut hızlı yol
  if (need <= BASEROW_PAGE_MAX) {
    const params = { page, size: need, user_field_names: true };
    if (orgId) params['filter__field_org_id__equal'] = orgId;
    if (filterField && filterValue) params[`filter__${filterField}__contains`] = filterValue;
    const res = await baserowClient.get(`/api/database/rows/table/${TABLE_ID}/`, { params });
    return res.data;
  }
  // Çok sayfa → hepsini topla
  const MAX_PAGES = Number(process.env.BASEROW_MAX_PAGES) || 50;
  const wanted = Math.min(need, MAX_PAGES * BASEROW_PAGE_MAX);
  const results = [];
  let count = 0;
  for (let p = 1; results.length < wanted && p <= MAX_PAGES; p++) {
    const params = { page: p, size: BASEROW_PAGE_MAX, user_field_names: true };
    if (orgId) params['filter__field_org_id__equal'] = orgId;
    if (filterField && filterValue) params[`filter__${filterField}__contains`] = filterValue;
    const res = await baserowClient.get(`/api/database/rows/table/${TABLE_ID}/`, { params });
    count = res.data.count || 0;
    const rows = res.data.results || [];
    results.push(...rows);
    if (rows.length < BASEROW_PAGE_MAX) break; // son sayfa
  }
  return { count, results: results.slice(0, wanted), next: null, previous: null };
}

async function searchAssets({ orgId, query }) {
  const params = { search: query, user_field_names: true, size: 100 };
  if (orgId) params['filter__field_org_id__equal'] = orgId;
  const res = await baserowClient.get(`/api/database/rows/table/${TABLE_ID}/`, { params });
  return res.data;
}

async function getAssetBySerial({ orgId, serialNumber }) {
  const params = {
    user_field_names: true,
    filter__serial_number__equal: serialNumber,
    size: 1,
  };
  if (orgId) params['filter__field_org_id__equal'] = orgId;
  const res = await baserowClient.get(`/api/database/rows/table/${TABLE_ID}/`, { params });
  return res.data.results?.[0] || null;
}

async function createAsset(data) {
  const res = await baserowClient.post(
    `/api/database/rows/table/${TABLE_ID}/?user_field_names=true`,
    data
  );
  return res.data;
}

async function updateAsset(rowId, data) {
  const res = await baserowClient.patch(
    `/api/database/rows/table/${TABLE_ID}/${rowId}/?user_field_names=true`,
    data
  );
  return res.data;
}

async function getStats(orgId) {
  const data = await getAllAssets({ orgId, size: 200 });
  const assets = data.results || [];

  const stats = {
    total: data.count || assets.length,
    by_brand: {},
    by_status: {},
    by_os: {},
    by_category: {},
    avg_ram_gb: 0,
    avg_disk_gb: 0,
    new_today: 0,
  };

  const today = new Date().toISOString().split('T')[0];
  let totalRam = 0, totalDisk = 0, ramCount = 0, diskCount = 0;

  for (const asset of assets) {
    const brand = asset.brand || 'Unknown';
    stats.by_brand[brand] = (stats.by_brand[brand] || 0) + 1;

    const status = asset.status || 'unknown';
    stats.by_status[status] = (stats.by_status[status] || 0) + 1;

    const osRaw = asset.os ? asset.os.split(' ')[0] : 'Unknown';
    // Normalize: IOS → iOS, MACOS → macOS etc.
    const os = osRaw === 'IOS' ? 'iOS' : osRaw === 'MACOS' ? 'macOS' : osRaw;
    stats.by_os[os] = (stats.by_os[os] || 0) + 1;

    const cat = asset.category || 'Diğer';
    stats.by_category[cat] = (stats.by_category[cat] || 0) + 1;

    if (asset.ram_gb)     { totalRam  += Number(asset.ram_gb);     ramCount++;  }
    if (asset.storage_gb) { totalDisk += Number(asset.storage_gb); diskCount++; }

    const created = asset.created_on || asset.last_seen || '';
    if (created.startsWith(today)) stats.new_today++;
  }

  stats.avg_ram_gb  = ramCount  ? Math.round(totalRam  / ramCount)  : 0;
  stats.avg_disk_gb = diskCount ? Math.round(totalDisk / diskCount) : 0;

  return stats;
}

module.exports = { getAllAssets, searchAssets, getAssetBySerial, createAsset, updateAsset, getStats };
