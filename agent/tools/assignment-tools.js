// ── Resmi Zimmet Modülü (assigned_to) — Devir Koruması ──────────────────────
// Resmi zimmet KİLİTLİ: yalnız kontrollü akıştan (assign/release) değişir.
// PUBLIC webhook/register bu tabloya DOKUNMAZ → zimmetli cihaz sessizce devralınamaz.
// Telemetri (Baserow username = son gören kullanıcı) ayrıdır ve serbest güncellenir.
const { db } = require('../../db');

function nowIso() { return new Date().toISOString(); }

async function getAssignment(assetId) {
  return db()('asset_assignments').where({ asset_id: Number(assetId) }).first();
}
async function getAll() {
  return db()('asset_assignments').select('*');
}

// Resmi zimmet ata/devret. Zaten BAŞKA kullanıcıya zimmetliyse ve force yoksa REDDEDER.
// force=true (yetkili bilinçli devir) veya önce release edilirse geçer.
async function assign(assetId, { to, hostname = null, by = 'system', note = null, force = false }) {
  const id = Number(assetId);
  if (!to || !String(to).trim()) throw new Error('Zimmet sahibi (to) zorunludur.');
  const target = String(to).trim();
  const existing = await getAssignment(id);
  if (existing && existing.assigned_to && existing.assigned_to !== target && !force) {
    const err = new Error(`Cihaz zaten "${existing.assigned_to}" kullanıcısına zimmetli. Önce iade edin veya onaylı devir (force) kullanın.`);
    err.code = 'ALREADY_ASSIGNED';
    err.current = existing.assigned_to;
    throw err;
  }
  const k = db();
  const row = { asset_id: id, assigned_to: target, hostname, assigned_at: nowIso(), assigned_by: by, note };
  if (existing) await k('asset_assignments').where({ asset_id: id }).update(row);
  else await k('asset_assignments').insert(row);
  return getAssignment(id);
}

async function release(assetId, { by = 'system', note = null } = {}) {
  const id = Number(assetId);
  const existing = await getAssignment(id);
  if (!existing || !existing.assigned_to) return existing || null;
  await db()('asset_assignments').where({ asset_id: id }).update({
    assigned_to: null, assigned_at: nowIso(), assigned_by: by, note,
  });
  return getAssignment(id);
}

// Telemetri (son gören kullanıcı) ile resmi zimmet uyuşmuyor mu? → izinsiz kullanım şüphesi.
// webhook/register çağrılırken kontrol edilir; uyuşmazlık kayda/uyarıya döner (engellemez —
// resmi zimmet zaten korunuyor, bu yalnız SİNYAL).
async function checkMismatch(assetId, telemetryUser) {
  const a = await getAssignment(assetId);
  if (!a || !a.assigned_to || !telemetryUser) return null;
  if (String(telemetryUser).trim().toLowerCase() === a.assigned_to.toLowerCase()) return null;
  return { asset_id: Number(assetId), assigned_to: a.assigned_to, seen_user: telemetryUser };
}

// Tüm envanterde telemetri≠resmi zimmet uyuşmazlıklarını listele.
async function listMismatches(assets) {
  const rows = await getAll();
  const map = {};
  rows.forEach(r => { if (r.assigned_to) map[r.asset_id] = r.assigned_to; });
  const out = [];
  for (const a of assets || []) {
    const owner = map[a.id];
    const seen = (a.username || '').trim();
    if (owner && seen && seen.toLowerCase() !== owner.toLowerCase()) {
      out.push({ asset_id: a.id, hostname: a.hostname, assigned_to: owner, seen_user: seen });
    }
  }
  return out;
}

// İlk kurulum: mevcut Baserow username'lerini resmi zimmet başlangıcı olarak al (tablo boşsa).
async function seedFromAssets(assets) {
  const [{ n }] = await db()('asset_assignments').count({ n: '*' });
  if (Number(n) > 0) return { skipped: true, count: 0 };
  let count = 0;
  for (const a of assets || []) {
    const u = (a.username || '').trim();
    if (!u) continue;
    await db()('asset_assignments').insert({
      asset_id: a.id, assigned_to: u, hostname: a.hostname || null,
      assigned_at: nowIso(), assigned_by: 'seed', note: 'İlk kurulum — mevcut kullanıcıdan',
    });
    count++;
  }
  return { skipped: false, count };
}

module.exports = { getAssignment, getAll, assign, release, checkMismatch, listMismatches, seedFromAssets };
