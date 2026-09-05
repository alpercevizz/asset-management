# ============================================================
#  AssetMan Collector - kolay kurulum sarmalayicisi
#  Kullanici bunu KUR.bat uzerinden calistirir (cift tiklama).
#  Gorevi: yonetici yetkisi al, ayar.ps1'i oku, gercek kurulumu
#  (install-collector.ps1) sessizce ayarlanmis degerlerle calistir
#  ve sonucu sade bir dille goster.
# ============================================================
$ErrorActionPreference = 'Stop'

# --- Yonetici degilsek kendimizi yonetici olarak yeniden baslat ---
$kimlik  = [Security.Principal.WindowsIdentity]::GetCurrent()
$yonetici = (New-Object Security.Principal.WindowsPrincipal($kimlik)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $yonetici) {
    Write-Host "Yonetici izni isteniyor (acilan pencerede 'Evet' deyin)..." -ForegroundColor Yellow
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
        )
    } catch {
        Write-Host "Yonetici izni verilmedi. Kurulum yapilamadi." -ForegroundColor Red
        Read-Host "Kapatmak icin Enter'a basin"
    }
    return
}

# --- Buradan itibaren yonetici yetkisiyle calisiyoruz ---
$ErrorActionPreference = 'Stop'
Clear-Host
Write-Host "==================================================="  -ForegroundColor Cyan
Write-Host "   AssetMan Collector Kurulumu"                       -ForegroundColor Cyan
Write-Host "==================================================="  -ForegroundColor Cyan
Write-Host ""

$ayarDosya    = Join-Path $PSScriptRoot 'ayar.ps1'
$kurucuBetik  = Join-Path $PSScriptRoot 'install-collector.ps1'

if (-not (Test-Path $ayarDosya)) {
    Write-Host "HATA: ayar.ps1 bulunamadi." -ForegroundColor Red
    Write-Host "Paket eksik gonderilmis olabilir. Lutfen paketi hazirlayan kisiye bildirin." -ForegroundColor Red
    Read-Host "Kapatmak icin Enter'a basin"; exit 1
}
if (-not (Test-Path $kurucuBetik)) {
    Write-Host "HATA: install-collector.ps1 bulunamadi (paket eksik)." -ForegroundColor Red
    Read-Host "Kapatmak icin Enter'a basin"; exit 1
}

# Ayarlari yukle ($WebhookUrl, $AgentKey)
. $ayarDosya

if ([string]::IsNullOrWhiteSpace($AgentKey) -or $AgentKey -eq 'BURAYA_AGENT_SECRET') {
    Write-Host "HATA: Kurulum anahtari ayarlanmamis." -ForegroundColor Red
    Write-Host "Paketi hazirlayan kisi 'paketle.ps1' calistirmali." -ForegroundColor Red
    Read-Host "Kapatmak icin Enter'a basin"; exit 1
}

Write-Host "Sunucu : $WebhookUrl" -ForegroundColor Gray
Write-Host "Bu islem 2-4 dakika surebilir. Lutfen pencereyi kapatmayin." -ForegroundColor Gray
Write-Host ""

try {
    & $kurucuBetik -WebhookUrl $WebhookUrl -AgentKey $AgentKey
    Write-Host ""
    Write-Host "==================================================="  -ForegroundColor Green
    Write-Host "   KURULUM TAMAMLANDI"                                -ForegroundColor Green
    Write-Host "==================================================="  -ForegroundColor Green
    Write-Host "Bu bilgisayar artik envantere otomatik rapor verecek." -ForegroundColor Green
    Write-Host "Baska bir sey yapmaniza gerek yok. Pencereyi kapatabilirsiniz." -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "KURULUM BASARISIZ" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Lutfen bu hatanin ekran goruntusunu paketi hazirlayan kisiye gonderin." -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Kapatmak icin Enter'a basin"
