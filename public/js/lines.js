/* AssetMan · lines.js
   Hatlar & SIM kartlari, operator logolari, barkod okuma, Ayarlar

   NOT: Bu dosya app.js'ten bolundu. ES modul DEGIL - index.html'de
   sirayla yuklenen duz scriptler; global kapsam paylasiliyor.
   Yukleme sirasi index.html'deki <script> siralamasidir. */

/* ─── Turkcell Hat / SIM Yönetimi ───────────────────────────────────────────── */
let _lines = [];
const LINE_STATUS_CLS = { aktif: 'badge--online', pasif: 'badge--unknown', iptal: 'badge--offline' };

/* ═══ HATLAR & SIM KARTLARI ════════════════════════════════════════════════
   Filtreleme ve sayfalama İSTEMCİDE. Hat sayısı küçük (yüzler mertebesi) —
   her tuşta sunucuya gitmenin faydası yok, gecikme zararı var. */
const _lineFiltre = { q: '', op: '', status: '', tariff: '' };
let _linePage = 1;
let _linePageSize = 25;

/* MSISDN'i okunur biçime getirir: +905321112233 → +90 532 111 22 33.
   Ham hâli 13 hanelik tek blok; tabloda gözle taranamıyor. */
function msisdnBicim(v) {
  const s = String(v || '').replace(/\s+/g, '');
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(s);
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : (v || '—');
}

/* Operatör rozeti. Marka logosu KULLANILMIYOR — logo dosyalarımız yok ve
   marka varlıklarını gömmek ayrı bir izin konusu. Operatörün baş harfi,
   ada göre sabit bir renkle gösteriliyor (aynı operatör hep aynı renk). */
const OP_RENK = ['blue', 'accent', 'green', 'purple', 'orange', 'teal'];

/* Operatör rengi ADA göre sabit: aynı operatör tabloda da, Hat Ekle
   modalında da aynı renkte görünür. Rastgele olsaydı iki yer tutmazdı. */
function opRenkSinifi(ad) {
  const t = String(ad || '').trim();
  if (!t) return 'kpi-ico--muted';
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return 'kpi-ico--' + OP_RENK[h % OP_RENK.length];
}

/* ── Operatör logoları ──────────────────────────────────────────────────────
   Logo dosyası VARSA harf rozetinin yerine geçer. Dosya yoksa/yüklenemezse
   harf rozeti olduğu gibi kalır — kırık görsel simgesi asla görünmez.
   Bu yüzden görsel doğrudan HTML'e yazılmaz; önce arka planda denenir. */
const OP_LOGO_YOL = 'img/operators/';
const OP_LOGOLAR = {
  turkcell: 'turkcell.png',
  turktelekom: 'turk-telekom.jpg',   // JPEG: saydamlığı yok, rozet zemini beyaz
  vodafone: 'vodafone.png',
};
const _opLogoDurum = {};   // dosya adı → true (yüklendi) | false (yok)

/* 'Türk Telekom' → 'turktelekom' */
function opLogoAnahtar(ad) {
  return String(ad || '').toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c])
    .replace(/[^a-z0-9]/g, '');
}

function opLogoDosya(ad) {
  return OP_LOGOLAR[opLogoAnahtar(ad)] || '';
}

/* Render sonrası çağrılır: data-op-logo taşıyan rozetlere görseli yerleştirir. */
function opLogoUygula(kok) {
  (kok || document).querySelectorAll('[data-op-logo]').forEach((el) => {
    const dosya = el.getAttribute('data-op-logo');
    if (!dosya || _opLogoDurum[dosya] === false || el.querySelector('img')) return;
    const koy = () => {
      el.classList.add('op-ico--logo');
      el.innerHTML = `<img src="${OP_LOGO_YOL}${encodeURIComponent(dosya)}" alt="">`;
    };
    if (_opLogoDurum[dosya] === true) { koy(); return; }
    const im = new Image();
    im.onload = () => { _opLogoDurum[dosya] = true; koy(); };
    im.onerror = () => { _opLogoDurum[dosya] = false; };   // harf rozeti kalır
    im.src = OP_LOGO_YOL + encodeURIComponent(dosya);
  });
}

/* Tek bir rozet elemanını tazeler (modaldaki canlı alanlar için).
   Logo yoksa harf rozeti; opLogoUygula sonradan görseli koyar. */
function opRozetYaz(el, ad, temelSinif) {
  const t = String(ad || '').trim();
  const logo = opLogoDosya(t);
  el.classList.remove('op-ico--logo');
  el.textContent = t ? t.slice(0, 1).toLocaleUpperCase('tr-TR') : '?';
  el.className = temelSinif + ' ' + opRenkSinifi(t);
  if (logo) el.setAttribute('data-op-logo', logo);
  else el.removeAttribute('data-op-logo');
}

