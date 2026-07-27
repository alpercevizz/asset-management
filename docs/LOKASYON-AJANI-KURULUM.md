# AssetMan — Lokasyon Ajanı (location-agent) Kurulum Runbook

Bu belge, her fiziksel lokasyona bir **lokasyon ajanı** kurar. Ajan o lokasyonun ağını tarar,
bulduğu cihazları merkezî AssetMan'e bildirir ve **cihazın hangi lokasyonda olduğunu** kanıtlar.
Lokasyon başına ~20 dakika.

> **Neden gerekli?** Ajan olmadan sistem cihazın *ait olduğu* yeri bilir (elle tanımlanır),
> ama *görüldüğü* yeri bilemez. Sapma uyarısı ("cihaz olmaması gereken yerde") ancak bu ajan
> çalıştığında üretilebilir. Ana collector lokasyon **toplamaz**.

---

## 0. Ön koşullar

| # | Gereksinim | Not |
|---|---|---|
| 1 | Merkezî AssetMan çalışıyor | `https://envanter.alperceviz.com` |
| 2 | Lokasyonda **sürekli açık** bir makine | Küçük Linux VM / mini PC / mevcut bir sunucu. Node.js 18+ |
| 3 | Bu makine lokasyonun LAN'ında | Ping + SNMP UDP 161 erişimi olacak |
| 4 | Bu makineden merkeze **HTTPS (443) çıkışı** | Ajan dışarı bağlanır; merkeze içeri port açmak GEREKMEZ |
| 5 | Ağ cihazlarında SNMP açık | Switch/firewall/AP/yazıcı — read-only community yeter |

> **Mimari not:** Ajan **dışarı doğru** bağlanır (agent → merkez). Lokasyona gelen bağlantı,
> port yönlendirme veya VPN gerekmez. Merkez VPS'te olsa bile çalışır.

---

## 1. Merkezde token üret (her lokasyon için AYRI)

AssetMan sunucusunda:

```bash
node -e "console.log('loc-'+require('crypto').randomBytes(24).toString('hex'))"
```

Her lokasyon için bir kez çalıştırın. Çıktıyı `.env`'e ekleyin (tek satır, JSON):

```ini
LOCATION_TOKENS={"loc-a1b2...":"İstanbul Merkez","loc-c3d4...":"Kocaeli Depo"}
```

Değişikliği uygulayın — **`restart` değil**, `.env`'i yeniden okumaz:

```bash
cd /opt/asset-management && docker compose --profile postgres up -d
```

Doğrulama: panelde **Ayarlar → Lokasyon İzleme** kartında
"Lokasyon token doğrulaması **açık**" yazmalı.

> **Token = lokasyonun kimliğidir.** Sunucu lokasyon adını TOKEN'DAN çözer; ajanın gönderdiği
> `location` metnine güvenmez. Bu yüzden token'lar parola gibi saklanır, lokasyonlar arasında
> paylaşılmaz.

---

## 2. Lokasyon makinesine ajanı kur

```bash
sudo mkdir -p /opt/assetman-agent && cd /opt/assetman-agent
# Depodaki location-agent klasörünü kopyalayın (git clone veya scp)
git clone --depth 1 https://github.com/alpercevizz/asset-management.git /tmp/am \
  && cp -r /tmp/am/location-agent/* . && rm -rf /tmp/am
npm install --omit=dev
```

Bağımlılıklar: `axios`, `net-snmp`, `ping`.

---

## 3. Ajanı yapılandır

```bash
cp config.example.json config.json && nano config.json
```

```json
{
  "location_id":    "istanbul-merkez",
  "location_name":  "İstanbul Merkez",
  "server_url":     "https://envanter.alperceviz.com/api/webhook",
  "location_token": "loc-a1b2...",

  "network": {
    "range":           "192.168.1.0/24",
    "snmp_community":  "okuma-community",
    "snmp_timeout_ms": 3000,
    "only_snmp":       true
  },

  "intervals": {
    "discovery_hours":   24,
    "snmp_poll_minutes": 60,
    "ping_minutes":      5
  }
}
```

