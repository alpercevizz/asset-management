# ============================================================
#  AI Asset Management - Windows Hardware Collector
#  Bilgisayar bilgilerini toplar ve webhook'a gönderir
# ============================================================

param(
    [string]$WebhookUrl    = "http://localhost:3000/api/webhook",
    [string]$LicenseUrl    = "http://localhost:3000/api/licenses/sync",
    [string]$LogFile       = "$env:TEMP\asset-collector.log",
    # Sunucudaki AGENT_SECRET ile ayni PAYLASILAN anahtar. Yalnizca ILK
    # baglantida (kayit/enrollment) kullanilir; sonrasinda cihaza ozel sir gecer.
    [string]$AgentKey      = "",
    # Paylasilan anahtarin dosyadan okundugu yol. Komut satirinda anahtar
    # tasimak, gorev tanimini okuyabilen HERKESE anahtari gosterir; dosya
    # SYSTEM+Administrators'a kilitlenebiliyor.
    [string]$AgentKeyFile  = "$env:ProgramData\AssetMangent.key",
    # Cihaza ozel sirrin saklandigi dosya. ProgramData bilincli: kullanici
    # profilinden bagimsiz, SYSTEM yazabiliyor.
    [string]$StateFile     = "$env:ProgramData\AssetMan\device.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$COLLECTOR_VERSION = "1.2.0"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    Write-Host $line
    $line | Out-File -FilePath $LogFile -Append -Encoding UTF8
}

function Get-SafeValue {
    param($Value, $Default = $null)
    if ($null -eq $Value -or $Value -eq "") { return $Default }
    return $Value
}

# ── Istek Imzalama ───────────────────────────────────────────────────────────
# Sunucu her webhook istegini HMAC-SHA256 ile dogrular. Imza GOVDE OZETINI de
# kapsar (yol ustunde degistirilemez) ve zaman damgasi + nonce icerir (eski bir
# istek tekrar oynatilamaz).

# Makine kimligi: kalici ve makineye ozgu olmali. MachineGuid Windows kurulumuyla
# birlikte uretilir ve yeniden kuruluma kadar degismez. Hostname KULLANILMAZ:
# degistirilebilir ve cakisabilir.
function Get-MachineId {
    try {
        $g = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
        if ($g) { return $g }
    } catch { }
    return $env:COMPUTERNAME    # son care
}

function Get-DeviceState {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }        # henuz kayitli degil
    try {
        return Get-Content $Path -Raw | ConvertFrom-Json
    } catch {
        # Dosya VAR ama okunamiyor. Neredeyse her zaman izin sorunudur: dosya
        # SYSTEM+Administrators'a kilitli (cihaz sirri kullanici tarafindan
        # okunabilseydi kullanici kendi makinesini taklit edebilirdi).
        # Bunu "kayitli degil" saymak YANLIS olur — paylasilan anahtarla
        # yeniden kaydolmayi dener, sunucu da onu hakli olarak reddeder.
        throw "Cihaz kayit dosyasi okunamiyor ($Path): $($_.Exception.Message)`n" +
              "Collector'i SYSTEM olarak (Gorev Zamanlayici) veya yonetici olarak calistirin. " +
              "Bkz. docs/COLLECTOR-KURULUM.md"
    }
}

function Save-DeviceState {
    param([string]$Path, [string]$DeviceId, [string]$Secret)
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    @{ device_id = $DeviceId; secret = $Secret; saved_at = (Get-Date -Format 'o') } |
        ConvertTo-Json | Out-File -FilePath $Path -Encoding UTF8 -Force
    # Cihaz sirri YALNIZCA SYSTEM ve yoneticilerce okunabilmeli. Kullanici
    # okuyabilseydi kendi makinesini taklit edebilirdi.
    try {
        icacls $Path /inheritance:r /grant "SYSTEM:F" /grant "Administrators:F" | Out-Null
    } catch { Write-Log "Cihaz dosyasi izinleri ayarlanamadi: $($_.Exception.Message)" "WARN" }
}

