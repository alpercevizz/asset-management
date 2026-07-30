// ── Collector Kimlik Doğrulaması (imzalı istek + cihaz kaydı) ───────────────
//
// SORUN: /api/webhook kimlik doğrulamasız ve internete açıktı. Adresi bilen
// herkes sahte cihaz oluşturabiliyor, mevcut cihazların telemetrisini/IP'sini
// ezebiliyordu. Envanter bir güvenlik ürününün temel verisi — kirlenirse
// üzerine kurulu her tespit (shadow IT, zimmet uyuşmazlığı, EOL) yanılır.
//
// ÇÖZÜM — iki katman:
//
//  1) İMZALI İSTEK. Collector her isteği paylaşılan anahtarla HMAC-SHA256
//     imzalar. İmza gövde ÖZETİNİ de kapsar → yol üstünde değiştirilemez.
//     Zaman damgası + nonce → eski bir istek tekrar oynatılamaz (replay).
//
//  2) CİHAZ KAYDI (enrollment). Bir cihaz ilk kez paylaşılan anahtarla
//     imzaladığında sunucu O CİHAZA ÖZEL bir sır üretip döndürür; collector
//     bunu saklar ve sonraki isteklerde kullanır. Kayıtlı bir cihaz için
//     paylaşılan anahtar ARTIK KABUL EDİLMEZ.
//
//     Bu ikinci katman şunun için var: paylaşılan anahtar her makinede
//     duruyor, yerel yöneticisi olan biri okuyabilir. Tek katman olsaydı o
//     kişi İSTEDİĞİ cihaz gibi rapor gönderebilirdi. Kayıt sonrası bunu
//     yapamaz — sunucu o cihaz için yalnız cihazın kendi sırrını kabul eder.
//
// KALAN RİSK (dürüstçe): paylaşılan anahtarı ele geçiren biri HENÜZ KAYITSIZ
// bir cihaz adına YENİ kayıt açabilir. Bunu tamamen kapatmak için cihaz başına
// önceden dağıtılan kayıt jetonu (veya mTLS) gerekir. Sahte kayıtlar
// "yeni cihaz" olarak loglanır ve envanterde görünür.
const crypto = require('crypto');
const { db } = require('../../db');

// Zaman damgası penceresi. Dar tutmak saat kaymasında istekleri düşürür,
// geniş tutmak replay penceresini büyütür. 5 dk yaygın denge.
const SKEW_MS = Number(process.env.AGENT_SKEW_MS || 5 * 60 * 1000);

// off | optional | required  (varsayılan: required — güvenli taraf)
function mode() {
  const m = String(process.env.WEBHOOK_AUTH || 'required').toLowerCase();
  return ['off', 'optional', 'required'].includes(m) ? m : 'required';
}

function sharedSecret() { return process.env.AGENT_SECRET || ''; }

/* ── Replay koruması ────────────────────────────────────────────────────────
   Görülen nonce'lar pencere boyunca hatırlanır. Tek süreç için bellek yeterli;
   çok örnekli kurulumda paylaşımlı depo (Redis) gerekir — bilinçli sadelik. */
const gorulen = new Map();   // nonce → ne zaman görüldü
function nonceTaze(nonce, now) {
  if (gorulen.size > 20000) {
    for (const [k, t] of gorulen) if (now - t > SKEW_MS) gorulen.delete(k);
  }
  const onceki = gorulen.get(nonce);
  if (onceki !== undefined && now - onceki <= SKEW_MS) return false;
  gorulen.set(nonce, now);
  return true;
}

