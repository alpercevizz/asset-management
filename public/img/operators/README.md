# Operatör logoları

Hatlar tablosundaki ve Hat Ekle modalındaki operatör rozetinde kullanılır.

## Beklenen dosyalar

| Operatör | Dosya adı | Not |
|---|---|---|
| Turkcell | `turkcell.png` | Kare/yuvarlak simge (sarı işaret) |
| Türk Telekom | `turk-telekom.png` | Tercihen **kare simge** (üçgen işaret). Yatay logotype rozette çok küçük kalır. |
| Vodafone | `vodafone.png` | (opsiyonel) |

- Format: PNG (saydam zemin) veya SVG. Kısa kenar en az 128 px.
- Rozet 22–30 px kare çizer; görsel `object-fit: contain` ile sığdırılır.

## Dosya yoksa ne olur?

Hiçbir şey bozulmaz. `opLogoUygula()` görseli önce arka planda yükler; yüklenemezse
mevcut **harf rozeti** (renkli kare içinde operatörün baş harfi) olduğu gibi kalır.
Kırık görsel simgesi hiçbir zaman görünmez.

## Yeni operatör eklemek

`public/js/app.js` içindeki `OP_LOGOLAR` eşlemesine anahtarı ekleyin. Anahtar,
operatör adının küçük harfe çevrilip Türkçe karakterlerin sadeleştirilmiş
ve boşlukların atılmış hâlidir (`Türk Telekom` → `turktelekom`).

## Marka kullanımı

Bu dosyalar marka sahiplerine aittir; depoya ekleme kararı ve kullanım izni
ürün sahibinin sorumluluğundadır.
