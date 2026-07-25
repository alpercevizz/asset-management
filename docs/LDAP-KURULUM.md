# AssetMan — On-Prem LDAP / Active Directory Kurulum Runbook

Bu belge, **on-prem kurulmuş** AssetMan'i şirketin Active Directory'sine bağlar: kullanıcılar
kendi AD hesaplarıyla girer, **rolleri AD grup üyeliğinden** türetilir. ~30 dakika.

> On-prem'de AssetMan, AD ile **aynı LAN'da** olduğu için doğrudan bağlanır (VPN/Tailscale gerekmez).

---

## 0. Ön koşullar

| # | Gereksinim | Not |
|---|---|---|
| 1 | AssetMan on-prem kurulu ve çalışıyor | `AUTH_PROVIDER=local` ile ilk açılış yapılmış olabilir |
| 2 | AD/DC erişilebilir | AssetMan sunucusu → DC **389** (LDAP) veya **636** (LDAPS) |
| 3 | Domain bilgileri | Domain: `zenauraprint.local` · Base DN: `DC=zenauraprint,DC=local` |
| 4 | Bir **Domain Admin** (kurulum adımları için) | Servis hesabı + grup oluşturmak için |

---

## 1. AD tarafı — servis hesabı (Domain Controller'da, PowerShell)

AssetMan bu hesapla **bind edip kullanıcı arar** (yalnız okuma). Süresiz parola önerilir.

```powershell
Import-Module ActiveDirectory

# Servis (okuma) hesabı
New-ADUser -Name "svc-assetman" -SamAccountName "svc-assetman" `
  -UserPrincipalName "svc-assetman@zenauraprint.local" `
  -Path "OU=ServiceAccounts,DC=zenauraprint,DC=local" `      # kendi OU'nu yaz
  -AccountPassword (Read-Host -AsSecureString "Servis hesabi parolasi") `
  -Enabled $true -PasswordNeverExpires $true -CannotChangePassword $true
```
> Ekstra yetki gerekmez — AD'de kimliği doğrulanmış her hesap dizini okuyabilir. (Sıkı ortamlarda "Authenticated Users" okuma yetkisi yeterli.)

## 2. AD tarafı — rol grupları + üyelik

AssetMan rolleri: **admin · it · approver**. Her AD grubunu bir role eşleyeceğiz.

```powershell
# Rol grupları (istersen mevcut gruplarını kullan — Domain Admins, BT vb.)
New-ADGroup -Name "AssetMan-Admins"    -GroupScope Global -Path "OU=Groups,DC=zenauraprint,DC=local"
New-ADGroup -Name "AssetMan-IT"        -GroupScope Global -Path "OU=Groups,DC=zenauraprint,DC=local"
New-ADGroup -Name "AssetMan-Approvers" -GroupScope Global -Path "OU=Groups,DC=zenauraprint,DC=local"

# Kullanıcıları ekle (DOĞRUDAN üyelik — iç içe/nested grup DEĞİL)
Add-ADGroupMember -Identity "AssetMan-Admins"    -Members "bt.muduru"
Add-ADGroupMember -Identity "AssetMan-IT"         -Members "destek1","destek2"
Add-ADGroupMember -Identity "AssetMan-Approvers"  -Members "ik.sorumlusu","departman.md"
```

**Rol öncelik sırası:** bir kullanıcı birden çok gruptaysa en yetkili kazanır → **admin > approver > it**.

## 3. (LDAPS istiyorsan) iç CA kök sertifikasını dışa aktar

Şifreli LDAPS + iç AD CS için, iç CA kökünü AssetMan'e tanıtacağız. Domain'e üye bir makinede:

