/* ═══ TOPLU DEPO KAYDI — İSİMLENDİRME PLANI ══════════════════════════════════
   Depodaki kimliği belirsiz cihazlar için placeholder kayıt adları üretir
   (DEPO-TABLET-001 gibi). Numaralandırma MEVCUT KAYITLARDAN DEVAM eder, bu
   yüzden aralık her zaman 001'den başlamaz — aksi hâlde ikinci toplu kayıt
   birincinin üstüne çakışan adlar üretirdi.

   Ayrı modül olmasının sebebi: hem önizleme hem oluşturma AYNI hesabı
   kullanmalı, yoksa panelde gösterilen aralık ile gerçekte oluşan kayıtlar
   ayrışır. Ayrıca birim testi artık bu gerçek fonksiyonu çağırıyor; önceden
   test, mantığın KOPYASINI doğruluyordu — kopya sürüklendiğinde test hiçbir
   şey yakalamazdı. */

const BULK_PREFIX_MAP = {
  Sunucu: 'DEPO-SUNUCU',
  Telefon: 'DEPO-TELEFON',
  Tablet: 'DEPO-TABLET',
  'El Terminali': 'DEPO-TERMINAL',
  Yazıcı: 'DEPO-YAZICI',
  'Ağ Aygıtı': 'DEPO-AG',
  'Çevre Aygıtı': 'DEPO-CEVRE',
  Diğer: 'DEPO-CIHAZ',
};

/**
 * @param {object} girdi  { category, prefix, quantity }
 * @param {(o:object)=>Promise<{results:object[]}>} getAllAssets  envanter okuyucu
 */
async function bulkPlan({ category = 'Diğer', prefix, quantity }, getAllAssets) {
  const qty = parseInt(quantity, 10);
  const pfx = (prefix && String(prefix).trim()) || BULK_PREFIX_MAP[category] || 'DEPO-CIHAZ';
  const all = await getAllAssets({ size: 200 });

  // Önek kullanıcıdan geliyor; regex'e gömmeden önce özel karakterler kaçırılır
  const kacis = pfx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Dize içinde \d yazılırsa JS onu 'd' harfine indirger → regex rakam yerine
  // harf arar ve numaralandırma her seferinde 001'den başlardı. \\d şart.
  const re = new RegExp('^' + kacis + '-(\\d+)$');

  let maxNum = 0;
  let mevcut = 0;
  for (const a of (all.results || [])) {
    const m = (a.hostname || '').match(re);
    if (m) { mevcut++; maxNum = Math.max(maxNum, parseInt(m[1], 10)); }
  }
  const no = (n) => pfx + '-' + String(n).padStart(3, '0');

  /* Örnek ID listesi — panelin "Önizleme" kolonu bunu gösteriyor. 200 kayıtta
     hepsini yollamanın anlamı yok: baş ve son birkaçı yeter, arası atlanır. */
  let ornekler = [];
  if (qty > 0) {
    const hepsi = Array.from({ length: qty }, (_, i) => no(maxNum + 1 + i));
    ornekler = hepsi.length <= 12 ? hepsi : [...hepsi.slice(0, 6), null, ...hepsi.slice(-5)];
  }

  return {
    prefix: pfx,
    maxNum,
    mevcut,
    quantity: Number.isFinite(qty) ? qty : 0,
    ilk: qty > 0 ? no(maxNum + 1) : null,
    son: qty > 0 ? no(maxNum + qty) : null,
    ornekler,
  };
}

module.exports = { bulkPlan, BULK_PREFIX_MAP };
