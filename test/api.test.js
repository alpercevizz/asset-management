/* ── AssetMan API Entegrasyon Testleri ───────────────────────────────────────
   Bu testler KARAKTERİZASYON testidir: bugünkü davranışı kilitler. Amaç
   "doğru mu" sorusunu değil, "refactor sonrası AYNI mı" sorusunu yanıtlamak.

   Neden alt süreç: sunucu gerçek bir HTTP sunucusu olarak başlatılır ve
   istekler ağ üzerinden gider. server.js'i require etmek modül seviyesinde
   yan etki çalıştırır ve gerçek kurulumu atlar; kara kutu testi router'ları
   ayırdığımızda da geçerli kalır.

   İZOLASYON: geçici SQLite + INVENTORY_PROVIDER=sql. Gerçek envantere
   (Baserow) tek bir istek bile gitmez — testin canlı veriyi kirletmesi
   kabul edilemez. */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.API_TEST_PORT || 3123);
const KOK = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assetman-api-'));
const SIFRE = 'admin123';

let sunucu = null;
let cerez = '';

function istek(yol, { method = 'GET', body = null, cookie = cerez, headers = {} } = {}) {
  return new Promise((cozumle, reddet) => {
    const veri = body === null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: yol, method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(veri ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(veri) } : {}),
        ...headers,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch { /* HTML veya boş olabilir */ }
        cozumle({ durum: res.statusCode, basliklar: res.headers, govde: d, json });
      });
    });
    req.on('error', reddet);
    if (veri) req.write(veri);
    req.end();
  });
}