```powershell
# İç CA sertifikasını DER olarak al, sonra PEM'e çevir
certutil -ca.cert C:\assetman\internal-ca.der
certutil -encode  C:\assetman\internal-ca.der C:\assetman\internal-ca.pem
```
Çok kademeli PKI (root + intermediate) varsa **tam zinciri** al — DC'nin 636'da sunduğu zinciri gör:
```bash
openssl s_client -connect dc.zenauraprint.local:636 -showcerts </dev/null 2>/dev/null > chain.txt
# chain.txt'teki CA sertifika(ları)nı internal-ca.pem'e koy
```
`internal-ca.pem`'i AssetMan sunucusunda **data volume'una** kopyala (ör. `data/internal-ca.pem` → container'da `/app/data/internal-ca.pem`).

> **LDAP (389) kullanacaksan bu adımı ATLA** — sertifika gerekmez.

## 4. AssetMan `.env` — LDAP bloğu

Modu **`LDAP_URL` şeması** belirler. Üç senaryodan birini seç:

**Senaryo A — LDAP (389, şifresiz — yalnız güvenilir iç LAN)**
```ini
AUTH_PROVIDER=ldap
LDAP_URL=ldap://dc.zenauraprint.local:389
LDAP_BIND_DN=CN=svc-assetman,OU=ServiceAccounts,DC=zenauraprint,DC=local
LDAP_BIND_PASSWORD=servis-hesabi-parolasi
LDAP_BASE_DN=DC=zenauraprint,DC=local
LDAP_USER_ATTR=sAMAccountName
LDAP_USER_FILTER=(&(objectCategory=person)(objectClass=user)({attr}={u}))
LDAP_GROUP_ROLE_MAP={"AssetMan-Admins":"admin","AssetMan-IT":"it","AssetMan-Approvers":"approver"}
LDAP_DEFAULT_ROLE=it
LDAP_MFA_GROUP=
```

**Senaryo B — LDAPS (636) + iç CA (önerilen on-prem)**
```ini
# A'daki her şey + şunlar:
LDAP_URL=ldaps://dc.zenauraprint.local:636
LDAP_TLS_CA=/app/data/internal-ca.pem
```

**Senaryo C — LDAPS (636) + public CA** (DC 636'da public wildcard sunuyorsa)
```ini
LDAP_URL=ldaps://dc.zenauraprint.com:636     # cert hostname'iyle eşleşen ad (IP değil!)
# TLS ayarı gerekmez — Node otomatik güvenir
```

Kaydet, sunucuyu **yeniden oluştur** (restart değil):
```bash
docker compose --profile postgres up -d
```

## 5. Doğrulama

**a) Bind + arama testi** (AssetMan sunucusunda):
```bash
docker compose exec app node -e "process.env.AUTH_PROVIDER='ldap'; require('./auth/ldap').authenticate('KULLANICI_ADI','PAROLA').then(p=>console.log(p||'BAŞARISIZ')).catch(e=>console.error('HATA:',e.message))"
```
Başarılıysa kullanıcının `{username, display, role, groups, upn}` bilgisi döner.

**b) Panelden giriş**: bir AD kullanıcısıyla `https://envanter...` → ilk girişte otomatik `users` tablosuna senkronlanır; rolü gruptan gelir. Her audit kaydı artık **gerçek AD kimliğiyle** (UPN) mühürlenir.

---

## Sorun giderme

| Belirti | Olası neden → çözüm |
|---|---|
| `BAŞARISIZ` (null) döner, hata yok | Parola yanlış **veya** kullanıcı `LDAP_BASE_DN` altında bulunamadı. Base DN'i kontrol et |
| `servis-bind hatası` / `invalid credentials` | `LDAP_BIND_DN` veya `LDAP_BIND_PASSWORD` yanlış. DN'i `CN=...,OU=...,DC=...` tam yaz |
| `connect ECONNREFUSED` / `timeout` | AssetMan → DC 389/636 erişimi yok (iç firewall?) veya `LDAP_URL` hostu yanlış |
| LDAPS'te `self signed certificate` / `unable to verify` | İç CA tanıtılmamış → `LDAP_TLS_CA` doğru PEM'i göstersin (tam zincir). Test için geçici `LDAP_TLS_REJECT_UNAUTHORIZED=false` |
| LDAPS'te `hostname/IP does not match` | `LDAP_URL` cert'in hostname'iyle eşleşmiyor (IP kullanma) → hostname kullan veya `LDAP_TLS_SERVERNAME` |
| Düz LDAP (389) `strong auth required` / bind red | DC "LDAP signing zorunlu" → **LDAPS'e geç** (Senaryo B/C) |
| Kullanıcı giriyor ama rolü `it` (varsayılan) | `memberOf` map'teki grup CN'iyle eşleşmiyor. Kullanıcı **doğrudan** rol grubunda mı? (nested değil) `LDAP_GROUP_ROLE_MAP` CN'leri birebir mi? |

---

## Güvenlik notları

- **LDAPS öner** — 389 parolaları açık metin taşır; güvenlik konumlandıran ürün için LDAPS doğru tercih.
- Servis hesabına **yalnız okuma** yetkisi ver, güçlü+süresiz parola.
- LDAP hesaplarının yerel `password` kolonu doğrulanamaz rastgele hash'le doldurulur → `local`'a dönülse bile bu hesaplara bilinen parolayla girilemez.
- MFA'yı grup üyeliğiyle modellemek istersen (`LDAP_MFA_GROUP`), Entra/Duo'dan senkronlanan bir güvenlik grubu kullan.

Ayrıntılı `.env` referansı için ana [DEPLOY.md §4b](../DEPLOY.md).