| Alan | Açıklama |
|---|---|
| `location_token` | **1. adımdaki token ile BİREBİR aynı.** Eşleşmezse sunucu 401 döner |
| `location_name` | Yalnız yerel log içindir — sunucu adı token'dan çözer |
| `network.range` | Bu lokasyonun subnet'i (CIDR). Birden çok subnet varsa her biri için ayrı config + ayrı servis |
| `only_snmp` | **`true` bırakın.** Aşağıdaki uyarıya bakın |
| `ping_minutes` | Online/offline takibi. 5 dk makul; ağ yükü düşük |

### ⚠️ `only_snmp` neden `true` kalmalı

`false` yaparsanız ajan, SNMP'ye cevap vermeyen **her** host için kayıt açar. Bir Windows PC
hakkında ajanın elinde yalnız IP + MAC vardır → `device-192-168-1-57` adıyla, seri numarası
`MAC-...` olan **jenerik bir kayıt** oluşur. Aynı makine collector ile **gerçek** seri
numarasıyla da kaydolduğundan envanterde **çift kayıt** olur.

`true` iken ajan yalnız SNMP'ye cevap veren cihazları (switch, firewall, AP, yazıcı) yazar —
zaten işi budur. **İstemcilerin envanteri collector'ün işidir.**

> **Bilinen sınır:** Bu ayrım nedeniyle ajan, PC/dizüstü için lokasyon sinyali **üretmez**.
> Bilgisayarların konumu bugün yalnız elle veya QR kaydıyla girilir. Ağ tabanlı PC konum takibi
> (MAC eşleştirmeli) henüz yok — bkz. "Sonraki adımlar".

---

## 4. Elle bir kez çalıştırıp doğrula

```bash
cd /opt/assetman-agent && node agent.js
```

Beklenen çıktı:

```
[INFO] Lokasyon  : İstanbul Merkez
[INFO] Ağ aralığı: 192.168.1.0/24
[INFO] ─── Ağ Keşfi Başlıyor ───
[INFO] 43 aktif host bulundu
[OK]   192.168.1.1      SW-CORE-01          [Ağ Aygıtı]
[OK]   192.168.1.20     HP-LASERJET-MUH     [Yazıcı]
[INFO] 192.168.1.57     SNMP yanıtı yok → atlandı (only_snmp)
```

`Ctrl+C` ile durdurun. Panelden doğrulayın:
**Varlıklar** → keşfedilen cihazlar görünmeli, **Lokasyon** sütunu doğru olmalı.
Cihaza tıklayın → **Lokasyon** kutusunda "Görülen (telemetri): İstanbul Merkez · kaynak: location-agent".

---

## 5. Servis olarak çalıştır (systemd)

```bash
sudo tee /etc/systemd/system/assetman-agent.service > /dev/null <<'EOF'
[Unit]
Description=AssetMan Lokasyon Ajani
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/assetman-agent
ExecStart=/usr/bin/node agent.js
Restart=always
RestartSec=30
User=assetman
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo useradd -r -s /usr/sbin/nologin assetman 2>/dev/null || true
sudo chown -R assetman:assetman /opt/assetman-agent
sudo chmod 600 /opt/assetman-agent/config.json    # token içerir
sudo systemctl daemon-reload
sudo systemctl enable --now assetman-agent
sudo systemctl status assetman-agent --no-pager
```

Log izleme:
```bash
journalctl -u assetman-agent -f
```

### Aynı lokasyonda birden çok subnet

Her subnet için ayrı config + ayrı servis:
```bash
cp config.json config.vlan20.json   # range'i değiştirin, token AYNI kalır
sudo cp /etc/systemd/system/assetman-agent.service /etc/systemd/system/assetman-agent-vlan20.service
# ExecStart satırını düzenleyin: /usr/bin/node agent.js --config config.vlan20.json
```

---

## 6. Beklenen lokasyonları tanımla

Ajan cihazların **görüldüğü** yeri doldurur. Sapma uyarısı için cihazın **ait olduğu** yer de
tanımlı olmalı.

**Panel → Ayarlar → Lokasyon İzleme → "Mevcut lokasyonları başlangıç olarak al"**

Bu, her cihazın o anki lokasyonunu *beklenen* lokasyon olarak kaydeder. Tablo doluysa **atlar**,
mevcut kayıtları ezmez. Tek tek değiştirmek için: cihaza tıklayın → Lokasyon kutusu →
"Beklenen lokasyonu değiştir".

Eşik: **Ayarlar → Tespit Eşikleri → Lokasyon sapması (gün)**, varsayılan 7.
Bu süreden kısa sapmalar (toplantıya götürülen cihaz) uyarı üretmez.

