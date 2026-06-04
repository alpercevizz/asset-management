# Ekran Görüntüleri

Bu klasör README'deki ekran görüntülerini barındırır. İdeal boyut **1600×1000**, format **PNG**.

| Dosya | Hangi panel | İçerik notu |
|---|---|---|
| `hero-lifecycle.png` | Yaşam Döngüsü | timeline + sign-off mührü + zincir bütünlüğü kartı (İHLAL VAR! + canlı ağ alarmı en şovluk) |
| `risk-scores.png` | Risk & Öngörü (üst) | 4 özet kart + risk skor tablosu (kritik cihazlar listelenmiş hâliyle) |
| `forecast.png` | Risk & Öngörü (alt) | 💱 kur satırı + 12 aylık tahmini bütçe + yenileme planı tablosu |
| `alerts.png` | Uyarılar | EOL · Düşük RAM/Disk · Uzun uptime · Lisans tabloları |

## Nasıl alınır?

1. Sunucuyu başlat: `npm start` → `http://localhost:3000`
2. `admin/admin123` ile giriş yap
3. İlgili panele git, **Win+Shift+S** ile ekran al
4. Bu klasöre yukarıdaki adlarla PNG olarak kaydet
5. `git add docs/screenshots/*.png && git commit -m "Ekran görüntülerini ekle" && git push`

README otomatik olarak görüntüleri gösterir; ek bir değişiklik gerekmez.
