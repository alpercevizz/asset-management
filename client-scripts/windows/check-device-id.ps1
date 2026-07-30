# ============================================================
#  AssetMan - Cihaz Kimligi Kontrolu (SALT OKUNUR)
#
#  Collector'i dagitmadan ONCE calistirin. Hicbir sey yazmaz,
#  hicbir yere baglanmaz; yalnizca bu makinenin kimlik degerlerini
#  ekrana basar.
#
#  NEDEN GEREKLI: sysprep yapilmadan klonlanan imajlarda MachineGuid
#  TUM makinelerde AYNI kalir. Collector kimligi once SMBIOS UUID'den
#  uretir (klonlamadan etkilenmez), ama bazi anakart ureticileri tum
#  partiye ayni UUID'yi yaziyor. Boyle bir durumda iki makine tek
#  cihaz sanilir. Bu betigi birkac makinede calistirip "Cihaz Kimligi"
#  satirlarini KARSILASTIRIN — ayni cikan varsa dagitimdan once cozun.
#
#  KULLANIM:
#    .\check-device-id.ps1
#
#  BIRDEN COK MAKINEDE (yonetici, uzaktan):
#    Invoke-Command -ComputerName PC1,PC2,PC3 -FilePath .\check-device-id.ps1
# ============================================================
[CmdletBinding()]
param()

$SAHTE_UUID = @(
    '00000000-0000-0000-0000-000000000000',
    'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
    '03000200-0400-0500-0006-000700080009',   # AMI varsayilani
    '00020003-0004-0005-0006-000700080009'
)
$SAHTE_SERI = 'To be filled|Default string|System Serial|O\.E\.M|None|N/A|Not Specified|^\s*$'

$uuid = $null; $seri = $null; $mg = $null
try { $uuid = (Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop).UUID } catch { }
try { $seri = (Get-CimInstance Win32_BIOS -ErrorAction Stop).SerialNumber } catch { }
try { $mg = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid } catch { }

$uuidGecerli = $uuid -and ($SAHTE_UUID -notcontains $uuid.ToUpper())
$seriGecerli = $seri -and ($seri -notmatch $SAHTE_SERI)

if     ($uuidGecerli) { $kimlik = $uuid.ToUpper();        $kaynak = 'SMBIOS UUID' }
elseif ($seriGecerli) { $kimlik = "BIOS:$($seri.Trim())"; $kaynak = 'BIOS seri no' }
elseif ($mg)          { $kimlik = "MG:$mg";               $kaynak = 'MachineGuid' }
else                  { $kimlik = "HOST:$env:COMPUTERNAME"; $kaynak = 'hostname' }

Write-Output ""
Write-Output "  Bilgisayar     : $env:COMPUTERNAME"
Write-Output "  SMBIOS UUID    : $uuid$(if (-not $uuidGecerli -and $uuid) { '   <-- BILINEN SAHTE DEGER' })"
Write-Output "  BIOS seri no   : $seri$(if (-not $seriGecerli -and $seri) { '   <-- yer tutucu' })"
Write-Output "  MachineGuid    : $mg"
Write-Output ""
Write-Output "  CIHAZ KIMLIGI  : $kimlik"
Write-Output "  Kaynak         : $kaynak"
Write-Output ""

if ($kaynak -eq 'SMBIOS UUID') {
    Write-Output "  DURUM: IYI. Kimlik anakarttan/hipervizorden geliyor; disk imaji"
    Write-Output "         klonlansa bile makineye ozgu kalir."
} elseif ($kaynak -eq 'BIOS seri no') {
    Write-Output "  DURUM: KABUL EDILEBILIR. SMBIOS UUID kullanilamadi, BIOS seri no"
    Write-Output "         kullaniliyor. Anakart degisirse kimlik degisir ve cihazin"
    Write-Output "         kaydini panelden sifirlamaniz gerekir."
} else {
    Write-Warning "DIKKAT: Kimlik $kaynak uzerinden uretiliyor."
    Write-Warning "Sysprep yapilmamis bir imajdan klonlandiysa bu deger DIGER makinelerle"
    Write-Warning "AYNI olur. O durumda yalniz ILK makine kaydolabilir, digerleri 401 alir."
}

Write-Output ""
Write-Output "  YAPILACAK: Bu betigi birkac makinede calistirin ve 'CIHAZ KIMLIGI'"
Write-Output "  satirlarini karsilastirin. Ayni cikan iki makine varsa dagitimdan"
Write-Output "  once imaji sysprep ile yeniden hazirlayin."
Write-Output ""
