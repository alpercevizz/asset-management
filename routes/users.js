/* ═══ KULLANICI YÖNETİMİ ROUTER (admin) ══════════════════════════════════════
   Yerel hesapların CRUD'u. Son-admin ve kendi-hesabını-silme korumaları
   users modülünde ve burada uygulanır.

   LDAP modunda hesaplar dizinden senkronlanır — buradaki rol değişikliği, o
   kullanıcının bir sonraki AD girişinde grup üyeliğine göre yeniden yazılır.
   Bu yüzden yanıtta UYARI dönülür: sessizce geri alınan bir değişiklik,
   yöneticinin yetki verdiğini sanmasına yol açardı.

   Bağımlılıklar fabrika ile enjekte edilir (bkz. routes/lines.js). */

const express = require('express');
const usersModule = require('../auth/users');

module.exports = function kullaniciRouter({ requireRole, currentUser }) {
  const r = express.Router();
  const admin = requireRole('admin');

  /* Yazma uçları 400 döner: gövde/kural ihlali istemcinin hatasıdır.
     Aktör adı günlüğe yazılır — kim kimi değiştirdi, denetim izi. */
  const yazma = (mesaj, isleyici) => async (req, res) => {
    try {
      await isleyici(req, res, currentUser(req));
    } catch (err) {
      console.error(`[${req.method} ${req.baseUrl}${req.path}]`, err.message);
      if (res.headersSent) return;
      res.status(400).json({ error: mesaj, detail: err.message });
    }
  };

  const ldapUyarisi = (kosul, metin) => (usersModule.AUTH_PROVIDER() === 'ldap' && kosul ? metin : undefined);

  r.get('/', admin, (req, res) => {
    try {
      res.json({
        provider: usersModule.AUTH_PROVIDER(),
        roles: usersModule.ROLES,
        users: usersModule.listUsers(),
      });
    } catch (err) {
      res.status(500).json({ error: 'Kullanıcılar alınamadı', detail: err.message });
    }
  });

  r.post('/', admin, yazma('Kullanıcı oluşturulamadı', async (req, res, ben) => {
    const u = await usersModule.createUser(req.body || {});
    console.log(`[users] Oluşturuldu: ${u.username} (${u.role}) — ${ben?.username}`);
    res.json({
      success: true,
      user: u,
      warning: ldapUyarisi(true, 'LDAP modundasınız: bu yerel hesap AD dışıdır, dizinden gelmez.'),
    });
  }));

  r.put('/:username', admin, yazma('Kullanıcı güncellenemedi', async (req, res, ben) => {
    const u = await usersModule.updateUser(req.params.username, req.body || {});
    console.log(`[users] Güncellendi: ${u.username} (${u.role}) — ${ben?.username}`);
    res.json({
      success: true,
      user: u,
      warning: ldapUyarisi(req.body && req.body.role,
        'LDAP modunda rol, kullanıcının bir sonraki girişinde AD grubuna göre yeniden yazılır.'),
    });
  }));

  r.delete('/:username', admin, yazma('Kullanıcı silinemedi', async (req, res, ben) => {
    /* Kendi hesabını silme koruması: yöneticinin kendini kilitlemesi geri
       alınamaz. Son-admin koruması users modülünde. */
    if (ben && String(ben.username).toLowerCase() === String(req.params.username).toLowerCase()) {
      return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz', code: 'SELF_DELETE' });
    }
    const sonuc = await usersModule.deleteUser(req.params.username);
    console.log(`[users] Silindi: ${sonuc.deleted} — ${ben?.username}`);
    res.json({ success: true, ...sonuc });
  }));

  return r;
};
