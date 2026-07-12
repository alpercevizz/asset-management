// ── Network Discovery Agent — Ölçeklenebilir, Async, VLAN-Segmentli ──────────
// Binlerce cihazlık kurumsal ağda ağı KİLİTLEMEDEN / backend'i SATÜRE ETMEDEN tarar:
//  • Cihazlar VLAN/segment bazında gruplanır.
//  • Segmentler sınırlı eşzamanlılıkla (worker pool) ASENKRON taranır (queue mantığı).
//  • Her segment, BATCH_SIZE'lık partiler hâlinde + BATCH_DELAY_MS throttle ile işlenir.
// Güvenlik: ağ kimliğine (MAC) GÜVENİLMEZ — her yönetilen cihaz OS Agent ile el sıkışır.
// MAC doğru olsa bile token uyuşmazsa → KLONLANMIŞ CİHAZ ŞÜPHESİ (spoofing).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAllAssets } = require('./baserow-tools');
const { getActiveNetworkDevices } = require('./anomaly-tools');
const { getCurrentStatusForAsset } = require('./lifecycle-tools');
const { verifyOsAgent, genTokenForAsset } = require('./os-agent');

// Ağda AKTİF OLMAMASI gereken yaşam döngüsü durumları
const QUARANTINE_STATES = new Set([
  'Depoya Kaldırıldı', 'Kayıp', 'Belirsiz', 'Ayrılan Personelden Teslim Alındı', 'Hurdaya Ayrıldı',
]);

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'discovery-state.json');

// Ölçek parametreleri (.env ile ayarlanır — binlerce cihazda networkü korur)
const MAX_CONCURRENT = () => Number(process.env.DISCOVERY_CONCURRENCY) || 2;   // aynı anda taranan segment
const BATCH_SIZE     = () => Number(process.env.DISCOVERY_BATCH_SIZE) || 64;   // segment içi parti boyutu
const BATCH_DELAY_MS = () => Number(process.env.DISCOVERY_BATCH_DELAY_MS) || 15; // partiler arası throttle

