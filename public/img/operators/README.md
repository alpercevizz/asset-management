# Operatör logoları

Hatlar tablosundaki ve Hat Ekle modalındaki operatör rozetinde kullanılır.

## Beklenen dosyalar

| Operatör | Dosya adı | Not |
|---|---|---|
| Turkcell | `turkcell.png` | 920×920 PNG, saydam zemin |
| Türk Telekom | `turk-telekom.jpg` | 512×512 JPEG. Saydamlığı yok; rozet zemini zaten beyaz olduğu için sorun çıkarmaz. |
| Vodafone | `vodafone.png` | (henüz yok — dosya eklenirse kendiliğinden çıkar) |

- Format: PNG (saydam zemin), JPEG veya SVG. **Kare** ve kısa kenarı en az 128 px olmalı;
  yatay logotype 24 px rozette okunmaz.
- Rozet 22–30 px kare çizer; görsel `object-fit: contain` ile sığdırılır.
- Dosya adı değişirse `OP_LOGOLAR` eşlemesi de güncellenmeli (uzantı dahil).

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
