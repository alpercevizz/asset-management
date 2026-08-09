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
  } catch (err) { alert('Silinemedi: ' + err.message); }
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
  } catch (err) { alert('Silinemedi: ' + err.message); }
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
  if (parca.length < 2) { alert('İki sayı girin: enlem, boylam'); return; }
  const lat = Number(parca[0].replace(',', '.')), lon = Number(parca[1].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { alert('Geçersiz sayı.'); return; }
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
  } catch (err) { alert('Kaydedilemedi: ' + err.message); }
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
  } catch (err) { alert('Silinemedi: ' + err.message); }
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
        <td class="upn-cell">${escapeHtml(u.upn || '—')}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-pdf" data-edit="${escapeHtml(u.username)}">Düzenle</button>
          <button class="btn-pdf" data-del="${escapeHtml(u.username)}" style="color:var(--red)">Sil</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="loading-cell">Hesap yok</td></tr>';

    body.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => editUserPrompt(users.find(x => x.username === b.dataset.edit))));
    body.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', () => deleteUserPrompt(b.dataset.del)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function roleFromPrompt(current) {
  const v = prompt(`Rol (${ROLE_OPTS.map(r => r[0]).join(' / ')}):`, current || 'it');
  if (v === null) return null;
  const r = String(v).trim().toLowerCase();
  if (!ROLE_OPTS.some(x => x[0] === r)) { alert('Geçersiz rol.'); return null; }
  return r;
}

async function createUserPrompt() {
  const username = prompt('Kullanıcı adı:');
  if (!username || !username.trim()) return;
  const display = prompt('Ad Soyad (opsiyonel):') || '';
  const role = roleFromPrompt('it');
  if (!role) return;
  const password = prompt('Parola (en az 8 karakter):');
  if (!password) return;
  try {
    const res = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), display, role, password }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadUsersView();
  } catch (err) { alert('Oluşturulamadı: ' + err.message); }
}

async function editUserPrompt(u) {
  if (!u) return;
  const role = roleFromPrompt(u.role);
  if (!role) return;
  const display = prompt('Ad Soyad:', u.display || '') ?? u.display;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(u.username)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, display }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    if (j.warning) alert(j.warning);
    loadUsersView();
  } catch (err) { alert('Güncellenemedi: ' + err.message); }
}

async function deleteUserPrompt(username) {
  if (!confirm(`"${username}" hesabı KALICI olarak silinecek. Emin misiniz?`)) return;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadUsersView();
  } catch (err) { alert('Silinemedi: ' + err.message); }
}

/* ─── Excel/CSV Export ──────────────────────────────────────────────────────── */
function exportAssetsCSV(secilenler) {
  // Argüman verilmezse EKRANDA GÖRÜNEN (filtrelenmiş) liste dışa aktarılır.
  // Toplu seçim çubuğu yalnız seçilenleri gönderir.
  const assets = Array.isArray(secilenler) ? secilenler
    : (state.renderedAssets || state.assets || []);
  if (!assets.length) { alert('Dışa aktarılacak kayıt yok.'); return; }

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

