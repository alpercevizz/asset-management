# ============================================================
#  AssetMan Collector - dagitim paketi olusturucu (SADECE ALPER calistirir)
#
#  Ne yapar:
#    1. Paylasilan anahtari (AGENT_SECRET) yerelde okur
#       (once data/secrets.json, sonra .env, olmazsa sorar).
#    2. Is arkadaslarina gonderilecek klasoru "dagitim/" altinda kurar:
#       KUR.bat, KUR.ps1, install-collector.ps1, collect-assets.ps1
#       ve gercek degerlerle doldurulmus ayar.ps1.
#    3. Tek dosya halinde .zip'e sikistirir.
#
#  GUVENLIK: Uretilen ayar.ps1 ve dagitim/ klasoru .gitignore'dadir;
#  anahtar ASLA depoya (git) girmez. Zip'i guvenli kanaldan gonderin.
#
#  Kullanim:
#    powershell -ExecutionPolicy Bypass -File paketle.ps1
#    powershell -ExecutionPolicy Bypass -File paketle.ps1 -WebhookUrl "https://ornek/api/webhook"
# ============================================================
param(
    [string]$WebhookUrl = "https://envanter.alperceviz.com/api/webhook",
    [string]$AgentKey   = "",   # bos: otomatik bulunur / sorulur
    [switch]$NoZip
)
$ErrorActionPreference = 'Stop'

$betikDizin = $PSScriptRoot
# repo koku: client-scripts/windows -> ../../
$repoKok = (Resolve-Path (Join-Path $betikDizin "..\..")).Path

function Anahtar-Bul {
    param([string]$repoKok)

    # 1) data/secrets.json
    $sj = Join-Path $repoKok "data\secrets.json"
    if (Test-Path $sj) {
        try {
            $o = Get-Content $sj -Raw | ConvertFrom-Json
            if ($o.AGENT_SECRET) { return [string]$o.AGENT_SECRET }
        } catch { }
    }
    # 2) .env  (AGENT_SECRET=...)
    $envDosya = Join-Path $repoKok ".env"
    if (Test-Path $envDosya) {
        $satir = Get-Content $envDosya | Where-Object { $_ -match '^\s*AGENT_SECRET\s*=' } | Select-Object -First 1
        if ($satir) {
            $deger = ($satir -replace '^\s*AGENT_SECRET\s*=', '').Trim().Trim('"').Trim("'")
            if ($deger) { return $deger }
        }
    }
    return $null
}

if (-not $AgentKey) {
    $AgentKey = Anahtar-Bul -repoKok $repoKok
}
if (-not $AgentKey) {
    Write-Host "AGENT_SECRET otomatik bulunamadi (data/secrets.json ve .env'de yok)." -ForegroundColor Yellow
    $gizli = Read-Host "Paylasilan anahtari (AGENT_SECRET) yapistirin" -AsSecureString
    $AgentKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($gizli))
}
if (-not $AgentKey) { Write-Error "Anahtar girilmedi. Iptal edildi."; exit 1 }

# --- Dagitim klasorunu kur ---
$dagitimKok = Join-Path $betikDizin "dagitim"
$paketDizin = Join-Path $dagitimKok "AssetMan-Collector"
if (Test-Path $paketDizin) { Remove-Item $paketDizin -Recurse -Force }
New-Item -ItemType Directory -Path $paketDizin -Force | Out-Null

# Gonderilecek dosyalar (KUR.bat/KUR.ps1 = kullanicinin calistiracagi,
# install+collect = asil is, README = kisa yonerge)
$kopyalanacak = @('KUR.bat', 'KUR.ps1', 'install-collector.ps1', 'collect-assets.ps1')
foreach ($d in $kopyalanacak) {
    $kaynak = Join-Path $betikDizin $d
    if (-not (Test-Path $kaynak)) { Write-Error "Eksik dosya: $d"; exit 1 }
    Copy-Item $kaynak (Join-Path $paketDizin $d) -Force
}

# Kisa kullanici yonergesi (is arkadasi icin)
$oku = @"
AssetMan Collector - Kurulum
============================

1. Bu klasordeki  KUR.bat  dosyasina CIFT TIKLAYIN.
2. "Yonetici olarak calistirmak istiyor" penceresinde  Evet  deyin.
3. Kurulum 2-4 dakika surer. "KURULUM TAMAMLANDI" yazinca pencereyi kapatin.

Baska bir sey yapmaniza gerek yok. Bilgisayariniz saatte bir
otomatik olarak envanter sistemine rapor verecek.

Sorun olursa hatanin ekran goruntusunu bize gonderin.
"@
Set-Content -Path (Join-Path $paketDizin "OKUBENI.txt") -Value $oku -Encoding utf8

# Gercek ayar.ps1 (anahtar damgalanir)
$ayarIcerik = @"
# Bu dosya paketle.ps1 tarafindan otomatik uretildi. Elle duzenlemeyin.
`$WebhookUrl = "$WebhookUrl"
`$AgentKey   = "$AgentKey"
"@
Set-Content -Path (Join-Path $paketDizin "ayar.ps1") -Value $ayarIcerik -Encoding utf8

Write-Host "[+] Paket hazirlandi: $paketDizin" -ForegroundColor Green
Write-Host "    Anahtar dosyaya yazildi (ekrana yazdirilmadi)." -ForegroundColor Gray

# --- Zip ---
if (-not $NoZip) {
    $zip = Join-Path $dagitimKok "AssetMan-Collector.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $paketDizin '*') -DestinationPath $zip -Force
    Write-Host "[+] Zip olusturuldu: $zip" -ForegroundColor Green
}

Write-Host ""
Write-Host "SIRADAKI ADIM:" -ForegroundColor Cyan
Write-Host "  dagitim/AssetMan-Collector.zip dosyasini is arkadaslarina gonderin." -ForegroundColor Cyan
Write-Host "  Onlar zip'i acip KUR.bat'a cift tiklayacak. Hepsi bu." -ForegroundColor Cyan
Write-Host ""
Write-Host "  UYARI: zip icinde paylasilan anahtar var. Guvenli kanaldan gonderin," -ForegroundColor Yellow
Write-Host "  herkese acik bir yere (mail listesi, ortak surucu) koymayin." -ForegroundColor Yellow