function opRozet(ad) {
  const t = String(ad || '').trim();
  if (!t) return '<span style="color:var(--text-muted)">—</span>';
  const logo = opLogoDosya(t);
  return `<span class="op-rozet"><i class="${opRenkSinifi(t)}"${logo ? ` data-op-logo="${escapeHtml(logo)}"` : ''}>` +
    `${escapeHtml(t.slice(0, 1).toLocaleUpperCase('tr-TR'))}</i>${escapeHtml(t)}</span>`;
}

function lineFiltrele() {
  const q = _lineFiltre.q.toLowerCase().replace(/\s+/g, '');
  return _lines.filter((l) => {
    if (_lineFiltre.op && l.operator !== _lineFiltre.op) return false;
    if (_lineFiltre.status && l.status !== _lineFiltre.status) return false;
    if (_lineFiltre.tariff && l.tariff !== _lineFiltre.tariff) return false;
    if (!q) return true;
    // Arama boşlukları yok sayar: kullanıcı "+90 532" yazsa da bulur
    return [l.msisdn, l.iccid, l.assigned_hostname, l.operator, l.tariff]
      .some((x) => String(x || '').toLowerCase().replace(/\s+/g, '').includes(q));
  });
}

/* Filtre seçenekleri VERİDEN türetilir. Sabit liste yazılsaydı yeni bir
   operatör/tarife eklenince listede görünmez, kullanıcı da filtreleyemezdi. */
function lineFiltreSecenekleri() {
  const doldur = (sel, degerler, mevcut) => {
    const e = $(sel);
    if (!e) return;
    const liste = [...new Set(degerler.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'tr'));
    e.innerHTML = '<option value="">Tümü</option>' +
      liste.map((v) => `<option value="${escapeHtml(v)}"${v === mevcut ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
  };
  doldur(`#lineFilterOp`, _lines.map((l) => l.operator), _lineFiltre.op);
  doldur(`#lineFilterStatus`, _lines.map((l) => l.status), _lineFiltre.status);
  doldur(`#lineFilterTariff`, _lines.map((l) => l.tariff), _lineFiltre.tariff);
}

async function loadLines() {
  const tbody = $(`#linesBody`);
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Yükleniyor...</td></tr>`;
  try {
    const res = await fetch('/api/lines');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _lines = data.lines || [];
    const s = data.summary || {};
    const setC = (id, v) => { const el = $(`#${id}`); if (el) animateCount(el, v); };
    setC('lineTotal', s.total || 0);
    setC('lineAssigned', s.assigned || 0);
    setC('lineUnassigned', s.unassigned || 0);
    /* Operatör kartı SAYI gösterir. Önceki sürümde buraya sabit "Turkcell"
       yazılıydı — ikinci operatör eklenince yanlış bilgi veriyordu. */
    setC('lineOperators', new Set(_lines.map((l) => l.operator).filter(Boolean)).size);
    lineFiltreSecenekleri();
    renderLinesTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderLinesTable() {
  const tbody = $(`#linesBody`);
  if (!tbody) return;

  const suzulen = lineFiltrele();
  const toplamSayfa = Math.max(1, Math.ceil(suzulen.length / _linePageSize));
  if (_linePage > toplamSayfa) _linePage = toplamSayfa;
  const bas = (_linePage - 1) * _linePageSize;
  const sayfa = suzulen.slice(bas, bas + _linePageSize);

  // Alt bilgi: kaç kayıt gösteriliyor + sayfalar
  const aralik = $(`#lineRange`);
  if (aralik) {
    aralik.textContent = suzulen.length
      ? `${bas + 1} – ${bas + sayfa.length} / ${suzulen.length} kayıt gösteriliyor` +
        (suzulen.length !== _lines.length ? ` (${_lines.length} kayıt içinden)` : '')
      : 'Kayıt yok';
  }
  const sayfalar = $(`#linePages`);
  if (sayfalar) {
    sayfalar.innerHTML = Array.from({ length: toplamSayfa }, (_, i) => i + 1)
      .map((n) => `<button class="lf-page${n === _linePage ? ' aktif' : ''}" data-p="${n}">${n}</button>`).join('');
    sayfalar.querySelectorAll('.lf-page').forEach((b) =>
      b.addEventListener('click', () => { _linePage = Number(b.dataset.p); renderLinesTable(); }));
  }
  const prev = $(`#linePrev`), next = $(`#lineNext`);
  if (prev) prev.disabled = _linePage <= 1;
  if (next) next.disabled = _linePage >= toplamSayfa;

  if (!suzulen.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">${
      _lines.length ? 'Filtreye uyan hat yok.' : 'Kayıtlı hat yok. "Hat Ekle" veya "CSV İçe Aktar" ile başlayın.'
    }</td></tr>`;
    return;
  }

  const stCls = (st) => LINE_STATUS_CLS[st] || 'badge--unknown';
  tbody.innerHTML = sayfa.map((l) => {
    /* Bağlı telefon: cihaz adı + ZİMMETLİ KULLANICI. Tasarımda burada ikinci
       bir telefon numarası vardı; cihaza ait ayrı bir numara sistemde YOK,
       uydurmak yerine gerçekten bildiğimiz bilgi gösteriliyor. */
    const cihaz = l.assigned_asset_id
      ? (state.assets || []).find((a) => String(a.id) === String(l.assigned_asset_id))
      : null;
    const kullanici = cihaz && (cihaz.username || '').trim();
    return `
    <tr>
      <td>
        <div class="ln-msisdn">
          <span class="ln-ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/></svg></span>
          <b>${escapeHtml(msisdnBicim(l.msisdn))}</b>
        </div>
      </td>
      <td>
        <span class="ln-iccid"><span class="serial-cell">${fmt(l.iccid)}</span>
          <button class="btn-icon ln-kopyala" data-v="${escapeHtml(l.iccid || '')}" title="SIM numarasını kopyala">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button></span>
      </td>
      <td>${opRozet(l.operator)}</td>
      <td>${fmt(l.tariff)}</td>
      <td><span class="badge ${stCls(l.status)}">${fmt(l.status)}</span></td>
      <td>${l.assigned_hostname
        ? `<div class="ln-bagli"><b>${escapeHtml(l.assigned_hostname)}</b>${
            kullanici ? `<small><i></i>${escapeHtml(kullanici)}</small>` : ''}</div>`
        : '<div class="ln-bagli"><span class="ln-bos">—</span><small>boşta</small></div>'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-icon line-assign" data-id="${l.id}" title="Telefona ata">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/></svg>
        </button>
        ${l.assigned_asset_id ? `<button class="btn-icon line-release" data-id="${l.id}" title="Telefondan çıkar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
        </button>` : ''}
        <button class="btn-icon line-history" data-id="${l.id}" title="Geçmiş">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.line-assign').forEach(b => b.addEventListener('click', () => assignLinePrompt(Number(b.dataset.id))));
  tbody.querySelectorAll('.line-release').forEach(b => b.addEventListener('click', () => releaseLineAction(Number(b.dataset.id))));
  tbody.querySelectorAll('.line-history').forEach(b => b.addEventListener('click', () => showLineHistory(Number(b.dataset.id))));
  tbody.querySelectorAll('.ln-kopyala').forEach(b => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.v);
      b.classList.add('kopyalandi');
      setTimeout(() => b.classList.remove('kopyalandi'), 1200);
    } catch { /* pano izni yok: kullanıcı elle seçebilir */ }
  }));
  opLogoUygula(tbody);
}


