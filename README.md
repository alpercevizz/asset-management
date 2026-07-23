<div align="center">

# AssetMan

**Kurumsal IT envanteri için AI destekli denetim & güvenlik platformu**

Değiştirilemez audit log · çift dijital onay · gerçek AD/LDAP girişi · canlı ağ savunması · döviz endeksli FinOps

[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Database](https://img.shields.io/badge/db-SQLite%20%7C%20PostgreSQL-336791?logo=postgresql&logoColor=white)](#kurulum)
[![Tests](https://img.shields.io/badge/tests-22%2F22%20passing-22c55e)](#test)
[![License](https://img.shields.io/badge/license-see%20LICENSE-blue)](./LICENSE)
[![Status](https://img.shields.io/badge/status-active-success)]()

</div>

---

<p align="center">
  <img src="docs/screenshots/hero-dashboard.png" alt="AssetMan — Dashboard (sıcak-modern arayüz)" width="880"/>
</p>

## Niçin AssetMan?

Piyasadaki çoğu envanter aracı (Snipe-IT, Lansweeper, GLPI) cihazın **son durumunu** tutar. AssetMan ise durumu *kim, ne zaman, neden, hangi yetkiyle değiştirdi*'yi **değiştirilemez (immutable)** olarak tutar — ve gerçek dünyadaki manipülasyon senaryolarını teknik olarak imkânsız kılar:

- Bir IT personeli "ben onaylamıştım" diyemez → her kritik değişiklik **iki kişinin kriptografik imzasını** taşır
- Bir yönetici "log'u sildim" diyemez → hash zinciri kopar, WORM yedek canlı kalır
- Bir saldırgan MAC adresi taklit etse bile → OS Agent el sıkışması başarısız olur, "klonlanmış cihaz" alarmı düşer
- Depodaki cihaz gizlice ağa bağlansa → 90 saniye içinde Telegram alarmı

## Özellikler

<table>
<tr>
<td width="50%" valign="top">

### Envanter & Tespit
- Otomatik cihaz toplama (Windows/Linux client)
- Anomali tespiti (RAM/disk/uptime)
- EOL işletim sistemi taraması · Garanti takibi
- Shadow IT / kayıt dışı cihaz keşfi
- Lisans uyum denetimi
- Cihaz detay & yaşam döngüsü geçmişi
- Zimmet teslim tutanağı (PDF) · Excel/CSV dışa aktarım
- Lokasyon dağılım analizi
- **Turkcell hat/SIM envanteri** — hangi hat hangi telefonda + geçmiş

</td>
<td width="50%" valign="top">

### Audit & Güvenlik
- **HMAC-SHA256 hash zinciri** (tamper-evident)
- **Çift onay** (dual-authorization) + tek kullanımlık link
- **Kişi-bazlı dijital imza** (AD UPN + IP + MFA gömülü)
- **WORM hardened yedek** (AES-256-GCM, write-once)
- **Gerçek AD/LDAP girişi** (`AUTH_PROVIDER=ldap`) — grup→rol eşleme
- **Zimmet devir koruması** — resmi zimmet kilitli, sessiz devralma engellenir
- Çok-kullanıcılı auth (scrypt + roller) · SQL katmanı

</td>
</tr>
<tr>
<td valign="top">

### Kurumsal Ağ
- **VLAN-segmentli asenkron tarama** (worker pool + throttle)
- **OS Agent handshake** — MAC spoofing kalkanı
- Karantina cihaz canlı tespit
- Network Discovery scheduler

</td>
<td valign="top">

### FinOps & AI
- **Gerçek döviz kuru** (ECB / frankfurter.app) — önbellekli, çevrimdışı fallback
- 12 aylık yenileme öngörüsü (EOL + garanti birleşik)
- Cihaz risk skoru (0-100, çok kaynaklı)
- **Ayarlar** — eşikler UI'dan canlı düzenlenir (restart yok)
- AI agent (Ollama / Anthropic) — deterministik tool kullanımı

</td>
</tr>
</table>

## Mimari

```mermaid
flowchart LR
    subgraph Clients
      PS[PowerShell/Bash<br/>Asset Collector]
      QR[QR / Mobile<br/>Self-Register]
    end

    subgraph Server[Node.js + Express]
      API[REST API]
      AI[AI Agent<br/>Ollama / Anthropic]
      DET[Deterministic Tools<br/>anomaly · eol · warranty<br/>shadow-it · lifecycle · risk · fx]
      AUTH[Auth & Roles<br/>scrypt + HMAC token<br/>local · LDAP/AD]
    end

    subgraph SQL[SQL Katmanı — SQLite / PostgreSQL]
      USERS[(users<br/>scrypt / LDAP sync)]
      LOG[(lifecycle_events<br/>HMAC-SHA256 chain)]
      AGENT[(os_agents<br/>spoofing shield)]
    end

    WORM[(WORM Repository<br/>AES-256-GCM<br/>write-once)]
    LDAP[LDAP / Active Directory]
    BR[(Baserow<br/>Inventory DB)]
    N8N[n8n Webhook<br/>Mail · Telegram]
    UI[Web Panel<br/>sıcak-modern · light/dark]

    PS --> N8N --> BR
    QR --> API
    UI <--> API
    API <--> AI
    AI <--> DET
    DET <--> BR
    DET --> LOG
    LOG -->|append-only<br/>encrypt| WORM
    API <--> AUTH
    AUTH --> USERS
    AUTH -.->|AUTH_PROVIDER=ldap| LDAP
    DET --> AGENT
    DET -->|critical alert| N8N
```

## Ekran Görüntüleri

<table>
<tr>
<td align="center" width="50%">
  <a href="docs/screenshots/device-modal.png"><img src="docs/screenshots/device-modal.png" alt="Cihaz detayı — resmi zimmet + bağlı hat" width="420"/></a>
  <br/><b>Cihaz Detayı</b><br/>🔒 Resmi zimmet (kilitli) + telemetri ayrımı · bağlı Turkcell hattı · zimmet tutanağı
</td>
<td align="center" width="50%">
  <a href="docs/screenshots/lines.png"><img src="docs/screenshots/lines.png" alt="Turkcell hat / SIM envanteri" width="420"/></a>
  <br/><b>Hatlar & SIM</b><br/>Hangi hat hangi telefonda · atama geçmişi · CSV içe aktarım
</td>
</tr>
<tr>
<td align="center" width="50%">
  <a href="docs/screenshots/insights.png"><img src="docs/screenshots/insights.png" alt="Risk skorları ve döviz endeksli bütçe" width="420"/></a>
  <br/><b>Risk & Öngörü</b><br/>0-100 risk skoru · canlı ECB kuruyla 12 aylık yenileme bütçesi
</td>
<td align="center" width="50%">
  <a href="docs/screenshots/settings.png"><img src="docs/screenshots/settings.png" alt="Ayarlar — eşikler ve sistem durumu" width="420"/></a>
  <br/><b>Ayarlar</b><br/>Tespit eşikleri UI'dan canlı düzenlenir (restart yok) · tema · sistem durumu
</td>
</tr>
</table>

## Kurulum

```bash
# 1. Klonla
git clone https://github.com/alpercevizz/asset-management.git
cd asset-management

# 2. Bağımlılıkları yükle
npm install

# 3. Yapılandırma
cp .env.example .env
# .env içindeki değerleri doldur (Baserow, AI provider, secrets)

# 4. Sunucuyu başlat
npm start
# Dashboard: http://localhost:3000
```

İlk açılışta `users` tablosu (SQL) tohumlanır. Demo kullanıcı parolaları **rastgele üretilip console'a yazılır** (bir kez gösterilir, kaydedin). Kendi parolanızı belirlemek için `.env`'ye `USER_PW_<USERNAME>=...` ekleyin. Docker + Caddy TLS ile kurumsal kurulum için [DEPLOY.md](./DEPLOY.md)'ye bakın.

### Veritabanı (driver seçilebilir)

Kimlik, audit log, OS Agent, hatlar, ayarlar ve zimmet kayıtları **SQL katmanında** tutulur:

```bash
DATABASE_URL=sqlite:./data/assetman.db          # varsayılan — sıfır ek servis, tek dosya
# DATABASE_URL=postgres://assetman:PAROLA@db:5432/assetman   # Pro/Enterprise (Docker profile)
```

Envanter (assets + licenses) **`INVENTORY_PROVIDER`** ile seçilir:

```bash
INVENTORY_PROVIDER=baserow   # varsayılan — Baserow REST API
# INVENTORY_PROVIDER=sql     # envanter de DATABASE_URL'de → Baserow'a bağımlılık YOK, veri kurumda kalır
```

Baserow'dan SQL'e geçiş (id'ler korunur, `asset_id` bağları bozulmaz):
```bash
docker compose exec app node scripts/migrate-inventory-to-sql.js
```

### Kimlik sağlayıcı (local | LDAP/AD)

```bash
AUTH_PROVIDER=local     # yerel scrypt parola (varsayılan)
# AUTH_PROVIDER=ldap    # gerçek Active Directory bind — rol AD grup üyeliğinden türetilir
```

`ldap` modunda kullanıcı ilk girişte dizinden `users` tablosuna senkronlanır; ayrıntılı yapılandırma (`LDAP_URL`, `LDAP_BIND_DN`, `LDAP_GROUP_ROLE_MAP`, `LDAP_MFA_GROUP` …) için [DEPLOY.md §4b](./DEPLOY.md)'ye bakın. Gerektiğinde: `npm install ldapts`.

### Yapılandırma (.env)

| Değişken | Açıklama |
|---|---|
| `AI_PROVIDER` | `ollama` veya `anthropic` |
| `OLLAMA_URL` / `OLLAMA_MODEL` | Yerel/uzak Ollama uç noktası (Docker'da: `http://host.docker.internal:<port>`) |
| `ANTHROPIC_API_KEY` | Claude API anahtarı (anthropic ise) |
| `INVENTORY_PROVIDER` | `baserow` (varsayılan) veya `sql` (envanter SQL'de) |
| `BASEROW_API_URL` / `BASEROW_API_TOKEN` / `BASEROW_TABLE_ID` | Baserow erişimi (provider=baserow ise) |
| `DATABASE_URL` | SQL katmanı — `sqlite:...` veya `postgres://...` |
| `AUTH_PROVIDER` | `local` (scrypt) veya `ldap` (gerçek AD bind) |
| `FX_PROVIDER` | `live` (frankfurter.app/ECB) veya `static` (tam izole) |
| `SESSION_SECRET` | Oturum cookie HMAC (zorunlu, ≥32 karakter) |
| `CHAIN_SECRET` | Audit log HMAC zincir sırrı (ayrı tutulması önerilir) |
| `WORM_SECRET` | WORM AES-256-GCM anahtar türetimi |
| `APP_PASSWORD` / `USER_PW_*` | Tohum kullanıcı parolaları (boşsa rastgele üretilir) |
| `APPROVAL_TTL_MS` | Dijital onay bekleme süresi (ms, varsayılan 24 saat) |
| `N8N_NOTIFY_WEBHOOK_URL` | Bildirim webhook adresi |
| `DISCOVERY_CONCURRENCY` / `DISCOVERY_BATCH_SIZE` | Ağ keşfi ölçek parametreleri |

> **PRODUCTION:** `NODE_ENV=production` iken zayıf/varsayılan/kısa (<32) secret tespit edilirse sunucu **başlamaz** (`checkSecrets`).

### Canlı sunucuya Docker kurulumu — sık takılınan noktalar (checklist)

Gerçek bir sunucuya (Docker + PostgreSQL) kurarken karşılaşılan noktalar ve **kesin çözümleri** — tek seferde düzgün kurulum için:

1. **Sunucuda zaten bir reverse-proxy (Traefik/Nginx) varsa** → bundled Caddy'yi **kullanma** (80/443 çakışır). `docker-compose.override.yml` ile Caddy'yi devre dışı bırakıp app'i mevcut proxy'ye label ile bağla:
   ```yaml
   services:
     caddy: { profiles: ["disabled"] }
     app:
       labels:                                   # Traefik örneği (entrypoint/certresolver kendi adlarınla)
         - "traefik.enable=true"
         - "traefik.http.routers.assetman.rule=Host(`envanter.sirket.com`)"
         - "traefik.http.routers.assetman.entrypoints=websecure"
         - "traefik.http.routers.assetman.tls.certresolver=letsencrypt"
         - "traefik.http.services.assetman.loadbalancer.server.port=3000"
   ```
   Proxy yoksa: `docker compose --profile postgres up -d` (Caddy TLS'i halleder).

2. **Ollama ayrı bir container ise** → host'a publish edilen **porta** bağlan (iç 11434'e değil): `OLLAMA_URL=http://host.docker.internal:<host-portu>` (ör. `:32768`). app servisine ekle:
   ```yaml
   app:
     extra_hosts: ["host.docker.internal:host-gateway"]
   ```
   Native Ollama ise varsayılan `127.0.0.1`'e bağlıdır → konteynerden erişilmez. `OLLAMA_HOST=0.0.0.0:11434` ile aç (systemd override + restart). **Ollama portunu firewall'da dışarı AÇMA** (iç iletişim, dışarı açmak güvenlik riski).

3. **`.env` değiştirdiysen `docker compose up -d`** (recreate) — `docker compose restart` **.env'i yeniden okumaz**, eski değerlerle çalışır.

4. **Firewall'da 80 VE 443 açık olmalı** (Let's Encrypt HTTP-challenge 80'i, uygulama 443'ü kullanır). Bulut firewall'unda (ör. Hostinger) kuralı eklediğin halde uygulanmıyorsa → firewall'u sunucudan **ayır → tekrar bağla** (detach/reattach); ruleset yeniden itilir.

5. **Envanteri Baserow'suz kur**: `INVENTORY_PROVIDER=sql` + PostgreSQL. Not: PostgreSQL tip-katıdır — collector'ın gönderebildiği ondalık sayılar (ör. çekirdek `4.1`) integer sütunlara otomatik yuvarlanır (v2.0+ ile giderildi).

## Roller & Yetki Modeli

| Rol | Yetki |
|---|---|
| `admin` | Tüm işlemler — kullanıcı yönetimi, kayıt, onay |
| `it` | Cihaz durumu değiştirme, log oluşturma (submitter) |
| `approver` | Kritik değişiklikleri dijital olarak onaylama (ikinci imza) |

Kritik durumlar (`Zimmet Değişikliği`, `Depoya Kaldırıldı`, `Kayıp`, vb.) **iki ayrı kişi** gerektirir — submitter ile approver aynı kişi olamaz. Bu kural backend'de enforce edilir.

## Test

```bash
npm test
```

Node'un yerleşik test runner'ı (`node:test`) — dış bağımlılık yok. Çekirdek IP'yi kapsar:

- Scrypt parola hash & rol yetkilendirmesi
- **LDAP/AD bind + grup→rol eşleme + MFA grubu** (sahte client ile, canlı AD gerekmez)
- HMAC zincir + tamper tespiti
- Dijital imza & forgery koruması
- Onay akışı (pending / approve / self-reject / expire / renew)
- `sameDevice` (asset_id rename dayanıklılığı)
- WORM yedekleme + AES roundtrip + kurtarma
- OS Agent handshake (spoofing tespiti)
- **Zimmet devir koruması** (zaten zimmetli cihaz force olmadan devralınamaz)
- **Turkcell hat/SIM** (oluştur→ata→taşı→geçmiş + MSISDN normalize)
- **Ayarlar deposu** (setSection tip-doğrulama + kalıcılık)
- Döviz dönüşümü · SQL driver seçimi

## Client Script

**Windows:**
```powershell
.\client-scripts\windows\collect-assets.ps1 -WebhookUrl "http://localhost:3000/api/webhook"
```

**Linux/macOS:**
```bash
ASSET_WEBHOOK_URL="http://localhost:3000/api/webhook" ./client-scripts/linux/collect-assets.sh
```

### Zamanlanmış Görev (Windows)
```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NonInteractive -File C:\Path\collect-assets.ps1"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 6) -Once -At (Get-Date)
Register-ScheduledTask -TaskName "AssetCollector" -Action $action -Trigger $trigger -RunLevel Highest
```

## Baserow Tablo Şeması

| Alan | Tip | Notlar |
|---|---|---|
| `hostname` | Text | |
| `serial_number` | Text | Stabil cihaz kimliği (rename'e dayanıklı) |
| `brand` / `model` / `cpu` / `os` | Text | |
| `cpu_cores` / `cpu_threads` / `ram_gb` / `storage_gb` / `gpu_ram_gb` / `uptime_days` | Number | |
| `ip_address` / `mac_address` | Text | Ağ keşfi için |
| `username` | Text | Atanan kullanıcı |
| `status` | Text | `online` / `offline` / `depoda` |
| `last_seen` | Text (ISO) | Son ağ teması |
| `category` / `location` / `domain` | Text | Sınıflandırma |
| `warranty_expiry` | Date (ISO) | Garanti takibi için |

## API Endpoint'leri (özet)

| Endpoint | Rol | Açıklama |
|---|---|---|
| `POST /api/login` | public | Oturum aç |
| `GET /api/me` | auth | Kullanıcı bilgisi |
| `GET /api/assets` / `stats` | auth | Envanter |
| `POST /api/webhook` | public | Cihaz toplama (client scripts) |
| `GET /api/anomalies` · `eol-os` · `warranty` · `shadow-it` | auth | Deterministik tespit |
| `POST /api/lifecycle/event` | it / admin | Durum değişikliği talebi |
| `GET /api/lifecycle/approve?token=` | approver | Dijital onay (tek kullanımlık link) |
| `POST /api/lifecycle/renew` | it / admin | Onay talebini yenile |
| `GET /api/lifecycle/{log,conflicts,verify}` | auth | Audit log & doğrulama |
| `GET /api/network/scan` | auth | VLAN-segmentli canlı ağ keşfi |
| `GET /api/backup/status` · `POST /api/backup/restore` | auth | WORM yedek |
| `GET /api/risk-scores` · `forecast` | auth | Risk & FinOps (canlı ECB kuru) |
| `GET /api/lines` · `POST /api/lines/import` | auth / it | Turkcell hat/SIM envanteri + CSV |
| `POST /api/assets/:id/assign` · `release` | it / admin | Resmi zimmet devri (409 koruma) |
| `GET /api/settings` · `PUT /api/settings/:section` | admin | Runtime ayarlar (eşikler, tema) |
| `POST /api/chat` | auth | AI agent sohbeti |

## Bilinçli Sınırlar (dürüst kapsam)

**AD/LDAP entegrasyonu artık gerçektir** (`AUTH_PROVIDER=ldap` — servis-bind + kullanıcı re-bind + grup→rol). Demo'dan production'a geçişte canlıya alınması gereken **iki** entegrasyon dikişi simüle çalışır:

- **Network Discovery feed**: `data/active-devices.json` örnek besleme — gerçekte Sophos/Zabbix/arp poller
- **WORM off-site**: yerel şifreli dizin write-once çalışır; off-site ayna gerçekte AWS S3 Object Lock (Compliance mode) veya Veeam Hardened Repo

Mantık ve API sözleşmeleri her iki durumda da birebir aynı kalır.

## Lisans

Detaylar için [LICENSE](./LICENSE) dosyasına bakın.
