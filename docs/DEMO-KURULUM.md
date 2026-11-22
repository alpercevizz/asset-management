# Demo Instance Kurulumu (assetmandemo.alperceviz.com)

Satış/tanıtım için **tamamen izole, zengin veriyle dolu** bir demo ortamı.
Gerçek envantere (envanter.alperceviz.com) **hiç dokunmaz** — kendi DB'si var.

## Ne içerir
Her açılışta `scripts/seed-demo.js` otomatik çalışır ve şunları yükler:
- **36 varlık** (bilgisayar, sunucu, telefon, tablet, yazıcı, ağ aygıtı, el terminali, depoda) — 5 lokasyon (İstanbul/Kocaeli/Ankara/İzmir/Bursa, haritada pinli)
- **12 yazılım lisansı** (Windows, Office 365, Adobe, AutoCAD, Kaspersky…)
- **4 Turkcell/TT/Vodafone hattı** telefonlara bağlı
- **20 resmi zimmet** + **23 yaşam döngüsü olayı** (server boot seed'i, `SEED_DEMO=true`)

Böylece Dashboard, Varlıklar, Lisanslar, Hatlar, Lokasyonlar, Zimmet, Yaşam
Döngüsü, Risk & Öngörü ve Raporlar **hepsi dolu** görünür.

## Deploy (AssetMan VPS'inde — srv1711334)

```bash
cd /opt/asset-management
git pull --ff-only origin main
docker compose -f docker-compose.demo.yml up -d --build
```

### Önce `docker-compose.demo.yml`'de 3 yeri KENDİ Traefik'ine göre ayarla
Dosyada `<...>` ile işaretli:
1. **Ağ adı** (`networks:` + `name:`) → mevcut Traefik'inin external ağ adı (ör. `web`, `proxy`, `traefik`).
2. **certresolver** (`tls.certresolver=myresolver`) → Traefik'indeki Let's Encrypt resolver adın.
3. **entrypoints** → genelde `websecure` (443).

> Envanter (prod) servisin zaten Traefik'e bağlı; oradaki ağ ve resolver adını
> `docker inspect assetman-app` ya da prod compose'undan görebilirsin, aynısını kullan.

## Giriş
- **URL:** https://assetmandemo.alperceviz.com
- **Kullanıcı:** `admin`
- **Parola:** `AssetManDemo2026` (değiştirmek için deploy öncesi `.env`'ye `DEMO_PASSWORD=...` ekle)

## Sıfırlama (reset)
Demo **her container restart'ında** otomatik temizlenip yeniden seed'lenir:
```bash
docker compose -f docker-compose.demo.yml restart app-demo
```
İstersen gece otomatik sıfırlama için VPS'te cron:
```bash
0 4 * * * cd /opt/asset-management && docker compose -f docker-compose.demo.yml restart app-demo
```

## AI yorumu (Ollama)
Demo `AI_PROVIDER=ollama` ile çalışır. Raporlardaki **gerçek AI yorumu** için demo
container'ının Ollama'ya erişmesi gerekir (aynı Docker ağında olmalı). Erişemezse
yorum **kural tabanlıya** düşer — demo yine sorunsuz çalışır, sadece yorum AI olmaz.

## Güvenlik notu
Demo şu an **yazılabilir + restart'ta sıfırlanır** (admin hesabı). Ziyaretçiler
deneyebilir, restart temizler. Tamamen kilitli (salt-okunur) public demo istersen
ayrı bir read-only rol ekleyebiliriz — söylemen yeterli. Demo dışarı bildirim
ATMAZ (`NOTIFY_ENABLED=false`) ve ağ taraması YAPMAZ (`SNMP_ENABLED=false`).
