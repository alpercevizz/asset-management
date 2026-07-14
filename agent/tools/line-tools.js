// ── Turkcell Hat / SIM Envanteri Modülü ─────────────────────────────────────
// phone_lines (hattın kendisi) + line_assignments (append-only atama geçmişi).
// Bir hat telefon değiştirebilir → "hangi hat hangi telefonda" + tam geçmiş.
// Veri kaynağı: manuel giriş / CSV import (Turkcell Kurumsal API ileride, sözleşme aynı kalır).
const { db } = require('../../db');

function nowIso() { return new Date().toISOString(); }

// ICCID/MSISDN normalize — sadece rakam (ve MSISDN için baştaki +)
function normIccid(v) { return String(v || '').replace(/[^0-9]/g, ''); }
function normMsisdn(v) {
  let s = String(v || '').replace(/[^0-9+]/g, '');
  if (s && !s.startsWith('+')) {
    if (s.startsWith('00')) s = '+' + s.slice(2);
    else if (s.startsWith('0')) s = '+9' + s;           // 05xx → +905xx
    else if (s.startsWith('5')) s = '+90' + s;          // 5xx → +905xx
  }
  return s;
}

function rowToLine(r) {
  if (!r) return null;
  return {
    id: r.id, iccid: r.iccid, msisdn: r.msisdn, operator: r.operator,
    tariff: r.tariff, status: r.status,
    assigned_asset_id: r.assigned_asset_id, assigned_hostname: r.assigned_hostname,
    note: r.note, created_at: r.created_at, updated_at: r.updated_at,
  };
}

// ── Sorgular ──────────────────────────────────────────────────────────────────
async function listLines() {
  const rows = await db()('phone_lines').select('*').orderBy('id');
  return rows.map(rowToLine);
}
async function getLine(id) {
  const r = await db()('phone_lines').where({ id }).first();
  return rowToLine(r);
}
async function getLineByIccid(iccid) {
  const r = await db()('phone_lines').where({ iccid: normIccid(iccid) }).first();
  return rowToLine(r);
}
async function getLineHistory(lineId) {
  return db()('line_assignments').where({ line_id: lineId }).orderBy('id', 'desc');
}
// Bir telefona (asset) bağlı güncel hat
async function getLineForAsset(assetId) {
  const r = await db()('phone_lines').where({ assigned_asset_id: assetId }).first();
  return rowToLine(r);
}

// ── Yazma ─────────────────────────────────────────────────────────────────────
async function _appendHistory(line, { action, asset_id = null, hostname = null, actor = 'system', note = null }) {
  await db()('line_assignments').insert({
    line_id: line.id, iccid: line.iccid, msisdn: line.msisdn,
    asset_id, hostname, action, actor, note, at: nowIso(),
  });
}

// Hat oluştur veya ICCID'e göre güncelle (CSV import buradan geçer)
async function upsertLine({ iccid, msisdn, operator = 'Turkcell', tariff = null, status = 'aktif', note = null, actor = 'system' }) {
  const ic = normIccid(iccid);
  const ms = normMsisdn(msisdn);
  if (!ic) throw new Error('ICCID (SIM kart no) zorunludur.');
  if (!ms) throw new Error('MSISDN (telefon no) zorunludur.');
  const k = db();
  const existing = await k('phone_lines').where({ iccid: ic }).first();
  if (existing) {
    await k('phone_lines').where({ id: existing.id }).update({
      msisdn: ms, operator, tariff, status, note, updated_at: nowIso(),
    });
    return { action: 'updated', line: await getLine(existing.id) };
  }
  const now = nowIso();
  const [id] = await k('phone_lines').insert({
    iccid: ic, msisdn: ms, operator, tariff, status,
    assigned_asset_id: null, assigned_hostname: null, note,
    created_at: now, updated_at: now,
  });
  const line = await getLine(id);
  await _appendHistory(line, { action: 'olusturuldu', actor, note: 'Hat envantere eklendi' });
  return { action: 'created', line };
}

// Hattı bir telefona ata (önceki telefondan otomatik düşer — geçmişe iz)
async function assignLine(lineId, { asset_id, hostname = null, actor = 'system', note = null }) {
  const line = await getLine(lineId);
  if (!line) throw new Error('Hat bulunamadı.');
  if (!asset_id) throw new Error('Telefon (asset_id) zorunludur.');
  // Bu telefonda başka bir hat varsa uyarı amaçlı bilgilendir (engellemez — dual SIM olabilir)
  const now = nowIso();
  await db()('phone_lines').where({ id: lineId }).update({
    assigned_asset_id: asset_id, assigned_hostname: hostname, updated_at: now,
  });
  const updated = await getLine(lineId);
  await _appendHistory(updated, { action: 'atandi', asset_id, hostname, actor, note });
  return updated;
}

// Hattı boşa al (telefondan iade)
async function releaseLine(lineId, { actor = 'system', note = null } = {}) {
  const line = await getLine(lineId);
  if (!line) throw new Error('Hat bulunamadı.');
  const prevAsset = line.assigned_asset_id, prevHost = line.assigned_hostname;
  await db()('phone_lines').where({ id: lineId }).update({
    assigned_asset_id: null, assigned_hostname: null, updated_at: nowIso(),
  });
  const updated = await getLine(lineId);
  await _appendHistory(updated, { action: 'iade', asset_id: prevAsset, hostname: prevHost, actor, note });
  return updated;
}

// CSV satırlarını toplu import et. rows: [{iccid,msisdn,operator,tariff,status,note}]
async function importLines(rows, actor = 'system') {
  const result = { created: 0, updated: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    try {
      const r = await upsertLine({ ...row, actor });
      result[r.action === 'created' ? 'created' : 'updated']++;
    } catch (e) {
      result.errors.push({ row: i + 1, error: e.message });
    }
  }
  return result;
}

async function summary() {
  const lines = await listLines();
  return {
    total: lines.length,
    assigned: lines.filter(l => l.assigned_asset_id).length,
    unassigned: lines.filter(l => !l.assigned_asset_id).length,
    by_status: lines.reduce((acc, l) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {}),
  };
}

// Demo seed — tablo boşsa gerçek telefon asset'lerine örnek Turkcell hatları bağlar.
async function seedDemoIfEmpty() {
  const k = db();
  const [{ n }] = await k('phone_lines').count({ n: '*' });
  if (Number(n) > 0) return { skipped: true, count: 0 };
  const demo = [
    { iccid: '8990011122233344455', msisdn: '05321112233', tariff: 'Kurumsal Ses+Data 20GB', asset_id: 10, hostname: 'IPHONE-ALPER' },
    { iccid: '8990011122233344466', msisdn: '05329998877', tariff: 'Kurumsal Sınırsız',       asset_id: 11, hostname: 'SAMSUNG-SATIS' },
    { iccid: '8990011122233344477', msisdn: '05330001122', tariff: 'Kurumsal Data 50GB',       asset_id: null, hostname: null },
  ];
  let count = 0;
  for (const d of demo) {
    const { line } = await upsertLine({ iccid: d.iccid, msisdn: d.msisdn, tariff: d.tariff, actor: 'seed' });
    if (d.asset_id) await assignLine(line.id, { asset_id: d.asset_id, hostname: d.hostname, actor: 'seed', note: 'Demo başlangıç zimmeti' });
    count++;
  }
  return { skipped: false, count };
}

module.exports = {
  normIccid, normMsisdn,
  listLines, getLine, getLineByIccid, getLineHistory, getLineForAsset,
  upsertLine, assignLine, releaseLine, importLines, summary, seedDemoIfEmpty,
};
