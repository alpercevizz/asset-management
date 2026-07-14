# Ekran Görüntüleri

Bu klasör README'deki ekran görüntülerini barındırır (sıcak-modern arayüz, 2× DPI).

| Dosya | Hangi panel | İçerik notu |
|---|---|---|
| `hero-dashboard.png` | Dashboard | KPI kartları + marka/kategori/durum + lokasyon dağılımı |
| `device-modal.png` | Cihaz detayı | 🔒 resmi zimmet + telemetri ayrımı + bağlı Turkcell hattı |
| `lines.png` | Hatlar & SIM | hat envanteri + bağlı telefon + CSV içe aktarım |
| `insights.png` | Risk & Öngörü | risk skorları + canlı ECB kuruyla 12 aylık bütçe |
| `settings.png` | Ayarlar | tespit eşikleri (canlı) + tema + sistem durumu |
| `assets.png` | Varlıklar | envanter tablosu + kategori sekmeleri + export |

## Nasıl yeniden üretilir?

Sunucu `http://localhost:3000` çalışırken, puppeteer-core ile gerçek login akışından
otomatik alınır (dev script `shots.js` — commit edilmez). Alternatif: her panele girip
**Win+Shift+S** ile elle al, bu klasöre yukarıdaki adlarla PNG kaydet. README otomatik gösterir.