function New-SignedHeaders {
    param([string]$Secret, [string]$DeviceId, [string]$Method, [string]$Path, [string]$Body)

    $ts    = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $nonce = [guid]::NewGuid().ToString('N')

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bodyHash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Body)) | ForEach-Object { $_.ToString('x2') })
    } finally { $sha.Dispose() }

    # Taban sunucudaki agent-auth.js ile BIREBIR ayni olmali (satir sonu \n)
    $base = ($ts, $nonce, $Method.ToUpper(), $Path, $bodyHash) -join "`n"

    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    try {
        $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
        $sig = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($base)) | ForEach-Object { $_.ToString('x2') })
    } finally { $hmac.Dispose() }

    return @{
        "Content-Type"           = "application/json"
        "User-Agent"             = "AssetCollector/$COLLECTOR_VERSION (Windows)"
        "X-AssetMan-Device"      = $DeviceId
        "X-AssetMan-Timestamp"   = $ts
        "X-AssetMan-Nonce"       = $nonce
        "X-AssetMan-Signature"   = $sig
        "X-AssetMan-Agent"       = $COLLECTOR_VERSION
    }
}

Write-Log "Veri toplama basliyor..."

try {
    # ── Sistem Bilgileri ─────────────────────────────────────────────────────
    $cs      = Get-WmiObject -Class Win32_ComputerSystem
    $bios    = Get-WmiObject -Class Win32_BIOS
    $os      = Get-WmiObject -Class Win32_OperatingSystem
    $cpu     = Get-WmiObject -Class Win32_Processor | Select-Object -First 1
    $disks   = Get-WmiObject -Class Win32_DiskDrive
    $gpu     = Get-WmiObject -Class Win32_VideoController | Where-Object { $_.AdapterRAM -gt 0 } | Select-Object -First 1
    $network = Get-WmiObject -Class Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true } | Select-Object -First 1
    $ram     = Get-WmiObject -Class Win32_PhysicalMemory

    # ── RAM Hesapla ──────────────────────────────────────────────────────────
    $totalRamGB = [math]::Round(($ram | Measure-Object -Property Capacity -Sum).Sum / 1GB, 0)

    # ── Disk Hesapla ─────────────────────────────────────────────────────────
    $totalDiskGB = 0
    foreach ($disk in $disks) {
        if ($disk.Size) {
            $totalDiskGB += [math]::Round($disk.Size / 1GB, 0)
        }
    }

    # ── IP & MAC ─────────────────────────────────────────────────────────────
    $ipAddress  = if ($network) { ($network.IPAddress | Where-Object { $_ -match '^\d+\.\d+' } | Select-Object -First 1) } else { $null }
    $macAddress = if ($network) { $network.MACAddress } else { $null }

    # ── Seri No ──────────────────────────────────────────────────────────────
    $serialNumber = Get-SafeValue $bios.SerialNumber
    if ($serialNumber -match "To be filled|Default|VMware|VirtualBox|None|N/A") {
        $serialNumber = Get-SafeValue $cs.Name  # hostname as fallback
    }

    # ── OS Detay ─────────────────────────────────────────────────────────────
    $osVersion = "$($os.Caption) (Build $($os.BuildNumber))"

    # ── Uptime ───────────────────────────────────────────────────────────────
    $uptimeDays = [math]::Round((New-TimeSpan -Start $os.ConvertToDateTime($os.LastBootUpTime) -End (Get-Date)).TotalDays, 1)

    # ── GPU ──────────────────────────────────────────────────────────────────
    $gpuName   = if ($gpu) { Get-SafeValue $gpu.Caption } else { $null }
    $gpuRamGB  = if ($gpu -and $gpu.AdapterRAM) { [math]::Round($gpu.AdapterRAM / 1GB, 0) } else { $null }

    # ── Oturum Acan Kullanici ────────────────────────────────────────────────
    # DIKKAT: Gorev Zamanlayici'da SYSTEM olarak calisirken $env:USERNAME
    # "SYSTEM" veya "MAKINE$" doner — cihazi GERCEKTEN kullanan kisi degil.
    # Win32_ComputerSystem.UserName etkilesimli oturumu verir (DOMAIN\kullanici).
    # Kimse oturum acmamissa (kilitli/RDP kapali) NULL kalir; tahmin YAPILMAZ,
    # cunku bu deger zimmet uyusmazligi tespitinde kullaniliyor.
    $loggedUser = $null
    if ($cs.UserName) {
        $loggedUser = ($cs.UserName -split '\\')[-1]     # DOMAIN\ad -> ad
    } elseif ($env:USERNAME -and $env:USERNAME -notmatch '^(SYSTEM|.*\$)$') {
        $loggedUser = $env:USERNAME                      # etkilesimli calistirma
    }
    if ($loggedUser) { Write-Log "Oturum acan kullanici: $loggedUser" }
    else { Write-Log "Oturum acan kullanici tespit edilemedi (kimse oturum acmamis olabilir)" }

    # ── Canlı Telemetri ──────────────────────────────────────────────────────
    # HER ÖLÇÜM AYRI try/catch: biri okunamazsa (sanal makine, kısıtlı yetki,
    # donanım yok) digerleri yine gonderilsin. Okunamayan alan GONDERILMEZ —
    # sunucu NULL birakir ve arayuz "veri gelmedi" der. Sifir yazmak yanlis
    # olurdu: sunucuda pil YOK, sanal makinede sicaklik sensoru YOK.
    $telemetry = @{}

    # DIKKAT — Get-Counter KULLANILMIYOR. Sayac yollari ('\Processor(_Total)\
    # % Processor Time') Windows'un DILINE gore yerellesir; Turkce Windows'ta
    # "The specified object was not found" hatasi verir. Musterinin makineleri
    # Turkce oldugu icin CPU ve ag olcumu HIC gelmiyordu. Asagidaki WMI
    # siniflari dilden BAGIMSIZ, her yerelde ayni calisir.
    try {   # CPU: iki okuma alinip ortalanir (tek anlik deger dalgali)
        $p1 = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -ErrorAction Stop
        Start-Sleep -Milliseconds 800
        $p2 = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -ErrorAction Stop
        $telemetry.cpu_pct = [math]::Round((($p1.PercentProcessorTime + $p2.PercentProcessorTime) / 2), 1)
    } catch { Write-Log "CPU kullanimi okunamadi: $($_.Exception.Message)" }

    try {
        $freeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)   # KB -> GB
        $telemetry.ram_total_gb = $totalRamGB
        $telemetry.ram_used_gb  = [math]::Round($totalRamGB - $freeGB, 2)
    } catch { Write-Log "RAM kullanimi okunamadi: $($_.Exception.Message)" }

    try {   # Yalnizca sistem diski (C:) — tum diskleri toplamak yaniltici olur
        $sys = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'" -ErrorAction Stop
        $telemetry.disk_total_gb = [math]::Round($sys.Size / 1GB, 2)
        $telemetry.disk_used_gb  = [math]::Round(($sys.Size - $sys.FreeSpace) / 1GB, 2)
    } catch { Write-Log "Disk kullanimi okunamadi: $($_.Exception.Message)" }

    try {   # Ag: bayt/sn -> Mbps (WMI sinifi, dilden bagimsiz)
        $nic = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction Stop |
               Where-Object { $_.Name -notmatch 'isatap|Teredo|Loopback|Pseudo' }
        if ($nic) {
            $rx = ($nic | Measure-Object -Property BytesReceivedPersec -Sum).Sum
            $tx = ($nic | Measure-Object -Property BytesSentPersec -Sum).Sum
            $telemetry.net_rx_mbps = [math]::Round($rx * 8 / 1MB, 2)
            $telemetry.net_tx_mbps = [math]::Round($tx * 8 / 1MB, 2)
        }
    } catch { Write-Log "Ag kullanimi okunamadi: $($_.Exception.Message)" }

    try {   # Pil YALNIZCA dizustunde vardir; masaustu/sunucuda bu blok bos gecer
        $bat = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1
        if ($bat) {
            $telemetry.battery_pct = $bat.EstimatedChargeRemaining
            # Win32_Battery.BatteryStatus: 1=pilde, 2=sebekede, 3=dolu
            $telemetry.battery_state = switch ($bat.BatteryStatus) {
                1 { "pilde" } 2 { "sarj_oluyor" } 3 { "dolu" } default { $null }
            }
        }
    } catch { Write-Log "Pil durumu okunamadi (masaustu/sunucu olabilir)" }

    try {   # SICAKLIK: cogu makinede OKUNAMAZ. MSAcpi_ThermalZoneTemperature
            # birçok uretici tarafindan desteklenmez, sanal makinede hic yoktur.
            # Okunamazsa alan gonderilmez — arayuz "sensor yok" gosterir.
        $t = Get-CimInstance -Namespace root/WMI -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop |
             Select-Object -First 1
        if ($t -and $t.CurrentTemperature -gt 0) {
            $telemetry.temp_c = [math]::Round(($t.CurrentTemperature / 10) - 273.15, 1)
        }
    } catch { Write-Log "Sicaklik sensoru okunamadi (bu makinede desteklenmiyor)" }

    # ── Guvenlik Durumu ──────────────────────────────────────────────────────
    # Okunamayan alan GONDERILMEZ; "bilinmiyor" ile "kapali" ayni sey degil.
    $security = @{}

    try {
        $av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop
        if ($av) {
            $primary = $av | Select-Object -First 1
            $security.antivirus_name = $primary.displayName
            # productState bit alani: 0x1000 biti "gercek zamanli koruma acik"
            $aktif = $av | Where-Object { ($_.productState -band 0x1000) -ne 0 }
            $security.antivirus = if ($aktif) { "aktif" } else { "pasif" }
            $def = $av | Where-Object { $_.displayName -match 'Defender' }
            if ($def) { $security.defender = if (($def.productState -band 0x1000) -ne 0) { "aktif" } else { "pasif" } }
        }
    } catch { Write-Log "Antivirus durumu okunamadi: $($_.Exception.Message)" }

    try {   # Herhangi bir profil acikken guvenlik duvari "aktif" sayilir
        $fw = Get-NetFirewallProfile -ErrorAction Stop
        $security.firewall = if ($fw | Where-Object { $_.Enabled }) { "aktif" } else { "pasif" }
    } catch { Write-Log "Guvenlik duvari durumu okunamadi: $($_.Exception.Message)" }

    try {   # BitLocker: yonetici yetkisi ister, yoksa sessizce atlanir
        $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
        $security.disk_encryption = if ($bl.ProtectionStatus -eq 'On') { "aktif" } else { "pasif" }
    } catch { Write-Log "BitLocker durumu okunamadi (yonetici yetkisi gerekebilir)" }

    try {   # Bekleyen guncellemeler — Windows Update COM arayuzu
        $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
        $pending  = $searcher.Search("IsInstalled=0 and IsHidden=0").Updates
        $security.pending_updates  = $pending.Count
        $security.critical_patches = @($pending | Where-Object { $_.MsrcSeverity -eq 'Critical' }).Count
        $security.os_update = if ($pending.Count -eq 0) { "guncel" } else { "bekliyor" }
    } catch { Write-Log "Windows Update durumu okunamadi: $($_.Exception.Message)" }

    # ── Payload Oluştur ──────────────────────────────────────────────────────
    $payload = @{
        hostname       = $env:COMPUTERNAME
        serial_number  = $serialNumber
        brand          = Get-SafeValue $cs.Manufacturer
        model          = Get-SafeValue $cs.Model
        cpu            = "$($cpu.Name)".Trim()
        cpu_cores      = $cpu.NumberOfCores
        cpu_threads    = $cpu.NumberOfLogicalProcessors
        ram_gb         = $totalRamGB
        storage_gb     = $totalDiskGB
        os             = $osVersion
        os_arch        = $os.OSArchitecture
        ip_address     = $ipAddress
        mac_address    = $macAddress
        gpu            = $gpuName
        gpu_ram_gb     = $gpuRamGB
        uptime_days    = $uptimeDays
        domain         = Get-SafeValue $cs.Domain
        username       = $loggedUser
        last_seen      = (Get-Date -Format "o")
        status         = "online"
        category       = "Bilgisayar"
        collector_ver  = $COLLECTOR_VERSION
    }

    # Null değerleri temizle
    $cleaned = @{}
    foreach ($key in $payload.Keys) {
        if ($null -ne $payload[$key]) {
            $cleaned[$key] = $payload[$key]
        }
    }

    # Olcum blolklari yalnizca ICI DOLUYSA eklenir. Bos nesne gondermek
    # sunucuda "olcum alindi ama hepsi bos" satiri acardi.
    if ($telemetry.Count -gt 0) { $cleaned.telemetry = $telemetry }
    if ($security.Count  -gt 0) { $cleaned.security  = $security }

    Write-Log "Toplanan veriler: Hostname=$($cleaned.hostname), Seri=$($cleaned.serial_number), RAM=${totalRamGB}GB, Disk=${totalDiskGB}GB"

    # ── Webhook Gönder (imzali) ──────────────────────────────────────────────
    $jsonBody = $cleaned | ConvertTo-Json -Depth 3 -Compress
    Write-Log "Webhook'a gonderiliyor: $WebhookUrl"

    $machineId = Get-MachineId
    $state     = Get-DeviceState -Path $StateFile

    # Cihaza ozel sir varsa ONU kullan; yoksa paylasilan anahtarla kaydol.
    # Kayitli cihaz icin sunucu paylasilan anahtari BILEREK reddeder.
    # -AgentKey verilmediyse korumali dosyadan oku
    if (-not $AgentKey -and (Test-Path $AgentKeyFile)) {
        try { $AgentKey = (Get-Content $AgentKeyFile -Raw).Trim() }
        catch { Write-Log "Anahtar dosyasi okunamadi ($AgentKeyFile): $($_.Exception.Message)" "WARN" }
    }

    if ($state -and $state.secret) {
        $signingKey = $state.secret
        $deviceId   = $state.device_id
        Write-Log "Imzalama: cihaza ozel sir (kayitli)"
    } elseif ($AgentKey) {
        $signingKey = $AgentKey
        $deviceId   = $machineId
        Write-Log "Imzalama: paylasilan anahtar (ilk kayit yapilacak)"
    } else {
        throw "Imzalama anahtari yok. -AgentKey verin, $AgentKeyFile dosyasina yazin (sunucudaki AGENT_SECRET) veya cihaz $StateFile ile kayitli olsun."
    }

    $uri     = [Uri]$WebhookUrl
    $headers = New-SignedHeaders -Secret $signingKey -DeviceId $deviceId `
                                 -Method 'POST' -Path $uri.AbsolutePath -Body $jsonBody

    # Gövde BAYT olarak gonderilir: Invoke-RestMethod string'i varsayilan
    # kodlamayla yollarsa Turkce karakterlerde bayt dizisi degisir ve sunucudaki
    # govde ozeti tutmaz — imza gecersiz olurdu.
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($jsonBody)
    $response  = Invoke-RestMethod -Uri $WebhookUrl -Method POST -Body $bodyBytes -Headers $headers -TimeoutSec 30

    # Ilk kayitta sunucu cihaza ozel sirri BIR KEZ dondurur — hemen sakla.
    if ($response.PSObject.Properties.Name -contains 'enrollment' -and $response.enrollment.secret) {
        Save-DeviceState -Path $StateFile -DeviceId $response.enrollment.device_id -Secret $response.enrollment.secret
        Write-Log "Cihaz kaydi tamamlandi. Cihaza ozel sir saklandi: $StateFile"
        Write-Log "Bundan sonra paylasilan anahtar bu cihaz icin KULLANILMAYACAK."
        # AYNI CALISTIRMADAKI sonraki istekler (lisans sync) de yeni sirla
        # imzalanmali: sunucu artik bu cihaz icin paylasilan anahtari reddediyor.
        $signingKey = $response.enrollment.secret
        $deviceId   = $response.enrollment.device_id
    }

    Write-Log "Basarili! Yanit: $($response | ConvertTo-Json -Compress -Depth 3)"

    # ── Yazılım & Lisans Toplama ─────────────────────────────────────────────
    Write-Log "Yazilim envanteri toplanıyor..."

    # Önemli yazılımları tespit et
    $trackedPublishers = @("Microsoft","Adobe","Autodesk","Symantec","SentinelOne",
                           "CrowdStrike","Trend Micro","ESET","Kaspersky","TeamViewer",
                           "Citrix","VMware","Oracle","SAP","Zebra")
    $trackedNames      = @("Office","Visual Studio","AutoCAD","Acrobat","Photoshop",
                           "Illustrator","SentinelOne","CrowdStrike","TeamViewer",
                           "AnyDesk","VPN","Endpoint","Security","Antivirus","Windows Server")

    $regPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    $allInstalled = @()
    foreach ($path in $regPaths) {
        $items = Get-ItemProperty $path -ErrorAction SilentlyContinue
        foreach ($item in $items) {
            try {
                $dn = $item.DisplayName
                # SDK / Runtime / düşük seviye bileşenleri hariç tut
                $skipPattern = "^KB\d+|Hotfix|Update for |Security Update|" +
                    "Microsoft \.NET .*(Runtime|SDK|Host|AppHost|Targeting|Standard|CoreRuntime|Toolset|Templates)|" +
                    "Microsoft (Windows Desktop|ASP\.NET Core).*(Runtime|Targeting Pack|Shared Framework)|" +
                    "Microsoft Visual C\+\+ 20\d\d.*(Redistributable|Runtime)|" +
                    "^vs_|^vcpp_|^icecap_|^DiagnosticsHub|^IntelliTrace|^windows_toolscore|" +
                    "ClickOnce Bootstrapper|^Visual C\+\+ Library|" +
                    "Workload\.|\.Manifest-|NetStandard SDK|\.NET Native|Universal Windows Platform SDK|" +
                    "Microsoft (TestPlatform|NetStandard|UniversalWindowsPlatform)|" +
                    "VS JIT Debugger|VS Immersive|vs_filehandler|File Handler|" +
                    "SQL Server 20\d\d (Batch|Common Files|Connection|DMF|XEvent|Shared Management|Database Engine|SQL Diagnostics|Backward|SQLAS|RsFx)|" +
                    "Browser for SQL Server|Microsoft VSS Writer for SQL|Microsoft System CLR Types|" +
                    "Microsoft (ODBC|OLE DB) Driver.*for SQL Server|" +
                    "Office 1\d Click-to-Run|" +
                    "Visual Studio (Installer|Setup|WMI|i.in|için)$|" +
                    "Microsoft Visual Studio (Installer|Setup|WMI)|" +
                    "Entity Framework.*Tools|Toplu Intellisense|" +
                    "Microsoft Edge WebView2|Adobe (Refresh Manager|Genuine Service)"
                if ($dn -and $dn.Trim() -ne "" -and $dn -notmatch $skipPattern) {
                    $allInstalled += $item
                }
            } catch { }
        }
    }

    # Sadece takip edilmesi gereken yazılımları filtrele
    $trackedSoftware = @()
    $seenNames = @{}
    foreach ($item in $allInstalled) {
        try {
            $name = $item.DisplayName
            $pub  = $item.Publisher
            if ($seenNames.ContainsKey($name)) { continue }
            $matched = ($trackedPublishers | Where-Object { $pub  -like "*$_*" }) -or
                       ($trackedNames      | Where-Object { $name -like "*$_*" })
            if ($matched) {
                $trackedSoftware += $item
                $seenNames[$name] = $true
            }
        } catch { }
    }

    # Office aktivasyon durumu
    function Get-OfficeLicenseStatus {
        $wmiLicenses = Get-WmiObject SoftwareLicensingProduct -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*Office*" -and $_.PartialProductKey }
        $results = @{}
        foreach ($lic in $wmiLicenses) {
            $status = switch ($lic.LicenseStatus) {
                0 { "Unlicensed" }
                1 { "Licensed" }
                2 { "OOBGrace" }
                3 { "OOTGrace" }
                4 { "NonGenuineGrace" }
                5 { "Notification" }
                6 { "ExtendedGrace" }
                default { "Unknown" }
            }
            $results[$lic.Name] = @{
                status  = $status
                keyHint = if ($lic.PartialProductKey) { $lic.PartialProductKey } else { "" }
            }
        }
        return $results
    }

    # Lisans tipi tahmini
    function Get-LicenseType($name, $publisher) {
        if ($name -match "365|Microsoft 365")             { return "Subscription" }
        if ($name -match "Volume|KMS|MAK|VLSC")           { return "Volume" }
        if ($name -match "OEM")                           { return "OEM" }
        if ($name -match "ESD|Digital Download|Online")   { return "ESD" }
        if ($publisher -match "Microsoft" -and $name -match "Office 20(16|19|21|24)") { return "ESD" }
        return "Unknown"
    }

    $officeLicenses = Get-OfficeLicenseStatus
    $softwareList   = @()

    foreach ($sw in $trackedSoftware) {
        try {
        $props     = $sw.PSObject.Properties.Name
        $name      = if ("DisplayName"    -in $props) { $sw.DisplayName.Trim()    } else { continue }
        $publisher = if ("Publisher"      -in $props) { $sw.Publisher             } else { "" }
        $version   = if ("DisplayVersion" -in $props) { $sw.DisplayVersion        } else { "" }
        $rawDate   = if ("InstallDate"    -in $props) { $sw.InstallDate           } else { "" }
        $instDate  = if ($rawDate -and $rawDate.Length -eq 8) {
                         "$($rawDate.Substring(0,4))-$($rawDate.Substring(4,2))-$($rawDate.Substring(6,2))"
                     } else { "" }

        # Office için WMI'dan aktivasyon durumu al
        $licStatus  = "Unknown"
        $keyHint    = ""
        foreach ($key in $officeLicenses.Keys) {
            if ($key -like "*Office*" -and $name -like "*Office*") {
                $licStatus = $officeLicenses[$key].status
                $keyHint   = $officeLicenses[$key].keyHint
                break
            }
        }

        # SentinelOne servis durumu
        if ($name -like "*SentinelOne*") {
            $svc = Get-Service "SentinelAgent" -ErrorAction SilentlyContinue
            $licStatus = if ($svc -and $svc.Status -eq "Running") { "Licensed" } else { "Unlicensed" }
        }

        $licType = Get-LicenseType $name $publisher

        $entry = @{
            software_name    = $name
            software_version = if ($version)  { $version }  else { "" }
            publisher        = if ($publisher) { $publisher } else { "" }
            license_type     = $licType
            license_status   = $licStatus
            key_hint         = $keyHint
            install_date     = if ($instDate)  { $instDate } else { "" }
        }

        # Null/boş temizle
        $cleanEntry = @{}
        foreach ($k in $entry.Keys) { if ($entry[$k] -ne $null -and $entry[$k] -ne "") { $cleanEntry[$k] = $entry[$k] } }
        $softwareList += $cleanEntry
        } catch { }
    }

    if ($softwareList.Count -gt 0) {
        $licPayload = @{
            hostname      = $cleaned.hostname
            serial_number = $cleaned.serial_number
            username      = $cleaned.username
            location      = if ($cleaned.ContainsKey("location")) { $cleaned.location } else { "" }
            software      = $softwareList
        }
        $licJson = $licPayload | ConvertTo-Json -Depth 5 -Compress
        # AYRI imza sart: imza yolu ve govde ozetini kapsar, webhook'un
        # basliklari burada gecersizdir (nonce da tekrar sayilir).
        $licUri     = [Uri]$LicenseUrl
        $licHeaders = New-SignedHeaders -Secret $signingKey -DeviceId $deviceId `
                                        -Method 'POST' -Path $licUri.AbsolutePath -Body $licJson
        $licBytes    = [Text.Encoding]::UTF8.GetBytes($licJson)
        $licResponse = Invoke-RestMethod -Uri $LicenseUrl -Method POST -Body $licBytes -Headers $licHeaders -TimeoutSec 60
        Write-Log "Lisans sync: $($licResponse.created) eklendi, $($licResponse.updated) guncellendi ($($softwareList.Count) yazilim)"
    } else {
        Write-Log "Takip edilecek yazilim bulunamadi."
    }

} catch {
    Write-Log "HATA: $($_.Exception.Message)" -Level "ERROR"
    Write-Log "Stack: $($_.ScriptStackTrace)" -Level "ERROR"
    exit 1
}

Write-Log "Tamamlandi."
