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
.\install-collector.ps1 -WebhookUrl "https://envanter.alperceviz.com/api/webhook"
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
  -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "\\dc01\NETLOGON\AssetMan\collect-assets.ps1" -WebhookUrl "https://envanter.alperceviz.com/api/webhook" -LogFile "C:\ProgramData\AssetMan\collector.log"
  ```
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

## Güvenlik notu

Betik `-WebhookUrl` ile verilen adrese **kimlik doğrulaması olmadan** POST
atar; `/api/webhook` public bir uç noktadır. Lokasyon bildirimi
`X-Location-Token` ile doğrulanır (bkz. [LOKASYON-AJANI-KURULUM.md](LOKASYON-AJANI-KURULUM.md)),
fakat envanter yazımı için token yoktur. İnternete açık kurulumda webhook'u
IP kısıtı veya ön kimlik doğrulama arkasına almak gerekir — aksi halde
adresi bilen biri sahte cihaz kaydı oluşturabilir.