async function hazirBekle(saniye = 40) {
  for (let i = 0; i < saniye * 2; i++) {
    try {
      const r = await istek('/api/health', { cookie: '' });
      if (r.durum && r.durum < 500) return true;
    } catch { /* henüz dinlemiyor */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

before(async () => {
  /* cwd BİLEREK geçici dizin: server.js `dotenv.config({override:true})`
     çağırıyor, yani .env GERÇEK ortam değişkenlerini EZİYOR. Projede .env
     olan bir dizinden başlatılırsa testin PORT/INVENTORY_PROVIDER ayarları
     yok sayılır ve test gerçek Baserow'a çıkardı. dotenv .env'i cwd'den
     okuduğu için boş bir dizinden başlatmak sorunu çözüyor.
     (server.js tüm yollarını __dirname'den kurduğu için cwd değişebilir.) */
  sunucu = spawn(process.execPath, [path.join(KOK, 'server.js')], {
    cwd: TMP,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      DATABASE_URL: 'sqlite:' + path.join(TMP, 'api.db'),
      INVENTORY_PROVIDER: 'sql',        // Baserow'a ÇIKMA
      AUTH_PROVIDER: 'local',
      AI_PROVIDER: 'none',              // rapor yorumu kural yedeğine düşer
      FX_PROVIDER: 'static',
      WORM_REPO_DIR: path.join(TMP, 'worm'),
      SESSION_SECRET: 'api-test-secret-en-az-otuziki-karakter-uzun!!',
      CHAIN_SECRET: 'api-test-chain-secret-en-az-otuziki-karakter!',
      WORM_SECRET: 'api-test-worm-secret-en-az-otuziki-karakterrr!',
      APP_PASSWORD: SIFRE,
      SUPPRESS_PASSWORD_LOG: '1',
      DISABLE_LOGIN_RATE_LIMIT: 'true',
      NOTIFY_ENABLED: 'false',
      SNMP_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  sunucu.stdout.on('data', (d) => { log += d; });
  sunucu.stderr.on('data', (d) => { log += d; });

  const hazir = await hazirBekle();
  if (!hazir) {
    sunucu.kill('SIGKILL');
    throw new Error('Test sunucusu ayağa kalkmadı:\n' + log.slice(-1500));
  }
});

after(() => {
  if (sunucu && !sunucu.killed) sunucu.kill('SIGKILL');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows kilidi */ }
});

/* 1) Kimlik doğrulama sınırı — korunan uçlar oturumsuz erişilemez. */
test('API: oturumsuz istek 401 döner, public uçlar açık kalır', async () => {
  const korunan = await istek('/api/assets', { cookie: '' });
  assert.equal(korunan.durum, 401);
  assert.equal(korunan.json?.code, 'UNAUTHORIZED',
    'istemci oturum bitişini bu koda göre ayırt ediyor (app.js fetch sarmalayıcısı)');

  const acik = await istek('/api/health', { cookie: '' });
  assert.ok(acik.durum < 400, '/health public kalmalı — izleme buna bakıyor');
});

test('API: hatalı parola reddedilir, doğru parola oturum açar', async () => {
  const yanlis = await istek('/api/login', { method: 'POST', body: { username: 'admin', password: 'yanlis' }, cookie: '' });
  assert.equal(yanlis.durum, 401);
  assert.ok(!yanlis.basliklar['set-cookie'], 'başarısız girişte çerez verilmemeli');

  const dogru = await istek('/api/login', { method: 'POST', body: { username: 'admin', password: SIFRE }, cookie: '' });
  assert.equal(dogru.durum, 200);
  const ck = dogru.basliklar['set-cookie'];
  assert.ok(ck && ck.length, 'başarılı girişte çerez gelmeli');
  assert.ok(String(ck).includes('HttpOnly'), 'oturum çerezi HttpOnly olmalı (XSS ile okunamasın)');
  cerez = ck.map((c) => c.split(';')[0]).join('; ');
});

/* 2) Okuma uçları — refactor sonrası hepsi aynı durum kodunu vermeli.
   Liste GENİŞ tutuldu: router ayrımında bir yolu taşımayı unutursak burada
   patlar, tarayıcıda değil. */
const OKUMA_UCLARI = [
  '/api/me', '/api/assets', '/api/stats', '/api/agents', '/api/licenses', '/api/licenses/stats',
  '/api/anomalies', '/api/alerts/offline', '/api/licenses/compliance', '/api/shadow-it',
  '/api/eol-os', '/api/warranty', '/api/risk-scores', '/api/forecast', '/api/lines',
  '/api/assignments', '/api/assignments/mismatches', '/api/location-drift', '/api/location-summary',
  '/api/trends?days=30', '/api/backup/status', '/api/lifecycle/log', '/api/lifecycle/conflicts',
  '/api/locations/geo',
  '/api/lifecycle/verify', '/api/settings', '/api/users', '/api/register/tokens',
];

test('API: tüm okuma uçları 200 ve JSON döner', async () => {
  const hatalar = [];
  for (const yol of OKUMA_UCLARI) {
    const r = await istek(yol);
    if (r.durum !== 200) hatalar.push(`${yol} -> ${r.durum}`);
    else if (r.json === null) hatalar.push(`${yol} -> JSON değil`);
  }
  assert.deepEqual(hatalar, [], 'bozulan uçlar');
});

/* 3) Panel HTML'i parçalardan birleşiyor ve tek dosya olarak servis ediliyor. */
test('API: panel HTML birleştirilmiş halde geliyor, parçalar tek başına servis edilmiyor', async () => {
  const panel = await istek('/');
  assert.equal(panel.durum, 200);
  assert.ok(panel.govde.includes('id="view-dashboard"'), 'dashboard görünümü eksik');
  assert.ok(panel.govde.includes('id="view-settings"'), 'settings görünümü eksik');
  assert.ok(panel.govde.includes('id="lineModalOverlay"'), 'hat modalı eksik');
  assert.ok(!panel.govde.includes('<!--#include'), 'çözülmemiş include işareti kalmış');

  const parca = await istek('/parts/views/assets.html');
  assert.equal(parca.durum, 404, 'parçalar ayrı sayfa değil, doğrudan servis edilmemeli');
});

test('API: oturumsuz panel isteği login sayfasına yönlendirir', async () => {
  const r = await istek('/', { cookie: '' });
  assert.equal(r.durum, 302);
  assert.equal(r.basliklar.location, '/login');
});

/* 4) Yazma ucu — doğrulama çalışıyor mu (kayıt OLUŞTURMADAN). */
test('API: eksik alanla hat kaydı reddedilir', async () => {
  const r = await istek('/api/lines', { method: 'POST', body: { operator: 'Turkcell' } });
  assert.ok(r.durum >= 400 && r.durum < 500, `beklenen 4xx, gelen ${r.durum}`);
});

/* 5) Rapor yorumu — model yokken bile HER ZAMAN metin döner (kural yedeği).
   Raporun yorumsuz çıkmaması ürün kararıydı; testi bunu kilitler. */
test('API: rapor yorumu model olmadan da metin döndürür', async () => {
  const r = await istek('/api/reports/ai-comment', { method: 'POST', body: {} });
  assert.equal(r.durum, 200);
  assert.ok(typeof r.json?.metin === 'string' && r.json.metin.length > 10, 'yorum metni boş');
  assert.equal(r.json.kaynak, 'kural', 'AI kapalıyken kural yedeğine düşmeli');
  assert.ok(!('model' in r.json) && !('provider' in r.json),
    'yanıt sağlayıcı/model adı sızdırmamalı — müşteriye altyapı gösterilmiyor');
});

/* ── QR / Toplu Kayıt uçları ─────────────────────────────────────────────────
   Bu blok, register route'ları routes/ altına taşınmadan ÖNCE yazıldı: en
   güvenlik-hassas uçları (jeton üretimi, tek kullanım, iptal) taşımadan önce
   HTTP seviyesinde kilitlemek gerekiyordu.

   Hiçbir test CİHAZ KAYDI OLUŞTURMAZ — yalnız jeton yaşam döngüsü ve plan
   önizlemesi denenir. Kayıt oluşturan uçlar (bulk/confirm) tek kullanımlık
   jeton tükettiği için testte tetiklenmez. */

test('API: QR jetonu üretilir, listelenir, durumu okunur ve iptal edilir', async () => {
  const uret = await istek('/api/register/token', { method: 'POST', body: { hours: 1, uses: 1 } });
  assert.equal(uret.durum, 200);
  const jti = uret.json?.jti;
  assert.ok(jti, 'jeton kimliği (jti) dönmedi');
  assert.ok(uret.json.token, 'imzalı jeton dönmedi');
  assert.equal(uret.json.max_uses, 1);

  const liste = await istek('/api/register/tokens');
  assert.equal(liste.durum, 200);
  assert.ok((liste.json?.results || []).some((t) => t.jti === jti), 'üretilen jeton listede yok');

  const durum = await istek(`/api/register/tokens/${jti}`);
  assert.equal(durum.durum, 200);
  assert.equal(durum.json?.jti, jti);
  assert.equal(durum.json?.asset, null, 'henüz kayıt olmadığı için asset null olmalı');

  const iptal = await istek(`/api/register/tokens/${jti}`, { method: 'DELETE' });
  assert.equal(iptal.durum, 200);
  assert.equal(iptal.json?.success, true);

  // İptalden sonra jeton ya kaybolur ya "iptal" işaretlenir; ikisi de kabul
  const sonra = await istek('/api/register/tokens');
  const kalan = (sonra.json?.results || []).find((t) => t.jti === jti);
  assert.ok(!kalan || kalan.revoked || kalan.status === 'iptal', 'iptal edilen jeton hâlâ etkin görünüyor');
});

test('API: olmayan jetonun durumu 404 döner', async () => {
  const r = await istek('/api/register/tokens/olmayan-jeton-123');
  assert.equal(r.durum, 404);
});

test('API: toplu depo önizlemesi kayıt OLUŞTURMADAN plan döndürür', async () => {
  const oncesi = await istek('/api/assets');
  const oncekiSayi = oncesi.json?.count ?? (oncesi.json?.results || []).length;

  const on = await istek('/api/register/bulk/preview?category=Tablet&quantity=3');
  assert.equal(on.durum, 200);
  assert.ok(Array.isArray(on.json?.hostnames) || Array.isArray(on.json?.names) || on.json?.quantity,
    'plan içeriği beklenen biçimde değil: ' + JSON.stringify(on.json).slice(0, 120));

  const sonrasi = await istek('/api/assets');
  const sonrakiSayi = sonrasi.json?.count ?? (sonrasi.json?.results || []).length;
  assert.equal(sonrakiSayi, oncekiSayi, 'önizleme envanteri değiştirmiş — sadece okumalı');
});

test('API: toplu onay kodu üretilir ve iptal edilir (kayıt oluşmaz)', async () => {
  const oncesi = await istek('/api/assets');
  const oncekiSayi = oncesi.json?.count ?? (oncesi.json?.results || []).length;

  const uret = await istek('/api/register/bulk/token', {
    method: 'POST', body: { category: 'Tablet', quantity: 2, minutes: 10 },
  });
  assert.equal(uret.durum, 200);
  const jti = uret.json?.jti;
  assert.ok(jti, 'toplu jeton kimliği dönmedi');
  assert.ok(uret.json?.plan, 'jetonla birlikte plan dönmeli (telefon ekranında gösteriliyor)');

  // Peek: planı okur ama jetonu TÜKETMEZ
  const bak = await istek(`/api/register/bulk/token/${jti}`);
  assert.equal(bak.durum, 200);

  const iptal = await istek(`/api/register/bulk/token/${jti}`, { method: 'DELETE' });
  assert.equal(iptal.durum, 200);

  const sonrasi = await istek('/api/assets');
  const sonrakiSayi = sonrasi.json?.count ?? (sonrasi.json?.results || []).length;
  assert.equal(sonrakiSayi, oncekiSayi, 'jeton üretimi envantere kayıt eklemiş olmamalı');
});

/* QR ve toplu onay SAYFALARI kök yoldan servis edilir; router'a taşınsalardı
   URL'leri /api/register olurdu ve cihaz kayıt ucuyla çakışırdı. Bu test o
   ayrımı kilitler — telefon bu sayfalara oturum AÇMADAN gelir. */
test('API: QR ve toplu onay sayfaları kök yoldan, oturumsuz açılır', async () => {
  const kayit = await istek('/register', { cookie: '' });
  assert.equal(kayit.durum, 200, 'QR kayıt sayfası açılmıyor');
  assert.ok(/<html/i.test(kayit.govde), 'HTML dönmedi');

  const onay = await istek('/bulk-confirm', { cookie: '' });
  assert.equal(onay.durum, 200, 'toplu onay sayfası açılmıyor');
  assert.ok(/<html/i.test(onay.govde), 'HTML dönmedi');

  // QR üretimi de public (telefon oturum açamaz)
  const qr = await istek('/api/qr?data=test', { cookie: '' });
  assert.equal(qr.durum, 200);
  assert.ok(/<svg/i.test(qr.govde), 'QR SVG dönmedi');
});

test('API: QR jeton uçları yetkisiz kullanıcıya kapalı', async () => {
  const r = await istek('/api/register/token', { method: 'POST', body: { hours: 1 }, cookie: '' });
  assert.equal(r.durum, 401, 'oturumsuz jeton üretilebiliyor');
});
