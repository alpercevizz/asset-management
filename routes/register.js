/* ═══ QR / CİHAZ KAYDI ROUTER ════════════════════════════════════════════════
   QR üretimi, tek kullanımlık kayıt jetonları ve toplu depo kaydı.
   Projenin en güvenlik-hassas bloğu: jetonlar imzalı ve tek kullanımlık,
   toplu onayda plan veritabanında DONDURULUR (istekten okunmaz).

   BURASI TAŞINDI, YENİDEN YAZILMADI: gövdeler server.js'teki hâliyle birebir
   aynı. Yalnızca yol önekleri router'a göre kısaldı ('/api/register/token'
   -> '/register/token'). Router '/api' altına bağlanır, bu yüzden PUBLIC_API
   listesi ve oturum ara katmanı aynen çalışır.

   Bağımlılıklar fabrika ile enjekte edilir (bkz. routes/lines.js). */

const express = require('express');
const QRCode = require('qrcode');
/* Jeton modülleri dosya başında bir kez: gövde içinde 10 ayrı require vardı.
   Node bunları önbelleğe alıyor, yani maliyet değil OKUNABİRLİK sorunuydu. */
const regToken = require('../agent/tools/register-token');
const bulkToken = require('../agent/tools/bulk-token');
const locationTools = require('../agent/tools/location-tools');

