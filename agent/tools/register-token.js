// ── QR Kayıt Jetonu ─────────────────────────────────────────────────────────
//
// SORUN: /api/register public'ti. QR ile telefondan cihaz kaydı yapıldığı için
// collector gibi HMAC imzalayamıyor — karşıda insan ve tarayıcı var. Ama açık
// bırakmak, adresi bilen herkesin envantere sahte cihaz eklemesi demekti.
//
// ÇÖZÜM: QR'ın İÇİNE yöneticinin ürettiği imzalı + süreli bir jeton gömülür.
// Telefon o jetonu geri gönderir, sunucu doğrular.
//
// İKİ KATMAN, ikisi de gerekli:
//   1) İMZA — jeton uydurulamaz (HMAC, REGISTER_SECRET ile).
//   2) KULLANIM SAYACI (DB) — imza tek başına yetmez: aynı QR'ı ele geçiren
//      biri onu SONSUZ kez kullanabilirdi. Sayaç bunu sınırlar.
//
// Süre ve kullanım hakkı bilinçli olarak yöneticiye bırakıldı: tek telefon için
// tek kullanımlık kısa jeton, depoya asılan basılı QR için çok kullanımlı uzun
// jeton isteniyor. İkisini tek varsayılana sıkıştırmak birini bozardı.
const crypto = require('crypto');
const { db } = require('../../db');

const AZAMI_SAAT = 168;     // 7 gün — basılı QR senaryosunun üst sınırı
const AZAMI_KULLANIM = 100;

function sir() {
  // SESSION_SECRET'e düşmüyoruz: farklı amaçlar farklı anahtar kullanmalı,
  // biri sızarsa diğerini de götürmesin.
  return process.env.REGISTER_SECRET || '';
}

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

/* Jeton üret. Döner: { token, jti, expires_at, max_uses } */
async function create({ hours = 24, uses = 1, by = 'system' } = {}) {
  if (!sir()) throw new Error('REGISTER_SECRET tanımlı değil');
  const saat = Math.min(Math.max(Number(hours) || 24, 1), AZAMI_SAAT);
  const hak = Math.min(Math.max(parseInt(uses, 10) || 1, 1), AZAMI_KULLANIM);
  const jti = crypto.randomBytes(12).toString('hex');
  const exp = Date.now() + saat * 3600 * 1000;

  const govde = b64u(JSON.stringify({ jti, exp }));
  const token = `${govde}.${imzala(govde)}`;

  await db()('register_tokens').insert({
    jti,
    created_at: new Date().toISOString(),
    created_by: String(by).slice(0, 128),
    expires_at: new Date(exp).toISOString(),
    max_uses: hak,
    uses: 0,
    revoked: 0,
  });
  return { token, jti, expires_at: new Date(exp).toISOString(), max_uses: hak, hours: saat };
}

/* Doğrula VE kullanımı işle. Tek adım olması bilinçli: ayrı olsaydı
   "doğrula" ile "tüket" arasında aynı jetonla ikinci istek geçebilirdi.
   Döner: { ok, code, reason, jti, kalan } */
async function verifyAndConsume(token) {
  if (!sir()) return { ok: false, code: 'SUNUCU_ANAHTARSIZ', reason: 'Sunucuda REGISTER_SECRET tanımlı değil' };
  const t = String(token || '').trim();
  if (!t) return { ok: false, code: 'JETON_YOK', reason: 'Kayıt jetonu eksik. Panelden yeni QR üretin.' };

  const [govde, sig] = t.split('.');
  if (!govde || !sig) return { ok: false, code: 'JETON_BOZUK', reason: 'Kayıt jetonu geçersiz' };
  if (!esitMi(sig, imzala(govde))) return { ok: false, code: 'IMZA_GECERSIZ', reason: 'Kayıt jetonu doğrulanamadı' };

  let veri;
  try { veri = JSON.parse(b64uCoz(govde)); } catch { return { ok: false, code: 'JETON_BOZUK', reason: 'Kayıt jetonu okunamadı' }; }
  if (!veri || !veri.jti) return { ok: false, code: 'JETON_BOZUK', reason: 'Kayıt jetonu eksik alan içeriyor' };
  if (!(Number(veri.exp) > Date.now())) {
    return { ok: false, code: 'SURE_DOLDU', reason: 'QR kodunun süresi dolmuş. Panelden yenisini üretin.' };
  }

  const satir = await db()('register_tokens').where({ jti: veri.jti }).first();
  if (!satir) return { ok: false, code: 'JETON_BULUNAMADI', reason: 'Kayıt jetonu tanınmıyor (silinmiş olabilir)' };
  if (satir.revoked) return { ok: false, code: 'IPTAL', reason: 'Bu QR kodu iptal edilmiş' };
  if (satir.uses >= satir.max_uses) {
    return { ok: false, code: 'HAK_BITTI', reason: `Bu QR kodu ${satir.max_uses} kez kullanılmış, hakkı bitti. Panelden yenisini üretin.` };
  }

  /* Sayaç KOŞULLU artırılır: WHERE uses = <okunan> — iki telefon aynı anda
     denerse yalnız biri geçer. Okuyup sonra yazmak yarış durumunda son hakkı
     iki kez harcatırdı. */
  const etkilenen = await db()('register_tokens')
    .where({ jti: veri.jti, uses: satir.uses })
    .update({ uses: satir.uses + 1, last_used_at: new Date().toISOString() });
  if (!etkilenen) return { ok: false, code: 'ESZAMANLI', reason: 'Jeton aynı anda kullanıldı, tekrar deneyin' };

  return { ok: true, jti: veri.jti, kalan: satir.max_uses - satir.uses - 1 };
}

async function list() {
  return db()('register_tokens')
    .select('jti', 'created_at', 'created_by', 'expires_at', 'max_uses', 'uses', 'last_used_at', 'revoked')
    .orderBy('created_at', 'desc').limit(100);
}

async function revoke(jti) {
  return db()('register_tokens').where({ jti: String(jti) }).update({ revoked: 1 });
}

/* Süresi dolmuş jetonları temizler. Tablo QR başına bir satır büyüyor;
   süresi geçmiş satırın doğrulamada hiçbir işlevi kalmıyor. */
async function pruneExpired() {
  return db()('register_tokens').where('expires_at', '<', new Date().toISOString()).del();
}

module.exports = { create, verifyAndConsume, list, revoke, pruneExpired, AZAMI_SAAT, AZAMI_KULLANIM };
