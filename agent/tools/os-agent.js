// ── OS Agent — MAC/IP Spoofing (Klonlama) Kalkanı (SQL destekli) ─────────────
// Her yönetilen cihazın OS'unda çalışan agent, backend ile HMAC handshake yapar.
// Enrollment (asset_id, agent_id, secret) DB'de tutulur; secret asla dış paylaşılmaz.
// MAC doğru olsa BİLE token uyuşmazsa → KLONLANMIŞ CİHAZ ŞÜPHESİ (spoofing).
const crypto = require('crypto');
const { db } = require('../../db');

function seedAgentDefs() {
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
let _cacheReady = false;

async function init() {
  const k = db();
  const [row] = await k('os_agents').count({ n: '*' });
  if (Number(row.n) === 0) {
    await k('os_agents').insert(seedAgentDefs());
  }
  _cache = await k('os_agents').select('*').orderBy('id');
  _cacheReady = true;
}

function _ensure() { if (!_cacheReady) throw new Error('os-agent.init() çağrılmadı.'); }

function loadAgents() { _ensure(); return _cache; }

function findByAsset(asset_id) {
  if (asset_id == null) return null;
  _ensure();
  return _cache.find(a => Number(a.asset_id) === Number(asset_id)) || null;
}

function challengeBucket() { return new Date().toISOString().slice(0, 10); }

function expectedToken(agent) {
  return crypto.createHmac('sha256', agent.secret)
    .update(`${agent.agent_id}|${challengeBucket()}`).digest('hex');
}

function verifyOsAgent(asset, presentedToken) {
  const agent = findByAsset(asset && asset.id);
  if (!agent) return { managed: false, verified: false, reason: 'enrollment_yok' };
  if (!presentedToken) return { managed: true, verified: false, reason: 'agent_yanit_yok', agent_id: agent.agent_id };
  const expected = expectedToken(agent);
  const a = Buffer.from(String(presentedToken)), b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { managed: true, verified: ok, reason: ok ? 'dogrulandi' : 'token_uyusmuyor', agent_id: agent.agent_id };
}

function genTokenForAsset(asset_id) {
  const agent = findByAsset(asset_id);
  return agent ? expectedToken(agent) : null;
}

function stats() {
  const agents = _cacheReady ? _cache : [];
  return { enrolled: agents.length, agent_version: agents[0] && agents[0].agent_version };
}

module.exports = { init, verifyOsAgent, genTokenForAsset, findByAsset, expectedToken, stats, loadAgents };