function esitMi(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* İmza tabanı. Yol ve yöntem de imzalanır ki bir uca ait imza başka bir uca
   taşınamasın; gövde özeti ile de içerik değiştirilemez. */
function imzaTabani({ timestamp, nonce, method, path, bodyHash }) {
  return [timestamp, nonce, String(method).toUpperCase(), path, bodyHash].join('\n');
}

function imzala(secret, parcalar) {
  return crypto.createHmac('sha256', secret).update(imzaTabani(parcalar)).digest('hex');
}

function govdeOzeti(raw) {
  return crypto.createHash('sha256').update(raw && raw.length ? raw : Buffer.alloc(0)).digest('hex');
}

/* ── Cihaz kaydı ───────────────────────────────────────────────────────────*/
function yeniSir() { return crypto.randomBytes(32).toString('base64'); }

async function getEnrollment(deviceId) {
  if (!deviceId) return null;
  return db()('agent_enrollments').where({ device_id: String(deviceId) }).first() || null;
}

async function enroll(deviceId, { agent_version = null, asset_id = null } = {}) {
  const secret = yeniSir();
  const satir = {
    device_id: String(deviceId),
    secret,
    asset_id,
    agent_version,
    enrolled_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    revoked: 0,
  };
  await db()('agent_enrollments').insert(satir);
  return satir;
}

async function touch(deviceId, { asset_id, agent_version, serial_number } = {}) {
  const yama = { last_seen_at: new Date().toISOString() };
  if (asset_id != null) yama.asset_id = asset_id;
  if (agent_version) yama.agent_version = agent_version;
  await db()('agent_enrollments').where({ device_id: String(deviceId) }).update(yama);
  if (serial_number) await checkClone(deviceId, serial_number);
}

/* KLON TESPİTİ. Cihaz kimliği SMBIOS UUID'den üretiliyor ama bazı üreticiler
   tüm partiye aynı UUID'yi yazıyor; sanal makineler de bozuk değer dönebiliyor.
   O zaman iki AYRI makine aynı kimliği paylaşır ve envanterde tek kayda
   çakışırlar — sessiz kalırsa iki bilgisayarı tek cihaz sanarsınız.

   Sinyal: kayıtlı kimlikten gelen SERİ NUMARASI değişirse. Ya anakart
   değişmiştir ya da klon vardır; ikisi de yöneticinin görmesi gereken durum.
   İstek REDDEDİLMEZ (meşru donanım değişimini kırmak istemiyoruz), işaretlenir. */
async function checkClone(deviceId, serial) {
  const s = String(serial).trim();
  if (!s) return null;
  const kayit = await db()('agent_enrollments').where({ device_id: String(deviceId) }).first();
  if (!kayit) return null;

  if (!kayit.serial_number) {
    await db()('agent_enrollments').where({ device_id: String(deviceId) }).update({ serial_number: s });
    return null;
  }
  if (kayit.serial_number === s) return null;

  const not = `Aynı cihaz kimliğinden farklı seri geldi: "${kayit.serial_number}" → "${s}". ` +
    'Anakart değişimi olabilir; değilse iki makine aynı kimliği paylaşıyor (sysprep yapılmamış imaj).';
  await db()('agent_enrollments').where({ device_id: String(deviceId) })
    .update({ clone_suspect: 1, clone_note: not.slice(0, 300), serial_number: s });
  console.warn(`[KLON ŞÜPHESİ] ${deviceId}: ${not}`);
  return not;
}

async function revoke(deviceId) {
  return db()('agent_enrollments').where({ device_id: String(deviceId) }).del();
}

async function listEnrollments() {
  // secret ASLA dışarı verilmez
  return db()('agent_enrollments')
    .select('device_id', 'asset_id', 'agent_version', 'enrolled_at', 'last_seen_at', 'revoked',
      'serial_number', 'clone_suspect', 'clone_note')
    .orderBy('last_seen_at', 'desc');
}

/* ── Doğrulama ─────────────────────────────────────────────────────────────
   Döner: { ok, code, reason, deviceId, enrollment, yeniKayit } */
async function verifyRequest(req) {
  const m = mode();
  if (m === 'off') return { ok: true, code: 'AUTH_KAPALI', imzasiz: true };

  const h = (n) => req.get(n) || '';
  const deviceId = h('X-AssetMan-Device').trim();
  const ts = h('X-AssetMan-Timestamp').trim();
  const nonce = h('X-AssetMan-Nonce').trim();
  const sig = h('X-AssetMan-Signature').trim();
  const agentVer = h('X-AssetMan-Agent') || null;

  const imzasiz = !sig && !ts && !nonce;
  if (imzasiz) {
    if (m === 'optional') return { ok: true, code: 'IMZASIZ_KABUL', imzasiz: true };
    return { ok: false, code: 'IMZA_YOK', reason: 'İstek imzalanmamış. Collector 1.2.0+ ve AGENT_SECRET gerekli.' };
  }

  if (!deviceId) return { ok: false, code: 'CIHAZ_YOK', reason: 'X-AssetMan-Device eksik' };
  if (!ts || !nonce || !sig) return { ok: false, code: 'BASLIK_EKSIK', reason: 'Zaman damgası, nonce veya imza eksik' };

  const now = Date.now();
  const t = Number(ts);
  if (!Number.isFinite(t)) return { ok: false, code: 'ZAMAN_GECERSIZ', reason: 'Zaman damgası sayı değil' };
  if (Math.abs(now - t) > SKEW_MS) {
    return { ok: false, code: 'ZAMAN_PENCERESI', reason: `Zaman damgası ±${SKEW_MS / 1000}sn penceresi dışında (sunucu/istemci saati uyuşmuyor olabilir)` };
  }
  if (!nonceTaze(nonce, now)) return { ok: false, code: 'TEKRAR', reason: 'Bu nonce yakın zamanda kullanıldı (replay)' };

  const parcalar = {
    timestamp: ts, nonce,
    method: req.method,
    path: req.path,
    bodyHash: govdeOzeti(req.rawBody),
  };

  const kayit = await getEnrollment(deviceId);

  // KAYITLI CİHAZ: yalnız kendi sırrı geçerli. Paylaşılan anahtar burada
  // BİLEREK reddedilir — anahtarı ele geçiren biri kayıtlı cihazı taklit edemesin.
  if (kayit && !kayit.revoked) {
    if (esitMi(sig, imzala(kayit.secret, parcalar))) {
      await touch(deviceId, { agent_version: agentVer });
      return { ok: true, code: 'CIHAZ_SIRRI', deviceId, enrollment: kayit };
    }
    // Paylaşılan anahtarla mı denedi? Ayırt etmek teşhis için değerli:
    // ya cihaz sırrını kaybetti (yeniden görüntülendi) ya da taklit var.
    const paylasilanIle = sharedSecret() && esitMi(sig, imzala(sharedSecret(), parcalar));
    return {
      ok: false,
      code: paylasilanIle ? 'KAYITLI_CIHAZ_PAYLASILAN_ANAHTAR' : 'IMZA_GECERSIZ',
      reason: paylasilanIle
        ? 'Bu cihaz kayıtlı; paylaşılan anahtar kabul edilmez. Cihaz yeniden kurulduysa kaydı sıfırlayın.'
        : 'İmza doğrulanamadı',
      deviceId,
    };
  }

  // KAYITSIZ CİHAZ: paylaşılan anahtarla imzalayıp kaydolabilir (bootstrap).
  if (!sharedSecret()) {
    return { ok: false, code: 'SUNUCU_ANAHTARSIZ', reason: 'Sunucuda AGENT_SECRET tanımlı değil' };
  }
  if (!esitMi(sig, imzala(sharedSecret(), parcalar))) {
    return { ok: false, code: 'IMZA_GECERSIZ', reason: 'İmza doğrulanamadı', deviceId };
  }
  const yeni = await enroll(deviceId, { agent_version: agentVer });
  return { ok: true, code: 'YENI_KAYIT', deviceId, enrollment: yeni, yeniKayit: true };
}

module.exports = {
  verifyRequest, mode, sharedSecret, imzala, govdeOzeti, imzaTabani,
  getEnrollment, enroll, revoke, listEnrollments, touch, checkClone, SKEW_MS,
};
