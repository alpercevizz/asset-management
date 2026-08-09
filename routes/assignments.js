/* ═══ RESMİ ZİMMET ROUTER ════════════════════════════════════════════════════
   Zimmet, telemetriden AYRI ve KİLİTLİ tutulur: webhook'tan gelen "username"
   cihazı o an kimin kullandığını söyler, resmi zimmet ise kimin SORUMLU
   olduğunu. İkisini aynı alanda tutmak, cihazı ödünç alan birinin sorumluyu
   sessizce değiştirmesi demekti.

   Devir koruması: cihaz zaten başkasına zimmetliyse force olmadan 409 döner —
   sessiz devralma engellenir, kullanıcıya onay sorulur.

   Gövdeler server.js'ten aynen taşındı; yalnız yol önekleri kısaldı.
   Router '/api' altına bağlanır. */

const express = require('express');
const assignmentTools = require('../agent/tools/assignment-tools');

module.exports = function zimmetRouter({ requireRole, currentUser, getAllAssets }) {
  const r = express.Router();


  // Bir cihazın resmi zimmeti (kilitli owner) + telemetri (Baserow username) birlikte
  r.get('/assets/:id/assignment', async (req, res) => {
    try {
      res.json({ assignment: await assignmentTools.getAssignment(req.params.id) || null });
    } catch (err) {
      res.status(500).json({ error: 'Zimmet sorgulanamadı', detail: err.message });
    }
  });

  // Resmi devir — zaten başkasına zimmetliyse force olmadan 409 (sessiz devralma engellenir)
  r.post('/assets/:id/assign', requireRole('it', 'admin'), async (req, res) => {
    try {
      const by = currentUser(req)?.username || 'system';
      const { to, hostname, note, force } = req.body || {};
      const a = await assignmentTools.assign(req.params.id, { to, hostname, note, force: !!force, by });
      res.json({ success: true, assignment: a });
    } catch (err) {
      if (err.code === 'ALREADY_ASSIGNED') {
        return res.status(409).json({ error: err.message, code: 'ALREADY_ASSIGNED', current: err.current });
      }
      console.error('[POST /api/assets/:id/assign]', err.message);
      res.status(400).json({ error: 'Zimmet atanamadı', detail: err.message });
    }
  });

  r.post('/assets/:id/release', requireRole('it', 'admin'), async (req, res) => {
    try {
      const by = currentUser(req)?.username || 'system';
      const a = await assignmentTools.release(req.params.id, { by, note: (req.body || {}).note });
      res.json({ success: true, assignment: a });
    } catch (err) {
      res.status(400).json({ error: 'İade edilemedi', detail: err.message });
    }
  });

  // Tüm resmi zimmetler — Varlıklar tablosundaki "Sorumlu Kişi" sütunu için.
  // Cihaz başına istek atmak N+1 olurdu; tek sorguda döner.
  r.get('/assignments', async (req, res) => {
    try {
      const rows = await assignmentTools.getAll();
      const map = {};
      // callback parametresi 'satir': router değişkeni de 'r', gölgelenmesin
      rows.forEach(satir => { if (satir.assigned_to) map[satir.asset_id] = satir.assigned_to; });
      res.json({ assignments: map });
    } catch (err) {
      res.status(500).json({ error: 'Zimmetler alınamadı', detail: err.message });
    }
  });

  // Telemetri ≠ resmi zimmet uyuşmazlıkları (izinsiz kullanım şüphesi)
  r.get('/assignments/mismatches', async (req, res) => {
    try {
      const data = await getAllAssets({ size: 200 });
      res.json({ mismatches: await assignmentTools.listMismatches(data.results || []) });
    } catch (err) {
      res.status(500).json({ error: 'Uyuşmazlık taranamadı', detail: err.message });
    }
  });

  return r;
};
