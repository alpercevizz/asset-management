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
| `DATABASE_URL` | **Veritabanı seçimi** — aşağıya bak |
| `ASSETMAN_HOST` | `envanter.sirket.com` (HTTPS için) |
| `ADMIN_EMAIL` | `it@sirket.com` (Let's Encrypt bildirimi için) |

### Veritabanı seçimi (SQLite vs PostgreSQL)

AssetMan **driver seçilebilir**. Aynı kod, iki farklı depoyla çalışır:

**SQLite (varsayılan — Starter/tek sunucu):**
```
DATABASE_URL=sqlite:./data/assetman.db
```
Sıfır ek servis. `data/assetman.db` dosyası `assetman-data` volume'una yazılır. 50.000 cihaza kadar rahat.

**PostgreSQL (Pro/Enterprise):**
```
DATABASE_URL=postgres://assetman:GUCLU-PAROLA@db:5432/assetman
DB_PASSWORD=GUCLU-PAROLA
```
Docker Compose'a Postgres profili ile başlatılır:
```bash
docker compose --profile postgres up -d
```
`db` servisi kalkar, uygulama `db:5432`'ye bağlanır. Portu dışarıya AÇILMAZ, sadece `assetman` network'ünden erişilir. Ekstra HA/backup için mevcut kurumsal PG cluster'ına da bağlanabilirsiniz — yalnız `DATABASE_URL`'i değiştirin, `db` profilini kullanmayın.

> **Secret'ları elle set etmeyin.** `SESSION_SECRET`, `CHAIN_SECRET`, `WORM_SECRET` — ilk açılışta setup wizard **rastgele üretip** `data/secrets.json`'a yazar (`chmod 600`). Env'de tanımlıysanız o kullanılır (env her zaman önceliklidir).

### Envanter deposu (Baserow vs SQL)

`INVENTORY_PROVIDER` ile envanterin (assets + licenses) nerede tutulacağı seçilir:

```
INVENTORY_PROVIDER=baserow   # varsayılan — Baserow REST API
INVENTORY_PROVIDER=sql       # DATABASE_URL'deki veritabanı (Baserow'a bağımlılık YOK)
```

`sql` modunda envanter de diğer tablolarla (kullanıcılar, audit, hatlar…) aynı PostgreSQL/SQLite'ta durur → **veri kurumdan çıkmaz**, tek yedek noktası. Baserow'dan geçiş:
```bash
docker compose exec app node scripts/migrate-inventory-to-sql.js   # id'ler korunarak taşır
```
`baserow`↔`sql` arasında aynı fonksiyon dikişi kullanıldığı için uygulama kodu değişmez; geri dönüş güvenli.

## 3. Ayağa kaldır

**SQLite (varsayılan):**
```bash
docker compose up -d
```

**PostgreSQL:**
```bash
docker compose --profile postgres up -d
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

## 4b. Kimlik sağlayıcı: LDAP / Active Directory (opsiyonel)

AssetMan **kimlik sağlayıcısı seçilebilir** (`AUTH_PROVIDER`), tıpkı veritabanı gibi:

**local (varsayılan):** Kullanıcılar `users` tablosunda, scrypt parola. Sıfır ek servis, hızlı demo.

**ldap:** Gerçek Active Directory bind. Kullanıcı **ilk girişte** dizinden `users` tablosuna senkronlanır; **rolü AD grup üyeliğinden** türetilir. Audit log imzası, onay akışı ve MFA-bypass tespiti gerçek AD kimliğiyle çalışır.

```bash
npm install ldapts        # yalnız ldap modunda gerekli (pure-JS, native derleme yok)
```

`.env`:
```
AUTH_PROVIDER=ldap
LDAP_URL=ldap://dc.sirket.local:389
LDAP_BIND_DN=CN=svc-assetman,OU=ServiceAccounts,DC=sirket,DC=local
LDAP_BIND_PASSWORD=servis-hesabi-parolasi
LDAP_BASE_DN=DC=sirket,DC=local
LDAP_USER_ATTR=sAMAccountName
LDAP_GROUP_ROLE_MAP={"Domain Admins":"admin","BT Yönetimi":"admin","Onaylayanlar":"approver","BT Destek":"it"}
LDAP_DEFAULT_ROLE=it
LDAP_MFA_GROUP=MFA-Enforced
```

**Nasıl çalışır (bind akışı):**
1. Servis hesabıyla bind edilir → kullanıcı `sAMAccountName` ile aranır (DN, displayName, UPN, `memberOf` alınır).
2. Bulunan **kullanıcı DN'iyle re-bind** yapılır — asıl parola doğrulaması budur (yanlış parola → giriş reddedilir).
3. `memberOf` grupları `LDAP_GROUP_ROLE_MAP` ile role eşlenir. Kullanıcı birden çok gruptaysa **en yetkili rol kazanır** (admin > approver > it). Hiçbiri eşleşmezse `LDAP_DEFAULT_ROLE`.
4. **MFA:** `LDAP_MFA_GROUP` üyeliğiyle modellenir (Entra ID / Duo'dan senkronlanan güvenlik grubu). Boş bırakılırsa MFA üst katmanda zorunlu varsayılır. Grupta olmayan kullanıcı için audit log **MFA-bypass** olarak işaretlenir.

> **Güvenlik notu:** LDAP hesaplarının yerel `password` kolonu doğrulanamaz rastgele bir hash'le doldurulur — `AUTH_PROVIDER=local`'a geri dönseniz bile bu hesaplara bilinen parolayla girilemez.

### LDAP mı LDAPS mı? (şema ile seçilir)

`LDAP_URL` şeması modu belirler — **ikisi de desteklenir, kurulum başına seçersiniz:**

| Mod | `LDAP_URL` | TLS ek ayarı |
|---|---|---|
| **LDAP (389)** | `ldap://dc.sirket.local:389` | Yok. **Uyarı:** parolalar açık metin gider (yalnız güvenilir iç LAN); sertleştirilmiş DC "LDAP signing zorunlu" ise **reddedebilir** |
| **LDAPS + public CA** | `ldaps://dc.sirket.com:636` | Yok — Node otomatik güvenir (hostname wildcard/SAN ile eşleşmeli, IP değil) |
| **LDAPS + iç CA (AD CS)** | `ldaps://dc.sirket.local:636` | İç CA kökünü tanıtın → aşağı |

İç CA ile LDAPS (en yaygın on-prem):
```
# İç CA kök sertifikasını PEM olarak dışa aktarıp volume'a koyun (ör. data/):
LDAP_TLS_CA=/app/data/internal-ca.pem
# Sadece hızlı test için (üretimde KULLANMAYIN):
# LDAP_TLS_REJECT_UNAUTHORIZED=false
# IP ile bağlanıp cert hostname'i farklıysa:
# LDAP_TLS_SERVERNAME=dc.sirket.local
```
> Güvenlik-odaklı ürün için **LDAPS önerilir** — maliyeti tek bir CA-kök dosyası. DC'nin 636'da hangi cert'i sunduğunu görmek için: `openssl s_client -connect dc.sirket.local:636 </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer`.

**LDAP bağlantı testi:**
```bash
docker compose exec app node -e "process.env.AUTH_PROVIDER='ldap'; require('./auth/ldap').authenticate('kullanici','parola').then(p=>console.log(p||'BAŞARISIZ')).catch(e=>console.error(e.message))"
```

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
| `assetman-data` | `secrets.json`, `assetman.db` (SQLite modunda), state dosyaları | 🔴 **Bu volume'u yedekleyin** |
| `assetman-worm` | Şifreli WORM halkaları (audit yedeği) | 🔴 Ayrı fiziksel diske mount önerilir |
| `assetman-db` | PostgreSQL data (yalnız `--profile postgres` ile) | 🔴 `pg_dump` ile ayrıca yedekleyin |
| `caddy-data` | Let's Encrypt cert'leri | 🟡 Kaybederseniz cert yeniden alınır |

**PostgreSQL yedekleme:**
```bash
docker compose exec db pg_dump -U assetman assetman > backup-$(date +%F).sql
# Geri yükle: cat backup-YYYY-MM-DD.sql | docker compose exec -T db psql -U assetman assetman
```

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
- **Gerçek OS Agent** (Windows service — Dalga 3)
- **LDAP/AD gerçek bağlantı** — ✅ mevcut (`AUTH_PROVIDER=ldap`, bkz. §4b)

Detaylı yol haritası ana [README](./README.md)'de.
