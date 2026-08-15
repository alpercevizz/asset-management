/* AssetMan · core.js
   Oturum korumasi, state, yardimcilar, API katmani, gorunum gecisi

   NOT: Bu dosya app.js'ten bolundu. ES modul DEGIL - index.html'de
   sirayla yuklenen duz scriptler; global kapsam paylasiliyor.
   Yukleme sirasi index.html'deki <script> siralamasidir. */

/* ─── Oturum: 401 dönerse login sayfasına yönlendir ────────────────────────
   DİKKAT: her 401 "oturum bitti" DEĞİL. Jetonla korunan uçlar da 401 döner
   (süresi dolmuş QR, iptal edilmiş onay, geçersiz imza...). Hepsini oturum
   bitişi sayan bir guard, kullanıcıyı geçerli oturumdayken login'e atardı.
   Sunucu oturum reddini `code: 'UNAUTHORIZED'` ile işaretliyor; yalnız ona
   bakıyoruz. Gövde okunurken KOPYA kullanılır, yoksa çağıran taraf boş
   gövdeyle karşılaşır. */
(function installAuthGuard() {
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await origFetch(...args);
    if (res.status === 401) {
      let oturumBitti = false;
      try {
        const j = await res.clone().json();
        oturumBitti = j && j.code === 'UNAUTHORIZED';
      } catch {
        oturumBitti = true;   // gövde okunamadı: güvenli taraf, oturuma say
      }
      if (oturumBitti) {
        window.location.href = '/login';
        throw new Error('Oturum sonlandı');
      }
    }
    return res;
  };
})();

/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  assets: [],
  licenses: [],
  stats: null,
  sessionId: 'session-' + Date.now(),
  currentView: 'dashboard',
  chatOpen: false,
  categoryFilter: '',
  locationFilter: '',
  // Dashboard v2
  allAssets: [], rawStats: null, rawSummary: null,
  catFilter: new Set(), rangeDays: 30, mapZoom: 1,
  trends: {}, trendSeries: [], seriesOnline: [], seriesOffline: [], seriesDepoda: [],
  locations: {}, critParts: {},
};

/* ─── Utils ─────────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmt(val, fallback = '—') {
  if (val === null || val === undefined || val === '') return fallback;
  return val;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Dashboard tablosu dar kolonda — saat olmadan (tasarım referansı da tarih-only)
function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const CAT_CLASS = {
  'Bilgisayar': 'bilgisayar',
  'Sunucu': 'sunucu',
  'Telefon': 'telefon',
  'El Terminali': 'terminal',
  'Yazıcı': 'yazici',
  'Ağ Aygıtı': 'ag',
  'Çevre Aygıtı': 'cevre',
  'Tablet': 'tablet',
};

function categoryBadge(cat) {
  if (!cat) return '<span style="color:var(--text-muted)">—</span>';
  const cls = CAT_CLASS[cat] || 'diger';
  return `<span class="cat-badge cat-badge--${cls}">${cat}</span>`;
}

function statusBadge(status) {
  const s = (status || 'unknown').toLowerCase();
  if (s === 'online') return `<span class="badge badge--online">online</span>`;
  if (s === 'offline') return `<span class="badge badge--offline">offline</span>`;
  if (s === 'depoda' || s === 'in_storage') return `<span class="badge badge--depoda">depoda</span>`;
  return `<span class="badge badge--unknown">${s}</span>`;
}

function animateCount(el, target) {
  const start = 0;
  const duration = 800;
  const startTime = performance.now();
  const hedef = Number(target) || 0;
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (hedef - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  /* GÜVENCE: requestAnimationFrame arka plan sekmesinde ÇALIŞMAZ. Panel
     arka planda açılırsa (veya kullanıcı yüklenirken sekme değiştirirse)
     animasyon hiç başlamaz ve sayaçlar "—" olarak kalırdı. Süre dolunca
     nihai değer koşulsuz yazılır — animasyon çalıştıysa zaten aynı değer. */
  setTimeout(() => { el.textContent = String(hedef); }, duration + 60);
}

/* ─── API ───────────────────────────────────────────────────────────────── */

/* Tek GET yardımcısı. Altındaki 17 fetch* fonksiyonu aynı üç satırı
   tekrarlıyordu: iste, res.ok denetle, json çöz. İstek biçimi artık tek
   yerde — hata mesajı, JSON çözümü ve ileride eklenecek zaman aşımı/yeniden
   deneme buradan yönetilir.

   NOT: 401 yakalama burada DEĞİL; o, dosyanın başındaki fetch sarmalayıcısında
   (oturum bitince login'e yönlendirme). Bu fonksiyon yalnız HTTP+JSON kabuğu. */
