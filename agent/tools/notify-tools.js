const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { detectAnomalies, detectOfflineDevices, detectLicenseCompliance, detectShadowIT, detectEolOs, detectWarranty } = require('./anomaly-tools');
const { detectLifecycleConflicts } = require('./lifecycle-tools');
const { scanNetwork } = require('./network-discovery');

// ── Konfigürasyon (.env) ──────────────────────────────────────────────────────
// N8N_NOTIFY_WEBHOOK_URL : n8n webhook adresi (İÇ AĞ — kapalı devre korunur).
// NOTIFY_ENABLED         : 'true' ise zamanlayıcı çalışır.
// NOTIFY_INTERVAL_MS     : tarama aralığı (varsayılan 30 dk). Dedup sayesinde sık tarama spam yapmaz.
const WEBHOOK_URL  = () => process.env.N8N_NOTIFY_WEBHOOK_URL || '';
const ENABLED      = () => String(process.env.NOTIFY_ENABLED || '').toLowerCase() === 'true';
const INTERVAL_MS  = () => Number(process.env.NOTIFY_INTERVAL_MS) || 30 * 60 * 1000;

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'notify-state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { last_signature: null, last_sent_at: null, last_total: 0 }; }
}
function writeState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); }
  catch (err) { console.error('[notify] durum dosyası yazılamadı:', err.message); }
}

