# Collector Kurulumu (Windows)

Toplama betiğinin **SYSTEM** hesabıyla çalışması gerekir. Sebebi net:

| Okuma | Normal kullanıcı | SYSTEM |
|---|---|---|
| Donanım, OS, IP/MAC, uptime | ✅ | ✅ |
| CPU / RAM / disk / ağ ölçümü | ✅ | ✅ |
| **BitLocker durumu** | ❌ erişim reddedilir | ✅ |
| **Windows Update / bekleyen yama** | ❌ genelde başarısız | ✅ |
| **Kullanıcı oturum açmasa da çalışma** | ❌ | ✅ |

Kullanıcı yetkisiyle çalıştırırsan panelde Disk Şifreleme ve İşletim Sistemi
Güncellemesi satırları **"bilinmiyor"** kalır — yanlış değil, ama eksik.

---

## Tek makine (test / pilot)

Yönetici PowerShell'de:

```powershell
cd <repo>\client-scripts\windows
.\install-collector.ps1 -WebhookUrl "https://envanter.alperceviz.com/api/webhook" -AgentKey "<AGENT_SECRET>"
```

`AGENT_SECRET` sunucuda otomatik üretilir. Almak için:

```bash
cd /opt/asset-management && docker compose exec -T app node -e "console.log(require('/app/data/secrets.json').AGENT_SECRET)"
```

Betik şunları yapar:

1. `collect-assets.ps1` dosyasını `C:\ProgramData\AssetMan\` altına kopyalar
   (kullanıcı profilinden bağımsız, SYSTEM okuyabilir).
2. Klasör izinlerini sıkılaştırır — `Users` yalnızca okuma+çalıştırma.
   **Bu önemli**: betik SYSTEM yetkisiyle çalışıyor, kullanıcı içeriğini
   değiştirebilseydi kendi kodunu SYSTEM olarak çalıştırabilirdi.
3. "AssetMan Collector" adında zamanlanmış görev kaydeder: SYSTEM, en yüksek
   yetki, açılışta (5 dk gecikmeli) + her 60 dakikada bir.
4. Hemen bir kez çalıştırır ve logun son 20 satırını ekrana basar.

Kaldırma:

```powershell
.\install-collector.ps1 -Uninstall
```

### Çalıştığını doğrulama

```powershell
Get-ScheduledTaskInfo -TaskName "AssetMan Collector"
```

`LastTaskResult = 0` ise başarılı. Log:

```powershell
Get-Content C:\ProgramData\AssetMan\collector.log -Tail 40
```

Logda **"okunamadi" satırları normaldir**: sanal makinede sıcaklık sensörü,
masaüstünde pil yoktur. O alanlar panelde "Ölçüm yok" görünür — sıfır
yazılmaz, çünkü "sensör yok" ile "%0" aynı şey değildir.

---

## Domain geneli (GPO)

### 1. Betiği paylaşıma koy

`\\dc01\NETLOGON\AssetMan\` altına `collect-assets.ps1` ve
`install-collector.ps1` dosyalarını koy. NETLOGON tüm domain makinelerinde
okunabilir ve yalnızca Domain Admins yazabilir.

### 2. GPO ile zamanlanmış görev dağıt

İki yol var:

**A) Doğrudan Scheduled Task tercihi (önerilen)**

`Group Policy Management` → yeni GPO → düzenle:

```
Computer Configuration
  └ Preferences
      └ Control Panel Settings
          └ Scheduled Tasks
              → New → Scheduled Task (At least Windows 7)