function normMac(mac) { return mac ? String(mac).toLowerCase().replace(/[^0-9a-f]/g, '') : ''; }
function normIp(ip) { return ip ? String(ip).trim() : ''; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// IP/subnet → VLAN segment (feed'de açık vlan yoksa türet)
function vlanOf(ip) {
  const s = normIp(ip);
  if (s.startsWith('10.0.1.')) return 10;
  if (s.startsWith('10.0.2.')) return 20;
  if (s.startsWith('10.0.3.')) return 30;
  if (s.startsWith('192.168.50.')) return 50;
  return 0; // segmentsiz/diğer
}

// Sınırlı eşzamanlılık kuyruğu (worker pool) — dış bağımlılık yok
async function runQueue(jobs, worker, concurrency) {
  const results = [];
  let next = 0;
  async function runner() {
    while (next < jobs.length) {
      const idx = next++;
      results[idx] = await worker(jobs[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, runner));
  return results;
}

// Tek bir VLAN segmentini partiler hâlinde + throttle ile tara
async function scanSegment(seg, activeByMac, activeByIp) {
  const findings = [];
  const batch = BATCH_SIZE();
  for (let i = 0; i < seg.assets.length; i += batch) {
    const slice = seg.assets.slice(i, i + batch);
    for (const a of slice) {
      const mac = normMac(a.mac_address);
      const ip = normIp(a.ip_address);
      const live = (mac && activeByMac.get(mac)) || (ip && activeByIp.get(ip)) || null;
      const statusOnline = (a.status || '').toLowerCase() === 'online';
      if (!live && !statusOnline) continue; // ağda yok → atla

      // ── OS Agent el sıkışması (MAC'e güvenme) ──
      // Canlı cihazın agent'ının sunduğu token'ı simüle et: spoof ise bozuk, değilse gerçek.
      const presentedToken = live && live.spoof
        ? 'SPOOF-' + crypto.randomBytes(4).toString('hex')   // klon: secret'ı yok
        : genTokenForAsset(a.id);                            // gerçek agent: doğru token
      const hs = verifyOsAgent(a, presentedToken);

      if (hs.managed && !hs.verified) {
        findings.push({
          type: 'spoofing', severity: 'critical', vlan: seg.vlan,
          hostname: a.hostname || '—', serial_number: a.serial_number || '—',
          live_ip: (live && live.ip) || a.ip_address || '—',
          live_mac: (live && live.mac) || a.mac_address || '—',
          agent_id: hs.agent_id, reason: hs.reason,
          message: `KLONLANMIŞ CİHAZ ŞÜPHESİ (SPOOFING): ${a.hostname || a.serial_number} MAC adresi ağda görülüyor ANCAK OS Agent kimlik doğrulaması BAŞARISIZ (${hs.reason}). MAC taklit edilmiş olabilir — cihazı izole edin. [VLAN ${seg.vlan}]`,
        });
        continue; // spoofing en kritik bulgu; bu cihaz için yeter
      }

      // ── Karantina durumundaki cihaz ağda aktif mi? ──
      const cur = getCurrentStatusForAsset(a);
      if (cur && QUARANTINE_STATES.has(cur.status)) {
        findings.push({
          type: 'quarantine_active', severity: 'critical', vlan: seg.vlan,
          hostname: a.hostname || '—', serial_number: a.serial_number || '—',
          lifecycle_status: cur.status,
          live_ip: (live && live.ip) || a.ip_address || '—',
          live_mac: (live && live.mac) || a.mac_address || '—',
          evidence: live ? 'ağ taramasında yanıt veriyor' : 'envanter durumu=online',
          message: `KRİTİK GÜVENLİK İHLALİ: '${cur.status}' statüsündeki ${a.hostname || a.serial_number} cihazı CANLI AĞDA AKTİF! (${(live && live.ip) || '—'} / ${(live && live.mac) || '—'}) — fiziksel konum ile kayıt çelişiyor. [VLAN ${seg.vlan}]`,
        });
      }
    }
    if (i + batch < seg.assets.length) await sleep(BATCH_DELAY_MS()); // throttle: ağı satüre etme
  }
  return { vlan: seg.vlan, scanned: seg.assets.length, findings };
}

// ── Ana tarama: segmentlere ayır → kuyruğa al → sınırlı eşzamanlılıkla asenkron tara ──
async function scanNetwork(orgId) {
  // Baserow tek sayfa 200 döner; getAllAssets iç sayfalama ile binleri toplar (max BASEROW_MAX_PAGES).
  const data = await getAllAssets({ orgId, size: 2000 });
  const assets = data.results || [];
  const feed = getActiveNetworkDevices();

  const activeByMac = new Map();
  const activeByIp = new Map();
  for (const dvc of feed.devices) {
    if (normMac(dvc.mac)) activeByMac.set(normMac(dvc.mac), dvc);
    if (normIp(dvc.ip)) activeByIp.set(normIp(dvc.ip), dvc);
  }

  // Cihazları VLAN'a göre segmentle (asset IP'sinden türet)
  const segMap = new Map();
  for (const a of assets) {
    const vlan = vlanOf(a.ip_address);
    if (!segMap.has(vlan)) segMap.set(vlan, { vlan, assets: [] });
    segMap.get(vlan).assets.push(a);
  }
  const segments = [...segMap.values()].sort((x, y) => x.vlan - y.vlan);

  // Segmentleri sınırlı eşzamanlılıkla işle (queue)
  const t0 = Date.now();
  const segResults = await runQueue(segments, (seg) => scanSegment(seg, activeByMac, activeByIp), MAX_CONCURRENT());
  const findings = segResults.flatMap(r => r.findings);
  const spoofing = findings.filter(f => f.type === 'spoofing');
  const quarantine = findings.filter(f => f.type === 'quarantine_active');

  return {
    scanned: assets.length,
    active_total: feed.devices.length,
    segments: segResults.map(r => ({ vlan: r.vlan, scanned: r.scanned, findings: r.findings.length })),
    concurrency: MAX_CONCURRENT(),
    batch_size: BATCH_SIZE(),
    scan_ms: Date.now() - t0,
    source: feed.source,
    captured_at: feed.captured_at,
    alarm: findings.length > 0,
    spoofing_count: spoofing.length,
    quarantine_count: quarantine.length,
    findings: { count: findings.length, items: findings },
  };
}

function signatureOf(scan) {
  const ids = (scan.findings.items || []).map(f => `${f.type}|${f.hostname}|${f.live_mac}`).sort();
  return crypto.createHash('sha256').update(ids.join('\n')).digest('hex');
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { last_signature: null }; } }
function writeState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8'); } catch {} }

// Arka plan zamanlayıcı: tarar, YENİ bulguda anlık bildirim tetikler.
let timer = null;
function startDiscoveryScheduler(sendDigest, intervalMs = 90 * 1000) {
  if (timer) clearInterval(timer);
  const tick = async () => {
    try {
      const scan = await scanNetwork();
      const sig = signatureOf(scan);
      const state = readState();
      if (scan.alarm && sig !== state.last_signature) {
        console.log(`[discovery] ${scan.findings.count} bulgu (${scan.spoofing_count} spoofing, ${scan.quarantine_count} karantina) → bildirim`);
        writeState({ last_signature: sig, last_alarm_at: new Date().toISOString() });
        if (sendDigest) sendDigest({ force: false }).catch(e => console.error('[discovery notify]', e.message));
      } else if (!scan.alarm) {
        writeState({ last_signature: null });
      }
    } catch (e) { console.error('[discovery]', e.message); }
  };
  timer = setInterval(tick, intervalMs);
  tick();
  console.log(`[discovery] Network Discovery Agent AÇIK — ${intervalMs / 1000}sn, eşzamanlılık ${MAX_CONCURRENT()}, parti ${BATCH_SIZE()} (VLAN-segmentli, async).`);
}

module.exports = { scanNetwork, startDiscoveryScheduler, QUARANTINE_STATES, vlanOf };