// ── Uyarı özeti (digest) — deterministik tespit verisinden toplanır ───────────
async function buildAlertDigest(orgId) {
  const [anomalies, offline, compliance, shadow, eol, warranty, lifecycle, netscan] = await Promise.all([
    detectAnomalies(orgId),
    detectOfflineDevices(orgId),
    detectLicenseCompliance(orgId),
    detectShadowIT(orgId),
    detectEolOs(orgId),
    detectWarranty(orgId),
    detectLifecycleConflicts(orgId),
    scanNetwork(orgId),
  ]);

  const lowRam    = anomalies.low_ram?.items     || [];
  const lowDisk   = anomalies.low_disk?.items    || [];
  const uptime    = anomalies.long_uptime?.items || [];
  const offlineIt = offline.offline?.items       || [];
  const staleIt   = offline.stale?.items         || [];
  const unlic     = compliance.unlicensed?.items || [];
  const expired   = compliance.expired?.items    || [];
  const expSoon   = compliance.expiring_soon?.items || [];
  const shadowIt  = shadow.shadow?.items         || [];
  const eolIt     = eol.eol?.items               || [];
  const eolSoon   = eol.approaching?.items       || [];
  const warrExp   = warranty.expired?.items      || [];
  const warrSoon  = warranty.expiring_soon?.items || [];
  const lifeConf  = lifecycle.conflicts          || [];
  const netFind   = netscan.findings?.items      || [];

  const summary = {
    total_anomalies: anomalies.total_anomalies || 0,
    offline_alerts:  offline.total_alerts || 0,
    license_issues:  compliance.total_issues || 0,
    shadow_it:       shadow.shadow?.count || 0,
    eol_os:          eol.total_issues || 0,
    warranty_issues: warranty.total_issues || 0,
    lifecycle_conflicts: lifecycle.total_conflicts || 0,
    network_alarms:  netscan.findings?.count || 0,
  };
  summary.total = summary.total_anomalies + summary.offline_alerts + summary.license_issues
    + summary.shadow_it + summary.eol_os + summary.warranty_issues + summary.lifecycle_conflicts + summary.network_alarms;

  // İnsan-okur Türkçe özet (n8n bunu doğrudan mail/Telegram gövdesine koyabilir)
  const lines = [];
  lines.push('IT VARLIK YÖNETİMİ — UYARI ÖZETİ');
  lines.push(`Oluşturma: ${new Date().toLocaleString('tr-TR')}`);
  lines.push('');
  if (netFind.length) {
    lines.push(`• [CANLI AĞ KEŞFİ] ${netFind.length} karantina cihazı ağda AKTİF tespit edildi:`);
    netFind.forEach(f => lines.push(`   ${f.message}`));
    lines.push('');
  }
  if (offlineIt.length) lines.push(`• Çevrimdışı cihaz: ${offlineIt.length} (${offlineIt.map(d => d.hostname).join(', ')})`);
  if (staleIt.length)   lines.push(`• Uzun süredir görünmeyen: ${staleIt.length} (${staleIt.map(d => d.hostname).join(', ')})`);
  if (lowRam.length)    lines.push(`• Düşük RAM (<8 GB): ${lowRam.length}`);
  if (lowDisk.length)   lines.push(`• Düşük disk (<256 GB): ${lowDisk.length}`);
  if (uptime.length)    lines.push(`• 30+ gün açık (yeniden başlatma): ${uptime.length}`);
  if (unlic.length)     lines.push(`• Lisanssız yazılım: ${unlic.length}`);
  if (expired.length)   lines.push(`• Süresi dolmuş lisans: ${expired.length}`);
  if (expSoon.length)   lines.push(`• 30 gün içinde dolacak lisans: ${expSoon.length}`);
  if (eolIt.length) {
    lines.push(`• [GÜVENLİK] Desteği bitmiş işletim sistemi: ${eolIt.length} cihaz`);
    eolIt.forEach(d => lines.push(`   ${d.hostname} — ${d.os_family} (${d.days_past} gün önce EOL)`));
    lines.push('   Öneri: Bu cihazları güncel işletim sistemine yükseltin; güvenlik yaması almıyorlar.');
  }
  if (eolSoon.length) lines.push(`• 180 gün içinde EOL olacak işletim sistemi: ${eolSoon.length}`);
  if (warrExp.length)  lines.push(`• Garantisi bitmiş cihaz: ${warrExp.length} (${warrExp.map(d => d.hostname).join(', ')})`);
  if (warrSoon.length) lines.push(`• 60 gün içinde garantisi bitecek: ${warrSoon.length}`);
  if (shadowIt.length) {
    lines.push(`• [UYARI] Ağda resmi envanter kaydı bulunmayan ${shadowIt.length} adet cihaz tespit edildi.`);
    shadowIt.forEach(d => lines.push(`   Detaylar: ${d.ip} - ${d.mac}${d.hostname ? ` (${d.hostname})` : ''}`));
    lines.push('   Öneri: Bu cihazların MAC adreslerini Sophos/Güvenlik duvarı üzerinden izole edin veya resmi envanter kaydını oluşturun.');
  }
  if (lifeConf.length) {
    const crit = lifeConf.filter(c => c.severity === 'critical');
    lines.push(`• [YAŞAM DÖNGÜSÜ] ${lifeConf.length} cihaz durumu çelişkisi/zafiyeti tespit edildi${crit.length ? ` (${crit.length} KRİTİK)` : ''}.`);
    lifeConf.forEach(c => lines.push(`   ${c.message}`)); // mesaj kritik ön ekini zaten içerir
    lines.push('   Öneri: Audit log ile fiili durumu karşılaştırıp çelişkili cihazları fiziksel olarak doğrulayın.');
  }
  if (summary.total === 0) lines.push('Aktif uyarı yok — tüm sistemler normal.');

  return {
    type: 'asset-alert-digest',
    generated_at: new Date().toISOString(),
    summary,
    sections: {
      offline: offlineIt, stale: staleIt,
      low_ram: lowRam, low_disk: lowDisk, long_uptime: uptime,
      license: { unlicensed: unlic, expired, expiring_soon: expSoon },
      shadow_it: shadowIt,
      eol_os: { eol: eolIt, approaching: eolSoon },
      warranty: { expired: warrExp, expiring_soon: warrSoon },
      lifecycle: lifeConf,
      network_discovery: netFind,
    },
    message: lines.join('\n'),
  };
}