/* Hatları CSV'ye aktar. EKRANDA GÖRÜNEN (filtrelenmiş) liste dışa aktarılır —
   kullanıcı bir filtre kurup dışa aktardığında tüm listeyi almak şaşırtıcı olur. */
function exportLinesCsv() {
  const liste = lineFiltrele();
  if (!liste.length) { alert('Dışa aktarılacak hat yok.'); return; }
  const cols = [
    ['msisdn', 'Telefon No'], ['iccid', 'SIM No (ICCID)'], ['operator', 'Operatör'],
    ['tariff', 'Tarife'], ['status', 'Durum'], ['assigned_hostname', 'Bağlı Telefon'],
    ['note', 'Not'],
  ];
  const esc = (v) => {
    const t = (v === null || v === undefined) ? '' : String(v);
    return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const csv = '﻿' + [
    cols.map(([, l]) => esc(l)).join(';'),
    ...liste.map((l) => cols.map(([k]) => esc(l[k])).join(';')),
  ].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `assetman-hatlar-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Sunucudaki normMsisdn ile BİREBİR aynı (agent/tools/line-tools.js).
   Önizleme farklı davransaydı kullanıcıya yanlış numarayı vaat ederdik. */
function normMsisdnIstemci(v) {
  let s = String(v || '').replace(/[^0-9+]/g, '');
  if (s && !s.startsWith('+')) {
    if (s.startsWith('00')) s = '+' + s.slice(2);
    else if (s.startsWith('0')) s = '+9' + s;
    else if (s.startsWith('5')) s = '+90' + s;
  }
  return s;
}

const LINE_DURUM_RENK = { aktif: 'var(--green)', pasif: 'var(--text-muted)', iptal: 'var(--red)' };

/* Form her değiştiğinde: sağdaki önizlemeyi tazele, ne kaydedileceğini göster
   ve aynı numaranın/SIM'in zaten kayıtlı olup olmadığını uyar. Sunucu da
   doğruluyor ama hatayı Kaydet'e basmadan görmek çok daha iyi. */
function lineFormKontrol() {
  const msHam = $(`#lineMsisdn`)?.value || '';
  const ms = normMsisdnIstemci(msHam);
  const ic = String($(`#lineIccid`)?.value || '').replace(/[^0-9]/g, '');
  const op = lineOperatorDegeri();
  const tf = ($(`#lineTariff`)?.value || '').trim();
  const dr = $(`#lineStatus`)?.value || 'aktif';

  const yaz = (sel, metin, sinif) => {
    const e = $(sel);
    if (!e) return;
    e.textContent = metin;
    e.className = 'hm-ipucu' + (sinif ? ' ' + sinif : '');
  };
  yaz(`#lineMsisdnOnizleme`, ms ? `Kaydedilecek: ${msisdnBicim(ms)}` : 'Başında 0 ile veya 0 olmadan girebilirsiniz.', ms ? 'hm-ok' : '');
  yaz(`#lineIccidOnizleme`, ic ? `${ic.length} hane` : '',
    ic && (ic.length < 18 || ic.length > 22) ? 'hm-dikkat' : '');

  // Operatör rozeti: tablodakiyle aynı renk kuralı (aynı ad → aynı renk)
  const rozet = $(`#lineOpRozet`);
  if (rozet) opRozetYaz(rozet, op, 'hm-alan-ico hm-op-rozet');

  // Durum noktası seçime göre renklenir (native select içine nokta konamıyor)
  const nokta = $(`#lineStatusNokta`);
  if (nokta) nokta.style.background = LINE_DURUM_RENK[dr] || 'var(--text-muted)';

  // Tarife temizleme düğmesi yalnız doluyken
  const temizle = $(`#lineTariffTemizle`);
  if (temizle) temizle.style.display = tf ? 'flex' : 'none';

  // ── Önizleme paneli ──
  const set = (sel, v) => { const e = $(sel); if (e) e.textContent = v; };
  set(`#ozOperator`, op || '—');
  set(`#ozTarife`, tf || '—');
  set(`#ozTelefon`, ms ? msisdnBicim(ms) : '—');
  const durumHtml = `<i class="hm-oz-nokta" style="background:${LINE_DURUM_RENK[dr] || 'var(--text-muted)'}"></i>` +
    escapeHtml(dr.charAt(0).toLocaleUpperCase('tr-TR') + dr.slice(1));
  const oz = $(`#ozDurum`);
  if (oz) oz.innerHTML = durumHtml;
  // İki SIM görseli var (sol önizleme + monitörde sağ panel); ikisi de yazar
  ['simMarka', 'simMarka2'].forEach((id) => {
    const e = document.getElementById(id);
    if (e) e.textContent = op || '';
  });

  // ── Özet Bilgiler paneli (tablet düzeni; aynı veriler, dikey dizilim) ──
  set(`#ozgTelefon`, ms ? msisdnBicim(ms) : '—');
  set(`#ozgIccid`, ic || '—');
  set(`#ozgOperator`, op || '—');
  set(`#ozgTarife`, tf || '—');
  const ozgDurum = $(`#ozgDurum`);
  if (ozgDurum) ozgDurum.innerHTML = durumHtml;
  const ozgRozet = $(`#ozgOpRozet`);
  if (ozgRozet) opRozetYaz(ozgRozet, op, 'hm-oz-ico hm-ozet-op');
  opLogoUygula($(`#lineModalOverlay`));

  // Adım göstergesi (telefon): 2. adım Önizleme'dir, kayıt için gereken
  // telefon + operatör girilince etkinleşir. Çubuk her alanla yarı yarıya dolar.
  const bar = document.getElementById('lineAdimBar');
  if (bar) bar.style.width = ((ms ? 50 : 0) + (op ? 50 : 0)) + '%';
  const adim2 = document.getElementById('lineAdim2');
  if (adim2) adim2.classList.toggle('is-aktif', !!(ms && op));

  // ── Çakışma uyarısı ──
  const uyari = $(`#lineUyari`);
  if (!uyari) return;
  const cakisma = (_lines || []).find((l) =>
    (ms && normMsisdnIstemci(l.msisdn) === ms) || (ic && String(l.iccid) === ic));
  if (cakisma) {
    uyari.className = 'hm-uyari goster';
    uyari.textContent = `Bu ${normMsisdnIstemci(cakisma.msisdn) === ms ? 'telefon numarası' : 'SIM numarası'} ` +
      `zaten kayıtlı (${msisdnBicim(cakisma.msisdn)}). Kaydederseniz mevcut kayıt güncellenir.`;
  } else {
    uyari.className = 'hm-uyari';
    uyari.textContent = '';
  }
}

/* ── Operatör açılır menüsü ─────────────────────────────────────────────────
   Liste = Türkiye'deki üç şebeke + veritabanında zaten geçen operatörler
   (MVNO/kurumsal adlar kaybolmasın) + "Diğer…". Sabit üçe kilitlemek, mevcut
   kayıtları düzenlerken operatörü sessizce değiştirirdi. */
const OP_SABIT = ['Turkcell', 'Vodafone', 'Türk Telekom'];
const OP_DIGER = '__diger';

function lineOperatorDoldur(secili) {
  const sel = $(`#lineOperator`);
  if (!sel) return;
  const hepsi = [...new Set([...OP_SABIT, ...(_lines || []).map((l) => (l.operator || '').trim())])]
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'tr'));
  sel.innerHTML = hepsi.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')
    + `<option value="${OP_DIGER}">Diğer…</option>`;

  const diger = $(`#lineOperatorDiger`);
  const s = (secili || '').trim();
  if (s && !hepsi.includes(s)) {          // listede yoksa "Diğer" olarak aç
    sel.value = OP_DIGER;
    if (diger) diger.value = s;
  } else {
    sel.value = s || hepsi[0] || OP_DIGER;
    if (diger) diger.value = '';
  }
  lineOperatorDigerGoster();
}

