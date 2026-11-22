/* AssetMan · admin.js
   Toplama ajanlari, cihaz gorselleri, lokasyon koordinatlari, Lokasyonlar/Kullanicilar gorunumu, CSV disa aktarim

   NOT: Bu dosya app.js'ten bolundu. ES modul DEGIL - index.html'de
   sirayla yuklenen duz scriptler; global kapsam paylasiliyor.
   Yukleme sirasi index.html'deki <script> siralamasidir. */

/* ═══ Toplama Ajanları (Ayarlar · admin) ══════════════════════════════════
   Cihaz sırları BURADA GÖSTERİLMEZ — sunucu zaten listede döndürmüyor.
   Ekranın asıl işi: hangi cihaz kayıtlı, en son ne zaman rapor verdi ve
   yeniden kurulan bir makinenin kaydını sıfırlayabilmek. */
async function loadAgents() {
  const body = $(`#agentBody`);
  const mod = $(`#agentMode`);
  if (!body) return;
  try {
    const r = await fetch('/api/agents');
    if (r.status === 403) { body.innerHTML = '<tr><td colspan="6" class="loading-cell">Bu bölüm yalnız yöneticilere açık.</td></tr>'; return; }
    const j = await r.json();

    if (mod) {
      const zorunlu = j.mode === 'required';
      mod.innerHTML = zorunlu
        ? '<span style="color:var(--green)">Kimlik doğrulama: zorunlu</span>'
        : `<span style="color:var(--red)">Kimlik doğrulama: ${escapeHtml(j.mode)} — imzasız istek kabul ediliyor</span>`;
    }

    const rows = j.results || [];
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="loading-cell">
        Henüz kayıtlı ajan yok. Kurulum: <code>docs/COLLECTOR-KURULUM.md</code></td></tr>`;
      return;
    }
    body.innerHTML = rows.map((a) => {
      // 24 saatten uzun süredir rapor gelmiyorsa dikkat çek — ajan durmuş olabilir
      const t = Date.parse(a.last_seen_at);
      const bayat = !Number.isNaN(t) && (Date.now() - t) > 24 * 3600 * 1000;
      /* Klon supheli kayit ACIKCA isaretlenir: iki makine ayni kimligi
         paylasiyorsa envanterde tek cihaz gorunurler — sessiz kalmasi
         yanlis envanter demek. */
      const klon = a.clone_suspect
        ? `<div style="color:var(--red);font-size:11px;margin-top:3px;line-height:1.45">⚠ ${escapeHtml(a.clone_note || 'Klon şüphesi')}</div>` : '';
      return `<tr>
        <td class="hostname-cell"><span class="serial-cell">${escapeHtml(a.device_id)}</span>
          ${a.serial_number ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">seri: ${escapeHtml(a.serial_number)}</div>` : ''}
          ${klon}</td>
        <td>${a.asset_id ? '#' + a.asset_id : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${a.agent_version ? escapeHtml(a.agent_version) : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${fmtDate(a.enrolled_at)}</td>
        <td${bayat ? ' style="color:var(--red)"' : ''}>${a.last_seen_at ? gecenSure(a.last_seen_at) : '—'}${bayat ? ' ⚠' : ''}</td>
        <td style="text-align:right"><button class="btn-pdf" data-agentdel="${escapeHtml(a.device_id)}" style="color:var(--red)">Kaydı sıfırla</button></td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-agentdel]').forEach((b) =>
      b.addEventListener('click', () => agentRevoke(b.dataset.agentdel)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function agentRevoke(deviceId) {
  if (!confirm(`"${deviceId}" cihazının kaydı silinsin mi?

` +
    'Cihaz bir sonraki bağlantısında paylaşılan anahtarla YENİDEN kaydolur. ' +
    'Yalnızca yeniden kurulan makineler için kullanın — kayıt silinmiş bir cihazı ' +
    'ele geçiren biri onun adına rapor gönderebilir.')) return;
  try {
    const r = await fetch('/api/agents/' + encodeURIComponent(deviceId), { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || 'silinemedi');
    loadAgents();
  } catch (err) { toast('Silinemedi: ' + err.message, 'hata'); }
}

/* ═══ Cihaz model görselleri (Ayarlar) ════════════════════════════════════
   Görsel MODELE bağlanır. Dosya tarayıcıda base64'e çevrilip JSON ile gönderilir
   (multipart bağımlılığı eklemeye gerek kalmadı); sunucu tür ve boyut doğrular.
   SVG kabul EDİLMEZ — panelde gösterilecek, içinde script taşıyabilir. */
let _imgHedef = null;   // { brand, model, category } | { category } (kategori geneli)

async function loadImageTable() {
  const body = $(`#imgBody`);
  if (!body) return;
  try {
    const r = await fetch('/api/device-images');
    if (r.status === 403) { body.innerHTML = '<tr><td colspan="6" class="loading-cell">Yetki yok.</td></tr>'; return; }
    const j = await r.json();
    const modeller = j.models || [];
    if (!modeller.length) { body.innerHTML = '<tr><td colspan="6" class="loading-cell">Envanterde model yok</td></tr>'; return; }
    const rozet = { model: 'tam model', marka: 'marka+kategori', kategori: 'kategori geneli' };
    body.innerHTML = modeller.map((m, i) => `
      <tr>
        <td>${m.image
          ? `<img src="${m.image.url}" alt="" style="width:44px;height:44px;object-fit:contain;border-radius:8px;background:var(--bg-card2)">`
          : '<span style="color:var(--text-muted);font-size:11.5px">yok</span>'}</td>
        <td class="hostname-cell">${escapeHtml((m.brand + ' ' + m.model).trim() || '(marka/model boş)')}</td>
        <td>${categoryBadge(m.category)}</td>
        <td>${m.count}</td>
        <td>${m.image
          ? `<span class="badge badge--online">${rozet[m.image.match] || m.image.match}</span>`
          : '<span class="badge badge--unknown">çizim</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-pdf" data-img="${i}">${m.image && m.image.match === 'model' ? 'Değiştir' : 'Görsel yükle'}</button>
          ${m.image && m.image.match === 'model' ? `<button class="btn-pdf" data-imgdel="${m.image.id}" style="color:var(--red)">Sil</button>` : ''}
        </td>
      </tr>`).join('');
    body.querySelectorAll('[data-img]').forEach(b => b.addEventListener('click', () => {
      const m = modeller[Number(b.dataset.img)];
      _imgHedef = { brand: m.brand, model: m.model, category: m.category };
      $(`#imgFile`)?.click();
    }));
    body.querySelectorAll('[data-imgdel]').forEach(b =>
      b.addEventListener('click', () => imageDelete(b.dataset.imgdel)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function imageCategoryPrompt() {
  const kat = prompt('Hangi kategori için genel görsel? (Bilgisayar, Sunucu, Telefon, Tablet, El Terminali, Yazıcı, Ağ Aygıtı, Çevre Aygıtı)');
  if (!kat || !kat.trim()) return;
  _imgHedef = { brand: '', model: '', category: kat.trim() };
  $(`#imgFile`)?.click();
}

async function imageUpload(file) {
  const msg = $(`#imgMsg`);
  if (!_imgHedef || !file) return;
  if (file.size > 2 * 1024 * 1024) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = `Görsel çok büyük (${Math.round(file.size / 1024)} KB, en fazla 2 MB).`; }
    return;
  }
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('Dosya okunamadı'));
    fr.readAsDataURL(file);
  });
  try {
    const r = await fetch('/api/device-images', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ..._imgHedef, dataUrl }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error);
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '✓ Görsel yüklendi'; setTimeout(() => msg.textContent = '', 3000); }
    loadImageTable();
    loadAgents();
  } catch (err) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; }
  } finally { _imgHedef = null; }
}

async function imageDelete(id) {
  if (!confirm('Bu model görseli silinsin mi? Cihazlar yerleşik kategori çizimine döner.')) return;
  try {
    const r = await fetch('/api/device-images/' + id, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || 'silinemedi');
    loadImageTable();
    loadAgents();
  } catch (err) { toast('Silinemedi: ' + err.message, 'hata'); }
}

/* ═══ Lokasyon koordinatları (Ayarlar) ════════════════════════════════════ */
async function loadGeoTable() {
  const body = $(`#geoBody`);
  if (!body) return;
  try {
    const r = await fetch('/api/locations/geo');
    if (r.status === 403) { body.innerHTML = '<tr><td colspan="5" class="loading-cell">Yetki yok.</td></tr>'; return; }
    const j = await r.json();
    const geo = j.geo || {};
    const adlar = (j.locations || []).slice().sort((a, b) => a.localeCompare(b, 'tr'));
    if (!adlar.length) { body.innerHTML = '<tr><td colspan="5" class="loading-cell">Envanterde lokasyon yok</td></tr>'; return; }
    body.innerHTML = adlar.map(ad => {
      const g = geo[ad];
      return `<tr>
        <td class="hostname-cell">${escapeHtml(ad)}</td>
        <td>${g ? g.lat.toFixed(3) : '<span style="color:var(--orange)">tanımsız</span>'}</td>
        <td>${g ? g.lon.toFixed(3) : '<span style="color:var(--orange)">tanımsız</span>'}</td>
        <td style="color:var(--text-muted)">${g ? (g.source === 'seed' ? 'otomatik' : 'elle') : '—'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-pdf" data-geo="${escapeHtml(ad)}">${g ? 'Düzenle' : 'Koordinat gir'}</button>
          ${g ? `<button class="btn-pdf" data-geodel="${escapeHtml(ad)}" style="color:var(--red)">Sil</button>` : ''}
        </td></tr>`;
    }).join('');
    body.querySelectorAll('[data-geo]').forEach(b =>
      b.addEventListener('click', () => geoPrompt(b.dataset.geo, geo[b.dataset.geo])));
    body.querySelectorAll('[data-geodel]').forEach(b =>
      b.addEventListener('click', () => geoDelete(b.dataset.geodel)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function geoPrompt(ad, mevcut) {
  const v = prompt(
    `"${ad}" için koordinat\n\nEnlem, Boylam biçiminde girin (ör. 41.01, 28.98).\n` +
    `Bir haritadan (OpenStreetMap/Google Maps) sağ tıkla kopyalayabilirsiniz.`,
    mevcut ? `${mevcut.lat}, ${mevcut.lon}` : '');
  if (v === null) return;
  const parca = String(v).split(/[,;\s]+/).filter(Boolean);
  if (parca.length < 2) { toast('İki sayı girin: enlem, boylam', 'hata'); return; }
  const lat = Number(parca[0].replace(',', '.')), lon = Number(parca[1].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { toast('Geçersiz sayı.', 'hata'); return; }
  const label = prompt('Haritada görünecek kısa ad (boş bırakılabilir):', mevcut?.label || ad) ?? null;
  geoSave(ad, lat, lon, label);
}

async function geoSave(location, lat, lon, label) {
  try {
    const r = await fetch('/api/locations/geo', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, lat, lon, label }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error);
    state.locGeo = null;                      // önbelleği düşür → harita tazelensin
    loadGeoTable();
    loadImageTable();
    loadAgents();
  } catch (err) { toast('Kaydedilemedi: ' + err.message, 'hata'); }
}

async function geoDelete(location) {
  if (!confirm(`"${location}" koordinatı silinsin mi? Bu lokasyon haritada görünmeyecek.`)) return;
  try {
    const r = await fetch('/api/locations/geo/' + encodeURIComponent(location), { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || 'silinemedi');
    state.locGeo = null;
    loadGeoTable();
    loadImageTable();
    loadAgents();
  } catch (err) { toast('Silinemedi: ' + err.message, 'hata'); }
}

async function geoSeed() {
  const msg = $(`#geoMsg`);
  try {
    const r = await fetch('/api/locations/geo/seed', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error);
    if (msg) {
      msg.style.color = 'var(--green)';
      msg.textContent = j.eklendi
        ? `✓ ${j.eklendi} lokasyon dolduruldu` + (j.eslesmeyen.length ? ` · ${j.eslesmeyen.length} tanesi elle girilmeli` : '')
        : 'Otomatik eşleşen yeni lokasyon yok — kalanları elle girin.';
    }
    state.locGeo = null;
    loadGeoTable();
    loadImageTable();
    loadAgents();
  } catch (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; } }
}

/* ═══ Lokasyonlar görünümü ════════════════════════════════════════════════ */
async function loadLocationsView() {
  const body = $(`#locationsBody`);
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5" class="loading-cell">Yükleniyor...</td></tr>';
  try {
    const [assetsData, summary, drift] = await Promise.all([
      fetchAssets({ size: 200 }),
      fetchLocationSummary().catch(() => ({ locations: {} })),
      fetchLocationDrift().catch(() => ({ drifted: [] })),
    ]);
    const assets = assetsData.results || [];
    const expectedCounts = {};
    (drift.drifted || []).forEach(() => {});
    const driftByLoc = {};
    (drift.drifted || []).forEach(d => {
      driftByLoc[d.expected_location] = (driftByLoc[d.expected_location] || 0) + 1;
    });

    const rows = {};
    assets.forEach(a => {
      const loc = (a.location || '').trim();
      if (!loc) return;
      rows[loc] = rows[loc] || { n: 0, cats: {} };
      rows[loc].n++;
      const c = a.category || 'Diğer';
      rows[loc].cats[c] = (rows[loc].cats[c] || 0) + 1;
    });

    const list = Object.entries(rows).sort((a, b) => b[1].n - a[1].n);
    const sub = $(`#locPageSub`);
    if (sub) sub.textContent = `${list.length} lokasyon · ${assets.length} cihaz`;

    body.innerHTML = list.length ? list.map(([loc, v]) => {
      const cats = Object.entries(v.cats).sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${categoryBadge(c)} <span style="color:var(--text-muted);font-size:11px">${n}</span>`).join(' ');
      const dr = driftByLoc[loc] || 0;
      return `<tr>
        <td class="hostname-cell">${escapeHtml(loc)}</td>
        <td>${v.n}</td>
        <td>${expectedCounts[loc] != null ? expectedCounts[loc] : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${dr ? `<span class="badge badge--offline">${dr}</span>` : '<span style="color:var(--green)">0</span>'}</td>
        <td>${cats}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="loading-cell">Lokasyon kaydı yok</td></tr>';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ═══ Kullanıcılar görünümü (admin) ═══════════════════════════════════════ */
const ROLE_OPTS = [['admin', 'Yönetici'], ['it', 'BT Ekibi'], ['approver', 'Onaylayıcı']];

async function loadUsersView() {
  const body = $(`#usersBody`);
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5" class="loading-cell">Yükleniyor...</td></tr>';
  try {
    const res = await fetch('/api/users');
    if (res.status === 403) {
      body.innerHTML = '<tr><td colspan="5" class="loading-cell">Bu sayfa yalnız yöneticiler içindir.</td></tr>';
      return;
    }
    const j = await res.json();
    const users = j.users || [];
    const sub = $(`#usersPageSub`);
    if (sub) sub.textContent = `${users.length} hesap`;
    const prov = $(`#usersProvider`);
    if (prov) prov.textContent = j.provider === 'ldap'
      ? 'LDAP modunda roller AD grubundan gelir — buradaki değişiklik sonraki girişte ezilebilir'
      : 'Yerel hesaplar';

    body.innerHTML = users.map(u => `
      <tr>
        <td class="hostname-cell">${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.display || '—')}</td>
        <td><span class="badge badge--unknown">${ROLE_LABEL[u.role] || u.role}</span></td>
        <td class="upn-cell col-upn">${escapeHtml(u.upn || '—')}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-pdf" data-edit="${escapeHtml(u.username)}">Düzenle</button>
          <button class="btn-pdf" data-del="${escapeHtml(u.username)}" style="color:var(--red)">Sil</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="loading-cell">Hesap yok</td></tr>';

    // UPN sütunu yalnız LDAP modunda (gerçek AD kimliği); yerel hesaplarda
    // "kullanici@kurumsal.local" sahte ve kafa karıştırıcıydı → gizle.
    const tablo = body.closest('table');
    if (tablo) tablo.classList.toggle('hide-upn', j.provider !== 'ldap');

    body.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => openUserModal(users.find(x => x.username === b.dataset.edit))));
    body.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', () => openUserDeleteModal(users.find(x => x.username === b.dataset.del))));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ─── Kullanıcı modalları (ekle / düzenle / sil) — tarayıcı prompt/confirm
   kutuları yerine tema uyumlu modallar. Partial'lar: parts/modals/user.html,
   userDelete.html. Alanlar: kullanıcı adı, ad soyad, rol (seçim), parola
   (yalnız eklemede). Kullanıcı adı düzenlemede kilitli. ─────────────────────*/
let _umMode = 'add';   // 'add' | 'edit'
let _umUser = null;    // düzenlenen kullanıcı nesnesi
let _udUser = null;    // silinecek kullanıcı nesnesi

function _umEl(id) { return document.getElementById(id); }
function _umErr(msg) { const e = _umEl('umError'); if (!e) return; if (!msg) { e.hidden = true; return; } e.textContent = msg; e.hidden = false; }

function openUserModal(user) {
  const ov = _umEl('userModalOverlay'); if (!ov) return;
  _umMode = user ? 'edit' : 'add';
  _umUser = user || null;
  _umErr('');
  _umEl('userModalTitle').textContent = user ? 'Kullanıcı Düzenle' : 'Kullanıcı Ekle';
  _umEl('userModalDesc').innerHTML = user
    ? `<b>${escapeHtml(user.username)}</b> hesabını düzenliyorsunuz.`
    : 'Yeni bir yerel hesap oluşturun.';
  _umEl('umIcoAdd').style.display = user ? 'none' : '';
  _umEl('umIcoEdit').style.display = user ? '' : 'none';

  const un = _umEl('umUsername');
  un.value = user ? user.username : '';
  un.disabled = !!user;                                  // kullanıcı adı düzenlenemez
  _umEl('umUserField').classList.toggle('um-field--ro', !!user);
  _umEl('umUserLock').style.display = user ? '' : 'none';

  _umEl('umDisplay').value = user ? (user.display || '') : '';
  _umEl('umRole').value = user ? user.role : 'it';
  _umEl('umRole').dispatchEvent(new Event('change'));   // temalı dropdown görünümünü senkronla

  const pill = _umEl('umRolePill');
  if (user) { pill.style.display = ''; pill.querySelector('b').textContent = ROLE_LABEL[user.role] || user.role; }
  else pill.style.display = 'none';

  _umEl('umPassRow').style.display = user ? 'none' : '';    // parola yalnız eklemede
  const pw = _umEl('umPassword'); pw.value = ''; pw.type = 'password';

  _umEl('umSaveLbl').textContent = user ? 'Kaydet' : 'Oluştur';
  ov.classList.add('open');
  setTimeout(() => (user ? _umEl('umDisplay') : un).focus(), 40);
}

function _umClose() { _umEl('userModalOverlay')?.classList.remove('open'); }

async function _umSave() {
  const username = _umEl('umUsername').value.trim();
  const display = _umEl('umDisplay').value.trim();
  const role = _umEl('umRole').value;
  const password = _umEl('umPassword').value;
  if (_umMode === 'add') {
    if (!username) return _umErr('Kullanıcı adı zorunludur.');
    if (!password || password.length < 8) return _umErr('Parola en az 8 karakter olmalı.');
  }
  const btn = _umEl('umSave'); btn.disabled = true;
  try {
    const res = _umMode === 'add'
      ? await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, display, role, password }) })
      : await fetch(`/api/users/${encodeURIComponent(_umUser.username)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, display }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error || 'İşlem başarısız');
    _umClose();
    toast(_umMode === 'add' ? `"${username}" kullanıcısı oluşturuldu.` : 'Kullanıcı güncellendi.', 'ok');
    if (j.warning) toast(j.warning, 'info', 6500);          // LDAP modu uyarısı (nadir)
    loadUsersView();
  } catch (err) {
    _umErr(err.message);
  } finally { btn.disabled = false; }
}

function openUserDeleteModal(user) {
  if (!user) return;
  const ov = _umEl('userDeleteOverlay'); if (!ov) return;
  _udUser = user;
  const ad = (user.display || user.username || '').trim();
  _umEl('udAvatar').textContent = (ad[0] || '?').toLocaleUpperCase('tr-TR');
  _umEl('udName').textContent = user.display || user.username;
  _umEl('udUser').textContent = user.username;   // UPN gösterme (yerel hesaplarda sahte)
  const e = _umEl('udError'); if (e) e.hidden = true;
  ov.classList.add('open');
}

function _udClose() { _umEl('userDeleteOverlay')?.classList.remove('open'); }

async function _udConfirm() {
  if (!_udUser) return;
  const btn = _umEl('udConfirm'); btn.disabled = true;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(_udUser.username)}`, { method: 'DELETE' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error || 'Silinemedi');
    _udClose();
    toast(`"${_udUser.username}" hesabı silindi.`, 'ok');
    loadUsersView();
  } catch (err) {
    const e = _umEl('udError'); if (e) { e.textContent = err.message; e.hidden = false; }
  } finally { btn.disabled = false; }
}

/* ─── Temalı açılır liste ────────────────────────────────────────────────────
   Native <select>'in açılan popup'ı Windows mavisiyle temayı bozuyordu. Bu,
   herhangi bir <select>'i gizli KAYNAK olarak tutup üstüne tema uyumlu özel
   bir liste kurar — select'in value'su ve change olayı aynen çalışır, bu yüzden
   mevcut kod (umRole.value okuma/yazma) değişmeden kalır. Başka select'lere de
   tek satırla uygulanabilir. İkonlar data-tsel-ikon ile. */
const _TSEL_IKON = {
  shield: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/></svg>',
};
function temaliSelect(sel) {
  if (!sel || sel.dataset.tsel) return;
  sel.dataset.tsel = '1';
  const wrap = document.createElement('div');
  wrap.className = 'tsel';
  sel.parentNode.insertBefore(wrap, sel);

  const trigger = document.createElement('div');
  trigger.className = 'um-field tsel-trigger';
  trigger.tabIndex = 0;
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = (_TSEL_IKON[sel.dataset.tselIkon] || '') +
    '<span class="tsel-val"></span>' +
    '<svg class="um-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';

  const list = document.createElement('div');
  list.className = 'tsel-list';
  list.setAttribute('role', 'listbox');
  [...sel.options].forEach((o) => {
    const it = document.createElement('div');
    it.className = 'tsel-opt';
    it.textContent = o.textContent;
    it.dataset.val = o.value;
    it.setAttribute('role', 'option');
    it.addEventListener('click', () => { sel.value = o.value; senk(); kapat(); sel.dispatchEvent(new Event('change', { bubbles: true })); });
    list.appendChild(it);
  });

  wrap.appendChild(trigger);
  wrap.appendChild(list);
  wrap.appendChild(sel);   // gizli kaynak
  const valEl = trigger.querySelector('.tsel-val');

  function senk() {
    const o = sel.options[sel.selectedIndex];
    valEl.textContent = o ? o.textContent : '';
    [...list.children].forEach((c) => c.classList.toggle('sel', c.dataset.val === sel.value));
  }
  function ac() { wrap.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); }
  function kapat() { wrap.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }
  trigger.addEventListener('click', (e) => { e.stopPropagation(); wrap.classList.contains('open') ? kapat() : ac(); });
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.classList.contains('open') ? kapat() : ac(); }
    else if (e.key === 'Escape') kapat();
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) kapat(); });
  sel.addEventListener('change', senk);   // dışarıdan value değişince (openUserModal) senkronla
  senk();
}

/* Statik modal düğmelerini bir kez bağla (init.js çağırır — DOM hazır). */
function bindUserModals() {
  const ov = _umEl('userModalOverlay');
  if (ov && !ov.dataset.bound) {
    ov.dataset.bound = '1';
    _umEl('umCancel')?.addEventListener('click', _umClose);
    _umEl('userModalClose')?.addEventListener('click', _umClose);
    _umEl('umSave')?.addEventListener('click', _umSave);
    ov.addEventListener('click', (e) => { if (e.target === ov) _umClose(); });
    _umEl('umEye')?.addEventListener('click', () => { const pw = _umEl('umPassword'); pw.type = pw.type === 'password' ? 'text' : 'password'; });
    ['umUsername', 'umDisplay', 'umPassword'].forEach((id) =>
      _umEl(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _umSave(); } }));
    temaliSelect(_umEl('umRole'));   // rol dropdown'unu temalı yap
  }
  const dov = _umEl('userDeleteOverlay');
  if (dov && !dov.dataset.bound) {
    dov.dataset.bound = '1';
    _umEl('udCancel')?.addEventListener('click', _udClose);
    _umEl('userDeleteClose')?.addEventListener('click', _udClose);
    _umEl('udConfirm')?.addEventListener('click', _udConfirm);
    dov.addEventListener('click', (e) => { if (e.target === dov) _udClose(); });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (_umEl('userModalOverlay')?.classList.contains('open')) _umClose();
    if (_umEl('userDeleteOverlay')?.classList.contains('open')) _udClose();
  });
}

/* ─── Excel/CSV Export ──────────────────────────────────────────────────────── */
function exportAssetsCSV(secilenler) {
  // Argüman verilmezse EKRANDA GÖRÜNEN (filtrelenmiş) liste dışa aktarılır.
  // Toplu seçim çubuğu yalnız seçilenleri gönderir.
  const assets = Array.isArray(secilenler) ? secilenler
    : (state.renderedAssets || state.assets || []);
  if (!assets.length) { toast('Dışa aktarılacak kayıt yok.', 'hata'); return; }

  const cols = [
    ['hostname', 'Hostname'], ['location', 'Lokasyon'], ['category', 'Kategori'],
    ['brand', 'Marka'], ['model', 'Model'], ['serial_number', 'Seri No'],
    ['cpu', 'CPU'], ['ram_gb', 'RAM (GB)'], ['storage_gb', 'Disk (GB)'],
    ['ip_address', 'IP'], ['mac_address', 'MAC'], ['os', 'OS'],
    ['username', 'Kullanıcı'], ['status', 'Durum'], ['last_seen', 'Son Görülme'],
  ];
  const esc = (v) => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = cols.map(([, label]) => esc(label)).join(';');
  const rows = assets.map((a) => cols.map(([key]) => esc(a[key])).join(';'));
  // BOM + ; ayraç → Excel Türkçe/UTF-8 doğru açar
  const csv = '﻿' + [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `assetman-envanter-${stamp}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

