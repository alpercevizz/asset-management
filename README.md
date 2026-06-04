# AI Asset Management

Claude AI destekli kurumsal IT varlık yönetim sistemi.

## Mimari

```
Client (PowerShell/Bash)
    └─► n8n Webhook
            └─► Baserow DB
                    └─► Node.js API (server.js)
                                └─► Claude AI Agent
                                        └─► Dashboard (Browser)
```

## Kurulum

```bash
# 1. Bağımlılıkları yükle
npm install

# 2. .env dosyası oluştur
cp .env.example .env
# .env içindeki değerleri doldur

# 3. Sunucuyu başlat
npm start
# Dashboard: http://localhost:3000
```

## .env Değerleri

| Değişken | Açıklama |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API anahtarı |
| `BASEROW_API_TOKEN` | Baserow token |
| `BASEROW_TABLE_ID` | Assets tablosunun ID'si |
| `BASEROW_API_URL` | Baserow URL (varsayılan: https://api.baserow.io) |

## Baserow Tablo Alanları

Baserow'da aşağıdaki field isimlerini kullanın:

| Alan | Tip |
|---|---|
| `hostname` | Text |
| `serial_number` | Text |
| `brand` | Text |
| `model` | Text |
| `cpu` | Text |
| `cpu_cores` | Number |
| `ram_gb` | Number |
| `storage_gb` | Number |
| `os` | Text |
| `ip_address` | Text |
| `mac_address` | Text |
| `username` | Text |
| `status` | Text |
| `last_seen` | Date |
| `uptime_days` | Number |
| `gpu` | Text |

## Client Script Kullanımı

**Windows:**
```powershell
# n8n üzerinden
.\collect-assets.ps1 -WebhookUrl "https://n8n.example.com/webhook/asset-collector"

# Direkt sunucuya
.\collect-assets.ps1 -WebhookUrl "http://localhost:3000/api/webhook"
```

**Linux/macOS:**
```bash
chmod +x collect-assets.sh
ASSET_WEBHOOK_URL="http://localhost:3000/api/webhook" ./collect-assets.sh
```

## Zamanlanmış Görev (Windows)

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NonInteractive -File C:\Path\collect-assets.ps1"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 6) -Once -At (Get-Date)
Register-ScheduledTask -TaskName "AssetCollector" -Action $action -Trigger $trigger -RunLevel Highest
```

## API Endpointleri

| Endpoint | Açıklama |
|---|---|
| `GET /api/assets` | Tüm varlıkları getir |
| `GET /api/stats` | İstatistikler |
| `POST /api/webhook` | Varlık ekle/güncelle |
| `POST /api/chat` | Claude AI ile sohbet |
| `DELETE /api/chat/:id` | Sohbeti temizle |
| `GET /api/health` | Sistem durumu |

## n8n Workflow

`n8n/workflow.json` dosyasını n8n'e import edip `BASEROW_API_URL` ve `BASEROW_TABLE_ID` environment variable'larını tanımlayın.