function lineOperatorDigerGoster() {
  const sel = $(`#lineOperator`), diger = $(`#lineOperatorDiger`);
  if (!sel || !diger) return;
  const acik = sel.value === OP_DIGER;
  diger.style.display = acik ? 'block' : 'none';
  if (acik && document.activeElement === sel) setTimeout(() => diger.focus(), 30);
}

/* Kaydedilecek operatör adı: "Diğer" seçiliyse serbest metin alanından. */
function lineOperatorDegeri() {
  const sel = $(`#lineOperator`);
  if (!sel) return '';
  return (sel.value === OP_DIGER ? ($(`#lineOperatorDiger`)?.value || '') : sel.value).trim();
}

function openLineModal() {
  ['lineMsisdn', 'lineIccid', 'lineTariff'].forEach(id => { const el = $(`#${id}`); if (el) el.value = ''; });
  const st = $(`#lineStatus`); if (st) st.value = 'aktif';
  lineOperatorDoldur('Turkcell');

  // Tarife önerileri mevcut hatlardan — sabit liste yazılsaydı kurumun kendi
  // tarifeleri hiç görünmezdi. (Operatör artık açılır menü, bkz. yukarısı.)
  const doldur = (sel, degerler) => {
    const e = $(sel);
    if (!e) return;
    e.innerHTML = [...new Set(degerler.filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), 'tr'))
      .map((v) => `<option value="${escapeHtml(v)}">`).join('');
  };
  doldur(`#lineTariffList`, (_lines || []).map((l) => l.tariff));

  lineFormKontrol();
  // Panel başlığı TV'de "Bilgi Özeti", diğer düzenlerde "Özet Bilgiler"
  const tv = document.body.classList.contains('tv-mode');
  const ozBas = document.querySelector('.hm-ozet-bas h4');
  if (ozBas) ozBas.textContent = tv ? 'Bilgi Özeti' : 'Özet Bilgiler';
  if (tv) lineTvKur();
  $(`#lineModalOverlay`)?.classList.add('open');
  setTimeout(() => $(`#lineMsisdn`)?.focus(), 60);
}

