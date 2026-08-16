/* ── Giriş Rate-Limit Testi ──────────────────────────────────────────────────
   Brute-force koruması gerçekten kilitliyor mu? Ayrı dosya çünkü limiter'ın
   AÇIK olması gerekiyor (diğer testler DISABLE_LOGIN_RATE_LIMIT=true ile
   çalışıyor, yoksa başarısız girişleri kovayı doldurup birbirini bozardı).

   Bu KENDİ yerel sunucumuza karşı bir kilitlenme denemesi — üçüncü tarafa
   brute-force değil, savunmanın devreye girdiğinin kanıtı. */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.RL_TEST_PORT || 3127);
const KOK = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assetman-rl-'));

let sunucu = null;

function istek(body) {
  return new Promise((cozumle, reddet) => {
    const veri = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(veri) },
    }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => cozumle({ durum: res.statusCode, basliklar: res.headers }));
    });
    req.on('error', reddet);
    req.write(veri); req.end();
  });
}

async function hazirBekle(saniye = 40) {
  for (let i = 0; i < saniye * 2; i++) {
    try {
      await new Promise((c, r) => http.get({ host: '127.0.0.1', port: PORT, path: '/api/health' }, (x) => { x.resume(); x.on('end', c); }).on('error', r));
      return true;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return false;
}

before(async () => {
  sunucu = spawn(process.execPath, [path.join(KOK, 'server.js')], {
    cwd: TMP,
    env: {
      ...process.env,
      PORT: String(PORT), NODE_ENV: 'test',
      DATABASE_URL: 'sqlite:' + path.join(TMP, 'rl.db'),
      INVENTORY_PROVIDER: 'sql', AUTH_PROVIDER: 'local', AI_PROVIDER: 'none', FX_PROVIDER: 'static',
      WORM_REPO_DIR: path.join(TMP, 'worm'),
      SESSION_SECRET: 'rl-test-secret-en-az-otuziki-karakter-uzunnn!',
      CHAIN_SECRET: 'rl-test-chain-secret-en-az-otuziki-karakter!',
      WORM_SECRET: 'rl-test-worm-secret-en-az-otuziki-karakterrrr!',
      APP_PASSWORD: 'admin123',
      SUPPRESS_PASSWORD_LOG: '1',
      // ÖNEMLİ: limiter AÇIK (disable flag'i YOK) — asıl test edilen bu.
      NOTIFY_ENABLED: 'false', SNMP_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  sunucu.stdout.on('data', (d) => { log += d; });
  sunucu.stderr.on('data', (d) => { log += d; });
  if (!(await hazirBekle())) { sunucu.kill('SIGKILL'); throw new Error('Rate-limit sunucusu kalkmadı:\n' + log.slice(-1000)); }
});

after(() => {
  if (sunucu && !sunucu.killed) sunucu.kill('SIGKILL');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows kilidi */ }
});

test('RATE-LIMIT: art arda hatalı giriş kilitlenmeye yol açar (429 + Retry-After)', async () => {
  // Eşik 15 dk'da 10 deneme. 12 hatalı deneme → sonlarda 429 görülmeli.
  const kodlar = [];
  for (let i = 0; i < 12; i++) {
    const r = await istek({ username: 'admin', password: 'yanlis-' + i });
    kodlar.push(r.durum);
  }
  assert.ok(kodlar.includes(429), `12 hatalı denemede 429 (kilit) çıkmadı: ${kodlar.join(',')}`);

  // Kilit sırasında DOĞRU parola bile reddedilir (kilit IP bazlı, parolaya bakmaz)
  const dogru = await istek({ username: 'admin', password: 'admin123' });
  assert.equal(dogru.durum, 429, 'kilit sırasında doğru parola geçti — limiter parolaya göre atlıyor');
  assert.ok(dogru.basliklar['retry-after'], 'Retry-After başlığı yok (istemci ne zaman deneyeceğini bilemez)');
});