// ── Durum imzası: uyarı KÜMESİ değişince değişir, her taramada değil ──────────
// (aynı uyarılar tekrar tekrar gönderilmesin = spam önleme)
function computeSignature(digest) {
  const s = digest.sections;
  const ids = [];
  s.offline.forEach(d => ids.push(`off:${d.hostname}`));
  s.stale.forEach(d   => ids.push(`stale:${d.hostname}`));
  s.low_ram.forEach(d => ids.push(`ram:${d.hostname}`));
  s.low_disk.forEach(d=> ids.push(`disk:${d.hostname}`));
  s.long_uptime.forEach(d => ids.push(`up:${d.hostname}`));
  s.license.unlicensed.forEach(l => ids.push(`unlic:${l.software_name}|${l.hostname}`));
  s.license.expired.forEach(l     => ids.push(`exp:${l.software_name}|${l.hostname}`));
  s.license.expiring_soon.forEach(l => ids.push(`soon:${l.software_name}|${l.hostname}`));
  s.shadow_it.forEach(d => ids.push(`shadow:${d.mac || d.ip}`));
  (s.eol_os?.eol || []).forEach(d         => ids.push(`eol:${d.hostname}|${d.os_family}`));
  (s.eol_os?.approaching || []).forEach(d => ids.push(`eolsoon:${d.hostname}|${d.os_family}`));
  (s.warranty?.expired || []).forEach(d      => ids.push(`warr:${d.hostname}`));
  (s.warranty?.expiring_soon || []).forEach(d => ids.push(`warrsoon:${d.hostname}`));
  (s.lifecycle || []).forEach(c => ids.push(`life:${c.type}|${c.serial_number || c.hostname}`));
  (s.network_discovery || []).forEach(f => ids.push(`net:${f.live_mac || f.hostname}`));
  ids.sort();
  return crypto.createHash('sha256').update(ids.join('\n')).digest('hex');
}

// ── Webhook'a gönder (dedup'lı). force=true → imza kontrolünü atla ────────────
async function sendDigest({ force = false, orgId = null } = {}) {
  const url = WEBHOOK_URL();
  if (!url) return { sent: false, skipped: 'no-webhook' };

  const digest = await buildAlertDigest(orgId);

  if (digest.summary.total === 0 && !force) {
    return { sent: false, skipped: 'no-alerts', summary: digest.summary };
  }

  const signature = computeSignature(digest);
  const state = readState();
  if (!force && signature === state.last_signature) {
    return { sent: false, skipped: 'unchanged', summary: digest.summary };
  }

  try {
    await axios.post(url, { ...digest, signature }, { timeout: 15000 });
    writeState({ last_signature: signature, last_sent_at: new Date().toISOString(), last_total: digest.summary.total });
    console.log(`[notify] Uyarı özeti gönderildi → n8n (${digest.summary.total} uyarı)`);
    return { sent: true, summary: digest.summary, signature };
  } catch (err) {
    console.error('[notify] webhook gönderim hatası:', err.message);
    return { sent: false, error: err.message, summary: digest.summary };
  }
}

// ── Zamanlayıcı ───────────────────────────────────────────────────────────────
let timer = null;
function startNotifyScheduler() {
  if (!ENABLED()) {
    console.log('[notify] Zamanlanmış bildirim KAPALI (NOTIFY_ENABLED=true ile aç).');
    return;
  }
  if (!WEBHOOK_URL()) {
    console.log('[notify] NOTIFY_ENABLED=true ama N8N_NOTIFY_WEBHOOK_URL tanımlı değil — bildirim atlanacak.');
    return;
  }
  const ms = INTERVAL_MS();
  console.log(`[notify] Zamanlanmış bildirim AÇIK — her ${Math.round(ms / 60000)} dk taranacak (dedup'lı).`);
  if (timer) clearInterval(timer);
  timer = setInterval(() => { sendDigest({ force: false }).catch(e => console.error('[notify]', e.message)); }, ms);
}

module.exports = { buildAlertDigest, sendDigest, startNotifyScheduler, computeSignature };
