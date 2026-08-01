// ── Toplu Kayıt Onay Jetonu ─────────────────────────────────────────────────
//
// NEDEN: TV/kiosk ekranında klavye ve fare yok. Operatör planı ekranda kurar,
// QR'ı telefonuyla okutup onaylar; kayıtlar o anda oluşur.
//
// TASARIM KARARLARI:
//
//  1) PLAN JETONA DONDURULUR. Kategori/adet/lokasyon/önek veritabanında
//     saklanır; onay isteği bu alanları GÖNDERMEZ, sunucu jetondan okur.
//     Telefon yalnızca "evet" diyebilir. Aksi halde QR'ı gören biri adedi
//     200'e çekip envanteri şişirebilirdi.
//
//  2) KISA ÖMÜR (varsayılan 5 dk). Bu bir "şimdi okut" akışı; basılı QR
//     senaryosu değil. Uzun ömür, ekranı gören birinin sonradan kullanması
//     demek olurdu.
//
//  3) TEK KULLANIM. Onay bir kez işler; sayaç koşullu UPDATE ile tüketilir,
//     iki telefon aynı anda okutursa yalnız biri geçer.
//
// KALAN RİSK (dürüstçe): QR ekranda görünürken onu okutan herkes onayı
// verebilir. Zarar SINIRLI — yalnızca operatörün zaten kurduğu plan uygulanır.
// Tam kapatmak için telefonda oturum şartı gerekir; o da kiosk akışının
// amacını (klavyesiz onay) bozar.
const crypto = require('crypto');
const { db } = require('../../db');

const VARSAYILAN_DK = Number(process.env.BULK_TOKEN_MINUTES || 5);
const AZAMI_DK = 30;

function sir() { return process.env.REGISTER_SECRET || ''; }

function b64u(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uCoz(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function imzala(govde) {
  return crypto.createHmac('sha256', sir()).update(govde).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function esitMi(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* Jeton üret — planı dondurur. */
async function create({ category, quantity, location = '', prefix = '', minutes, by = 'system' }) {
  if (!sir()) throw new Error('REGISTER_SECRET tanımlı değil');
  const qty = parseInt(quantity, 10);
  if (!qty || qty < 1 || qty > 200) throw new Error('quantity 1-200 arası olmalı');
  const dk = Math.min(Math.max(Number(minutes) || VARSAYILAN_DK, 1), AZAMI_DK);

  const jti = crypto.randomBytes(12).toString('hex');
  const exp = Date.now() + dk * 60 * 1000;
  // typ: bu jetonun QR kayıt jetonuyla karıştırılmaması için
  const govde = b64u(JSON.stringify({ jti, exp, typ: 'bulk' }));
  const token = `${govde}.${imzala(govde)}`;

  await db()('bulk_tokens').insert({
    jti,
    created_at: new Date().toISOString(),
    created_by: String(by).slice(0, 128),
    expires_at: new Date(exp).toISOString(),
    category: String(category || 'Diğer').slice(0, 64),
    quantity: qty,
    location: String(location || '').slice(0, 190),
    prefix: String(prefix || '').slice(0, 64),
    revoked: 0,
  });
  return { token, jti, expires_at: new Date(exp).toISOString(), minutes: dk };
}

/* Yalnız OKUR — onay sayfası planı göstermek için kullanır, tüketmez. */
async function peek(token) {
  const c = coz(token);
  if (!c.ok) return c;
  const satir = await db()('bulk_tokens').where({ jti: c.jti }).first();
  if (!satir) return { ok: false, code: 'JETON_BULUNAMADI', reason: 'Onay kodu tanınmıyor' };
  if (satir.revoked) return { ok: false, code: 'IPTAL', reason: 'Bu onay iptal edilmiş' };
  if (satir.used_at) return { ok: false, code: 'KULLANILDI', reason: 'Bu onay zaten kullanılmış', satir };
  /* Süre HEM imzadan HEM veritabanından denetlenir. İkisi aynı değerden
     üretiliyor, ama yalnız imzaya bakmak süreyi tek yere bağlardı: satırın
     süresi elle kısaltılsa bile jeton geçerli kalırdı. */
  if (new Date(satir.expires_at).getTime() <= Date.now()) {
    return { ok: false, code: 'SURE_DOLDU', reason: 'Onay kodunun süresi doldu. Ekrandan yenisini üretin.' };
  }
  return { ok: true, jti: c.jti, satir };
}

function coz(token) {
  if (!sir()) return { ok: false, code: 'SUNUCU_ANAHTARSIZ', reason: 'Sunucuda REGISTER_SECRET tanımlı değil' };
  const t = String(token || '').trim();
  if (!t) return { ok: false, code: 'JETON_YOK', reason: 'Onay kodu eksik' };
  const [govde, sig] = t.split('.');
  if (!govde || !sig) return { ok: false, code: 'JETON_BOZUK', reason: 'Onay kodu geçersiz' };
  if (!esitMi(sig, imzala(govde))) return { ok: false, code: 'IMZA_GECERSIZ', reason: 'Onay kodu doğrulanamadı' };
  let v;
  try { v = JSON.parse(b64uCoz(govde)); } catch { return { ok: false, code: 'JETON_BOZUK', reason: 'Onay kodu okunamadı' }; }
  // Tür kontrolü: QR kayıt jetonu buraya geçmesin
  if (!v || !v.jti || v.typ !== 'bulk') return { ok: false, code: 'JETON_TURU', reason: 'Bu kod toplu kayıt onayı değil' };
  if (!(Number(v.exp) > Date.now())) {
    return { ok: false, code: 'SURE_DOLDU', reason: 'Onay kodunun süresi doldu. Ekrandan yenisini üretin.' };
  }
  return { ok: true, jti: v.jti };
}

/* Onayı TÜKET. Koşullu UPDATE: iki telefon aynı anda okutursa yalnız biri
   geçer, ikinci istek "zaten kullanılmış" alır. */
async function consume(token, ip = '') {
  const p = await peek(token);
  if (!p.ok) return p;
  const etkilenen = await db()('bulk_tokens')
    .where({ jti: p.jti }).whereNull('used_at')
    .update({ used_at: new Date().toISOString(), used_ip: String(ip).slice(0, 64) });
  if (!etkilenen) return { ok: false, code: 'KULLANILDI', reason: 'Bu onay az önce kullanıldı' };
  return { ok: true, jti: p.jti, plan: p.satir };
}

async function sonucYaz(jti, { count, first, last }) {
  await db()('bulk_tokens').where({ jti: String(jti) })
    .update({ result_count: count, first_id: first || null, last_id: last || null });
}

async function status(jti) {
  return db()('bulk_tokens')
    .select('jti', 'expires_at', 'category', 'quantity', 'location', 'prefix',
      'used_at', 'result_count', 'first_id', 'last_id', 'revoked')
    .where({ jti: String(jti) }).first() || null;
}

async function revoke(jti) {
  return db()('bulk_tokens').where({ jti: String(jti) }).update({ revoked: 1 });
}

async function pruneExpired() {
  return db()('bulk_tokens').where('expires_at', '<', new Date(Date.now() - 3600e3).toISOString()).del();
}

module.exports = { create, peek, consume, sonucYaz, status, revoke, pruneExpired, VARSAYILAN_DK, AZAMI_DK };
