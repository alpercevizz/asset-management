# ============================================================
#  AI Asset Management - Windows Hardware Collector
#  Bilgisayar bilgilerini toplar ve webhook'a gönderir
# ============================================================

param(
    [string]$WebhookUrl    = "http://localhost:3000/api/webhook",
    [string]$LicenseUrl    = "http://localhost:3000/api/licenses/sync",
    [string]$LogFile       = "$env:TEMP\asset-collector.log"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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
        username       = $env:USERNAME
        last_seen      = (Get-Date -Format "o")
        status         = "online"
        category       = "Bilgisayar"
        collector_ver  = "1.0.0"
    }

    # Null değerleri temizle
    $cleaned = @{}
    foreach ($key in $payload.Keys) {
        if ($null -ne $payload[$key]) {
            $cleaned[$key] = $payload[$key]
        }
    }

    Write-Log "Toplanan veriler: Hostname=$($cleaned.hostname), Seri=$($cleaned.serial_number), RAM=${totalRamGB}GB, Disk=${totalDiskGB}GB"

    # ── Webhook Gönder ───────────────────────────────────────────────────────
    $jsonBody = $cleaned | ConvertTo-Json -Depth 3 -Compress
    Write-Log "Webhook'a gonderiliyor: $WebhookUrl"

    $headers = @{
        "Content-Type" = "application/json"
        "User-Agent"   = "AssetCollector/1.0 (Windows)"
    }

    $response = Invoke-RestMethod -Uri $WebhookUrl -Method POST -Body $jsonBody -Headers $headers -TimeoutSec 30

    Write-Log "Basarili! Yanit: $($response | ConvertTo-Json -Compress)"

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
        $licResponse = Invoke-RestMethod -Uri $LicenseUrl -Method POST -Body $licJson -Headers $headers -TimeoutSec 60
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
