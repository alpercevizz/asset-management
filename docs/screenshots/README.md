# Ekran Görüntüleri

Bu klasör README'deki ekran görüntülerini barındırır. İdeal boyut **1600×1000**, format **PNG**.

| Dosya | Hangi panel | İçerik notu |
|---|---|---|
| `hero-lifecycle.png` | Yaşam Döngüsü | timeline + sign-off mührü (kilit/uyarı ikonları) + zincir bütünlüğü kartı |
| `insights.png` | Risk & Öngörü | risk skor tablosu + canlı kur (💱) + bütçe kartları |
| `alerts.png` | Uyarılar | 6 özet kart + bir tablo (örn. EOL veya Garanti) |
| `dashboard.png` | Dashboard | envanter özeti + grafikler |

## Nasıl alınır?

1. Sunucuyu başlat: `npm start` → `http://localhost:3000`
2. `admin/admin123` ile giriş yap
3. İlgili panele git, **Win+Shift+S** ile ekran al
4. Bu klasöre yukarıdaki adlarla PNG olarak kaydet
5. `git add docs/screenshots/*.png && git commit -m "Ekran görüntülerini ekle" && git push`

README otomatik olarak görüntüleri gösterir; ek bir değişiklik gerekmez.
