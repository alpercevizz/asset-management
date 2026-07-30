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
    # Sunucudaki AGENT_SECRET. Cihazin ILK kaydi icin sart; kayittan sonra
    # cihaz kendi sirriyla imzalar ve bu anahtar o cihaz icin gecersizlesir.
    [Parameter(Mandatory = $false)][string]$AgentKey = "",
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

# ── Imzalama anahtari kontrolu ───────────────────────────────────────────────
# Sunucu WEBHOOK_AUTH=required ile calisiyorsa imzasiz istek reddedilir.
# Anahtarsiz kurulum, her saat sessizce 401 alan bir gorev birakirdi.
$zatenKayitli = Test-Path (Join-Path $InstallDir "device.json")
$anahtarVar   = Test-Path (Join-Path $InstallDir "agent.key")
if (-not $AgentKey -and -not $zatenKayitli -and -not $anahtarVar) {
    Write-Warning "-AgentKey verilmedi ve bu cihaz henuz kayitli degil."
    Write-Warning "Sunucudaki AGENT_SECRET degerini kullanin (data/secrets.json veya .env)."
    Write-Warning "Sunucuda WEBHOOK_AUTH=off degilse collector 401 alacaktir."
}
if ($zatenKayitli) { Write-Host "[i] Cihaz zaten kayitli — kendi sirriyla imzalayacak" }

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
    "-LogFile", "`"$logDosya`"",
    "-StateFile", "`"$InstallDir\device.json`""
)
if ($LicenseUrl) { $argListesi += @("-LicenseUrl", "`"$LicenseUrl`"") }
# Anahtar gorev argumanina KONMAZ — gorev tanimini okuyabilen herkes gorurdu.
# Kilitli dosyaya yazilir, collector oradan okur.
if ($AgentKey) {
    $anahtarDosya = Join-Path $InstallDir "agent.key"
    Set-Content -Path $anahtarDosya -Value $AgentKey -Encoding ascii -NoNewline
    icacls $anahtarDosya /inheritance:r /grant "SYSTEM:F" /grant "Administrators:F" | Out-Null
    Write-Host "[+] Paylasilan anahtar kilitli dosyaya yazildi (yalniz SYSTEM+Administrators)"
}

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
# BITMESINI BEKLE. Onceki surum 25 saniye bekleyip sonucu yaziyordu; toplama
# 2-4 dakika suruyor (yazilim envanteri + Windows Update sorgusu), bu yuzden
# her zaman 267009 (0x41301 = "gorev hala calisiyor") gosteriyor ve kullaniciya
# basarili mi basarisiz mi oldugunu SOYLEMIYORDU.
Write-Host "[i] Test calistirmasi baslatiliyor (2-4 dakika surebilir)..."
Start-ScheduledTask -TaskName $TaskName

$azamiSaniye = 360
$gecen = 0
while ($gecen -lt $azamiSaniye) {
    Start-Sleep -Seconds 5
    $gecen += 5
    if ((Get-ScheduledTask -TaskName $TaskName).State -ne 'Running') { break }
    if ($gecen % 30 -eq 0) { Write-Host "    ...calisiyor ($gecen sn)" }
}

$gorev = Get-ScheduledTaskInfo -TaskName $TaskName
$kod = $gorev.LastTaskResult
$aciklama = switch ($kod) {
    0        { "BASARILI" }
    267009   { "hala calisiyor (zaman asimi - logu kontrol edin)" }
    267011   { "gorev henuz calismadi" }
    default  { "HATA (0x" + ('{0:X}' -f $kod) + ") - logu kontrol edin" }
}

Write-Host ""
Write-Host "  Son calisma  : $($gorev.LastRunTime)"
Write-Host "  Sonuc        : $kod  ->  $aciklama"
Write-Host "  Sonraki      : $($gorev.NextRunTime)"
Write-Host "  Log          : $logDosya"
Write-Host ""
if (Test-Path $logDosya) {
    Write-Host "--- Log (son 25 satir) ---"
    Get-Content $logDosya -Tail 25
}

# Logda ERROR varsa kullaniciyi acikca uyar — "kuruldu" demek yetmez,
# kurulmus ama her saat hata veren bir gorev en kotu sonuc.
if ((Test-Path $logDosya) -and ((Get-Content $logDosya -Tail 25) -match '\[ERROR\]')) {
    Write-Host ""
    Write-Warning "Logda HATA var — collector veri gonderemedi. Yukaridaki ERROR satirlarina bakin."
    Write-Warning "Sik neden: -AgentKey eksik/yanlis, ag veya TLS sorunu, sunucuda WEBHOOK_AUTH=required."
} else {
    Write-Host ""
    Write-Host "Hangi olcumlerin okunabildigini yukaridaki logdan gorun."
    Write-Host "'okunamadi' satirlari NORMALDIR: sanal makinede sicaklik sensoru,"
    Write-Host "masaustunde pil yoktur. O alanlar panelde 'Olcum yok' gorunur."
}