/* ── TV/duvar ekranı başlığı: sistem durumu + saat ──────────────────────────
   Durum uydurulmuyor: panodaki uyarı sayısı henüz hesaplanmadıysa
   "bilinmiyor" yazar. Duvar ekranında yanlış bir "normal" en kötü yalandır. */
let _lineTvSaat = null;

function lineTvKur() {
  const durum = $(`#lineTvDurum`);
  if (durum) {
    const n = _toplamUyari;
    const [sinif, metin] = n === null ? ['bilinmiyor', 'Sistem durumu bilinmiyor']
      : n === 0 ? ['normal', 'Sistem Normal']
        : ['dikkat', `${n} uyarı`];
    durum.className = 'hm-tv-durum ' + sinif;
    durum.querySelector('b').textContent = metin;
  }
  const yaz = () => {
    const e = $(`#lineTvSaat`);
    if (!e) return;
    const d = new Date();
    e.innerHTML = `<b>${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</b>` +
      `<span>${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}</span>`;
  };
  yaz();
  if (_lineTvSaat) clearInterval(_lineTvSaat);
  _lineTvSaat = setInterval(yaz, 1000);
}

function lineTvDurdur() {
  if (_lineTvSaat) { clearInterval(_lineTvSaat); _lineTvSaat = null; }
}