module.exports = function kayitRouter({
  rota, requireRole, currentUser,
  getAllAssets, createAsset, updateAsset, getAssetBySerial,
  lifecycleModule, bulkPlan,
}) {
  const r = express.Router();


  // QR kod üret (lokal, dışarı istek yok) — SVG döner
  r.get('/qr', rota('QR üretim hatası', async (req, res) => {
    const data = req.query.data;
    if (!data) return res.status(400).json({ error: 'data parametresi zorunlu' });
    const svg = await QRCode.toString(String(data), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#1e293b', light: '#ffffff' },
    });
    res.type('image/svg+xml').send(svg);
  }));

  /* Lokasyon konaklama kaydı — TÜM kaynaklar için ortak.
     Kaynak (webhook/qr/snmp) kaydın güven seviyesini taşır; yer değiştiyse denetim
     zincirine de mühürlenir. Bu adım atlanırsa o cihazda süre eşiği çalışmaz
     (geçmiş yoksa "ne kadar süredir orada" bilinemez). */
  async function trackLocation(assetId, asset, location, source) {
    if (!assetId || !location) return null;
    try {
      const seen = await locationTools.recordSeen(assetId, {
        location, source,
        serial_number: asset.serial_number || null,
        hostname: asset.hostname || null,
      });
      if (!seen.changed) return null;
      console.warn(`[LOKASYON] ${asset.hostname || assetId}: "${seen.from}" → "${seen.to}" (${source})`);
      try {
        await lifecycleModule.recordEvent({
          asset_id: assetId, hostname: asset.hostname || null,
          serial_number: asset.serial_number || null,
          to_status: 'Lokasyon Değişikliği',
          note: `Otomatik tespit: "${seen.from}" → "${seen.to}" (kaynak: ${source})`,
          actor: `sistem/${source}`, approval_status: 'n/a',
        });
      } catch (e) { console.warn('[LOKASYON] olay kaydedilemedi:', e.message); }
      return seen;
    } catch (e) {
      console.warn('[LOKASYON] konaklama kaydı hatası:', e.message);
      return null;
    }
  }

  // Mobil formdan gelen cihaz kaydı (telefon, tablet, el terminali vb.)
  r.post('/register', rota('Cihaz kaydı hatası', async (req, res) => {
    /* QR JETONU ZORUNLU. Bu uc telefondan cagriliyor, oturum yok — jeton
       oturumun yerini tutuyor: imzali (uydurulamaz), sureli ve kullanim
       hakki sinirli. Panelden uretilmemis bir QR ile kayit yapilamaz. */
    const jeton = await regToken.verifyAndConsume(
      req.get('X-Register-Token') || (req.body && req.body.reg_token));
    if (!jeton.ok) {
      console.warn(`[REGISTER REDDEDİLDİ] ${jeton.code} — ${jeton.reason} ` +
        `ip=${(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()}`);
      return res.status(401).json({ error: jeton.reason, code: jeton.code });
    }

    const p = req.body || {};
    const hostname = (p.hostname || '').trim();
    if (!hostname && !p.serial_number) {
      return res.status(400).json({ error: 'Cihaz adı (hostname) veya seri no zorunludur' });
    }

    const enriched = {
      hostname,
      serial_number: (p.serial_number || hostname).trim(),
      category:    p.category    || 'Diğer',
      brand:       p.brand       || '',
      model:       p.model       || '',
      os:          p.os          || '',
      username:    p.username    || '',
      location:    p.location    || '',
      ip_address:  p.ip_address  || '',
      last_seen:   new Date().toISOString(),
      status:      'online',
      collector_ver: 'qr-1.0.0',
    };
    // Boş alanları gönderme
    Object.keys(enriched).forEach(k => { if (enriched[k] === '') delete enriched[k]; });

    let existing = null;
    if (enriched.serial_number) {
      existing = await getAssetBySerial({ serialNumber: enriched.serial_number });
    }

    let result, action;
    if (existing) {
      result = await updateAsset(existing.id, enriched);
      action = 'updated';
    } else {
      result = await createAsset(enriched);
      action = 'created';
    }
    console.log(`[REGISTER] ${action}: ${hostname} (${enriched.category})`);
    // QR kaydında lokasyon formdan BEYAN edilir → kaynak 'qr' olarak izlenir (token'lı
    // ajan kadar güvenilir değil ama geçmiş tutulmazsa süre eşiği hiç çalışmaz).
    await trackLocation(result.id, enriched, enriched.location, 'qr');
    // Panel bu jetonu yokluyor: hangi cihazin bagland~igini buradan ogreniyor
    await regToken.recordAsset(jeton.jti, result.id);
    res.json({ success: true, action, id: result.id, kalan_hak: jeton.kalan });
  }));

  /* ─── QR kayıt jetonları (it/admin) ────────────────────────────────────────*/
  r.post('/register/token', requireRole('it', 'admin'), async (req, res) => {
    try {
      const me = currentUser(req);
        await regToken.pruneExpired();
      const t = await regToken.create({
        hours: req.body && req.body.hours,
        uses: req.body && req.body.uses,
        by: me ? me.username : 'system',
      });
      console.log(`[REGISTER] QR jetonu üretildi: ${t.jti} (${t.max_uses} kullanım, ${t.hours}s) — ${me?.username}`);
      res.json(t);
    } catch (err) {
      res.status(500).json({ error: 'Jeton üretilemedi', detail: err.message });
    }
  });

  /* Tek jetonun durumu — panel QR'i gosterirken 3 saniyede bir yokluyor.
     Cihaz kaydolunca last_asset_id doluyor ve panel otomatik ilerliyor. */
  r.get('/register/tokens/:jti', requireRole('it', 'admin'), async (req, res) => {
    try {
        const d = await regToken.status(req.params.jti);
      if (!d) return res.status(404).json({ error: 'Jeton bulunamadı' });
      let asset = null;
      if (d.last_asset_id != null) {
        const inv = await getAllAssets({ size: 200 });
        asset = (inv.results || []).find(a => String(a.id) === String(d.last_asset_id)) || null;
      }
      res.json({ ...d, asset });
    } catch (err) {
      res.status(500).json({ error: 'Jeton durumu alınamadı', detail: err.message });
    }
  });

  r.get('/register/tokens', requireRole('it', 'admin'), async (req, res) => {
    try {
      res.json({ results: await regToken.list() });
    } catch (err) {
      res.status(500).json({ error: 'Jetonlar alınamadı', detail: err.message });
    }
  });

  r.delete('/register/tokens/:jti', requireRole('it', 'admin'), async (req, res) => {
    try {
      const n = await regToken.revoke(req.params.jti);
      console.warn(`[REGISTER] QR jetonu iptal edildi: ${req.params.jti} — ${currentUser(req)?.username}`);
      res.json({ success: true, revoked: n });
    } catch (err) {
      res.status(500).json({ error: 'İptal edilemedi', detail: err.message });
    }
  });

  // Toplu placeholder kayıt: depodaki kimliği belirsiz cihazlar için
  // IT adet + kategori girer, sistem otomatik ID'li 'depoda' taslakları oluşturur.
  /* Toplu kayıt planı — ÖNEK ve NUMARA ARALIĞI burada hesaplanır.
     Hem önizleme ucu hem oluşturma ucu BU fonksiyonu kullanır: iki yerde ayrı
     hesaplanırsa önizleme kullanıcıya yanlış ID aralığı gösterir. Numaralandırma
     mevcut kayıtlardan DEVAM eder, bu yüzden aralık her zaman 001'den başlamaz. */
  // bulkPlan fabrikadan enjekte edilir (agent/tools/bulk-plan.js).

  /* Önizleme: panelin sağdaki "Oluşturulacak Kayıtlar" kutusu bununla dolar.
     Oluşturma ile AYNI hesabı kullandığı için gösterilen aralık gerçektir. */
  r.get('/register/bulk/preview', requireRole('it', 'admin'), async (req, res) => {
    try {
      res.json(await bulkPlan({
        category: req.query.category, prefix: req.query.prefix, quantity: req.query.quantity,
      }));
    } catch (err) {
      res.status(500).json({ error: 'Önizleme hesaplanamadı', detail: err.message });
    }
  });

  /* Taslak kayıtları OLUŞTUR. Hem panel düğmesi hem telefon onayı bu fonksiyonu
     çağırır — iki yol ayrı kod olsaydı biri düzeltilip diğeri unutulurdu. */
  async function bulkOlustur({ category = 'Diğer', location = '', quantity, prefix, kaynak = 'panel' }) {
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1 || qty > 200) throw new Error('quantity 1-200 arası olmalı');

    const plan = await bulkPlan({ category, prefix, quantity: qty });
    const now = new Date().toISOString();
    const created = [];
    for (let i = 1; i <= qty; i++) {
      const hostname = `${plan.prefix}-${String(plan.maxNum + i).padStart(3, '0')}`;
      const row = {
        hostname,
        serial_number: hostname,   // bilinmiyor → geçici olarak hostname
        category,
        status: 'depoda',
        last_seen: now,
        collector_ver: 'manual-bulk-1.0.0',
      };
      if (location) row.location = location;
      const r = await createAsset(row);
      created.push({ id: r.id, hostname });
    }
    console.log(`[BULK] ${qty} adet '${category}' taslak oluşturuldu (${plan.prefix}-...) kaynak=${kaynak}`);
    return { count: created.length, prefix: plan.prefix, items: created };
  }

  r.post('/register/bulk', async (req, res) => {
    try {
      const { category = 'Diğer', location = '', quantity, prefix } = req.body || {};
      const r = await bulkOlustur({ category, location, quantity, prefix, kaynak: 'panel' });
      res.json({ success: true, ...r });
    } catch (err) {
      console.error('[POST /api/register/bulk]', err.message);
      res.status(err.message.includes('quantity') ? 400 : 500)
        .json({ error: 'Toplu kayıt hatası', detail: err.message });
    }
  });

  /* ─── TV/kiosk: telefonla onay akışı ───────────────────────────────────────
     Ekranda klavye yok. Operatör planı kurar, QR'ı telefonuyla okutup onaylar.
     Plan JETONA DONDURULUR; onay isteği kategori/adet göndermez. */
  r.post('/register/bulk/token', requireRole('it', 'admin'), async (req, res) => {
    try {
      const bt = bulkToken;
      await bt.pruneExpired();
      const me = currentUser(req);
      const b = req.body || {};
      const t = await bt.create({
        category: b.category, quantity: b.quantity, location: b.location,
        prefix: b.prefix, minutes: b.minutes, by: me ? me.username : 'system',
      });
      const plan = await bulkPlan({ category: b.category, prefix: b.prefix, quantity: b.quantity });
      console.log(`[BULK] Onay kodu üretildi: ${t.jti} (${b.quantity}×${b.category}) — ${me?.username}`);
      res.json({ ...t, plan });
    } catch (err) {
      res.status(400).json({ error: 'Onay kodu üretilemedi', detail: err.message });
    }
  });

  r.get('/register/bulk/token/:jti', requireRole('it', 'admin'), async (req, res) => {
    try {
      const d = await bulkToken.status(req.params.jti);
      if (!d) return res.status(404).json({ error: 'Onay kodu bulunamadı' });
      res.json(d);
    } catch (err) {
      res.status(500).json({ error: 'Durum alınamadı', detail: err.message });
    }
  });

  r.delete('/register/bulk/token/:jti', requireRole('it', 'admin'), async (req, res) => {
    try {
      await bulkToken.revoke(req.params.jti);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'İptal edilemedi', detail: err.message });
    }
  });

  /* Telefonun okuduğu plan — PUBLIC ama jeton zorunlu. Yalnız okur, tüketmez:
     kullanıcı onaylamadan kayıt oluşmamalı. */
  r.get('/register/bulk/confirm', async (req, res) => {
    try {
      const p = await bulkToken.peek(req.query.t);
      if (!p.ok) return res.status(401).json({ error: p.reason, code: p.code });
      const plan = await bulkPlan({
        category: p.satir.category, prefix: p.satir.prefix, quantity: p.satir.quantity,
      });
      res.json({
        category: p.satir.category, quantity: p.satir.quantity,
        location: p.satir.location || '', expires_at: p.satir.expires_at, plan,
      });
    } catch (err) {
      res.status(500).json({ error: 'Plan alınamadı', detail: err.message });
    }
  });

  /* ONAY — kayıtları oluşturur. PUBLIC ama jeton zorunlu ve TEK KULLANIMLIK.
     Gövdeden kategori/adet OKUNMAZ: ne oluşacağı jetondaki dondurulmuş plandan
     gelir, telefon değiştiremez. */
  r.post('/register/bulk/confirm', rota('Onay işlenemedi', async (req, res) => {
    const bt = bulkToken;
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const c = await bt.consume((req.body && req.body.t) || req.query.t, ip);
    if (!c.ok) {
      console.warn(`[BULK ONAY REDDEDİLDİ] ${c.code} — ${c.reason} ip=${ip}`);
      return res.status(401).json({ error: c.reason, code: c.code });
    }
    const r = await bulkOlustur({
      category: c.plan.category, location: c.plan.location,
      quantity: c.plan.quantity, prefix: c.plan.prefix, kaynak: 'telefon-onay',
    });
    await bt.sonucYaz(c.jti, {
      count: r.count,
      first: r.items[0] && r.items[0].hostname,
      last: r.items[r.items.length - 1] && r.items[r.items.length - 1].hostname,
    });
    res.json({ success: true, ...r });
  }));

  return r;
};
