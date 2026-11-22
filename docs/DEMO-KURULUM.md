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

Compose, mevcut Traefik'ine göre **hazır** (host modu, `certresolver=letsencrypt`,
`entrypoints=websecure`, ayrı proje adı `assetman-demo`). Ekstra ayara gerek yok:

```bash
cd /opt/asset-management
git pull --ff-only origin main
docker compose -f docker-compose.demo.yml up -d --build
```

İlk istekte Let's Encrypt sertifikasını Traefik otomatik alır (DNS zaten hazır).
Yönlendirme olmazsa (host-modu Traefik bazen ağ IP'sini seçemez) tek satır eklenir:
`traefik.docker.network=assetman-demo_default` — gerekirse söyle, eklerim.

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
container'ının Ollama'ya erişmesi gerekir.

Compose, `OLLAMA_URL`'i `http://host.docker.internal:32768` olarak ezer ve
`extra_hosts: host.docker.internal:host-gateway` ekler. Böylece container, host'un
yayınlanmış Ollama portuna (32768) host gateway'i üzerinden ulaşır — `.env`'deki
public IP (`187.124.35.214:32768`) container İÇİNDEN hairpin-NAT yüzünden çalışmaz.

**Doğrulama** (deploy sonrası, VPS'te): demo container'ı Ollama'yı görüyor mu?
```bash
docker exec assetman-demo wget -qO- --timeout=10 http://host.docker.internal:32768/api/tags
```
Model listesi (JSON) dönerse erişim var. Erişemezse yorum **kural tabanlıya** düşer
— demo yine sorunsuz çalışır, sadece yorum AI olmaz. (Ollama portu 0.0.0.0'da değil
de 127.0.0.1'de yayınlıysa host-gateway de ulaşamaz; o durumda demo'yu Ollama
container'ının ağına bağlarız — söyle, tek satır eklerim.)

## Güvenlik notu
Demo şu an **yazılabilir + restart'ta sıfırlanır** (admin hesabı). Ziyaretçiler
deneyebilir, restart temizler. Tamamen kilitli (salt-okunur) public demo istersen
ayrı bir read-only rol ekleyebiliriz — söylemen yeterli. Demo dışarı bildirim
ATMAZ (`NOTIFY_ENABLED=false`) ve ağ taraması YAPMAZ (`SNMP_ENABLED=false`).