/* ── SIM barkodunu kamerayla oku ────────────────────────────────────────────
   Native BarcodeDetector; harici kütüphane YOK. Tarayıcı desteklemiyorsa
   düğme hiç gösterilmez — çalışmayan düğme kullanıcıyı yanıltır. */
let _lineScanStream = null, _lineScanLoop = null, _lineDetector = null;

function lineScanKur() {
  if (!('BarcodeDetector' in window)) return;
  try {
    _lineDetector = new BarcodeDetector({
      formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix', 'codabar'],
    });
  } catch { try { _lineDetector = new BarcodeDetector(); } catch { _lineDetector = null; } }
  const b = $(`#lineIccidScan`);
  if (_lineDetector && b) b.style.display = 'flex';
}

async function lineScanBaslat() {
  const ov = $(`#lineScanOverlay`), video = $(`#lineScanVideo`);
  if (!_lineDetector || !ov || !video) return;
  try {
    _lineScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    video.srcObject = _lineScanStream;
    await video.play();
    ov.classList.add('open');
    _lineScanLoop = setInterval(async () => {
      try {
        const kodlar = await _lineDetector.detect(video);
        const ham = kodlar && kodlar[0] && kodlar[0].rawValue;
        if (!ham) return;
        const rakam = String(ham).replace(/[^0-9]/g, '');
        if (rakam.length < 10) return;          // gürültü: ICCID bu kadar kısa olmaz
        const el = $(`#lineIccid`);
        if (el) { el.value = rakam; lineFormKontrol(); }
        lineScanDurdur();
      } catch { /* kare okunamadı: bir sonrakini dene */ }
    }, 400);
  } catch (err) {
    alert('Kamera açılamadı: ' + err.message);
    lineScanDurdur();
  }
}

function lineScanDurdur() {
  if (_lineScanLoop) { clearInterval(_lineScanLoop); _lineScanLoop = null; }
  if (_lineScanStream) { _lineScanStream.getTracks().forEach((t) => t.stop()); _lineScanStream = null; }
  $(`#lineScanOverlay`)?.classList.remove('open');
}