```

- **Action**: Update (yoksa oluşturur, varsa günceller — tekrar çalıştırmak güvenli)
- **Name**: `AssetMan Collector`
- **Run as**: `NT AUTHORITY\SYSTEM`, ✅ *Run with highest privileges*
- **Program**: `powershell.exe`
- **Arguments**:
  ```
  -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "\\dc01\NETLOGON\AssetMan\collect-assets.ps1" -WebhookUrl "https://envanter.alperceviz.com/api/webhook" -LogFile "C:\ProgramData\AssetMan\collector.log" -StateFile "C:\ProgramData\AssetMan\device.json" -AgentKey "<AGENT_SECRET>"
  ```

  > **Anahtarı GPO argümanına KOYMAYIN.** Görev tanımını okuyabilen herkes
  > görür. Bunun yerine anahtarı makinelere kilitli bir dosya olarak dağıtın:
  > `C:\ProgramData\AssetMan\agent.key` (yalnız SYSTEM + Administrators
  > okuyabilsin). Collector `-AgentKey` verilmediğinde bu dosyadan okur.
  > Dosyayı GPO ile dağıtmak için: Computer Configuration → Preferences →
  > Windows Settings → Files.
  >
  > Anahtar yalnız **ilk kayıt** için gerekli; cihaz kaydolduktan sonra kendi
  > sırrıyla imzalar ve paylaşılan anahtar o cihaz için geçersizleşir.
- **Triggers**: At startup (5 dk gecikme) + Daily, repeat every 1 hour
- **Settings**: ✅ Start only if network available, ✅ Run as soon as possible
  after a scheduled start is missed, ⏱ Stop if runs longer than 10 minutes
- **Common** sekmesi: ✅ *Item-level targeting* → yalnız istediğin OU/grup

**Rastgele gecikme ekle.** 500 makine aynı dakikada POST atarsa sunucu
gereksiz darbe yer. Trigger'da `Delay task for up to (random delay): 5 minutes`.

**B) Startup Script**

`Computer Configuration → Policies → Windows Settings → Scripts → Startup`
altına `install-collector.ps1` eklenebilir. Startup script'ler zaten SYSTEM
olarak çalışır. Dezavantajı: yalnızca açılışta çalışır, saatlik toplama için
yine görev kaydetmen gerekir — bu yüzden (A) daha doğrudan.

### 3. Uygulamayı zorla ve doğrula

Hedef makinede:

```powershell
gpupdate /force
Get-ScheduledTask -TaskName "AssetMan Collector" | Select-Object State, @{n='Kullanici';e={$_.Principal.UserId}}
```

---

## Sık karşılaşılanlar

**`LastTaskResult = 0x1` (genel hata)** — betik yolu yanlış veya
ExecutionPolicy engelliyor. Argümanlarda `-ExecutionPolicy Bypass` olduğundan
emin ol; NETLOGON yolunu tırnak içine al.

**`0x41303` — "görev hiç çalışmadı"** — normal, henüz tetiklenmemiş.
`Start-ScheduledTask` ile elle tetikle.

**Panelde "Agent Versiyonu: agent kurulu değil"** — cihaza hiç collector
POST'u gelmemiş. Sunucu logunda `[WEBHOOK]` satırı var mı bak; yoksa ağ/DNS
veya TLS sorunudur.

**Kullanıcı adı yanlış görünüyor** — collector, oturum açan kullanıcıyı
`Win32_ComputerSystem.UserName` üzerinden alır (SYSTEM altında
`$env:USERNAME` "SYSTEM" veya "MAKINE$" döner, o yüzden kullanılmaz).
Kimse oturum açmamışsa alan **boş bırakılır**, tahmin edilmez — bu değer
zimmet uyuşmazlığı tespitinde kullanılıyor, yanlışı boştan kötüdür.

**Sıcaklık hiçbir makinede gelmiyor** — beklenen olabilir.
`MSAcpi_ThermalZoneTemperature` birçok üretici tarafından desteklenmez ve
sanal makinelerde hiç yoktur. Gerçek sıcaklık gerekiyorsa üretici ajanı
(Dell OMSA, HP Insight, LibreHardwareMonitor) şart.

---

## Kimlik doğrulama (imzalı istek)

`/api/webhook` ve `/api/licenses/sync` envanteri **yazan** uçlardır. Eskiden
kimlik doğrulaması yoktu: adresi bilen herkes sahte cihaz ekleyebilir veya
mevcut bir cihazın verisini ezebilirdi. Envanter, üzerine kurulu her tespitin
(shadow IT, zimmet uyuşmazlığı, EOL, lisans uyumu) girdisi — kirlenirse
hepsi yanılır. Artık iki katmanlı koruma var.

### 1. İmzalı istek

Collector her isteği HMAC-SHA256 ile imzalar. İmza **gövde özetini** de kapsar
(yol üstünde değiştirilemez), **zaman damgası** ve **nonce** içerir (eski bir
istek tekrar oynatılamaz — replay).

Başlıklar: `X-AssetMan-Device`, `X-AssetMan-Timestamp`, `X-AssetMan-Nonce`,
`X-AssetMan-Signature`. Zaman penceresi ±5 dk (`AGENT_SKEW_MS`).

> Sunucu ve istemci saatleri 5 dakikadan fazla kayarsa istekler `ZAMAN_PENCERESI`
> ile reddedilir. Domain makinelerinde bu genelde sorun olmaz (AD saat senkronu),
> ama izole makinelerde NTP kontrol edin.

### 2. Cihaz kaydı (enrollment)

Paylaşılan anahtar **her makinede duruyor** — yerel yöneticisi olan biri
okuyabilir. Tek katman olsaydı o kişi *istediği* cihaz adına rapor
gönderebilirdi. Bu yüzden:

1. Cihaz ilk kez paylaşılan anahtarla imzalar.
2. Sunucu **o cihaza özel** bir sır üretip yanıtta **bir kez** döner.
3. Collector bunu `C:\ProgramData\AssetMan\device.json` içine yazar ve
   dosyayı yalnız SYSTEM + Administrators okuyabilecek şekilde kilitler.
4. **Kayıtlı cihaz için paylaşılan anahtar artık kabul edilmez.**

### Cihaz yeniden kurulursa

Sır kaybolur ve cihaz paylaşılan anahtarla **yeniden kaydolamaz** — sunucu
`KAYITLI_CIHAZ_PAYLASILAN_ANAHTAR` döner. Bu bilinçli: aksi halde koruma
anlamsız olurdu. Yönetici kaydı silince cihaz temiz bir kayıt açar:

```bash
curl -X DELETE https://envanter.alperceviz.com/api/agents/<device_id> -b "am_session=..."
```

Panelden: **Ayarlar → Toplama Ajanları**. Hangi cihaz kayıtlı, hangi agent
sürümü, en son ne zaman rapor verdiği görünür; 24 saatten uzun süredir sessiz
kalan ajanlar kırmızı işaretlenir. "Kaydı sıfırla" düğmesi yeniden kurulan
makineler içindir. Cihaz sırları ne ekranda ne API yanıtında yer alır.

### Modlar (`WEBHOOK_AUTH`)

| Değer | Davranış |
|---|---|
| `required` (varsayılan) | İmzasız istek reddedilir. **Üretimde bu.** |
| `optional` | İmzasız kabul edilir ve loglanır; imza varsa katı doğrulanır. Geçiş için. |
| `off` | Doğrulama yok. Yalnız yerel geliştirme. |

Sunucu açılışta modu yazar. `required` dışındaysa uyarı basar — korumasız
çalıştığını kimsenin fark etmemesi en kötü senaryo.

### Kalan risk (dürüstçe)

Paylaşılan anahtarı ele geçiren biri **henüz kayıtsız** bir cihaz adına yeni
kayıt açabilir. Bunu tamamen kapatmak için cihaz başına önceden dağıtılan
kayıt jetonu veya mTLS gerekir. Sahte kayıtlar envanterde "yeni cihaz" olarak
görünür ve `GET /api/agents` listesinde `enrolled_at` ile ayırt edilir.

### QR ile telefon kaydı (`/api/register`)

Bu uç telefondan çağrıldığı için collector gibi imza atamaz — karşıda insan ve
tarayıcı var. Onun yerine **QR'ın içine yöneticinin ürettiği imzalı jeton**
gömülür:

1. Panelde **Varlıklar → Yeni Varlık Ekle → QR** sekmesinde kaç cihaz ve ne
   kadar süre geçerli olacağı seçilir (varsayılan 1 cihaz / 1 gün).
2. QR üretilirken sunucudan imzalı jeton alınır ve URL'ye eklenir.
3. Telefon o jetonu geri gönderir; sunucu imzayı, süreyi ve **kullanım
   hakkını** doğrular.

İmza tek başına yetmez — aynı QR'ı ele geçiren biri onu sonsuz kez
kullanabilirdi. Bu yüzden kullanım sayısı veritabanında tutulur ve koşullu
`UPDATE` ile artırılır (iki telefon aynı anda okutursa yalnız biri geçer).

Üst sınırlar: 7 gün, 100 kullanım. Jetonu üreten kullanıcı kaydedilir.
İptal: `DELETE /api/register/tokens/<jti>`.

`/api/register/bulk` (Toplu Depo Kaydı) **public listeden çıkarıldı** —
yalnızca girişli panelden çağrılıyor, açık olmasının hiçbir sebebi yoktu.

