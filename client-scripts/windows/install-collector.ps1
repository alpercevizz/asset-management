# ============================================================
#  AssetMan - Collector Kurulumu (Gorev Zamanlayici / SYSTEM)
#  Betigi SYSTEM hesabiyla, oturum acilmasa bile calisacak
#  sekilde zamanlanmis gorev olarak kaydeder.
#
#  KULLANIM (yonetici PowerShell):
#    .\install-collector.ps1 -WebhookUrl "https://envanter.alperceviz.com/api/webhook"
#
#  KALDIRMA:
#    .\install-collector.ps1 -Uninstall
# ============================================================
[CmdletBinding()]
param(
    [string]$WebhookUrl  = "https://envanter.alperceviz.com/api/webhook",
    [string]$LicenseUrl  = "",
    # Kurulum hedefi. ProgramData bilincli secildi: kullanici profilinden
    # BAGIMSIZ, SYSTEM okuyabiliyor ve kullanici silemiyor.
    [string]$InstallDir  = "$env:ProgramData\AssetMan",
    [int]$IntervalMinutes = 60,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "AssetMan Collector"

# ── Yonetici kontrolu ────────────────────────────────────────────────────────
# SYSTEM olarak gorev kaydetmek yonetici yetkisi ISTER. Kontrolu bastan
# yapiyoruz: yarim kurulum birakmak, hic kurmamaktan kotudur.
$kimlik = [Security.Principal.WindowsIdentity]::GetCurrent()
$yetki  = New-Object Security.Principal.WindowsPrincipal($kimlik)
if (-not $yetki.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Bu betik YONETICI olarak calistirilmali. PowerShell'i 'Yonetici olarak calistir' ile acin."
    exit 1
}

# ── Kaldirma ─────────────────────────────────────────────────────────────────
if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[+] Zamanlanmis gorev kaldirildi: $TaskName"
    } else {
        Write-Host "[-] Gorev zaten yok: $TaskName"
    }
    # Dosyalar BILINCLI olarak silinmiyor — log gecmisi kalsin.
    Write-Host "[i] Dosyalar duruyor: $InstallDir (gerekiyorsa elle silin)"
    exit 0
}

# ── Dosyalari kopyala ────────────────────────────────────────────────────────
$kaynak = Join-Path $PSScriptRoot "collect-assets.ps1"
if (-not (Test-Path $kaynak)) { Write-Error "collect-assets.ps1 bulunamadi: $kaynak"; exit 1 }

if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
Copy-Item $kaynak (Join-Path $InstallDir "collect-assets.ps1") -Force
Write-Host "[+] Betik kopyalandi: $InstallDir\collect-assets.ps1"

# Kullanicilar betigi DEGISTIREMESIN (degistirilirse SYSTEM yetkisiyle
# calisan keyfi kod anlamina gelir — yetki yukseltme acigi).
icacls $InstallDir /inheritance:r /grant "SYSTEM:(OI)(CI)F" /grant "Administrators:(OI)(CI)F" /grant "Users:(OI)(CI)RX" | Out-Null
Write-Host "[+] Dosya izinleri sikilastirildi (Users yalnizca okuma+calistirma)"

$logDosya = Join-Path $InstallDir "collector.log"

# ── Gorev tanimi ─────────────────────────────────────────────────────────────
$argListesi = @(
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", "`"$InstallDir\collect-assets.ps1`"",
    "-WebhookUrl", "`"$WebhookUrl`"",
    "-LogFile", "`"$logDosya`""
)
if ($LicenseUrl) { $argListesi += @("-LicenseUrl", "`"$LicenseUrl`"") }

$eylem = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
                                 -Argument ($argListesi -join ' ')

# Iki tetikleyici: acilista (5 dk gecikmeli, ag hazir olsun) + periyodik.
$tetikAcilis = New-ScheduledTaskTrigger -AtStartup
$tetikAcilis.Delay = "PT5M"
$tetikPeriyot = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
                  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

# SYSTEM + en yuksek yetki: BitLocker ve Windows Update okumasi bunu ister.
$kimlikBilgisi = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$ayarlar = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew
# Ag yoksa bekle: dizustu acilirken VPN/Wi-Fi henuz baglanmamis olabiliyor.
$ayarlar.RunOnlyIfNetworkAvailable = $true
# Rastgele gecikme: 500 makine ayni saniyede POST atarsa sunucu darbe yer.
$tetikPeriyot.RandomDelay = "PT5M"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[i] Onceki gorev kaldirildi (yeniden kurulacak)"
}

Register-ScheduledTask -TaskName $TaskName `
    -Description "AssetMan envanter ve telemetri toplayicisi (SYSTEM)" `
    -Action $eylem -Trigger @($tetikAcilis, $tetikPeriyot) `
    -Principal $kimlikBilgisi -Settings $ayarlar | Out-Null

Write-Host "[+] Gorev kaydedildi: $TaskName (SYSTEM, her $IntervalMinutes dk)"

# ── Dogrulama: hemen bir kez calistir ────────────────────────────────────────
Write-Host "[i] Test calistirmasi baslatiliyor..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 25

$gorev = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ""
Write-Host "  Son calisma  : $($gorev.LastRunTime)"
Write-Host "  Sonuc kodu   : $($gorev.LastTaskResult)  (0 = basarili)"
Write-Host "  Sonraki      : $($gorev.NextRunTime)"
Write-Host "  Log          : $logDosya"
Write-Host ""
if (Test-Path $logDosya) {
    Write-Host "--- Log (son 20 satir) ---"
    Get-Content $logDosya -Tail 20
}
Write-Host ""
Write-Host "Hangi olcumlerin okunabildigini yukaridaki logdan gorun."
Write-Host "'okunamadi' satirlari NORMALDIR: sanal makinede sicaklik sensoru,"
Write-Host "masaustunde pil yoktur. O alanlar panelde 'Olcum yok' gorunur."