async function saveLine() {
  /* "Diğer" seçilip ad yazılmadıysa varsayılana düşmek YANLIŞ olur: hat
     sessizce başka bir operatöre kaydedilir. Kullanıcıya sorulur. */
  const operator = lineOperatorDegeri();
  if (!operator) {
    alert('Operatör seçin; "Diğer" seçtiyseniz operatör adını yazın.');
    $(`#lineOperatorDiger`)?.focus();
    return;
  }
  const body = {
    msisdn: $(`#lineMsisdn`)?.value.trim(),
    iccid: $(`#lineIccid`)?.value.trim(),
    operator,
    tariff: $(`#lineTariff`)?.value.trim(),
    status: $(`#lineStatus`)?.value || 'aktif',
  };
  if (!body.msisdn || !body.iccid) { alert('Telefon no ve SIM no zorunludur.'); return; }
  try {
    const res = await fetch('/api/lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error || 'Hata');
    $(`#lineModalOverlay`)?.classList.remove('open');
    loadLines();
  } catch (err) { alert('Hat kaydedilemedi: ' + err.message); }
}

async function assignLinePrompt(lineId) {
  // Telefon kategorisindeki cihazlardan seç (state.assets veya taze çek)
  let phones = (state.assets || []).filter(a => a.category === 'Telefon');
  if (!phones.length) { try { const d = await fetchAssets({ size: 200 }); phones = (d.results || []).filter(a => a.category === 'Telefon'); } catch {} }
  const opts = phones.map((p, i) => `${i + 1}) ${p.hostname} (${p.username || 'zimmetsiz'})`).join('\n');
  const pick = prompt(`Hangi telefona atansın? Numara girin:\n\n${opts}`);
  if (!pick) return;
  const idx = parseInt(pick, 10) - 1;
  const phone = phones[idx];
  if (!phone) { alert('Geçersiz seçim.'); return; }
  try {
    const res = await fetch(`/api/lines/${lineId}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: phone.id, hostname: phone.hostname }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadLines();
  } catch (err) { alert('Atanamadı: ' + err.message); }
}

async function releaseLineAction(lineId) {
  if (!confirm('Bu hat telefondan çıkarılsın (boşa alınsın) mı?')) return;
  try {
    const res = await fetch(`/api/lines/${lineId}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadLines();
  } catch (err) { alert('İade edilemedi: ' + err.message); }
}

async function showLineHistory(lineId) {
  try {
    const res = await fetch(`/api/lines/${lineId}/history`);
    const j = await res.json();
    const h = j.history || [];
    const line = _lines.find(l => l.id === lineId);
    const ACT = { olusturuldu: 'Envantere eklendi', atandi: 'Telefona atandı', iade: 'Telefondan çıkarıldı' };
    const body = h.length
      ? h.map(e => `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>
          <div style="flex:1"><div style="color:var(--text);font-weight:500">${ACT[e.action] || e.action}${e.hostname ? ` — ${escapeHtml(e.hostname)}` : ''}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:1px">${fmtDate(e.at)} · ${escapeHtml(e.actor || '—')}${e.note ? ` · ${escapeHtml(e.note)}` : ''}</div></div>
        </div>`).join('')
      : '<p style="padding:4px 0;color:var(--text-muted)">Geçmiş kaydı yok.</p>';
  // Cihaz modalını yeniden kullan (başlık + body)
  $(`#deviceModalTitle`).textContent = `${line ? line.msisdn : 'Hat'} — Geçmiş`;
  $(`#deviceModalBody`).innerHTML = `<div style="font-size:12.5px">${body}</div>`;
  $(`#handoverPdfBtn`).style.display = 'none';
  _deviceModalAsset = null;
  $(`#deviceModalOverlay`)?.classList.add('open');
  } catch (err) { alert('Geçmiş alınamadı: ' + err.message); }
}

// CSV import: başlık satırı iccid,msisdn,operator,tariff,status bekler (esnek eşleme)
function importLinesCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { alert('CSV boş veya sadece başlık var.'); return; }
  const delim = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delim).map(h => h.trim().toLowerCase().replace(/^﻿/, ''));
  const idx = (names) => headers.findIndex(h => names.includes(h));
  const iIccid = idx(['iccid', 'sim', 'sim no', 'sim_no']);
  const iMsisdn = idx(['msisdn', 'numara', 'telefon', 'telefon no', 'phone']);
  const iOp = idx(['operator', 'operatör']);
  const iTariff = idx(['tariff', 'tarife', 'paket']);
  const iStatus = idx(['status', 'durum']);
  if (iIccid < 0 || iMsisdn < 0) { alert('CSV başlığında iccid ve msisdn sütunları bulunmalı.'); return; }
  const rows = lines.slice(1).map(line => {
    const c = line.split(delim);
    return {
      iccid: (c[iIccid] || '').trim(), msisdn: (c[iMsisdn] || '').trim(),
      operator: iOp >= 0 ? (c[iOp] || '').trim() || 'Turkcell' : 'Turkcell',
      tariff: iTariff >= 0 ? (c[iTariff] || '').trim() : '',
      status: iStatus >= 0 ? (c[iStatus] || '').trim() || 'aktif' : 'aktif',
    };
  }).filter(r => r.iccid && r.msisdn);
  if (!rows.length) { alert('Geçerli satır bulunamadı.'); return; }
  fetch('/api/lines/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) })
    .then(r => r.json())
    .then(j => {
      if (j.error) throw new Error(j.detail || j.error);
      alert(`İçe aktarma tamam: ${j.created} yeni, ${j.updated} güncellendi${j.errors?.length ? `, ${j.errors.length} hata` : ''}.`);
      loadLines();
    })
    .catch(err => alert('İçe aktarma hatası: ' + err.message));
}

/* ─── Ayarlar (admin) ───────────────────────────────────────────────────────── */
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.status === 403) { $(`#systemStatusBody`).innerHTML = `<tr><td colspan="2" class="loading-cell">Bu sayfa yalnız yöneticiler içindir.</td></tr>`; return; }
    const data = await res.json();
    const th = data.settings?.thresholds || {};
    const setV = (id, v) => { const el = $(`#${id}`); if (el) el.value = v; };
    setV('setLowRam', th.low_ram_gb); setV('setLowDisk', th.low_disk_gb);
    setV('setUptime', th.old_uptime_days); setV('setOffline', th.offline_hours); setV('setStale', th.stale_days);
    setV('setLocDrift', th.location_drift_days);
    setV('setTheme', data.settings?.appearance?.theme || 'auto');
    renderSystemStatus(data.system || {});
    loadLocationSetup(data.system || {});
    loadGeoTable();
    loadImageTable();
    loadAgents();
  } catch (err) {
    $(`#systemStatusBody`).innerHTML = `<tr><td colspan="2" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderSystemStatus(s) {
  const tbody = $(`#systemStatusBody`);
  if (!tbody) return;
  const yn = (b) => b ? '<span class="badge badge--online">yapılandırıldı</span>' : '<span class="badge badge--unknown">yok</span>';
  const rows = [
    ['Sürüm', s.version || '—'],
    ['Ortam', s.node_env || '—'],
    ['Veritabanı', (s.database?.driver || '—')],
    ['Kimlik sağlayıcı', s.auth_provider || '—'],
    ['Döviz kaynağı', s.fx_provider || '—'],
    ['Onay bekleme süresi', (s.approval_ttl_hours != null ? s.approval_ttl_hours + ' saat' : '—')],
    ['Baserow bağlantısı', yn(s.integrations?.baserow)],
    ['Anthropic anahtarı', yn(s.integrations?.anthropic_key)],
    ['n8n bildirim', yn(s.integrations?.n8n_notify)],
    ['LDAP/AD', yn(s.integrations?.ldap)],
    ['Lokasyon token doğrulaması', yn(s.integrations?.location_tokens)],
    ['WORM yedek', s.backup ? (s.backup.in_sync ? '<span class="badge badge--online">senkron</span>' : '<span class="badge badge--offline">senkron değil</span>') : '—'],
  ];
  tbody.innerHTML = rows.map(([k, v]) => `<tr><td style="color:var(--text-muted);width:40%">${k}</td><td class="hostname-cell">${v}</td></tr>`).join('');
}

