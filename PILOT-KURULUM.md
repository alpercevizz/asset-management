# AssetMan — Canlı Pilot Kurulum Runbook

**Senaryo:** Bulut VPS · kurum içi Ollama (kapalı devre AI) · gerçek AD/LDAP giriş.

Bu belge, sıfırdan bir bulut VPS'e AssetMan'i canlı test için kurar. ~45-60 dk.

---

## 0. Gereksinim özeti (kurulumdan önce hazırla)

| # | Ne | Not |
|---|---|---|
| 1 | **Bulut VPS** | 8 GB RAM (qwen2.5:3b) veya 16 GB (llama3.1:8b), 4 vCPU, 40 GB SSD, Ubuntu 22.04 |
| 2 | **Alan adı** | örn. `envanter.sirket.com` → DNS A kaydı VPS IP'sine |
| 3 | **Açık portlar** | 80, 443 (TLS). Ollama/uygulama portları dışarı AÇILMAZ |
| 4 | **Baserow** | assets + licenses tabloları, database token, tablo ID'leri (VPS'ten erişilebilir) |
| 5 | **AD/LDAP erişimi** | VPS → şirket AD (389/636) bağlantısı: VPN **veya** LDAPS firewall kuralı. Servis (okuma) hesabı DN+parola |
| 6 | **AD grup→rol haritası** | Hangi AD grubu hangi rol (admin/it/approver) |

---

## 1. VPS hazırlığı

```bash
# Docker + compose kur
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # yeniden giriş yap
```

## 2. Ollama kur (kapalı devre AI — aynı VPS)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b            # veya: ollama pull llama3.1:8b (16GB RAM ister)
# Ollama'yı localhost'ta tut (dışarı açma). Varsayılan: 127.0.0.1:11434
systemctl enable --now ollama
ollama ps                        # model yüklü mü kontrol
```

> **Model sıcak kalsın:** ilk sorgu modeli belleğe alır. Yoğun demo öncesi bir kez `ollama run qwen2.5:3b "merhaba"` ile ısıt.

## 3. Repo + yapılandırma

```bash
git clone https://github.com/alpercevizz/asset-management.git
cd asset-management
cp .env.example .env
nano .env        # aşağıdaki §4 şablonuna göre doldur
```

## 4. `.env` şablonu (bu senaryo için)

```ini
# ── AI: kapalı devre Ollama (aynı VPS) ──
AI_PROVIDER=ollama
OLLAMA_URL=http://host.docker.internal:11434   # bkz §4 not: docker-compose'a extra_hosts eklenir
OLLAMA_MODEL=qwen2.5:3b

# ── Envanter: SQL (Baserow'dan bağımsız — veri kurumda kalır) ──
INVENTORY_PROVIDER=sql
# (İlk geçişte Baserow'dan taşımak için BASEROW_* de doldur → migrate script; sonra kaldırılabilir)
BASEROW_API_URL=https://api.baserow.io
BASEROW_API_TOKEN=BURAYA_TOKEN_MIGRASYON_ICIN
BASEROW_TABLE_ID=BURAYA_ASSETS_TABLO_ID
BASEROW_LICENSE_TABLE_ID=BURAYA_LICENSES_TABLO_ID

# ── Veritabanı: gerçek kurulumda PostgreSQL ──
DATABASE_URL=postgres://assetman:GUCLU-PAROLA@db:5432/assetman
DB_PASSWORD=GUCLU-PAROLA

# ── Kimlik: gerçek AD/LDAP ──
AUTH_PROVIDER=ldap
LDAP_URL=ldaps://dc.sirket.local:636
LDAP_BIND_DN=CN=svc-assetman,OU=ServiceAccounts,DC=sirket,DC=local
LDAP_BIND_PASSWORD=SERVIS_HESABI_PAROLASI
LDAP_BASE_DN=DC=sirket,DC=local
LDAP_USER_ATTR=sAMAccountName
LDAP_GROUP_ROLE_MAP={"Domain Admins":"admin","BT Yönetimi":"admin","Onaylayanlar":"approver","BT Destek":"it"}
LDAP_DEFAULT_ROLE=it
LDAP_MFA_GROUP=

# ── Domain + TLS (Caddy otomatik Let's Encrypt) ──
ASSETMAN_HOST=envanter.sirket.com
ADMIN_EMAIL=it@sirket.com

# ── Server ──
NODE_ENV=production
PORT=3000

