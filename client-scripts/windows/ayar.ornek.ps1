# ============================================================
#  AssetMan Collector ayarlari (SABLON)
#
#  Bu dosyayi ELLE DUZENLEMEYIN. "paketle.ps1" calistirdiginizda
#  gercek degerlerle dolu "ayar.ps1" otomatik uretilir ve dagitim
#  klasorune konur. Anahtar bu depoya (git) ASLA yazilmaz.
# ============================================================

# Sunucunun webhook adresi (collector telemetriyi buraya gonderir).
$WebhookUrl = "https://envanter.alperceviz.com/api/webhook"

# Paylasilan kayit anahtari (AGENT_SECRET). Cihaz ilk kez kayit
# olurken bununla imza atar; kayit sonrasi cihaz kendi ozel sirrini
# kullanir ve paylasilan anahtari artik kabul etmez.
$AgentKey = "BURAYA_AGENT_SECRET"