/* Ayarlar → Lokasyon İzleme kurulum durumu.
   Modül "açık ama görünmez" kalabilir (token yok / beklenen lokasyon tohumlanmamış)
   → bu durumu gizlemek yerine açıkça yaz. */
async function loadLocationSetup(system) {
  const box = $(`#locSetupStatus`);
  if (!box) return;
  try {
    const drift = await fetchLocationDrift();
    const tokensOn = !!system?.integrations?.location_tokens;
    const total = (drift.unassigned || 0) + (drift.count || 0);
    const line = (ok, text) =>
      `<div><span style="color:${ok ? 'var(--green)' : 'var(--yellow)'};font-weight:700">${ok ? '✓' : '!'}</span> ${text}</div>`;

    box.innerHTML =
      line(tokensOn,
        tokensOn
          ? 'Lokasyon token doğrulaması <strong>açık</strong> — ajan bildirimleri doğrulanıyor.'
          : 'Lokasyon token doğrulaması <strong>kapalı</strong> (.env → LOCATION_TOKENS tanımsız). Webhook’tan gelen lokasyon doğrulanmıyor.') +
      line(drift.unassigned === 0,
        drift.unassigned === 0
          ? 'Tüm cihazların beklenen lokasyonu tanımlı.'
          : `<strong>${drift.unassigned}</strong> cihazın beklenen lokasyonu tanımlı değil — sapma taramasının dışındalar.`) +
      line(true, `Sapma eşiği: <strong>${drift.threshold_days} gün</strong> · şu an <strong>${drift.count}</strong> sapma.`);

    const btn = $(`#seedExpectedBtn`);
    if (btn) btn.disabled = drift.unassigned === 0 && total > 0;
  } catch (err) {
    box.innerHTML = `<span style="color:var(--red)">Durum alınamadı: ${escapeHtml(err.message)}</span>`;
  }
}

async function seedExpectedLocations() {
  const msg = $(`#seedMsg`);
  if (!confirm('Her cihazın envanterdeki mevcut lokasyonu, beklenen (resmi) lokasyon olarak kaydedilecek.\n\nBeklenen lokasyon tablosu boş değilse işlem atlanır — mevcut kayıtlar EZİLMEZ.\n\nDevam edilsin mi?')) return;
  try {
    const res = await fetch('/api/location-drift/seed', { method: 'POST' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    if (msg) {
      msg.style.color = j.skipped ? 'var(--yellow)' : 'var(--green)';
      msg.textContent = j.skipped
        ? 'Atlandı — beklenen lokasyonlar zaten tanımlı.'
        : `✓ ${j.count} cihaza beklenen lokasyon atandı.`;
    }
    loadSettings();
  } catch (err) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; }
  }
}

async function saveThresholds() {
  const body = {
    low_ram_gb: $(`#setLowRam`)?.value, low_disk_gb: $(`#setLowDisk`)?.value,
    old_uptime_days: $(`#setUptime`)?.value, offline_hours: $(`#setOffline`)?.value, stale_days: $(`#setStale`)?.value,
    location_drift_days: $(`#setLocDrift`)?.value,
  };
  const msg = $(`#thresholdsMsg`);
  try {
    const res = await fetch('/api/settings/thresholds', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    if (msg) { msg.textContent = '✓ Kaydedildi — yeni eşikler anında geçerli'; setTimeout(() => msg.textContent = '', 3000); }
  } catch (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; } }
}

async function saveAppearance() {
  const theme = $(`#setTheme`)?.value || 'auto';
  applyTheme(theme);
  const msg = $(`#appearanceMsg`);
  try {
    const res = await fetch('/api/settings/appearance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
    if (!res.ok) throw new Error('Hata');
    localStorage.setItem('theme', theme);
    if (msg) { msg.textContent = '✓ Kaydedildi'; setTimeout(() => msg.textContent = '', 3000); }
  } catch (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; } }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme'); // auto → prefers-color-scheme
}

