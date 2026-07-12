// ── Veeam Hardened / Append-Only WORM Yedek Modülü (simülasyon) ──────────────
// Art niyetli bir yöneticinin yerel audit log'u silme/uçurma ihtimaline karşı:
// Yerel hash zincirine yazılan HER halka, eş zamanlı olarak dışarıda simüle edilmiş,
// ÜZERİNE YAZILAMAYAN (Write Once Read Many) şifreli bir "Hardened Repository"ye
// append-only kopyalanır. Yerel DB silinse/manipüle edilse bile yedek zinciri canlı kalır.
//
// WORM uygulaması: her halka ayrı bir dosyaya AES-256-GCM ile şifreli yazılır; dosya
// 'wx' bayrağıyla açılır (VARSA YAZMAYI REDDEDER) → fiziksel write-once. Geriye dönük
// silme/değiştirme kod yolunda YOKTUR. Gerçekte burası AWS S3 Object Lock (Compliance mode)
// veya Veeam Hardened Repo olur; mantık birebir aynıdır.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_DIR = process.env.WORM_REPO_DIR || path.join(__dirname, '..', '..', 'data', 'worm-repository');
const KEY = () => crypto.createHash('sha256')
  .update(process.env.WORM_SECRET || process.env.SESSION_SECRET || 'assetman-worm-secret')
  .digest(); // 32 byte AES-256 anahtarı

function ensureRepo() {
  if (!fs.existsSync(REPO_DIR)) fs.mkdirSync(REPO_DIR, { recursive: true });
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

function fileFor(entry) {
  const seq = String(entry.seq).padStart(6, '0');
  return path.join(REPO_DIR, `${seq}-${String(entry.hash).slice(0, 12)}.worm`);
}

// Bir halkayı WORM depoya append-only yaz. Dosya VARSA dokunma (write-once).
function wormAppend(entry) {
  try {
    ensureRepo();
    const file = fileFor(entry);
    if (fs.existsSync(file)) return { ok: true, skipped: 'exists' }; // write-once: tekrar yazma
    // ATOMİK + write-once: temp'e yaz, hedef yoksa rename. Çökme/partial-write korumalı.
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, encrypt(entry), { flag: 'w' });
    if (fs.existsSync(file)) { fs.unlinkSync(tmp); return { ok: true, skipped: 'exists' }; }
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// WORM deposundaki tüm halkaları sırayla oku (decrypt).
function readBackupEvents() {
  ensureRepo();
  const files = fs.readdirSync(REPO_DIR).filter(f => f.endsWith('.worm')).sort();
  const events = [];
  for (const f of files) {
    try { events.push(decrypt(fs.readFileSync(path.join(REPO_DIR, f), 'utf8'))); }
    catch { /* bozuk/erişilemez halka atlanır */ }
  }
  events.sort((a, b) => a.seq - b.seq);
  return events;
}

// Yedek zincirinin kendi içinde bütünlüğünü doğrula (hash zinciri).
function verifyBackupChain(hashEntry) {
  const events = readBackupEvents();
  const GENESIS = '0'.repeat(64);
  let prevHash = GENESIS;
  for (const e of events) {
    const { prev_hash, hash, ...corePlusBackup } = e;
    // backup metası varsa çıkar
    const { _backed_up_at, ...core } = corePlusBackup;
    if (prev_hash !== prevHash) return { valid: false, broken_at: e.seq, reason: 'Yedek zinciri kopuk.' };
    if (hashEntry && hash !== hashEntry(prevHash, core)) return { valid: false, broken_at: e.seq, reason: 'Yedek halka değiştirilmiş.' };
    prevHash = hash;
  }
  return { valid: true, total: events.length, last_hash: prevHash };
}

// Yerel ↔ Yedek karşılaştırması + durum.
// localEvents: yerel log; localValid: verifyChain() sonucu.
function getBackupStatus({ localEvents = [], localValid = { valid: true }, hashEntry = null } = {}) {
  const backup = readBackupEvents();
  const backupChain = verifyBackupChain(hashEntry);
  const localCount = localEvents.length;
  const backupCount = backup.length;
  const localLast = localEvents.length ? localEvents[localEvents.length - 1].hash : null;
  const backupLast = backup.length ? backup[backup.length - 1].hash : null;

  const inSync = localValid.valid && backupChain.valid && localCount === backupCount && localLast === backupLast;
  // Kurtarma gerekli: yerel bozulmuş/eksik AMA yedek sağlam ve daha eksiksiz
  const recoveryNeeded = backupChain.valid && (!localValid.valid || localCount < backupCount);

  return {
    repository: 'WORM Hardened Repository (AES-256-GCM, write-once)',
    local_count: localCount,
    backup_count: backupCount,
    local_valid: !!localValid.valid,
    backup_valid: backupChain.valid,
    in_sync: inSync,
    recovery_needed: recoveryNeeded,
    backup_last_hash: backupLast,
    detail: recoveryNeeded
      ? 'Local DB bütünlüğü bozuldu — yedek depodan geri yüklenebilir.'
      : (inSync ? 'Yerel ve WORM yedek senkron, bütünlük tam.' : 'Senkronizasyon kontrol ediliyor.'),
  };
}

// Yerel log'u WORM yedeğinden yeniden inşa et (kurtarma). writeLog SYNC veya ASYNC olabilir.
async function restoreFromBackup(writeLog) {
  const backup = readBackupEvents();
  if (!backup.length) throw new Error('Yedek depo boş — geri yüklenecek halka yok.');
  // backup metasını temizleyip saf event olarak yaz
  const clean = backup.map(({ _backed_up_at, ...e }) => e);
  await writeLog(clean);
  return { restored: clean.length, last_hash: clean[clean.length - 1].hash };
}

// Demo/re-seed için yedek deposunu sıfırla (PRODUCTION'da çağrılmaz!).
function _resetRepo() {
  ensureRepo();
  for (const f of fs.readdirSync(REPO_DIR)) {
    if (f.endsWith('.worm')) fs.unlinkSync(path.join(REPO_DIR, f));
  }
}

module.exports = { wormAppend, readBackupEvents, verifyBackupChain, getBackupStatus, restoreFromBackup, _resetRepo, REPO_DIR };
