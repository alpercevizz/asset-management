// ── Baserow → SQL Envanter Migrasyonu (tek seferlik) ─────────────────────────
// Baserow'daki assets + licenses satırlarını SQL katmanına (DATABASE_URL) taşır.
// id'ler KORUNUR → os_agents/asset_assignments/phone_lines/lifecycle asset_id bağları bozulmaz.
// Kullanım:  node scripts/migrate-inventory-to-sql.js
// Öncesinde .env: BASEROW_* (kaynak) + DATABASE_URL (hedef). INVENTORY_PROVIDER önemsiz.
require('dotenv').config({ override: true });
require('../auth/setup').bootstrapSecrets();
const { db, migrate, driver } = require('../db');
const baserowAssets = require('../agent/tools/inventory-baserow');
const baserowLic = require('../agent/tools/licenses-baserow');

const INT = ['cpu_cores', 'cpu_threads', 'ram_gb', 'storage_gb', 'gpu_ram_gb', 'uptime_days'];
const ASSET_COLS = ['hostname', 'serial_number', 'brand', 'model', 'cpu', 'cpu_cores', 'cpu_threads', 'ram_gb', 'storage_gb', 'os', 'os_arch', 'ip_address', 'mac_address', 'username', 'gpu', 'gpu_ram_gb', 'uptime_days', 'domain', 'last_seen', 'status', 'collector_ver', 'category', 'location', 'warranty_expiry', 'org_id', 'created_on'];
const LIC_COLS = ['hostname', 'serial_number', 'software_name', 'software_version', 'publisher', 'license_type', 'license_status', 'license_key', 'username', 'location', 'install_date', 'expiry_date', 'last_seen', 'org_id'];

function pick(row, cols) {
  const o = { id: row.id };
  for (const c of cols) {
    let v = row[c];
    if (v === undefined) continue;
    if (INT.includes(c)) v = (v === '' || v == null) ? null : Number(v) || null;
    if (v === '') v = null;
    o[c] = v;
  }
  return o;
}

async function resetSeq(table) {
  if (driver() !== 'postgres') return;
  const k = db();
  await k.raw(`SELECT setval(pg_get_serial_sequence('??', 'id'), COALESCE((SELECT MAX(id) FROM ??), 1))`, [table, table]);
}

(async () => {
  await migrate();
  const k = db();

  // ── Assets ──
  const aData = await baserowAssets.getAllAssets({ size: 100000 });
  const assets = (aData.results || []).map((r) => pick(r, ASSET_COLS));
  await k('assets').del();
  for (let i = 0; i < assets.length; i += 200) await k('assets').insert(assets.slice(i, i + 200));
  await resetSeq('assets');
  console.log(`✓ assets: ${assets.length} kayıt taşındı`);

  // ── Licenses (Baserow sayfa tavanı 200 → sayfala) ──
  const rawLics = [];
  for (let page = 1; page <= 200; page++) {
    const d = await baserowLic.getAllLicenses({ page, size: 200 });
    const rows = d.results || [];
    rawLics.push(...rows);
    if (rows.length < 200) break;
  }
  const lics = rawLics.filter((r) => r.software_name).map((r) => pick(r, LIC_COLS));
  await k('licenses').del();
  for (let i = 0; i < lics.length; i += 200) await k('licenses').insert(lics.slice(i, i + 200));
  await resetSeq('licenses');
  console.log(`✓ licenses: ${lics.length} kayıt taşındı`);

  console.log('\nTAMAM. Doğrula, sonra .env: INVENTORY_PROVIDER=sql yapıp sunucuyu yeniden başlat.');
  process.exit(0);
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
