// ── İlk Açılış Setup Wizard ─────────────────────────────────────────────────
// PRODUCTION deploy'da secret'ları elle set etmeden başlatmak istemez.
// Bu modül:
//   1) SESSION/CHAIN/WORM_SECRET boşsa/zayıfsa data/secrets.json'a KALICI güçlü sırlar üretir.
//      Elle .env'ye set edilmişse ONLARI kullanır (env her zaman öncelikli).
//   2) İlk açılışta process.env'yi doldurur → checkSecrets ve modüller aynı değeri görür.
//   3) Yeniden başlatmada aynı dosyadan yükler → cookie/imza/WORM anahtarları KORUNUR.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRETS_FILE = process.env.SECRETS_FILE || path.join(__dirname, '..', 'data', 'secrets.json');
const KEYS = ['SESSION_SECRET', 'CHAIN_SECRET', 'WORM_SECRET'];
const DEFAULT = 'assetman-demo-secret-degistir';

function strong(v) {
  return v && v !== DEFAULT && String(v).length >= 32;
}
function gen() {
  return crypto.randomBytes(48).toString('base64').replace(/[+/=]/g, '');
}
function readSecrets() {
  try { return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')); } catch { return {}; }
}
function writeSecrets(obj) {
  try { fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true }); } catch {}
  const tmp = SECRETS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SECRETS_FILE);
  try { fs.chmodSync(SECRETS_FILE, 0o600); } catch {}
}

// Sunucu boot'unda ilk olarak çağrılır — env yoksa data/secrets.json'dan doldurur.
function bootstrapSecrets() {
  const stored = readSecrets();
  const changes = [];
  let saved = false;
  for (const k of KEYS) {
    // 1) Env'de güçlü sır varsa dokunma
    if (strong(process.env[k])) { changes.push(`${k}: env`); continue; }
    // 2) Dosyada güçlü sır varsa process.env'ye yükle
    if (strong(stored[k])) { process.env[k] = stored[k]; changes.push(`${k}: file`); continue; }
    // 3) Yoksa üret + dosyaya yaz
    const v = gen();
    process.env[k] = v;
    stored[k] = v;
    saved = true;
    changes.push(`${k}: generated`);
  }
  if (saved) {
    stored._comment = 'AssetMan otomatik üretilmiş sırlar. ELLE PAYLAŞMAYIN. Dosya sadece kullanıcı okumalı (chmod 600).';
    stored._generated_at = new Date().toISOString();
    writeSecrets(stored);
  }
  console.log('[setup] Sır kaynakları:', changes.join(', '));
  return { saved };
}

module.exports = { bootstrapSecrets, SECRETS_FILE };