async function apiGet(yol) {
  const res = await fetch(yol);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function fetchAssets(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiGet(`/api/assets${qs ? '?' + qs : ''}`);
}

async function fetchStats() {
  return apiGet('/api/stats');
}

async function fetchLicenses(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return apiGet(`/api/licenses${qs ? '?' + qs : ''}`);
}

async function fetchLicenseStats() {
  return apiGet('/api/licenses/stats');
}

async function fetchAnomalies() {
  return apiGet('/api/anomalies');
}

async function fetchOfflineAlerts() {
  return apiGet('/api/alerts/offline');
}

async function fetchLicenseCompliance() {
  return apiGet('/api/licenses/compliance');
}

async function fetchShadowIT() {
  return apiGet('/api/shadow-it');
}

async function fetchEolOs() {
  return apiGet('/api/eol-os');
}

async function fetchWarranty() {
  return apiGet('/api/warranty');
}

async function fetchLifecycleConflicts() {
  return apiGet('/api/lifecycle/conflicts');
}

async function fetchLifecycleLog(limit = 100) {
  return apiGet(`/api/lifecycle/log?limit=${limit}`);
}

async function fetchLifecycleVerify() {
  return apiGet('/api/lifecycle/verify');
}

async function fetchRiskScores() {
  return apiGet('/api/risk-scores');
}

async function fetchForecast() {
  return apiGet('/api/forecast');
}

async function fetchNetworkScan() {
  return apiGet('/api/network/scan');
}

async function fetchBackupStatus() {
  return apiGet('/api/backup/status');
}

async function postBackupRestore() {
  const res = await fetch('/api/backup/restore', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}

async function postLifecycleEvent(payload) {
  const res = await fetch('/api/lifecycle/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}

// Rapora eklenecek DETERMINISTIK Shadow IT bloğu (kesin format — LLM'e bırakılmaz)
function shadowItReportHtml(data) {
  const items = (data.shadow && data.shadow.items) || [];
  const count = (data.shadow && data.shadow.count) || 0;
  let html = '<h2>Ağ Güvenliği — Shadow IT Taraması</h2>';
  if (count === 0) {
    html += `<p style="color:var(--green);">Ağda resmi envanter kaydı bulunmayan cihaz tespit edilmedi. (${data.total_active || 0} aktif cihaz tarandı)</p>`;
    return html;
  }
  const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  html += `<div class="shadow-alert">`;
  html += `<p class="shadow-warn">[UYARI] Ağda resmi envanter kaydı bulunmayan ${count} adet cihaz tespit edildi.</p>`;
  html += `<ul class="shadow-list">`;
  for (const d of items) {
    const host = d.hostname ? ` (${escape(d.hostname)})` : ' (Hostname bilinmiyor)';
    const vendor = d.vendor ? ` — ${escape(d.vendor)}` : '';
    html += `<li>Detaylar: ${escape(d.ip)} - ${escape(d.mac)}${host}${vendor}</li>`;
  }
  html += `</ul>`;
  html += `<p class="shadow-rec">Öneri: Bu cihazların MAC adreslerini Sophos/Güvenlik duvarı üzerinden izole edin veya resmi envanter kaydını oluşturun.</p>`;
  html += `</div>`;
  return html;
}

// Rapora eklenecek DETERMINISTIK EOL bloğu (kesin format — LLM'e bırakılmaz)
function eolReportHtml(data) {
  const eolItems  = (data.eol && data.eol.items) || [];
  const soonItems = (data.approaching && data.approaching.items) || [];
  let html = '<h2>Güvenlik — Eski İşletim Sistemi (EOL) Taraması</h2>';
  if (eolItems.length === 0 && soonItems.length === 0) {
    html += `<p style="color:var(--green);">Güvenlik desteği biten veya bitmek üzere olan işletim sistemi tespit edilmedi.</p>`;
    return html;
  }
  const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  html += `<div class="shadow-alert">`;
  if (eolItems.length) {
    html += `<p class="shadow-warn">[GÜVENLİK] Üretici güvenlik desteği BİTMİŞ ${eolItems.length} cihaz tespit edildi.</p>`;
    html += `<ul class="shadow-list">`;
    eolItems.forEach(d => html += `<li>${escape(d.hostname)} — ${escape(d.os_family)} (${d.days_past} gün önce EOL oldu)</li>`);
    html += `</ul>`;
    html += `<p class="shadow-rec">Öneri: Bu cihazları güncel ve desteklenen bir işletim sistemine yükseltin; artık güvenlik yaması almıyorlar.</p>`;
  }
  if (soonItems.length) {
    html += `<p class="shadow-warn">180 gün içinde desteği bitecek ${soonItems.length} cihaz:</p>`;
    html += `<ul class="shadow-list">`;
    soonItems.forEach(d => html += `<li>${escape(d.hostname)} — ${escape(d.os_family)} (${d.days_left} gün kaldı)</li>`);
    html += `</ul>`;
  }
  html += `</div>`;
  return html;
}

// Rapora eklenecek DETERMINISTIK Garanti bloğu (kesin format — LLM'e bırakılmaz)
function warrantyReportHtml(data) {
  const expItems  = (data.expired && data.expired.items) || [];
  const soonItems = (data.expiring_soon && data.expiring_soon.items) || [];
  let html = '<h2>Donanım — Garanti Takibi</h2>';
  if (expItems.length === 0 && soonItems.length === 0) {
    html += `<p style="color:var(--green);">Garantisi bitmiş veya yakında bitecek cihaz tespit edilmedi.</p>`;
    return html;
  }
  const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  html += `<div class="shadow-alert">`;
  if (expItems.length) {
    html += `<p class="shadow-warn">[UYARI] Garantisi BİTMİŞ ${expItems.length} cihaz tespit edildi.</p>`;
    html += `<ul class="shadow-list">`;
    expItems.forEach(d => html += `<li>${escape(d.hostname)} — ${escape(d.brand)} ${escape(d.model)} (garanti ${escape(d.warranty_expiry)}, ${d.days_past} gün önce bitti)</li>`);
    html += `</ul>`;
    html += `<p class="shadow-rec">Öneri: Bu cihazlar için garanti uzatma veya yenileme/değişim planı oluşturun.</p>`;
  }
  if (soonItems.length) {
    html += `<p class="shadow-warn">60 gün içinde garantisi bitecek ${soonItems.length} cihaz:</p>`;
    html += `<ul class="shadow-list">`;
    soonItems.forEach(d => html += `<li>${escape(d.hostname)} — ${escape(d.brand)} ${escape(d.model)} (garanti ${escape(d.warranty_expiry)}, ${d.days_left} gün kaldı)</li>`);
    html += `</ul>`;
  }
  html += `</div>`;
  return html;
}

async function sendChat(message) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: state.sessionId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function clearChatSession() {
  await fetch(`/api/chat/${state.sessionId}`, { method: 'DELETE' }).catch(() => {});
  state.sessionId = 'session-' + Date.now();
}

async function loadAiProviderInfo() {
  const badge     = $(`#aiBadge`);
  const badgeText = $(`#aiBadgeText`);
  const chatTitle = $(`#chatProviderTitle`);
  // İsim her zaman AssetMan
  if (chatTitle) chatTitle.textContent = 'AssetMan';

  let online = false;
  try {
    const res = await fetch('/api/health');
    online = res.ok;
  } catch (_) { online = false; }

  // Sunucu çalışıyorsa yeşil, çalışmıyorsa kırmızı ışık (demo: sağlayıcı/model gizli)
  if (online) {
    if (badge) badge.classList.remove('offline');
    if (badgeText) badgeText.textContent = 'AI Agent Çalışıyor';
  } else {
    if (badge) badge.classList.add('offline');
    if (badgeText) badgeText.textContent = 'AI Agent Çalışmıyor';
  }
}

const ROLE_LABEL = { admin: 'Yönetici', it: 'BT Ekibi', approver: 'Onaylayıcı' };

function userInitials(name) {
  const parts = String(name || '').trim().split(/[\s._\-@]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function loadCurrentUser() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const data = await res.json();
    const initials = userInitials(data.user);
    const roleLabel = ROLE_LABEL[data.role] || data.role || '';
    const av = $(`#userAvatar`);
    if (av && data.user) {
      av.textContent = initials;
      av.title = `${data.user} · ${roleLabel}`;
    }
    // Sidebar kullanıcı kartı + hesap menüsü başlığı
    const setTxt = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };
    if (data.user) {
      setTxt('sbUserAv', initials);
      setTxt('sbUserName', data.display || data.user);
      setTxt('sbUserRole', roleLabel);
      setTxt('menuUserName', data.display || data.user);
      setTxt('menuUserRole', roleLabel);
    }
    state.role = data.role;
    rolUygula(data.role);
  } catch (_) { /* sessizce geç */ }
}

/* ─── Rol bazlı arayüz ──────────────────────────────────────────────────────
   BU BİR GÜVENLİK KATMANI DEĞİLDİR. Gerçek yetki denetimi sunucuda
   requireRole() ile yapılır ve orada kalır; buradaki tek amaç, kullanıcıya
   basınca 403 alacağı düğmeyi hiç göstermemek. Tarayıcıdan gizlenen bir
   düğme, isteği elle atmayı engellemez.

   Bildirimsel: kural öğenin YANINDA durur (data-rol="it,admin"). Dağınık
   if'lerle yapılsaydı yeni bir düğme eklendiğinde kuralı eklemeyi unutmak
   kaçınılmazdı; burada attribute yoksa öğe herkese görünür — güvenli varsayılan
   "göster", çünkü gizleme yalnızca konfor.

   'admin' her yeri görür: ayrıca yazmaya gerek kalmasın diye örtük eklenir. */
function rolUygula(rol) {
  const benim = String(rol || '').trim();
  document.querySelectorAll('[data-rol]').forEach((el) => {
    const izinli = el.getAttribute('data-rol').split(',').map((x) => x.trim()).filter(Boolean);
    const gorunur = izinli.includes(benim) || benim === 'admin';
    /* SINIF ile gizleniyor, satır içi style ile DEĞİL: bazı öğelerin görünürlüğünü
       uygulamanın kendi mantığı yönetiyor (örn. yedekten geri yükle düğmesi
       yalnız yedek varsa çıkar). style.display'e yazsaydık o mantıkla kavga
       eder, kısa süreliğine yanlış düğme gösterirdik. */
    el.classList.toggle('rol-yok', !gorunur);
    if (gorunur) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', 'true');
  });
}

/* ─── Views ─────────────────────────────────────────────────────────────── */
function showView(name) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const target = $(`#view-${name}`);
  if (target) target.classList.remove('hidden');

  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  const navItem = $(`.nav-item[data-view="${name}"]`);
  if (navItem) navItem.classList.add('active');

  // Alt sekme çubuğu: doğrudan karşılığı olmayan görünümlerde hiçbiri aktif olmaz
  $$('.tab[data-view]').forEach((t) => t.classList.toggle('active', t.dataset.view === name));

  // Dashboard araç çubuğu (tarih aralığı + Filtrele) YALNIZ dashboard'a aittir;
  // topbar'da mount edildiği için diğer sayfalarda gizlenmeli (Varlıklar'ın kendi
  // filtre çubuğu var, ikisi birden kafa karıştırıyordu).
  const slotEl = document.querySelector('#topbarToolbarSlot');
  if (slotEl) slotEl.style.display = (name === 'dashboard') ? '' : 'none';

  state.currentView = name;
  if (name === 'assets')   renderAssetsTable();
  if (name === 'licenses') loadLicenses();
  if (name === 'lines')    loadLines();
  if (name === 'settings') loadSettings();
  if (name === 'alerts')   loadAlerts();
  if (name === 'lifecycle') loadLifecycle();
  if (name === 'insights') loadInsights();
  if (name === 'locations') loadLocationsView();
  if (name === 'users') loadUsersView();
  if (name === 'reports') loadReports();
  // Operasyon Merkezi tam ekrandır (kenar çubuğu/topbar gizli); diğer sayfalar
  // TV modunda da normal kabuğunu korur.
  document.body.classList.toggle('tv-full', name === 'tv');
  if (name === 'tv') { tvxStart(); } else { tvxStop(); }
}

const RISK_LEVEL_CLASS = { 'Kritik': 'badge--offline', 'Yüksek': 'badge--offline', 'Orta': 'badge--unknown', 'Düşük': 'badge--online' };
function trMoney(n) { return Number(n || 0).toLocaleString('tr-TR') + ' ₺'; }

async function loadInsights() {
  const setLoad = (id, cols) => { const b = $(`#${id}`); if (b) b.innerHTML = `<tr><td colspan="${cols}" class="loading-cell">Yükleniyor...</td></tr>`; };
  setLoad('riskBody', 6); setLoad('fcBody', 6);
  try {
    const [risk, fc] = await Promise.all([
      fetchRiskScores(),
      fetchForecast().catch(() => ({ total_count: 0, total_estimated_cost: 0, overdue_count: 0, by_period: {}, items: [] })),
    ]);

    // Risk özet
    const d = risk.distribution || {};
    const setC = (id, v) => { const el = $(`#${id}`); if (el) animateCount(el, v); };
    setC('riskCritical', d.critical || 0); setC('riskHigh', d.high || 0);
    setC('riskAvg', risk.average_score || 0); setC('riskTotal', risk.total_assets || 0);
    setPill('riskAtRiskPill', risk.at_risk_count || 0);

    // Risk tablosu (skor>0 olanlar; hepsi düşükse en yüksek 15)
    const riskItems = (risk.items || []).filter(i => i.score > 0);
    const shown = riskItems.length ? riskItems : (risk.items || []).slice(0, 15);
    const rb = $('#riskBody');
    if (rb) {
      rb.innerHTML = shown.length ? shown.map(i => {
        const cls = RISK_LEVEL_CLASS[i.level] || 'badge--unknown';
        const factors = (i.factors || []).slice(0, 3).map(f => escapeHtml(f.label)).join(' · ') || '—';
        return `<tr>
          <td><span class="risk-score risk-${i.level === 'Kritik' || i.level === 'Yüksek' ? 'hi' : (i.level === 'Orta' ? 'mid' : 'lo')}">${i.score}</span></td>
          <td><span class="badge ${cls}">${i.level}</span></td>
          <td class="hostname-cell">${fmt(i.hostname)}</td>
          <td>${fmt(i.category)}</td>
          <td>${fmt(i.username)}</td>
          <td style="color:var(--text-muted);font-size:12px;" title="${(i.factors||[]).map(f=>escapeHtml(f.label)).join(' · ')}">${factors}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="6" class="loading-cell" style="color:var(--green,#22c55e)">Riskli cihaz yok ✓</td></tr>`;
    }

    // Öngörü özet (döviz endeksli)
    const ftc = $('#fcTotalCost'); if (ftc) ftc.textContent = trMoney(fc.total_estimated_cost);
    setC('fcCount', fc.total_count || 0); setC('fcOverdue', fc.overdue_count || 0);
    // Döviz kuru bilgisi (canlı parite)
    const fxEl = $('#fcFx');
    if (fxEl && fc.fx) {
      const trend = fc.fx.usd_trend === 'up' ? '▲' : '▼';
      fxEl.innerHTML = `💱 1 USD = <b>${fc.fx.USD_TRY}</b> ₺ ${trend} · 1 EUR = <b>${fc.fx.EUR_TRY}</b> ₺ · ` +
        `Baz: <b>$${(fc.total_estimated_cost_usd || 0).toLocaleString('tr-TR')}</b> · <span style="color:var(--text-muted)">${escapeHtml(fc.fx.source)}</span>`;
    }
    const fp = $('#fcPeriods');
    if (fp) {
      const parts = Object.values(fc.by_period || {}).filter(p => p.count).map(p => `${p.label}: ${p.count} (${trMoney(p.cost)})`);
      fp.innerHTML = parts.length ? parts.join('<br>') : 'Yaklaşan yenileme yok';
    }
    setPill('fcPill', fc.total_count || 0);
    const fb = $('#fcBody');
    if (fb) {
      fb.innerHTML = (fc.items || []).length ? fc.items.map(it => `<tr>
        <td class="hostname-cell">${fmt(it.hostname)}</td>
        <td>${fmt(it.category)}</td>
        <td style="font-size:12px;">${escapeHtml(it.reason)}</td>
        <td>${fmtDate(it.due_date)}</td>
        <td>${it.overdue ? '<span class="badge badge--offline">Gecikmiş</span>' : `<span class="badge badge--unknown">${it.months_left} ay</span>`}</td>
        <td style="font-weight:600;">${trMoney(it.est_cost)}</td>
      </tr>`).join('') : `<tr><td colspan="6" class="loading-cell" style="color:var(--green,#22c55e)">12 ay içinde yenileme gerektiren cihaz yok ✓</td></tr>`;
    }
  } catch (err) {
    console.error('Insights load error:', err);
    const rb = $('#riskBody'); if (rb) rb.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color:#ef4444">${err.message}</td></tr>`;
  }
}