# ── Sırlar: BOŞ bırak → ilk açılışta otomatik güçlü üretilir (data/secrets.json) ──
SESSION_SECRET=
CHAIN_SECRET=
WORM_SECRET=

# ── Döviz (gerçek ECB kuru; çevrimdışı fallback var) ──
FX_PROVIDER=live

# ── Bildirim (opsiyonel, n8n varsa aç) ──
NOTIFY_ENABLED=false
```

> **Not (OLLAMA_URL — önemli):** Uygulama Docker'da özel ağda, Ollama ise host'ta çalışıyor. Uygulamanın host Ollama'ya erişmesi için `docker-compose.yml`'deki `app` servisine şunu ekle:
> ```yaml
>     extra_hosts:
>       - "host.docker.internal:host-gateway"
> ```
> Böylece `OLLAMA_URL=http://host.docker.internal:11434` çalışır. (Alternatif: Ollama'yı da bir container olarak compose'a eklemek.)

## 5. Ayağa kaldır (PostgreSQL profili)

```bash
docker compose --profile postgres up -d   # app + PostgreSQL + Caddy
docker compose logs -f app                # "Server: http://localhost:3000" görene kadar izle
```

### 5b. Envanteri Baserow'dan SQL'e taşı (tek seferlik)

Mevcut Baserow verisi varsa, SQL'e aktar (id'ler korunur — zimmet/hat bağları bozulmaz):
```bash
docker compose exec app node scripts/migrate-inventory-to-sql.js
# ✓ assets: N kayıt taşındı / ✓ licenses: M kayıt taşındı
```
Doğruladıktan sonra `.env`'den `BASEROW_*` satırlarını kaldırabilirsin — artık Baserow'a bağımlı değilsin.
Sıfırdan başlıyorsan bu adımı atla; cihazlar collector ile doğrudan SQL'e düşer.

Beklenen log:
```
[setup] Sır kaynakları: ... generated
[GÜVENLİK] Sır kontrolü geçti
[AI Agent] Provider: ollama | Model: qwen2.5:3b
[db] Katman hazır — driver: sqlite
Server: http://localhost:3000
```

## 6. İlk giriş & doğrulama

1. `https://envanter.sirket.com` → bir AD kullanıcısıyla giriş yap (LDAP bind test).
2. **LDAP bağlantı testi** (giriş başarısızsa):
   ```bash
   docker compose exec app node -e "process.env.AUTH_PROVIDER='ldap'; require('./auth/ldap').authenticate('KULLANICI','PAROLA').then(p=>console.log(p||'BAŞARISIZ')).catch(e=>console.error(e.message))"
   ```
3. **AI sohbet testi**: panelde bir soru sor ("kaç cihaz var"). İlk yanıt yavaş olabilir (model ısınıyor).
4. **Baserow testi**: Varlıklar sayfası envanteri gösteriyor mu?

## 7. Cihaz toplama (collector) — gerçek veri akışı

Windows domain'inde GPO ile (6 saatte bir):
```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NonInteractive -File \\SUNUCU\netlogon\collect-assets.ps1"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 6) -Once -At (Get-Date)
Register-ScheduledTask -TaskName "AssetCollector" -Action $action -Trigger $trigger -RunLevel Highest
```
`collect-assets.ps1` içindeki webhook URL'sini `https://envanter.sirket.com/api/webhook` yap.

---

## Canlı pilot uyarıları (dürüst)

- **Ollama RAM**: Model yetersiz RAM'de yüklenmez ("requires more memory" hatası). VPS'i model boyutuna göre seç.
- **LDAP erişimi**: Bulut VPS şirket AD'sine erişemiyorsa giriş çalışmaz — önce §0.5 bağlantıyı çöz, ya da geçici `AUTH_PROVIDER=local` ile başla.
- **Ağ keşfi & Shadow IT** şu an `data/active-devices.json` besleme dosyasını okur — gerçek canlı tarama (Sophos/Zabbix) pilotta bağlanacak entegrasyon dikişidir.
- **Ölçek**: Pilotu küçük tut (birkaç yüz cihaz). Binlerce cihaz + eşzamanlı yazma henüz doğrulanmadı.
- **Yedek**: `assetman-data` ve `assetman-worm` volume'larını düzenli yedekle (DEPLOY.md §Yönetim).

---

Detaylı Docker/PostgreSQL/güvenlik başlıkları için ana [DEPLOY.md](./DEPLOY.md).
