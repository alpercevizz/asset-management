// ── OS Agent — MAC/IP Spoofing (Klonlama) Kalkanı ───────────────────────────
// Kurumsal ağda MAC taklit edilebilir; ağ katmanı kimliğine GÜVENİLMEZ.
// Her yönetilen cihazın işletim sisteminde çalışan şifreli bir "OS Agent" servisi vardır;
// her cihaza enrollment anında benzersiz bir SECRET verilir. Cihaz ağda görününce backend
// agent ile el sıkışır (challenge-response): agent, secret'ı ile HMAC token üretir; backend
// kayıtlı secret'tan beklenen token'ı hesaplayıp sabit-zamanlı karşılaştırır.
// MAC doğru olsa BİLE token uyuşmazsa → KLONLANMIŞ CİHAZ ŞÜPHESİ (spoofing).
// TAMAMEN YEREL simülasyon — gerçekte agent imzalı token'ı TLS ile gönderir; mantık birebir aynı.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENTS_FILE = process.env.OS_AGENTS_FILE || path.join(__dirname, '..', '..', 'data', 'os-agents.json');

// Hangi cihazlar OS Agent ile yönetilir (kritik/kurumsal). Enrollment'ta secret atanır.
// Demo: bilgisayar + sunucu + ağ aygıtları enroll'lu sayılır.
function seedAgents() {
  // (asset_id, hostname, os) — secret rastgele üretilir
  const devs = [
    [6, 'ALPER-PC', 'Windows 11'], [7, 'DELL-IT-01', 'Windows 11'], [8, 'LENOVO-DEV-02', 'Windows 11'],
    [9, 'HP-MUHASEBE', 'Windows 10'], [29, 'DC-SRV-01', 'Windows Server 2022'],
    [30, 'FILE-SRV-01', 'Windows Server 2019'], [31, 'VMHOST-01', 'VMware ESXi 8.0'],
    [32, 'DB-SRV-01', 'Ubuntu 22.04 LTS'], [19, 'CISCO-SW-CORE', 'Cisco IOS'], [20, 'FORTIGATE-FW', 'FortiOS'],
  ];
  return devs.map(([asset_id, hostname, os]) => ({
    asset_id, hostname, os,
    agent_id: 'AGT-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    secret: crypto.randomBytes(24).toString('base64'),
    enrolled_at: new Date().toISOString(),
    agent_version: '1.0.0',
  }));
}

let _cache = null;
function loadAgents() {
  if (_cache) return _cache;
  try {
    const j = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
    if (Array.isArray(j.agents) && j.agents.length) { _cache = j.agents; return _cache; }
  } catch { /* yok → tohumla */ }
  _cache = seedAgents();
  try { fs.writeFileSync(AGENTS_FILE, JSON.stringify({ _comment: 'OS Agent enrollment — secret\'lar gizli. ASLA paylaşma.', agents: _cache }, null, 2), 'utf8'); }
  catch (e) { console.error('[os-agent] yazılamadı:', e.message); }
  return _cache;
}

function findByAsset(asset_id) {
  if (asset_id == null) return null;
  return loadAgents().find(a => Number(a.asset_id) === Number(asset_id)) || null;
}

// Günlük challenge bucket (token zaman penceresi). Gerçekte nonce; demo'da deterministik gün.
function challengeBucket() { return new Date().toISOString().slice(0, 10); }

// Bir cihazın OS Agent'ının ÜRETMESİ gereken token (agent tarafı — feed'i tohumlarken kullanılır)
function expectedToken(agent) {
  return crypto.createHmac('sha256', agent.secret)
    .update(`${agent.agent_id}|${challengeBucket()}`).digest('hex');
}

// ── Handshake doğrulama ──────────────────────────────────────────────────────
// asset: envanter kaydı; presentedToken: ağda görünen cihazın agent'ının sunduğu token.
// Döner: { managed, verified, reason }
//  managed=false → cihaz OS Agent ile yönetilmiyor (enrollment yok) — spoofing değil, "yönetilmeyen".
//  verified=true  → token kayıtlı secret ile eşleşti → GERÇEK cihaz.
//  verified=false → managed ama token yok/uyuşmuyor → KLONLANMIŞ CİHAZ ŞÜPHESİ.
function verifyOsAgent(asset, presentedToken) {
  const agent = findByAsset(asset && asset.id);
  if (!agent) return { managed: false, verified: false, reason: 'enrollment_yok' };
  if (!presentedToken) return { managed: true, verified: false, reason: 'agent_yanit_yok', agent_id: agent.agent_id };
  const expected = expectedToken(agent);
  const a = Buffer.from(String(presentedToken)), b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { managed: true, verified: ok, reason: ok ? 'dogrulandi' : 'token_uyusmuyor', agent_id: agent.agent_id };
}

// Demo feed'i tohumlarken: bir cihazın GERÇEK token'ını üret (legit), spoof için bozuk ver.
function genTokenForAsset(asset_id) {
  const agent = findByAsset(asset_id);
  return agent ? expectedToken(agent) : null;
}

function stats() {
  const agents = loadAgents();
  return { enrolled: agents.length, agent_version: agents[0] && agents[0].agent_version };
}

module.exports = { verifyOsAgent, genTokenForAsset, findByAsset, expectedToken, stats, loadAgents };
