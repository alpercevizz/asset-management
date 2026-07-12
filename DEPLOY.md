# AssetMan — Kurulum Kılavuzu

Bu belge AssetMan'i **sıfırdan bir sunucuya** kurmayı 30 dakikada tamamlar. Docker + Caddy TLS ile kurumsal deploy önerilir.

---

## Gereksinimler

- **Sunucu:** Linux (Ubuntu 22.04+ önerilir) veya Windows Server 2019+
- **Docker 20.10+** ve **docker compose plugin** (Docker Desktop veya `apt install docker-ce docker-compose-plugin`)
- **Alan adı** (opsiyonel ama HTTPS için önerilen): DNS A kaydını sunucu IP'sine yönlendirin
- **Portlar açık:** 80 (Let's Encrypt), 443 (HTTPS)
- **Baserow** hesabı (self-hosted veya baserow.io) — envanter DB'si

Ollama kullanacaksanız ayrıca:
- **Ollama** kurulu bir makine (aynı sunucuda veya erişilebilir başka host)

---

## 1. Repo'yu klonla

```bash
git clone https://github.com/alpercevizz/asset-management.git
cd asset-management
```

## 2. `.env` dosyasını doldur

```bash
cp .env.example .env
nano .env    # veya vim/code
```

Zorunlu değerler:

| Değişken | Örnek |
|---|---|
| `AI_PROVIDER` | `ollama` veya `anthropic` |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://ollama.host:11434` / `llama3.1:8b` |
| `ANTHROPIC_API_KEY` | `sk-ant-...` (provider=anthropic ise) |
| `BASEROW_API_URL` | `https://api.baserow.io` |
| `BASEROW_API_TOKEN` | Baserow ayarlarından database token |
| `BASEROW_TABLE_ID` | Assets tablosunun sayısal ID'si |
| `BASEROW_LICENSE_TABLE_ID` | Licenses tablosunun ID'si |
| `ASSETMAN_HOST` | `envanter.sirket.com` (HTTPS için) |
| `ADMIN_EMAIL` | `it@sirket.com` (Let's Encrypt bildirimi için) |

> **Secret'ları elle set etmeyin.** `SESSION_SECRET`, `CHAIN_SECRET`, `WORM_SECRET` — ilk açılışta setup wizard **rastgele üretip** `data/secrets.json`'a yazar (`chmod 600`). Env'de tanımlıysanız o kullanılır (env her zaman önceliklidir).

## 3. Ayağa kaldır

```bash
docker compose up -d
```

Yaklaşık 30 saniye içinde `assetman-app` ve `assetman-caddy` container'ları başlar. Caddy Let's Encrypt cert'ini otomatik alır (`ASSETMAN_HOST` public erişilebilir olmalı).

Log kontrol:

```bash
docker compose logs -f app
```

Beklenen çıktı:
```
[setup] Sır kaynakları: SESSION_SECRET: generated, CHAIN_SECRET: generated, WORM_SECRET: generated
[GÜVENLİK] Sır kontrolü geçti (SESSION/CHAIN/WORM güçlü).
[notify] Zamanlanmış bildirim ...
[discovery] Network Discovery Agent AÇIK ...
AI Asset Management
Server: http://localhost:3000
```

## 4. İlk giriş

Tarayıcıdan: **https://envanter.sirket.com** (veya `http://SUNUCU-IP` — LAN kurulumu)

İlk açılışta console'da yazan **rastgele admin parolasını** kullanın (log'da "İLK AÇILIŞ PAROLALARI" başlığı altında görünür). Ardından `.env`'ye `USER_PW_ADMIN=...` ekleyip container'ı yeniden başlatarak kendi parolanızı belirleyin.

Yerleşik roller: `admin` · `it` · `approver` — Roller & Yetki Modeli için ana README'ye bakın.

## 5. Baserow tablosunu hazırlayın

Aşağıdaki alanları Baserow assets tablosuna ekleyin (metin/sayı/tarih):

```
hostname, serial_number, brand, model, cpu, cpu_cores, cpu_threads, ram_gb, storage_gb,
os, ip_address, mac_address, username, gpu, gpu_ram_gb, uptime_days, domain,
last_seen, status, collector_ver, category, location, warranty_expiry
```

## 6. Client script dağıtımı

Windows domain'inde GPO ile:

```powershell
# Zamanlanmış görev (6 saatte bir)
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NonInteractive -File \\SUNUCU\netlogon\collect-assets.ps1"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 6) -Once -At (Get-Date)
Register-ScheduledTask -TaskName "AssetCollector" -Action $action -Trigger $trigger -RunLevel Highest
```

Linux için Ansible örneği veya elle:

```bash
ASSET_WEBHOOK_URL="https://envanter.sirket.com/api/webhook" ./collect-assets.sh
# cron: 0 */6 * * * ...
```

---

## Yönetim

| Ne | Komut |
|---|---|
| Log görüntüle | `docker compose logs -f app` |
| Yeniden başlat | `docker compose restart app` |
| Kapat | `docker compose down` |
| Sunucu güncelle | `git pull && docker compose build && docker compose up -d` |
| Yedek al (yerel data) | `docker run --rm -v assetman_assetman-data:/data -v $PWD:/backup alpine tar czf /backup/backup-$(date +%F).tgz -C /data .` |
| WORM yedeği ayrı yere kopyala | `docker cp assetman-app:/app/data/worm-repository ./worm-offsite/` |

### Volume yapısı

| Volume | İçerik | Kritiklik |
|---|---|---|
| `assetman-data` | `users.json`, `secrets.json`, `lifecycle-log.json`, `os-agents.json` | 🔴 **Bu volume'u yedekleyin** |
| `assetman-worm` | Şifreli WORM halkaları (audit yedeği) | 🔴 Ayrı fiziksel diske mount önerilir |
| `caddy-data` | Let's Encrypt cert'leri | 🟡 Kaybederseniz cert yeniden alınır |

---

## Güvenlik notları (PRODUCTION)

`NODE_ENV=production` iken **zayıf secret** (< 32 karakter, boş, veya varsayılan `assetman-demo-secret-degistir`) tespit edilirse **sunucu başlamaz** (`checkSecrets`). Setup wizard bunları otomatik güçlü üretir; sorun yaşarsanız:

```bash
docker compose exec app cat /app/data/secrets.json     # doğrulama
docker compose down && docker compose up -d
```

**Login rate-limit:** IP başına 15 dakikada 10 deneme (aşınca 429). Testte kapatmak için `DISABLE_LOGIN_RATE_LIMIT=true`.

**Güvenlik başlıkları:** Caddy ve uygulama katmanında çift uygulanır (HSTS, X-Frame-Options, CSP, Referrer-Policy).

---

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Caddy cert alamıyor | DNS A kaydı doğru mu? 80/443 açık mı? `docker compose logs caddy` |
| `checkSecrets` fail | `.env`'de secret'lar 32+ karakter mi? Ya da wizard'a bırakın (env'yi silin) |
| Baserow 401 | `BASEROW_API_TOKEN` yenile, tabloya `Read` yetkisi verildi mi? |
| Ollama bağlanamıyor | `docker compose exec app wget -qO- $OLLAMA_URL/api/tags` |
| WORM out-of-sync alarmı | Panel → Yaşam Döngüsü → "Yedekten Geri Yükle" |

---

## Sonraki adım

- **Public domain + Let's Encrypt** ile HTTPS (yukarıda anlatıldı)
- **HR entegrasyonu** (çalışan ayrıldığında otomatik lifecycle event)
- **SQLite geçişi** (Dalga 1B, JSON dosya limitini kaldırır)
- **Gerçek OS Agent** (Windows service — Dalga 3)

Detaylı yol haritası ana [README](./README.md)'de.
