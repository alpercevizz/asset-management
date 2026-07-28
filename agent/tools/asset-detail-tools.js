// ── Varlık Detayı: ek alanlar + model görselleri ────────────────────────────
// Envanter sağlayıcıdan (baserow|sql) BAĞIMSIZ: ek alanlar ayrı SQL tablosunda.
// Model görselleri cihaza değil MODELE bağlanır → bir kez yüklenen görsel o
// modeldeki tüm cihazlarda görünür.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('../../db');

const IMG_DIR = process.env.DEVICE_IMAGE_DIR ||
  path.join(__dirname, '..', '..', 'data', 'device-images');

// Yalnız bu türler kabul edilir (SVG YOK — içinde script taşıyabilir)
const IZINLI = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_BYTE = 2 * 1024 * 1024;   // 2 MB

function nowIso() { return new Date().toISOString(); }

/* Türkçe 'İ' toLowerCase'te birleşik nokta üretir → eşleştirme tutmaz.
   NFD ile birleşik işaretler ayıklanır. Noktalama/boşluk sadeleşir. */
function normKey(x) {
  return String(x || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* ══ Ek alanlar ═══════════════════════════════════════════════════════════ */
const ALANLAR = ['purchase_date', 'purchase_price', 'currency', 'supplier',
  'last_maintenance', 'next_maintenance', 'note'];

async function getDetail(assetId) {
  return db()('asset_details').where({ asset_id: Number(assetId) }).first();
}

async function getAllDetails() {
  const rows = await db()('asset_details').select('*');
  const map = {};
  rows.forEach(r => { map[r.asset_id] = r; });
  return map;
}

function gecerliTarih(v) {
  if (v === null || v === undefined || v === '') return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v));
}

async function setDetail(assetId, patch, by = 'system') {
  const id = Number(assetId);
  if (!id) throw new Error('Geçersiz varlık.');
  const temiz = {};
  for (const a of ALANLAR) {
    if (patch[a] === undefined) continue;
    let v = patch[a];
    if (v === '' || v === null) { temiz[a] = null; continue; }
    if (a === 'purchase_price') {
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) throw new Error('Satın alma bedeli geçersiz.');
      temiz[a] = n;
    } else if (a.includes('date') || a.includes('maintenance')) {
      if (!gecerliTarih(v)) throw new Error(`${a}: tarih YYYY-AA-GG biçiminde olmalı.`);
      temiz[a] = String(v);
    } else {
      temiz[a] = String(v).slice(0, a === 'note' ? 2000 : 128);
    }
  }
  temiz.updated_at = nowIso();
  temiz.updated_by = by;

  const k = db();
  const varMi = await getDetail(id);
  if (varMi) await k('asset_details').where({ asset_id: id }).update(temiz);
  else await k('asset_details').insert({ asset_id: id, ...temiz });
  return getDetail(id);
}

/* Kullanım süresi — satın alma tarihinden bugüne (detay sayfasındaki alan) */
function kullanimSuresi(purchaseDate) {
  if (!purchaseDate) return null;
  const t = Date.parse(purchaseDate);
  if (Number.isNaN(t)) return null;
  const ay = Math.max(0, Math.floor((Date.now() - t) / (30.44 * 86400000)));
  if (ay < 1) return 'yeni';
  if (ay < 12) return `${ay} ay`;
  const yil = Math.floor(ay / 12), kalan = ay % 12;
  return kalan ? `${yil} yıl ${kalan} ay` : `${yil} yıl`;
}

/* ══ Model görselleri ═════════════════════════════════════════════════════ */
async function listImages() {
  return db()('device_images').select('*').orderBy(['brand_key', 'model_key']);
}

/* data: "data:image/png;base64,...." — dış istek yok, istemciden gelir. */
async function saveImage({ brand, model, category, dataUrl, by = 'system' }) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Görsel verisi okunamadı (data URL bekleniyor).');
  const mime = m[1].toLowerCase();
  const uzanti = IZINLI[mime];
  // SVG bilinçli olarak DIŞARIDA: içinde script taşıyabilir, panelde gösterilecek.
  if (!uzanti) throw new Error('Yalnız PNG, JPEG veya WebP yüklenebilir.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new Error('Görsel boş.');
  if (buf.length > MAX_BYTE) throw new Error(`Görsel çok büyük (${Math.round(buf.length / 1024)} KB, en fazla 2 MB).`);

  const brand_key = normKey(brand);
  const model_key = normKey(model);
  const kat = (category || '').trim() || null;
  if (!brand_key && !model_key && !kat) throw new Error('Marka/model veya kategori belirtilmeli.');

  fs.mkdirSync(IMG_DIR, { recursive: true });
  const ad = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) + '.' + uzanti;
  fs.writeFileSync(path.join(IMG_DIR, ad), buf);

  const row = {
    brand_key, model_key, category: kat,
    brand_label: (brand || '').trim() || null,
    model_label: (model || '').trim() || null,
    file: ad, mime, bytes: buf.length,
    uploaded_at: nowIso(), uploaded_by: by,
  };
  const k = db();
  const varMi = await k('device_images')
    .where({ brand_key, model_key }).andWhere(qb => kat ? qb.where({ category: kat }) : qb.whereNull('category'))
    .first();
  if (varMi) { await k('device_images').where({ id: varMi.id }).update(row); return { ...row, id: varMi.id }; }
  const [id] = await k('device_images').insert(row);
  return { ...row, id };
}

async function deleteImage(id) {
  const k = db();
  const row = await k('device_images').where({ id: Number(id) }).first();
  if (!row) return false;
  await k('device_images').where({ id: Number(id) }).del();
  // Dosya başka kayıtta kullanılmıyorsa sil
  const kalan = await k('device_images').where({ file: row.file }).first();
  if (!kalan) { try { fs.unlinkSync(path.join(IMG_DIR, row.file)); } catch { /* yoksa geç */ } }
  return true;
}

/* 4 kademeli eşleştirme — en özelden en genele.
   1) tam marka+model  2) model ailesi (önek)  3) marka+kategori  4) kategori
   Hiçbiri yoksa null döner → arayüz yerleşik kategori çizimini kullanır. */
function matchImage(images, { brand, model, category }) {
  const b = normKey(brand), m = normKey(model), kat = (category || '').trim();
  if (!images || !images.length) return null;

  const tam = images.find(i => i.model_key && i.brand_key === b && i.model_key === m);
  if (tam) return tam;

  // Model ailesi: kayıtlı anahtar, cihazın modelinin ÖNEKİ ise (en uzun eşleşme kazanır)
  const aile = images
    .filter(i => i.model_key && i.brand_key === b && m.startsWith(i.model_key + ' '))
    .sort((x, y) => y.model_key.length - x.model_key.length)[0];
  if (aile) return aile;

  const markaKat = images.find(i => !i.model_key && i.brand_key === b && i.category === kat);
  if (markaKat) return markaKat;

  const sadeceKat = images.find(i => !i.model_key && !i.brand_key && i.category === kat);
  if (sadeceKat) return sadeceKat;

  return null;
}

module.exports = {
  IMG_DIR, ALANLAR, normKey,
  getDetail, getAllDetails, setDetail, kullanimSuresi,
  listImages, saveImage, deleteImage, matchImage,
};
