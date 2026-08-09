/* ═══ HTML PARÇA BİRLEŞTİRİCİ ════════════════════════════════════════════════
   index.html 2300 satıra ulaşmıştı; görünümler ve modallar ayrı dosyalara
   çıkarıldı. Bu modül `<!--#include parts/... -->` işaretlerini dosya
   içeriğiyle değiştirir.

   Neden derleme adımı (bundler) DEĞİL: projede hiç derleme adımı yok, tarayıcı
   doğrudan public/ klasörünü kullanıyor. Bir bundler eklemek dağıtımı,
   Docker imajını ve geliştirme akışını değiştirirdi — bölme işi bunu
   gerektirmiyor (YAGNI).

   Neden istemci tarafı fetch DEĞİL: her görünüm için ek istek, ilk boyamada
   gecikme ve JS kapalıyken boş sayfa demekti. Birleştirme sunucuda, bir kez.

   Üretimde sonuç önbelleğe alınır; geliştirmede her istekte yeniden okunur ki
   parçayı düzenleyince sunucuyu yeniden başlatmak gerekmesin. */

const fs = require('fs');
const path = require('path');

const ISARET = /<!--#include\s+([\w./-]+)\s*-->/g;
const EN_FAZLA_DERINLIK = 5;      // döngüsel include'a karşı

const _onbellek = new Map();

/* Yol güvenliği: parça yolu kök dizinin DIŞINA çıkamaz. İşaretler bizim
   yazdığımız dosyalardan geliyor ama bu dosyalar ileride şablon hâline
   gelirse '../../etc/passwd' okunmasını engelleyen tek şey bu denetim. */
function guvenliYol(kok, parca) {
  const tam = path.resolve(kok, parca);
  const kokTam = path.resolve(kok);
  if (tam !== kokTam && !tam.startsWith(kokTam + path.sep)) {
    throw new Error(`Parça kök dizinin dışında: ${parca}`);
  }
  return tam;
}

function coz(kok, icerik, derinlik = 0) {
  if (derinlik > EN_FAZLA_DERINLIK) {
    throw new Error('include derinliği aşıldı (döngüsel referans olabilir)');
  }
  return icerik.replace(ISARET, (_, parca) => {
    const dosya = guvenliYol(kok, parca);
    if (!fs.existsSync(dosya)) throw new Error(`Parça bulunamadı: ${parca}`);
    return coz(kok, fs.readFileSync(dosya, 'utf8'), derinlik + 1);
  });
}

/**
 * Kabuk dosyasını parçalarıyla birleştirip HTML döndürür.
 * @param {string} kabukYolu  index.html'in tam yolu
 * @param {{onbellek?: boolean}} secenek
 */
function birlestir(kabukYolu, { onbellek = process.env.NODE_ENV === 'production' } = {}) {
  if (onbellek && _onbellek.has(kabukYolu)) return _onbellek.get(kabukYolu);
  const kok = path.dirname(kabukYolu);
  const html = coz(kok, fs.readFileSync(kabukYolu, 'utf8'));
  if (onbellek) _onbellek.set(kabukYolu, html);
  return html;
}

function onbellegiTemizle() { _onbellek.clear(); }

module.exports = { birlestir, coz, onbellegiTemizle, ISARET };