---

## 7. Çalıştığını doğrula

| Kontrol | Nerede | Beklenen |
|---|---|---|
| Token doğrulaması | Ayarlar → Lokasyon İzleme | "açık" |
| Kapsam | Aynı kart | "0 cihazın beklenen lokasyonu tanımlı değil" (ideal) |
| Konum geçmişi | Cihaz modalı → Lokasyon | En az bir konaklama satırı, kaynak `location-agent` |
| Sapma tespiti | Uyarılar → Lokasyon Sapması | Cihaz gerçekten taşındıysa eşik sonrası listelenir |
| Denetim izi | Yaşam Döngüsü | Taşınmada "Lokasyon Değişikliği" olayı |

**Uçtan uca test:** SNMP'li bir cihazı (ör. yedek switch) A lokasyonundan B'ye taşıyın.
Sonraki keşif turunda konum geçmişine yeni konaklama düşer ve zincire olay mühürlenir.
Eşik dolunca Uyarılar'da belirir.

---

## Sorun giderme

| Belirti | Olası neden → çözüm |
|---|---|
| Ajan `401` / `Lokasyon bildirimi için X-Location-Token zorunludur` | `config.json` → `location_token` boş veya yanlış |
| Ajan `401` / `Geçersiz lokasyon token'ı` | Token merkezdeki `LOCATION_TOKENS` ile eşleşmiyor. Boşluk/tırnak hatasına bakın; `.env` sonrası `up -d` yapıldı mı? |
| Panelde lokasyon **yanlış ad** görünüyor | Normal — ad TOKEN'dan çözülür. `config.json`'daki `location_name` sadece yerel logdur. Merkezdeki eşlemeyi düzeltin |
| `0 aktif host bulundu` | `network.range` yanlış veya ICMP kapalı. `ping <switch-ip>` deneyin |
| Host bulunuyor ama hepsi "SNMP yanıtı yok" | Community yanlış veya cihazlarda SNMP kapalı. `snmpwalk -v2c -c <community> <ip> 1.3.6.1.2.1.1` ile test edin |
| Envanterde `device-192-168-...` jenerik kayıtlar | `only_snmp` `false` yapılmış → `true`'ya çevirin, oluşan jenerik kayıtları temizleyin |
| Cihaz görünüyor ama sapma uyarısı yok | (a) beklenen lokasyon tanımsız → tohumlayın, (b) eşik dolmamış → Ayarlar'dan süreyi görün |
| Servis sürekli yeniden başlıyor | `journalctl -u assetman-agent -n 50` — çoğunlukla `config.json` JSON hatası |

---

## Güvenlik notları

- `config.json` **token içerir** → `chmod 600`, ajan kullanıcısına ait olmalı. Git'e **koymayın**
  (`location-agent/config.json` gitignore'da).
- Token'lar lokasyona özeldir. Bir lokasyonun token'ı sızarsa **yalnız o lokasyonun adı**
  yazılabilir — diğer lokasyonlar etkilenmez. Sızma şüphesinde o token'ı `.env`'den silin,
  yenisini üretin, ajan config'ini güncelleyin.
- SNMP için **read-only** community kullanın; mümkünse SNMPv3 (auth/priv) tercih edin.
  *(Not: ajan bugün yalnız v2c destekler; merkezî `snmp-discovery` modülü v3 destekler.)*
- Ajan makinesi lokasyonun LAN'ında olduğu için ağ tarama yetkisine sahiptir — fiziksel ve
  yönetimsel erişimi kısıtlayın.
- Merkeze **içeri** hiçbir port açılmaz; ajan yalnız dışarı HTTPS bağlanır.

---

## Sonraki adımlar (henüz yapılmadı)

- **PC/dizüstü konum takibi**: ajan `only_snmp` nedeniyle istemcileri raporlamaz. Çözüm ya
  collector'ün lokasyon göndermesi ya da sunucuda MAC eşleştirmeli konum güncellemesi olur
  (webhook bugün yalnız `serial_number` ile eşleştirir).
- **SNMPv3 desteği** ajan tarafında.
- Ajanın kendi sağlık bildirimi (ajan durursa merkez fark etmez — bugün sessiz kalır).

İlgili belgeler: [DEPLOY.md](../DEPLOY.md) · [LDAP-KURULUM.md](LDAP-KURULUM.md)
