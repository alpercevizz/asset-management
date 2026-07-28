/* ─── Oturum: 401 dönerse login sayfasına yönlendir ──────────────────────── */
(function installAuthGuard() {
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await origFetch(...args);
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Oturum sonlandı');
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
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── API ───────────────────────────────────────────────────────────────── */
async function fetchAssets(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/assets${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchStats() {
  const res = await fetch('/api/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLicenses(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/licenses${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLicenseStats() {
  const res = await fetch('/api/licenses/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAnomalies() {
  const res = await fetch('/api/anomalies');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchOfflineAlerts() {
  const res = await fetch('/api/alerts/offline');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLicenseCompliance() {
  const res = await fetch('/api/licenses/compliance');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchShadowIT() {
  const res = await fetch('/api/shadow-it');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchEolOs() {
  const res = await fetch('/api/eol-os');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchWarranty() {
  const res = await fetch('/api/warranty');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLifecycleConflicts() {
  const res = await fetch('/api/lifecycle/conflicts');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLifecycleLog(limit = 100) {
  const res = await fetch(`/api/lifecycle/log?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLifecycleVerify() {
  const res = await fetch('/api/lifecycle/verify');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchRiskScores() {
  const res = await fetch('/api/risk-scores');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchForecast() {
  const res = await fetch('/api/forecast');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchNetworkScan() {
  const res = await fetch('/api/network/scan');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBackupStatus() {
  const res = await fetch('/api/backup/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
    // Ayarlar nav'ı yalnız admin'e görünür
    if (data.role === 'admin') {
      const n = $(`#navSettings`); if (n) n.style.display = '';
      const u = $(`#navUsers`);    if (u) u.style.display = '';
    }
  } catch (_) { /* sessizce geç */ }
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

/* ─── Dashboard ─────────────────────────────────────────────────────────── */
async function fetchTrends(days) {
  const res = await fetch('/api/trends?days=' + (days || 30));
  if (!res.ok) throw new Error('Trend alınamadı');
  return res.json();
}

async function fetchLocationSummary() {
  const res = await fetch('/api/location-summary');
  if (!res.ok) throw new Error('Lokasyon özeti alınamadı');
  return res.json();
}

const EMPTY_SUMMARY = {
  total: 0, dogru: 0, tasinmis: 0, guncellenen: 0, bilinmeyen: 0, baseline_yok: 0,
  severity: { kritik: 0, uyari: 0, bilgi: 0 }, locations: {}, location_count: 0, threshold_days: 7,
};

async function loadDashboard() {
  try {
    // Lokasyon/uyarı verileri BAŞARISIZ olsa da çekirdek dashboard çizilir.
    const [assetsData, stats, summary, trendData, lcLog, anomalies, warranty] = await Promise.all([
      fetchAssets({ size: 200 }),
      fetchStats(),
      fetchLocationSummary().catch(() => ({ ...EMPTY_SUMMARY })),
      fetchTrends(state.rangeDays).catch(() => null),
      fetchLifecycleLog(30).catch(() => ({ events: [] })),
      fetchAnomalies().catch(() => ({})),
      fetchWarranty().catch(() => ({})),
    ]);
    state.allAssets = assetsData.results || [];
    state.assets = state.allAssets;
    state.stats = stats;
    state.rawStats = stats;
    state.locSummary = summary;
    state.rawSummary = summary;
    buildCategoryFilter(stats.by_category || {});
    state.trends = trendData?.trends || {};
    state.trendSeries = trendData?.series || [];
    state.seriesOnline = trendData?.series_online || [];
    state.seriesOffline = trendData?.series_offline || [];
    state.seriesDepoda = trendData?.series_depoda || [];

    renderStats(stats, summary);
    renderCategoryDonut(stats.by_category || {}, stats.total || 0);
    applyLocViewMode(summary.locations || {});
    renderMismatch(summary);
    renderLocationStateDonut(summary);
    renderRecentTable(state.assets.slice(0, 5));
    renderActivities(lcLog.events || lcLog.log || []);
    const parts = {
      drift:    summary.tasinmis || 0,
      warranty: warranty.expired?.items?.length || 0,
      uptime:   anomalies.long_uptime?.items?.length || 0,
      disk:     anomalies.low_disk?.items?.length || 0,
      offline:  stats.by_status?.offline || 0,
    };
    state.critParts = parts;
    renderCriticalStrip(parts);
    renderInsight(summary, parts);
    if (document.body.classList.contains('tv-mode')) renderTvDaily();
    if (state.catFilter && state.catFilter.size) applyDashFilter();

    // Eski görünümlerde kalan grafikler (elemanı yoksa sessizce atlanır)
    renderBrandChart(stats.by_brand || {});
    renderCategoryChart(stats.by_category || {});
    renderStatusChart(stats.by_status || {});
    renderLocationChart(state.assets);
  } catch (err) {
    console.error('Dashboard load error:', err);
    const tb = $('tbody#recentBody');
    if (tb) tb.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">Envanter kaynağına bağlanılamadı.</td></tr>`;
  }
}

/* KPI kartları — hepsi GERÇEK veriden; uydurma trend yüzdesi YOK.
   Toplam kart: son 14 günün kümülatif kayıt eğrisi (created_on).
   Durum kartları: toplam içindeki gerçek pay çubuğu. */
/* ═══ TV / duvar ekranı modu ═══════════════════════════════════════════════
   NOT: Ekran GENİŞLİĞİNDEN "bu bir TV" sonucu çıkarılamaz — 4K TV tarayıcıları
   dPR 2 ile 1920 CSS px raporlar, 2560'lık masaüstü monitörler de yaygındır.
   Bu yüzden mod AÇIK BİR TERCİH (topbar düğmesi, localStorage'da saklanır).
   Yalnızca ilk açılışta ≥2200px ise önerilen varsayılan olarak açılır. */
function applyTvMode(on) {
  document.body.classList.toggle('tv-mode', !!on);
  localStorage.setItem('tvMode', on ? '1' : '0');
  const btn = $(`#tvToggle`);
  if (btn) { btn.classList.toggle('active', !!on); btn.title = on ? 'TV modundan çık' : 'TV / duvar ekranı modu'; }
  if (on) { startTvClock(); renderTvDaily(); } else { stopTvClock(); }
}

let _tvClockTimer = null;
function startTvClock() {
  const tick = () => {
    const d = new Date();
    const dEl = $(`#tvDate`), cEl = $(`#tvClock`);
    if (dEl) dEl.textContent = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
    if (cEl) cEl.textContent = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  if (!_tvClockTimer) _tvClockTimer = setInterval(tick, 30000);
}
function stopTvClock() { if (_tvClockTimer) { clearInterval(_tvClockTimer); _tvClockTimer = null; } }

/* AI Günlük Analiz — 4 kutu, hepsi GERÇEK tespitlerden (kural tabanlı, LLM yok) */
function renderTvDaily() {
  const box = $(`#tvDaily`);
  if (!box) return;
  const s = state.locSummary || {};
  const p = state.critParts || {};
  const tiles = [
    { n: s.tasinmis || 0,  t: 'cihaz farklı<br>lokasyonda', tone: 'blue',
      ico: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>' },
    { n: p.warranty || 0,  t: 'garanti süresi<br>bitiyor', tone: 'orange',
      ico: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    { n: p.disk || 0,      t: 'cihazın diski<br>dolu', tone: 'red',
      ico: '<rect x="2" y="7" width="20" height="10" rx="2"/><line x1="6" y1="12" x2="6.01" y2="12"/>' },
    { n: p.offline || 0,   t: `cihaz ${(s.threshold_days || 7)} gündür<br>çevrimdışı`, tone: 'green',
      ico: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>' },
  ];
  box.innerHTML = tiles.map(t => `
    <div class="tvd">
      <span class="tvd-ico kpi-ico--${t.tone}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${t.ico}</svg>
      </span>
      <div><b>${t.n}</b><span>${t.t}</span></div>
    </div>`).join('');
}

/* ═══ Kategori filtresi ═══════════════════════════════════════════════════
   Filtre İSTEMCİDE yeniden hesaplar (sunucuya ek istek yok). Trend rozetleri
   sunucudaki filtresiz anlık görüntülerden gelir → filtre etkinken GİZLENİR,
   yoksa "seçili kategorinin %12 artışı" gibi YANLIŞ bir okuma doğardı. */
function buildCategoryFilter(byCategory) {
  const box = $(`#filterCats`);
  if (!box || box.dataset.built === '1') return;
  const cats = Object.keys(byCategory).sort();
  box.innerHTML = cats.map(c =>
    `<label><input type="checkbox" class="f-cat" value="${escapeHtml(c)}"> ${escapeHtml(c)}</label>`).join('');
  box.dataset.built = '1';
  $$('.f-cat').forEach(cb => cb.addEventListener('change', onCatFilterChange));
}

function onCatFilterChange(e) {
  const all = document.querySelector('.f-cat[value=""]');
  if (e.target === all && all.checked) {
    $$('.f-cat').forEach(cb => { if (cb !== all) cb.checked = false; });
  } else if (e.target !== all) {
    if (all) all.checked = false;
  }
  const sel = new Set($$('.f-cat').filter(cb => cb.checked && cb.value).map(cb => cb.value));
  if (!sel.size && all) all.checked = true;
  state.catFilter = sel;
  applyDashFilter();
}

function applyDashFilter() {
  const sel = state.catFilter;
  const active = sel && sel.size > 0;
  const list = active ? (state.allAssets || []).filter(a => sel.has(a.category || 'Diğer')) : (state.allAssets || []);
  state.assets = list;

  // İstatistikleri seçili kümeden yeniden hesapla
  const byCategory = {}, byStatus = {}, locs = {};
  list.forEach(a => {
    const c = a.category || 'Diğer'; byCategory[c] = (byCategory[c] || 0) + 1;
    const st = a.status || 'unknown'; byStatus[st] = (byStatus[st] || 0) + 1;
    const l = (a.location || '').trim(); if (l) locs[l] = (locs[l] || 0) + 1;
  });
  const stats = active
    ? { total: list.length, by_category: byCategory, by_status: byStatus, new_today: 0 }
    : state.rawStats;
  const summary = active
    ? { ...state.rawSummary, locations: locs, location_count: Object.keys(locs).length }
    : state.rawSummary;

  renderStats(stats, summary);
  renderCategoryDonut(stats.by_category || {}, stats.total || 0);
  applyLocViewMode(active ? locs : (state.rawSummary.locations || {}));
  renderRecentTable(list.slice(0, 5));

  // Filtre etkinken trend rozetleri anlamsız → gizle
  ['kpiTotalTrend', 'kpiOnlineTrend', 'kpiStorageTrend', 'kpiOfflineTrend'].forEach(id => {
    const el = $('#' + id);
    if (el && active) { el.className = 'kpi-trend kpi-trend--none'; el.textContent = 'filtre etkin'; }
  });
  ['kpiTotalSpark', 'kpiOnlineSpark', 'kpiStorageSpark', 'kpiOfflineSpark'].forEach(id => {
    const el = $('#' + id); if (el && active) el.innerHTML = '';
  });
}

// Harita / liste görünümü arasında geçiş (seçim korunur)
function applyLocViewMode(locations) {
  state.locations = locations;
  const sel = $(`#locViewMode`);
  const mode = sel ? sel.value : 'map';
  const mapW = $(`#locMapWrap`), listW = $(`#locListWrap`);
  if (mapW) mapW.classList.toggle('hidden', mode !== 'map');
  if (listW) listW.classList.toggle('hidden', mode === 'map');
  if (mode === 'map') renderLocationMap(locations); else renderLocationList(locations);
}

/* KPI trend rozeti — GERÇEK anlık görüntü verisinden.
   Karşılaştıracak geçmiş yoksa oran GÖSTERİLMEZ ("veri birikiyor") — sıfır uydurulmaz. */
function renderTrend(id, t, windowDays) {
  const el = $('#' + id);
  if (!el) return;
  if (!t) {
    el.className = 'kpi-trend kpi-trend--none';
    el.textContent = 'trend için veri birikiyor';
    return;
  }
  const arrow = t.dir === 'up' ? '↑' : (t.dir === 'down' ? '↓' : '→');
  const period = windowDays >= 365 ? 'bu yıl' : (windowDays >= 30 ? 'bu ay' : `${windowDays} günde`);
  el.className = `kpi-trend kpi-trend--${t.dir === 'flat' ? 'flat' : t.dir}`;
  el.textContent = `${arrow} %${Math.abs(t.pct)} ${period}`;
}

/* Sparkline — gerçek günlük serilerden (yoksa çizilmez) */
function sparkFromSeries(id, series, color) {
  const el = $('#' + id);
  if (!el) return;
  const pts = (series || []).map(p => p.value);
  if (pts.length < 4) { el.innerHTML = ''; return; }
  const min = Math.min(...pts), max = Math.max(...pts);
  const W = 78, H = 30;
  const y = (v) => max === min ? H / 2 : H - ((v - min) / (max - min)) * (H - 6) - 3;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderStats(stats, summary) {
  const locEl = $(`#kpiLocations`);
  if (locEl) animateCount(locEl, summary?.location_count || 0);
  const total   = stats.total || 0;
  const online  = stats.by_status?.online  || 0;
  const storage = stats.by_status?.depoda  || 0;
  const offline = stats.by_status?.offline || 0;

  const set = (id, val) => { const el = $('#' + id); if (el) animateCount(el, val); };
  set('kpiTotal', total); set('kpiOnline', online);
  set('kpiStorage', storage); set('kpiOffline', offline);

  // Trend + sparkline: /api/trends'ten gelen GERÇEK anlık görüntülerden
  const tr = state.trends || {};
  const win = tr.window_days || 30;
  renderTrend('kpiTotalTrend',   tr.total,   win);
  renderTrend('kpiOnlineTrend',  tr.online,  win);
  renderTrend('kpiStorageTrend', tr.depoda,  win);
  renderTrend('kpiOfflineTrend', tr.offline, win);

  const series = state.trendSeries || [];
  sparkFromSeries('kpiTotalSpark',   series, 'rgba(255,255,255,.9)');
  sparkFromSeries('kpiOnlineSpark',  state.seriesOnline  || [], '#10b981');
  sparkFromSeries('kpiStorageSpark', state.seriesDepoda  || [], '#f59e0b');
  sparkFromSeries('kpiOfflineSpark', state.seriesOffline || [], '#ef4444');
}

// Toplam içindeki payı gösteren ince çubuk (gerçek oran)
function shareBar(id, pct, color) {
  const el = $('#' + id);
  if (!el) return;
  el.innerHTML = `<svg width="84" height="10" viewBox="0 0 84 10">
    <rect x="0" y="3" width="84" height="4" rx="2" fill="var(--bg-hover)"/>
    <rect x="0" y="3" width="${(Math.max(0, Math.min(100, pct)) / 100) * 84}" height="4" rx="2" fill="${color}"/>
  </svg>`;
}

// Son 14 günün kümülatif envanter büyümesi — created_on alanından hesaplanır
function growthSpark(id, assets) {
  const el = $('#' + id);
  if (!el) return;
  const STEPS = 14;
  const dates = (assets || [])
    .map(a => Date.parse(a.created_on || a.last_seen || ''))
    .filter(t => !Number.isNaN(t));
  if (dates.length < 3) { el.innerHTML = ''; return; }
  // Tüm kayıtlar 1-3 güne sıkışmışsa eğri "L" şeklinde bozuk çıkar → hiç çizme.
  const distinctDays = new Set(dates.map(t => Math.floor(t / 86400000))).size;
  if (distinctDays < 4) { el.innerHTML = ''; return; }
  // Zaman aralığı veriye göre uyarlanır: ilk kayıttan bugüne 14 eşit örnek.
  // Sabit 14 günlük pencere eski envanterlerde düz çizgi verirdi.
  const end = Date.now();
  const start = Math.min(...dates);
  if (end - start < 86400000) { el.innerHTML = ''; return; }
  const pts = [];
  for (let i = 0; i < STEPS; i++) {
    const cut = start + ((end - start) * i) / (STEPS - 1);
    pts.push(dates.filter(t => t <= cut).length);
  }
  const min = Math.min(...pts), max = Math.max(...pts);
  if (max === min) { el.innerHTML = ''; return; }
  const W = 84, H = 30;
  const d = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((v - min) / (max - min)) * (H - 4) - 2;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="İlk kayıttan bugüne envanter büyümesi">
    <path d="${d}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ═══ Lokasyon haritası ═══════════════════════════════════════════════════
   Harici harita kütüphanesi YOK (kapalı devre/CSP kısıtı). Basitleştirilmiş
   Türkiye sınırı + il koordinatları, aynı projeksiyonla çizilir → balonlar
   gerçek coğrafi konuma oturur. Eşleşmeyen lokasyon adları "Diğer"e düşer. */
const TR_CITIES = {
  'istanbul': [41.01, 28.98], 'ankara': [39.93, 32.86], 'izmir': [38.42, 27.14],
  'bursa': [40.19, 29.06], 'antalya': [36.90, 30.70], 'adana': [37.00, 35.32],
  'konya': [37.87, 32.48], 'gaziantep': [37.07, 37.38], 'kocaeli': [40.85, 29.88],
  'izmit': [40.77, 29.92], 'kayseri': [38.73, 35.49], 'samsun': [41.29, 36.33],
  'trabzon': [41.00, 39.72], 'erzurum': [39.90, 41.27], 'diyarbakir': [37.91, 40.24],
  'van': [38.49, 43.38], 'eskisehir': [39.78, 30.52], 'mersin': [36.80, 34.63],
  'denizli': [37.78, 29.09], 'sakarya': [40.78, 30.40], 'tekirdag': [40.98, 27.51],
  'balikesir': [39.65, 27.89], 'manisa': [38.62, 27.43], 'hatay': [36.20, 36.16],
  'malatya': [38.35, 38.31], 'sivas': [39.75, 37.02], 'aydin': [37.85, 27.84],
  'mugla': [37.22, 28.36], 'ordu': [40.98, 37.88], 'zonguldak': [41.45, 31.79],
};
/* Sınır noktaları (lon, lat). İki parça: Anadolu + Trakya (Marmara arada kalsın
   diye ayrı çizilir — tek poligonda Türkiye tanınmaz bir bloba dönüşüyordu). */
const TR_ANATOLIA = [
  [29.05,41.20],[29.50,41.15],[31.40,41.10],[32.30,41.75],[33.40,42.00],[35.15,42.08],
  [36.30,41.35],[37.90,41.02],[39.50,41.10],[40.50,41.20],[41.55,41.52],[42.80,41.55],
  [43.45,41.20],[43.60,40.60],[43.70,40.02],[44.80,39.65],[44.35,39.40],[44.05,39.38],
  [44.30,38.35],[44.50,37.75],[44.00,37.30],[42.80,37.32],[42.35,37.25],[41.30,37.10],
  [40.20,36.90],[39.00,36.70],[38.20,36.90],[37.00,36.65],[36.60,36.20],[36.15,35.85],
  [35.90,36.25],[35.50,36.60],[34.90,36.75],[34.00,36.30],[33.00,36.15],[32.00,36.10],
  [31.00,36.25],[30.60,36.25],[30.35,36.32],[29.70,36.15],[29.00,36.50],[28.20,36.65],
  [27.40,36.72],[27.25,37.10],[27.90,37.35],[27.25,37.70],[26.35,38.15],[26.90,38.42],
  [26.40,38.62],[26.70,38.88],[26.20,39.50],[26.15,39.92],[26.70,40.40],[27.50,40.35],
  [28.60,40.40],[29.30,40.75],
];
const TR_THRACE = [
  [26.05,41.35],[26.35,41.72],[27.00,42.05],[28.00,41.75],[28.90,41.22],
  [28.60,41.02],[27.50,40.98],[26.90,40.62],[26.20,40.62],
];
const MAP_W = 560, MAP_H = 300;
const LON0 = 25.4, LON1 = 45.6, LAT0 = 35.6, LAT1 = 42.6;
const projX = (lon) => ((lon - LON0) / (LON1 - LON0)) * MAP_W;
const projY = (lat) => ((LAT1 - lat) / (LAT1 - LAT0)) * MAP_H;

/* Aksanları sadeleştirip şehir adı ara ("İstanbul Depo A" → istanbul).
   DİKKAT: 'İ'.toLowerCase() → 'i' + U+0307 (birleşik nokta) üretir; düz replace
   zinciri bunu yakalamaz ve İstanbul HİÇ eşleşmez. NFD ile ayrıştırıp birleşik
   işaretleri atmak tek güvenli yol ('ş','ğ','ü','ö','ç' de böyle sadeleşir).
   'ı' ayrışmaz → ayrıca değiştirilir. */
function trSlug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');
}
function cityKey(name) {
  const s = trSlug(name);
  for (const key of Object.keys(TR_CITIES)) if (s.includes(key)) return key;
  return null;
}

function renderLocationMap(locations) {
  const svg = $(`#locMap`), legend = $(`#locMapLegend`);
  if (!svg || !legend) return;
  const entries = Object.entries(locations || {});
  if (!entries.length) {
    svg.innerHTML = '';
    legend.innerHTML = '<p class="map-empty">Lokasyon verisi yok</p>';
    return;
  }

  // Şehir bazında topla (aynı şehirdeki birden çok depo tek balon olur)
  const byCity = {}; const unknown = [];
  entries.forEach(([loc, n]) => {
    const key = cityKey(loc);
    if (key) (byCity[key] = byCity[key] || { n: 0, names: [] }), byCity[key].n += n, byCity[key].names.push(loc);
    else unknown.push([loc, n]);
  });

  const toPath = (pts) => pts.map(([lon, lat], i) =>
    `${i ? 'L' : 'M'}${projX(lon).toFixed(1)} ${projY(lat).toFixed(1)}`).join(' ') + ' Z';
  const path = toPath(TR_ANATOLIA) + ' ' + toPath(TR_THRACE);

  const sorted = Object.entries(byCity).sort((a, b) => b[1].n - a[1].n);
  const max = Math.max(1, ...sorted.map(([, v]) => v.n));
  const colorOf = (i) => DONUT_COLORS[i % DONUT_COLORS.length];

  // Etiketler: balon yeterince büyükse sayı İÇİNE, şehir adı ÜSTÜNE yazılır
  // (tasarım referansı). Küçük balonlarda yazı okunmaz → yalnız nokta kalır.
  const bubbles = sorted.map(([key, v], i) => {
    const [lat, lon] = TR_CITIES[key];
    const r = (7 + Math.sqrt(v.n / max) * 22) * (state.mapZoom || 1); // alan ~ adet
    const c = colorOf(i);
    const x = +projX(lon).toFixed(1), y = +projY(lat).toFixed(1);
    const ad = key.charAt(0).toUpperCase() + key.slice(1);
    const buyuk = r >= 13;
    return `<circle class="map-bubble" cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${c}" stroke="${c}">
        <title>${escapeHtml(v.names.join(', '))} — ${v.n} cihaz</title></circle>` +
      (buyuk
        ? `<text class="map-count" x="${x}" y="${y + 4}" fill="#fff">${v.n}</text>
           <text class="map-city" x="${x}" y="${(y - r - 7).toFixed(1)}">${escapeHtml(ad)}</text>`
        : `<circle class="map-dot" cx="${x}" cy="${y}" r="2.5" fill="${c}"/>
           <text class="map-city map-city--sm" x="${x}" y="${(y - r - 5).toFixed(1)}">${escapeHtml(ad)}</text>`);
  }).join('');

  svg.innerHTML = `<path class="map-land" d="${path}"/>${bubbles}`;

  const unknownTotal = unknown.reduce((a, [, n]) => a + n, 0);
  legend.innerHTML =
    sorted.slice(0, 4).map(([key, v], i) =>
      `<span><i style="background:${colorOf(i)}"></i>${key.charAt(0).toUpperCase() + key.slice(1)} (${v.n})</span>`).join('') +
    (unknownTotal ? `<span><i style="background:var(--text-muted)"></i>Diğer (${unknownTotal})</span>` : '');
}

function renderLocationList(locations) {
  const box = $(`#locListWrap`);
  if (!box) return;
  const entries = Object.entries(locations || {}).sort((a, b) => b[1] - a[1]);
  const sum = entries.reduce((a, [, n]) => a + n, 0) || 1;
  box.innerHTML = entries.length ? entries.map(([loc, n], i) => `
    <div class="dl-row">
      <span class="dl-name" title="${escapeHtml(loc)}">
        <span class="dl-dot" style="background:${donutColor(loc, i)}"></span>${escapeHtml(loc)}
      </span>
      <span class="dl-pct">${Math.round((n / sum) * 100)}%</span>
      <span class="dl-count">${n}</span>
    </div>`).join('')
    : '<p class="map-empty">Lokasyon verisi yok</p>';
}

/* ─── Donut grafikler ───────────────────────────────────────────────────── */
const DONUT_COLORS = ['#4f46e5', '#10b981', '#a855f7', '#ef4444', '#f59e0b', '#14b8a6', '#6366f1', '#94a3b8'];
const DONUT_MUTED = '#94a3b8'; // "Diğer"/"Belirtilmemiş" toplayıcı dilimler nötr kalır
const donutColor = (label, i) =>
  LOC_STATE_COLORS[label] ||
  ((label === 'Diğer' || label === 'Belirtilmemiş') ? DONUT_MUTED : DONUT_COLORS[i % DONUT_COLORS.length]);

// entries: [[etiket, adet], ...] — tek SVG'de dash-offset ile dilimlenmiş halka
function paintDonut(svgId, legendId, totalId, entries, centerValue, emptyText) {
  const svg = $('#' + svgId), legend = $('#' + legendId), totalEl = $('#' + totalId);
  if (!svg || !legend) return;
  const sum = entries.reduce((a, [, n]) => a + n, 0);
  if (totalEl) totalEl.textContent = (centerValue ?? sum).toLocaleString('tr-TR');
  if (!sum) {
    svg.innerHTML = `<circle cx="60" cy="60" r="42" fill="none" stroke="var(--bg-hover)" stroke-width="18"/>`;
    legend.innerHTML = `<p style="color:var(--text-muted);font-size:13px">${emptyText}</p>`;
    return;
  }
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  svg.innerHTML = entries.map(([label, n], i) => {
    const len = (n / sum) * C;
    const seg = `<circle class="donut-seg" cx="60" cy="60" r="${R}" fill="none"
      stroke="${donutColor(label, i)}" stroke-width="18"
      stroke-dasharray="${len - 1.5} ${C - len + 1.5}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
    return seg;
  }).join('');

  legend.innerHTML = entries.map(([label, n], i) => `
    <div class="dl-row">
      <span class="dl-name" title="${escapeHtml(label)}">
        <span class="dl-dot" style="background:${donutColor(label, i)}"></span>${escapeHtml(label)}
      </span>
      <span class="dl-pct">${Math.round((n / sum) * 100)}%</span>
      <span class="dl-count">${n.toLocaleString('tr-TR')}</span>
    </div>`).join('');
}

/* Lokasyon durumu efsanesi tasarımdaki "1.210 (97%)" biçiminde tek sütun */
function paintDonutCombined(svgId, legendId, totalId, entries, centerValue, emptyText) {
  paintDonut(svgId, legendId, totalId, entries, centerValue, emptyText);
  const legend = $('#' + legendId);
  if (!legend) return;
  const sum = entries.reduce((a, [, n]) => a + n, 0);
  if (!sum) return;
  legend.innerHTML = entries.map(([label, n], i) => `
    <div class="dl-row dl-row--combined">
      <span class="dl-name" title="${escapeHtml(label)}">
        <span class="dl-dot" style="background:${donutColor(label, i)}"></span><span class="dl-txt">${escapeHtml(label)}</span>
      </span>
      <span class="dl-count">${n.toLocaleString('tr-TR')} <span class="dl-pct">(${Math.round((n / sum) * 100)}%)</span></span>
    </div>`).join('');
}

function renderCategoryDonut(byCategory, total) {
  // İlk 5 kategori + kalanı "Diğer" altında topla (efsane okunur kalsın)
  const all = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const top = all.slice(0, 5);
  const restSum = all.slice(5).reduce((a, [, n]) => a + n, 0);
  if (restSum) top.push(['Diğer', restSum]);
  paintDonut('catDonut', 'catLegend', 'catDonutTotal', top, total, 'Kategori verisi yok');
}

/* ═══ Lokasyon uyumsuzluğu — şiddet dağılımı ══════════════════════════════
   Şiddet SÜREDEN türer (uydurma ağırlık yok): kritik ≥30 gün · uyarı eşik-30 ·
   bilgilendirme eşik altı (henüz uyarı üretmeyen taze sapmalar). */
function renderMismatch(summary) {
  const sev = summary.severity || {};
  const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = `${v} cihaz`; };
  set('sevKritik', sev.kritik || 0);
  set('sevUyari', sev.uyari || 0);
  set('sevBilgi', sev.bilgi || 0);
  setPill('mismatchPill', summary.tasinmis || 0);

  // Kapsam dürüstlüğü: baseline'ı olmayan cihazlar bu tabloda GÖRÜNMEZ.
  const note = $(`#sevNote`);
  if (note) {
    note.textContent = summary.baseline_yok > 0
      ? `${summary.baseline_yok} cihazın beklenen lokasyonu tanımlı değil — bu tablonun dışındalar. Ayarlar → Lokasyon İzleme'den tanımlayın.`
      : `Eşik: ${summary.threshold_days} gün. Kritik = 30+ gündür yerinde değil.`;
  }
}

/* Varlık lokasyon durumu — her cihaz TEK kovada, toplam = envanter */
function renderLocationStateDonut(summary) {
  const entries = [
    ['Doğru Lokasyonda', summary.dogru || 0],
    ['Taşınmış', summary.tasinmis || 0],
    ['Lokasyonu Güncellenen', summary.guncellenen || 0],
    ['Baseline Yok', summary.baseline_yok || 0],
    ['Bilinmeyen', summary.bilinmeyen || 0],
  ].filter(([, n]) => n > 0);
  paintDonutCombined('locStateDonut', 'locStateLegend', 'locStateTotal', entries, summary.total, 'Lokasyon verisi yok');
}

const LOC_STATE_COLORS = {
  'Doğru Lokasyonda': '#10b981', 'Taşınmış': '#f59e0b',
  'Lokasyonu Güncellenen': '#4f46e5', 'Baseline Yok': '#94a3b8', 'Bilinmeyen': '#ef4444',
};

/* ═══ Son aktiviteler — yaşam döngüsü kayıtlarından (gerçek olaylar) ═══════ */
const ACT_ICON = {
  'Lokasyon Değişikliği': ['blue', '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'],
  'Bakımda': ['orange', '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'],
  'Hurdaya Ayrıldı': ['red', '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'],
  'Kayıp': ['red', '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'],
};
const ACT_DEFAULT = ['green', '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'];

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} saat önce`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} gün önce` : fmtDate(iso);
}

function renderActivities(events, hedef = 'activityList') {
  const box = $('#' + hedef);
  if (!box) return;
  const list = (events || []).slice(-5).reverse();
  if (!list.length) { box.innerHTML = '<p class="map-empty">Henüz kayıtlı işlem yok</p>'; return; }
  box.innerHTML = list.map((e) => {
    const [tone, icon] = ACT_ICON[e.to_status] || ACT_DEFAULT;
    const who = e.hostname || e.serial_number || 'Cihaz';
    return `<div class="act-item">
      <span class="act-ico kpi-ico--${tone}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      </span>
      <span class="act-txt">
        <strong>${escapeHtml(who)} — ${escapeHtml(e.to_status || '')}</strong>
        <span>${escapeHtml(e.note || e.actor || '')}</span>
      </span>
      <span class="act-time">${timeAgo(e.timestamp)}</span>
    </div>`;
  }).join('');
}

/* ═══ Kritik uyarı şeridi — mevcut tespit modüllerinden ═══════════════════ */
function renderCriticalStrip(parts) {
  const box = $(`#critStrip`);
  if (!box) return;
  const chips = [
    { n: parts.drift,    t: 'Lokasyon Dışı Cihazlar', tone: 'red',    view: 'alerts' },
    { n: parts.warranty, t: 'Garanti Süresi Dolan',   tone: 'orange', view: 'alerts' },
    { n: parts.uptime,   t: 'Yeniden Başlatma Gerekli', tone: 'orange', view: 'alerts' },
    { n: parts.disk,     t: 'Disk Alanı Düşük',       tone: 'red',    view: 'alerts' },
  ];
  setPill('critPill', chips.reduce((a, c) => a + c.n, 0));
  box.innerHTML = chips.map(c => `
    <button class="crit-chip" data-view="${c.view}">
      <span class="sev-ico sev-ico--${c.tone}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </span>
      <div><strong>${c.t}</strong><span>${c.n} cihaz</span></div>
    </button>`).join('');
}

/* ═══ Öneri — KURAL TABANLI, LLM ÇAĞRISI YOK ══════════════════════════════
   Dashboard açılışında LLM çağırmak yavaş + küçük modelde bozuk TR üretiyor
   (bkz. deterministik tespit kararı). En yüksek etkili sinyal seçilip
   sabit metinle sunulur — sayılar gerçek, cümle uydurma değil. */
function renderInsight(summary, parts) {
  const el = $(`#insightText`), btn = $(`#insightBtn`);
  if (!el) return;
  let msg, go = null;
  if (summary.baseline_yok > 0) {
    msg = `${summary.baseline_yok} cihazın beklenen lokasyonu tanımlı değil; bu cihazlar sapma taramasının dışında kalıyor. Ayarlar → Lokasyon İzleme'den mevcut lokasyonları başlangıç olarak alabilirsiniz.`;
    go = 'settings';
  } else if ((summary.severity?.kritik || 0) > 0) {
    msg = `${summary.severity.kritik} cihaz 30 günden uzun süredir ait olduğu lokasyonun dışında. Transferi resmileştirin veya cihazları yerine iade ettirin.`;
    go = 'alerts';
  } else if (summary.tasinmis > 0) {
    msg = `${summary.tasinmis} cihaz farklı lokasyonda görülüyor. Lokasyonlarını güncellemenizi öneririz.`;
    go = 'alerts';
  } else if (parts.warranty > 0) {
    msg = `${parts.warranty} cihazın garanti süresi dolmuş. Yenileme bütçesi için Risk & Öngörü ekranına bakın.`;
    go = 'insights';
  } else if (summary.bilinmeyen > 0) {
    msg = `${summary.bilinmeyen} cihazın lokasyon bilgisi hiç yok. Lokasyon ajanı kurulumu veya QR kaydıyla bu boşluk kapanır.`;
    go = 'assets';
  } else {
    msg = 'Lokasyon uyumu tam — tüm cihazlar ait olduğu yerde görünüyor.';
  }
  el.textContent = msg;
  if (btn) {
    btn.style.display = go ? '' : 'none';
    btn.onclick = go ? () => showView(go) : null;
  }
}

function renderLocationDonut(assets) {
  const counts = {};
  (assets || []).forEach((a) => {
    const loc = (a.location || '').trim() || 'Belirtilmemiş';
    counts[loc] = (counts[loc] || 0) + 1;
  });
  const all = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = all.slice(0, 5);
  const restSum = all.slice(5).reduce((a, [, n]) => a + n, 0);
  if (restSum) top.push(['Diğer', restSum]);
  paintDonut('locDonut', 'locLegend', 'locDonutTotal', top, all.length, 'Lokasyon verisi yok');
}

function renderBrandChart(byBrand) {
  const entries = Object.entries(byBrand).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = entries[0]?.[1] || 1;
  const container = $(`#brandBars`);
  if (!container) return;
  container.innerHTML = entries
    .map(([brand, count]) => `
      <div class="bar-row">
        <span class="bar-label" title="${brand}">${brand}</span>
        <div class="bar-track"><div class="bar-fill" style="width:0%" data-pct="${Math.round((count/max)*100)}"></div></div>
        <span class="bar-count">${count}</span>
      </div>`)
    .join('') || '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';

  // Animate bars
  setTimeout(() => {
    container.querySelectorAll('.bar-fill').forEach((el) => {
      el.style.width = el.dataset.pct + '%';
    });
  }, 100);
}

function renderCategoryChart(byCategory) {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = entries[0]?.[1] || 1;
  const container = $(`#categoryBars`);
  if (!container) return;
  container.innerHTML = entries
    .map(([cat, count]) => {
      const cls = CAT_CLASS[cat] || 'diger';
      return `
        <div class="bar-row">
          <span class="bar-label" title="${cat}">${cat}</span>
          <div class="bar-track"><div class="bar-fill cat-bar cat-bar--${cls}" style="width:0%" data-pct="${Math.round((count/max)*100)}"></div></div>
          <span class="bar-count">${count}</span>
        </div>`;
    })
    .join('') || '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';

  setTimeout(() => {
    container.querySelectorAll('.cat-bar').forEach((el) => {
      el.style.width = el.dataset.pct + '%';
    });
  }, 100);
}

function renderStatusChart(byStatus) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  const container = $(`#statusRings`);
  if (!container) return;
  const items = [
    { key: 'online', label: 'Cevrimici', cls: 'online' },
    { key: 'offline', label: 'Cevrimdisi', cls: 'offline' },
    { key: 'unknown', label: 'Bilinmiyor', cls: 'unknown' },
  ];
  container.innerHTML = items.map(({ key, label, cls }) => {
    const count = byStatus[key] || 0;
    const pct = Math.round((count / total) * 100);
    return `
      <div class="ring-row">
        <span class="ring-dot ring-dot--${cls}"></span>
        <div class="ring-info">
          <div style="display:flex;justify-content:space-between;"><span class="ring-name">${label}</span><span style="font-size:12px;color:var(--text-muted)">${count}</span></div>
          <div class="ring-track"><div class="ring-fill ring-fill--${cls}" style="width:0%" data-pct="${pct}"></div></div>
        </div>
        <span class="ring-pct">${pct}%</span>
      </div>`;
  }).join('');

  setTimeout(() => {
    container.querySelectorAll('.ring-fill').forEach((el) => { el.style.width = el.dataset.pct + '%'; });
  }, 100);
}

function renderLocationChart(assets) {
  const container = $(`#locationBars`);
  if (!container) return;
  const counts = {};
  (assets || []).forEach((a) => {
    const loc = (a.location || '').trim() || 'Belirtilmemiş';
    counts[loc] = (counts[loc] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = entries[0]?.[1] || 1;
  const totalEl = $(`#locationTotal`);
  if (totalEl) totalEl.textContent = `${entries.length} lokasyon`;
  container.innerHTML = entries.length ? entries
    .map(([loc, count]) => `
      <div class="bar-row">
        <span class="bar-label" title="${escapeHtml(loc)}">${escapeHtml(loc)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:0%" data-pct="${Math.round((count/max)*100)}"></div></div>
        <span class="bar-count">${count}</span>
      </div>`).join('')
    : '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';
  setTimeout(() => {
    container.querySelectorAll('.bar-fill').forEach((el) => { el.style.width = el.dataset.pct + '%'; });
  }, 100);
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

/* ─── Turkcell Hat / SIM Yönetimi ───────────────────────────────────────────── */
let _lines = [];
const LINE_STATUS_CLS = { aktif: 'badge--online', pasif: 'badge--unknown', iptal: 'badge--offline' };

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
    setC('lineTotal', s.total || 0); setC('lineAssigned', s.assigned || 0); setC('lineUnassigned', s.unassigned || 0);
    const cnt = $(`#lineCount`); if (cnt) cnt.textContent = `${s.total || 0} hat · ${s.assigned || 0} telefona bağlı`;
    renderLinesTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderLinesTable() {
  const tbody = $(`#linesBody`);
  if (!tbody) return;
  if (!_lines.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Kayıtlı hat yok. "Hat Ekle" veya "CSV İçe Aktar" ile başlayın.</td></tr>`;
    return;
  }
  const stCls = (st) => LINE_STATUS_CLS[st] || 'badge--unknown';
  tbody.innerHTML = _lines.map((l) => `
    <tr>
      <td class="hostname-cell">${fmt(l.msisdn)}</td>
      <td class="serial-cell">${fmt(l.iccid)}</td>
      <td>${fmt(l.operator)}</td>
      <td>${fmt(l.tariff)}</td>
      <td><span class="badge ${stCls(l.status)}">${fmt(l.status)}</span></td>
      <td>${l.assigned_hostname ? `<span class="hostname-cell">${escapeHtml(l.assigned_hostname)}</span>` : '<span style="color:var(--text-muted)">boşta</span>'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-icon line-assign" data-id="${l.id}" title="Telefona ata" style="display:inline-flex">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
        </button>
        ${l.assigned_asset_id ? `<button class="btn-icon line-release" data-id="${l.id}" title="Telefondan çıkar" style="display:inline-flex;margin-left:4px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
        </button>` : ''}
        <button class="btn-icon line-history" data-id="${l.id}" title="Geçmiş" style="display:inline-flex;margin-left:4px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.line-assign').forEach(b => b.addEventListener('click', () => assignLinePrompt(Number(b.dataset.id))));
  tbody.querySelectorAll('.line-release').forEach(b => b.addEventListener('click', () => releaseLineAction(Number(b.dataset.id))));
  tbody.querySelectorAll('.line-history').forEach(b => b.addEventListener('click', () => showLineHistory(Number(b.dataset.id))));
}

function openLineModal() {
  ['lineMsisdn', 'lineIccid', 'lineTariff'].forEach(id => { const el = $(`#${id}`); if (el) el.value = ''; });
  const op = $(`#lineOperator`); if (op) op.value = 'Turkcell';
  $(`#lineModalOverlay`)?.classList.add('open');
}

async function saveLine() {
  const body = {
    msisdn: $(`#lineMsisdn`)?.value.trim(),
    iccid: $(`#lineIccid`)?.value.trim(),
    operator: $(`#lineOperator`)?.value.trim() || 'Turkcell',
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

/* ─── Cihaz Detay & Geçmiş Modalı ───────────────────────────────────────────── */
let _deviceModalAsset = null;

function openDeviceModal(asset) {
  _deviceModalAsset = asset;
  const overlay = $(`#deviceModalOverlay`);
  const title = $(`#deviceModalTitle`);
  const body = $(`#deviceModalBody`);
  if (!overlay || !body) return;
  if (title) title.textContent = asset.hostname || asset.serial_number || 'Cihaz Detayı';

  const row = (label, val) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span style="color:var(--text-muted)">${label}</span>
      <span style="color:var(--text);font-weight:500;text-align:right">${val}</span></div>`;

  body.innerHTML = `
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${categoryBadge(asset.category)} ${statusBadge(asset.status)}
      ${asset.location ? `<span class="location-tag">${escapeHtml(asset.location)}</span>` : ''}
    </div>
    <div style="margin-bottom:18px">
      ${row('Marka / Model', `${fmt(asset.brand)} ${fmt(asset.model, '')}`)}
      ${row('Seri No', `<span class="serial-cell">${fmt(asset.serial_number)}</span>`)}
      ${row('Son gören kullanıcı (telemetri)', fmt(asset.username, '—'))}
      ${row('CPU', fmt(asset.cpu))}
      ${row('RAM / Disk', `${asset.ram_gb ? asset.ram_gb + ' GB' : '—'} / ${asset.storage_gb ? asset.storage_gb + ' GB' : '—'}`)}
      ${row('IP / MAC', `<span class="serial-cell">${fmt(asset.ip_address)} · ${fmt(asset.mac_address)}</span>`)}
      ${row('İşletim Sistemi', fmt(asset.os))}
      ${row('Son Görülme', fmtDate(asset.last_seen))}
    </div>
    <div id="deviceAssignBox" style="margin-bottom:18px"></div>
    <div id="deviceLocationBox" style="margin-bottom:18px"></div>
    ${asset.category === 'Telefon' ? '<div id="deviceLineBox" style="margin-bottom:18px"></div>' : ''}
    <h4 style="font-size:13px;font-weight:600;margin:0 0 10px;color:var(--text)">Yaşam Döngüsü Geçmişi</h4>
    <div id="deviceHistory" style="font-size:12.5px;color:var(--text-muted)">Yükleniyor...</div>`;

  const pdfBtn = $(`#handoverPdfBtn`); if (pdfBtn) pdfBtn.style.display = '';
  overlay.classList.add('open');
  loadDeviceHistory(asset);
  loadDeviceAssignment(asset);
  loadDeviceLocation(asset);
  if (asset.category === 'Telefon' && asset.id != null) loadDeviceLine(asset.id);
}

/* Cihaz modalı — lokasyon kutusu.
   BEKLENEN (resmi, kilitli) vs GÖRÜLEN (telemetri) ayrımı ekranda da korunur. */
async function loadDeviceLocation(asset) {
  const box = $(`#deviceLocationBox`);
  if (!box || asset.id == null) { if (box) box.innerHTML = ''; return; }
  try {
    const res = await fetch(`/api/assets/${asset.id}/location`);
    const j = await res.json();
    const exp = j.expected?.location || null;
    const seen = j.current?.to_location || (asset.location || '').trim() || null;
    const drift = exp && seen && exp.toLowerCase() !== seen.toLowerCase();
    const since = j.current?.first_seen_at;
    const days = since ? Math.floor((Date.now() - new Date(since).getTime()) / 86400000) : null;

    const hist = (j.history || []).slice(0, 6).map(h => `
      <div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>
        <div style="flex:1">
          <div style="color:var(--text);font-weight:500">
            ${h.from_location ? `${escapeHtml(h.from_location)} → ` : ''}${escapeHtml(h.to_location)}
          </div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:1px">
            ${fmtDate(h.first_seen_at)} — ${fmtDate(h.last_seen_at)} · kaynak: ${escapeHtml(h.source)}
          </div>
        </div>
      </div>`).join('') || '<p style="padding:4px 0;color:var(--text-muted)">Konum geçmişi kaydı yok.</p>';

    box.innerHTML = `
      <h4 style="font-size:13px;font-weight:600;margin:0 0 10px;color:var(--text)">Lokasyon</h4>
      <div style="background:var(--bg-card2);border:1px solid ${drift ? 'var(--red)' : 'var(--border)'};
                  border-radius:var(--radius-sm);padding:14px">
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px">
          <div><div style="font-size:11px;color:var(--text-muted)">Beklenen (resmi)</div>
            <div style="font-weight:600;color:var(--text)">${exp ? escapeHtml(exp) : '<span style="color:var(--text-muted);font-weight:400">tanımlı değil</span>'}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted)">Görülen (telemetri)</div>
            <div style="font-weight:600;color:${drift ? 'var(--red)' : 'var(--text)'}">
              ${seen ? escapeHtml(seen) : '—'}${days !== null ? ` <span style="font-weight:400;color:var(--text-muted)">(${days} gündür)</span>` : ''}</div></div>
        </div>
        ${drift ? `<p style="color:var(--red);font-size:12px;margin:0 0 10px">
          ⚠ Cihaz ait olduğu lokasyonun dışında görülüyor. Transferi resmileştirin veya cihazı yerine iade ettirin.</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-pdf" id="locSetExpected">${exp ? 'Beklenen lokasyonu değiştir' : 'Beklenen lokasyonu belirle'}</button>
          ${drift ? `<button class="btn-pdf" id="locAcceptMove">Transferi resmileştir (görüleni beklenen yap)</button>` : ''}
        </div>
      </div>
      <div style="margin-top:12px;font-size:12.5px">${hist}</div>`;

    $(`#locSetExpected`)?.addEventListener('click', () => setExpectedLocationPrompt(asset, exp));
    $(`#locAcceptMove`)?.addEventListener('click', () => saveExpectedLocation(asset, seen));
  } catch (err) {
    box.innerHTML = `<p style="color:var(--red);font-size:12px">Lokasyon bilgisi alınamadı: ${escapeHtml(err.message)}</p>`;
  }
}

function setExpectedLocationPrompt(asset, current) {
  const v = prompt('Cihazın ait olduğu (resmi) lokasyon:', current || asset.location || '');
  if (v === null) return;
  if (!v.trim()) { alert('Lokasyon boş olamaz.'); return; }
  saveExpectedLocation(asset, v.trim());
}

async function saveExpectedLocation(asset, location) {
  try {
    const res = await fetch(`/api/assets/${asset.id}/expected-location`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, hostname: asset.hostname || null }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadDeviceLocation(asset);
  } catch (err) { alert('Kaydedilemedi: ' + err.message); }
}

async function loadDeviceAssignment(asset) {
  const box = $(`#deviceAssignBox`);
  if (!box || asset.id == null) { if (box) box.innerHTML = ''; return; }
  try {
    const res = await fetch(`/api/assets/${asset.id}/assignment`);
    const a = (await res.json()).assignment;
    const owner = a && a.assigned_to;
    const seen = (asset.username || '').trim();
    const mismatch = owner && seen && seen.toLowerCase() !== owner.toLowerCase();
    box.innerHTML = `
      <div style="padding:12px 14px;background:${mismatch ? 'var(--red-bg)' : 'var(--bg-card2)'};border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:11px;font-weight:600;color:${mismatch ? 'var(--red)' : 'var(--text-muted)'};text-transform:uppercase;letter-spacing:.05em">🔒 Resmi Zimmet</span>
          <span>${owner ? `<button class="btn-icon" id="devReleaseBtn" title="İade al" style="display:inline-flex;width:26px;height:26px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}
          <button class="btn-icon" id="devAssignBtn" title="${owner ? 'Devret' : 'Zimmetle'}" style="display:inline-flex;width:26px;height:26px;margin-left:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg></button></span>
        </div>
        <div style="font-size:14px;font-weight:600;color:var(--text)">${owner ? escapeHtml(owner) : '<span style="color:var(--text-muted);font-weight:400">Zimmetsiz</span>'}</div>
        ${mismatch ? `<div style="font-size:11.5px;color:var(--red);margin-top:5px">⚠ Telemetri farklı kullanıcı gördü: <b>${escapeHtml(seen)}</b> — izinsiz kullanım şüphesi</div>` : ''}
        ${a && a.assigned_at ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">${fmtDate(a.assigned_at)}${a.assigned_by ? ` · ${escapeHtml(a.assigned_by)}` : ''}</div>` : ''}
      </div>`;
    $(`#devAssignBtn`)?.addEventListener('click', () => assignDevicePrompt(asset, owner));
    $(`#devReleaseBtn`)?.addEventListener('click', () => releaseDevice(asset));
  } catch { box.innerHTML = ''; }
}

async function assignDevicePrompt(asset, currentOwner) {
  const to = prompt(`"${asset.hostname}" cihazını kime zimmetleyelim?${currentOwner ? `\n\n(Şu an "${currentOwner}" kullanıcısına zimmetli — devir onayı istenecek)` : ''}`, currentOwner || (asset.username || ''));
  if (!to || !to.trim()) return;
  try {
    let res = await fetch(`/api/assets/${asset.id}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to.trim(), hostname: asset.hostname }) });
    if (res.status === 409) {
      const j = await res.json();
      if (!confirm(`${j.error}\n\nYine de devretmek istiyor musunuz? (yetkili onaylı devir)`)) return;
      res = await fetch(`/api/assets/${asset.id}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), hostname: asset.hostname, force: true }) });
    }
    if (!res.ok) throw new Error((await res.json()).detail || 'Hata');
    loadDeviceAssignment(asset);
  } catch (err) { alert('Zimmet hatası: ' + err.message); }
}

async function releaseDevice(asset) {
  if (!confirm(`"${asset.hostname}" cihazının resmi zimmeti kaldırılsın (iade) mı?`)) return;
  try {
    const res = await fetch(`/api/assets/${asset.id}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error('Hata');
    loadDeviceAssignment(asset);
  } catch (err) { alert('İade hatası: ' + err.message); }
}

async function loadDeviceLine(assetId) {
  const box = $(`#deviceLineBox`);
  if (!box) return;
  try {
    const res = await fetch(`/api/lines/for-asset/${assetId}`);
    const j = await res.json();
    const l = j.line;
    if (!l) {
      box.innerHTML = `<div style="padding:12px 14px;background:var(--bg-card2);border-radius:10px;font-size:12.5px;color:var(--text-muted)">
        📱 Bu telefona bağlı hat yok. <a href="#" id="goLinesLink" style="color:var(--accent)">Hatlar</a> sayfasından atayabilirsiniz.</div>`;
      $(`#goLinesLink`)?.addEventListener('click', (e) => { e.preventDefault(); $(`#deviceModalOverlay`)?.classList.remove('open'); showView('lines'); });
      return;
    }
    box.innerHTML = `<div style="padding:12px 14px;background:var(--accent-glow);border-radius:10px">
      <div style="font-size:11px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">📱 Bağlı Hat</div>
      <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text);font-weight:600">${escapeHtml(l.msisdn)}</span><span style="color:var(--text-muted)">${escapeHtml(l.operator)}</span></div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px">SIM: ${escapeHtml(l.iccid)}${l.tariff ? ` · ${escapeHtml(l.tariff)}` : ''}</div>
    </div>`;
  } catch { box.innerHTML = ''; }
}

async function loadDeviceHistory(asset) {
  const el = $(`#deviceHistory`);
  if (!el) return;
  try {
    const q = asset.serial_number ? `serial=${encodeURIComponent(asset.serial_number)}`
      : `hostname=${encodeURIComponent(asset.hostname || '')}`;
    const res = await fetch(`/api/lifecycle/log?${q}`);
    const data = await res.json();
    const events = data.events || data || [];
    if (!Array.isArray(events) || !events.length) {
      el.innerHTML = '<p style="padding:4px 0">Bu cihaz için kayıtlı yaşam döngüsü olayı yok.</p>';
      return;
    }
    el.innerHTML = events.slice().reverse().map((e) => `
      <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>
        <div style="flex:1">
          <div style="color:var(--text);font-weight:500">${escapeHtml(e.to_status || '—')}${e.from_status ? ` <span style="color:var(--text-muted);font-weight:400">← ${escapeHtml(e.from_status)}</span>` : ''}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:1px">${fmtDate(e.timestamp)} · ${escapeHtml(e.actor_upn || e.actor || '—')}${e.note ? ` · ${escapeHtml(e.note)}` : ''}</div>
        </div>
      </div>`).join('');
  } catch (err) {
    el.innerHTML = `<p style="color:var(--red)">Geçmiş yüklenemedi: ${escapeHtml(err.message)}</p>`;
  }
}

/* ─── Zimmet Teslim Tutanağı (PDF) ──────────────────────────────────────────── */
function printHandoverReceipt(asset) {
  if (!asset) return;
  const now = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  const g = (v) => (v === null || v === undefined || v === '') ? '—' : String(v);
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/>
  <title>Zimmet Tutanağı — ${g(asset.hostname)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1a1815; font-size:13px; line-height:1.7; padding:0; }
    .hdr { padding:44px 48px 0; }
    .hdr-top { display:flex; justify-content:space-between; align-items:center; padding-bottom:22px; border-bottom:1px solid #ece5da; }
    .brand { display:flex; align-items:center; gap:11px; }
    .brand-icon { width:34px; height:34px; background:linear-gradient(135deg,#6b5cff,#8a7dff); border-radius:9px; display:flex; align-items:center; justify-content:center; }
    .brand-icon svg { width:19px; height:19px; stroke:#fff; fill:none; stroke-width:1.8; }
    .brand-name { font-family:"Fraunces",Georgia,serif; font-size:17px; font-weight:600; color:#1a1815; letter-spacing:-.01em; }
    .brand-sub { font-size:11px; color:#8a8378; }
    .meta { text-align:right; font-size:11px; color:#8a8378; }
    .meta strong { color:#1a1815; }
    .title-block { padding:30px 0 4px; }
    .chip { display:inline-flex; align-items:center; gap:6px; background:#eeecff; color:#6b5cff; font-size:10.5px; font-weight:600; padding:4px 11px; border-radius:999px; margin-bottom:14px; }
    .chip::before { content:''; width:5px; height:5px; border-radius:50%; background:#6b5cff; }
    .title { font-family:"Fraunces",Georgia,serif; font-size:30px; font-weight:600; letter-spacing:-.01em; color:#1a1815; }
    .subtitle { font-size:12.5px; color:#8a8378; margin-top:6px; }
    .body { padding:26px 48px 44px; }
    .sec { font-size:11px; font-weight:600; color:#8a8378; text-transform:uppercase; letter-spacing:.06em; margin:22px 0 8px; }
    table { width:100%; border-collapse:collapse; font-size:12.5px; }
    td { padding:9px 0; border-bottom:1px solid #f0e9de; color:#5a544c; vertical-align:top; }
    td.k { color:#8a8378; width:38%; }
    td.v { color:#1a1815; font-weight:500; }
    .statement { margin:24px 0; padding:16px 18px; background:#f7f2ea; border-radius:12px; font-size:12.5px; color:#5a544c; line-height:1.75; }
    .sign-row { display:flex; gap:40px; margin-top:52px; }
    .sign { flex:1; }
    .sign-line { border-top:1px solid #1a1815; padding-top:8px; font-size:12px; color:#5a544c; }
    .sign-line strong { display:block; color:#1a1815; font-size:13px; margin-bottom:2px; }
    .footer { margin:0 48px; padding:16px 0; border-top:1px solid #ece5da; font-size:10.5px; color:#b3a89a; text-align:center; }
    @media print { @page { margin:0; size:A4; } body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } .brand-icon,.chip,.statement{ -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
  </style></head><body>
  <div class="hdr">
    <div class="hdr-top">
      <div class="brand">
        <div class="brand-icon"><svg viewBox="0 0 24 24" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg></div>
        <div><div class="brand-name">AssetMan</div><div class="brand-sub">IT Varlık Yönetimi</div></div>
      </div>
      <div class="meta"><div>Düzenlenme Tarihi</div><div><strong>${now}</strong></div></div>
    </div>
    <div class="title-block">
      <div class="chip">Resmi Belge</div>
      <div class="title">Zimmet Teslim Tutanağı</div>
      <div class="subtitle">Cihaz teslim / iade kaydı</div>
    </div>
  </div>
  <div class="body">
    <div class="sec">Cihaz Bilgileri</div>
    <table>
      <tr><td class="k">Cihaz Adı (Hostname)</td><td class="v">${g(asset.hostname)}</td></tr>
      <tr><td class="k">Kategori</td><td class="v">${g(asset.category)}</td></tr>
      <tr><td class="k">Marka / Model</td><td class="v">${g(asset.brand)} ${g(asset.model)}</td></tr>
      <tr><td class="k">Seri Numarası</td><td class="v">${g(asset.serial_number)}</td></tr>
      <tr><td class="k">Teknik Özellik</td><td class="v">${g(asset.cpu)}${asset.ram_gb ? ' · ' + asset.ram_gb + ' GB RAM' : ''}${asset.storage_gb ? ' · ' + asset.storage_gb + ' GB Disk' : ''}</td></tr>
      <tr><td class="k">İşletim Sistemi</td><td class="v">${g(asset.os)}</td></tr>
    </table>
    <div class="sec">Zimmet Bilgileri</div>
    <table>
      <tr><td class="k">Teslim Alan Personel</td><td class="v">${g(asset.username)}</td></tr>
      <tr><td class="k">Lokasyon / Departman</td><td class="v">${g(asset.location)}</td></tr>
      <tr><td class="k">Teslim Tarihi</td><td class="v">${now}</td></tr>
    </table>
    <div class="statement">Yukarıda özellikleri belirtilen cihaz, çalışır ve eksiksiz durumda tarafıma teslim edilmiştir. Cihazı kurumsal kullanım politikalarına uygun kullanacağımı, hasar/kayıp durumunda bilgi vereceğimi ve görevimden ayrılmam halinde eksiksiz iade edeceğimi kabul ederim.</div>
    <div class="sign-row">
      <div class="sign"><div class="sign-line"><strong>Teslim Eden (IT)</strong>Ad Soyad · İmza · Tarih</div></div>
      <div class="sign"><div class="sign-line"><strong>Teslim Alan (Personel)</strong>${g(asset.username)} · İmza · Tarih</div></div>
    </div>
  </div>
  <div class="footer">AssetMan — Bu belge sistem tarafından otomatik oluşturulmuştur.</div>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`);
  win.document.close();
}

function renderRecentTable(assets) {
  const tbody = $(`#recentBody`);
  if (!tbody) return;
  if (!assets.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">Henüz kayıt yok</td></tr>`;
    return;
  }
  tbody.innerHTML = assets.map((a) => `
    <tr data-asset-id="${a.id}" style="cursor:pointer">
      <td class="hostname-cell">${fmt(a.hostname)}</td>
      <td>${categoryBadge(a.category)}</td>
      <td>${a.location ? `<span class="location-tag">${escapeHtml(a.location)}</span>` : '—'}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${fmtDay(a.last_seen)}</td>
    </tr>`).join('');
  tbody.querySelectorAll('tr[data-asset-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const asset = state.assets.find(x => String(x.id) === tr.dataset.assetId);
      if (asset) openDeviceModal(asset);
    });
  });
}

/* ─── Assets View ───────────────────────────────────────────────────────── */
function populateLocationFilter(assets) {
  const sel = $(`#filterLocation`);
  if (!sel) return;
  const locations = [...new Set(assets.map(a => a.location).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">Tüm Lokasyonlar</option>' +
    locations.map(l => `<option value="${l}" ${l === current ? 'selected' : ''}>${l}</option>`).join('');
}

/* ═══ VARLIKLAR v2 ════════════════════════════════════════════════════════
   Önceki tablo 13 sütundu (dar ekranda kesiliyordu), sayfalama ve satır
   aksiyonu yoktu. Tasarım referansına göre 7 sütun + seçim + sayfalama.
   Filtre/sıralama/sayfalama İSTEMCİDE — envanter zaten tek istekte geliyor. */
const ASSET_SORT_LABEL = { serial_number: 'Varlık Kodu', hostname: 'Varlık Adı',
  category: 'Kategori', location: 'Lokasyon', status: 'Durum' };

function assetSearchBlob(a) {
  return [a.hostname, a.serial_number, a.brand, a.model, a.location, a.category,
    a.ip_address, a.mac_address, a.username, a.os].filter(Boolean).join(' ');
}

function filteredAssets() {
  const q = trSlug($(`#assetSearch`)?.value || '').trim();
  const cat = $(`#filterCategory`)?.value || '';
  const loc = $(`#filterLocation`)?.value || '';
  const st  = $(`#filterStatus`)?.value || '';
  let list = (state.allAssets || []).slice();
  if (cat) list = list.filter(a => (a.category || 'Diğer') === cat);
  if (loc) list = list.filter(a => (a.location || '') === loc);
  if (st)  list = list.filter(a => (a.status || '') === st);
  // trSlug: Türkçe 'İ' toLowerCase'te birleşik nokta üretir → arama tutmazdı
  if (q)   list = list.filter(a => trSlug(assetSearchBlob(a)).includes(q));

  const key = state.assetSort?.key;
  if (key) {
    const dir = state.assetSort.dir === 'desc' ? -1 : 1;
    list.sort((x, y) => String(x[key] || '').localeCompare(String(y[key] || ''), 'tr') * dir);
  }
  return list;
}

async function renderAssetsTable() {
  const tbody = $(`#assetsBody`);
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">Yükleniyor...</td></tr>`;
  try {
    // Envanter + resmi zimmetler TEK seferde (cihaz başına istek N+1 olurdu)
    const [data, asg, trendData, lcLog, locSum, anom, warr] = await Promise.all([
      fetchAssets({ size: 200 }),
      fetch('/api/assignments').then(r => r.ok ? r.json() : { assignments: {} }).catch(() => ({ assignments: {} })),
      // Dashboard'a hiç uğranmadan gelinirse trendler boş kalmasın
      state.trendSeries?.length ? Promise.resolve(null) : fetchTrends(state.rangeDays).catch(() => null),
      // Sağ ray verisi (yalnız bir kez)
      state.railEvents ? Promise.resolve(null) : fetchLifecycleLog(30).catch(() => ({ events: [] })),
      state.locSummary ? Promise.resolve(null) : fetchLocationSummary().catch(() => ({ ...EMPTY_SUMMARY })),
      state.critParts?.warranty !== undefined ? Promise.resolve(null) : fetchAnomalies().catch(() => ({})),
      state.critParts?.warranty !== undefined ? Promise.resolve(null) : fetchWarranty().catch(() => ({})),
    ]);
    if (trendData) {
      state.trends = trendData.trends || {};
      state.trendSeries = trendData.series || [];
      state.seriesOnline = trendData.series_online || [];
      state.seriesOffline = trendData.series_offline || [];
      state.seriesDepoda = trendData.series_depoda || [];
    }
    if (lcLog) state.railEvents = lcLog.events || lcLog.log || [];
    if (locSum) state.locSummary = locSum;
    if (anom || warr) {
      state.critParts = {
        drift:    state.locSummary?.tasinmis || 0,
        warranty: warr?.expired?.items?.length || 0,
        uptime:   anom?.long_uptime?.items?.length || 0,
        disk:     anom?.low_disk?.items?.length || 0,
        offline:  0,
      };
    }
    state.allAssets = data.results || [];
    state.assets = state.allAssets;
    state.assignments = asg.assignments || {};
    populateAssetFilters(state.allAssets);
    paintAssetsTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function populateAssetFilters(assets) {
  const cats = [...new Set(assets.map(a => a.category || 'Diğer'))].sort((a, b) => a.localeCompare(b, 'tr'));
  const locs = [...new Set(assets.map(a => (a.location || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const fill = (id, items, hepsi) => {
    const el = $('#' + id); if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${hepsi}</option>` +
      items.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (items.includes(cur)) el.value = cur;
  };
  fill('filterCategory', cats, 'Tüm Kategoriler');
  fill('filterLocation', locs, 'Tüm Lokasyonlar');
}

/* Kategori ikonu — mobil kart listesindeki renkli kutu (tasarım referansı) */
const CAT_ICON = {
  'Bilgisayar': ['blue', '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'],
  'Sunucu': ['blue', '<rect x="2" y="3" width="20" height="7" rx="1"/><rect x="2" y="14" width="20" height="7" rx="1"/><path d="M6 6.5h.01M6 17.5h.01"/>'],
  'Telefon': ['green', '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>'],
  'Tablet': ['orange', '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>'],
  'El Terminali': ['orange', '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 6h6"/>'],
  'Yazıcı': ['red', '<path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="8" rx="2"/><path d="M6 17h12v5H6z"/>'],
  'Ağ Aygıtı': ['blue', '<rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 17.5h.01M10 17.5h.01"/><path d="M12 14V9M8 6l4-3 4 3"/>'],
  'Çevre Aygıtı': ['green', '<path d="M3 12a9 9 0 0 1 18 0v5a2 2 0 0 1-2 2h-2v-7h4"/><path d="M3 17v-5h4v7H5a2 2 0 0 1-2-2z"/>'],
};
const CAT_ICON_DEFAULT = ['blue', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>'];

function catIcon(cat) {
  const [tone, path] = CAT_ICON[cat] || CAT_ICON_DEFAULT;
  return `<span class="ac-ico kpi-ico--${tone}">
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
}

/* Geniş ekran bağlam rayı — dashboard ile AYNI veriden, dikey liste sunumu.
   Veri yoksa (Varlıklar'a doğrudan gelinmişse) sessizce boş kalır, hata vermez. */
function renderAssetsRail() {
  const parts = state.critParts || {};
  const chips = [
    { n: parts.drift || 0,    t: 'Lokasyon Dışı Cihazlar', tone: 'red' },
    { n: parts.warranty || 0, t: 'Garanti Süresi Dolan',   tone: 'orange' },
    { n: parts.uptime || 0,   t: 'Bakım Süresi Geçen',     tone: 'orange' },
    { n: parts.disk || 0,     t: 'Disk Alanı Düşük',       tone: 'red' },
  ];
  setPill('railCritPill', chips.reduce((a, c) => a + c.n, 0));
  const crit = $(`#railCrit`);
  if (crit) {
    crit.innerHTML = chips.map(c => `
      <button class="sev-row" data-view="alerts">
        <span class="sev-ico sev-ico--${c.tone}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </span>
        <span class="sev-name">${c.t}<small>${c.n} cihaz</small></span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>`).join('');
    crit.querySelectorAll('.sev-row').forEach(r => r.addEventListener('click', () => showView('alerts')));
  }

  renderActivities(state.railEvents || [], 'railActivity');

  // Öneri metni dashboard ile aynı kuraldan
  const el = $(`#railInsightText`), btn = $(`#railInsightBtn`);
  if (el && state.locSummary) {
    const tmpText = $(`#insightText`), tmpBtn = $(`#insightBtn`);
    const yedek = tmpText ? tmpText.textContent : null;
    renderInsight(state.locSummary, parts);
    if (tmpText) {
      el.textContent = tmpText.textContent;
      if (btn && tmpBtn) {
        btn.style.display = tmpBtn.style.display;
        btn.onclick = tmpBtn.onclick;
      }
      if (yedek !== null && state.currentView !== 'dashboard') tmpText.textContent = yedek;
    }
  }
}

/* Varlık durum kartları — tablet/masaüstünde tam KPI kartı, mobilde mini şerit.
   Tek fonksiyon, tek veri; sunumu CSS ayırır. Trend GERÇEK anlık görüntülerden
   (yoksa 'veri birikiyor' der — sıfır uydurmaz, dashboard ile aynı kural). */
function renderMiniStats() {
  const box = $(`#miniStats`);
  if (!box) return;
  const all = state.allAssets || [];
  const say = (st) => all.filter(a => (a.status || '') === st).length;
  const tr = state.trends || {};
  const win = tr.window_days || 30;
  const kartlar = [
    { k: '', ad: 'Toplam Varlık', n: all.length, tone: 'blue', renk: 'var(--accent)',
      t: tr.total, seri: state.trendSeries, sc: '#4f46e5',
      ico: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/>' },
    { k: 'online', ad: 'Aktif', n: say('online'), tone: 'green', renk: 'var(--green)',
      t: tr.online, seri: state.seriesOnline, sc: '#10b981',
      ico: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/>' },
    { k: 'depoda', ad: 'Depoda', n: say('depoda'), tone: 'orange', renk: 'var(--orange)',
      t: tr.depoda, seri: state.seriesDepoda, sc: '#f59e0b',
      ico: '<path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21V12h6v9"/>' },
    { k: 'offline', ad: 'Kullanım Dışı', n: say('offline'), tone: 'red', renk: 'var(--red)',
      t: tr.offline, seri: state.seriesOffline, sc: '#ef4444',
      ico: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' },
    // 5. kart yalnız geniş ekranda görünür (CSS); dashboard'la AYNI veri
    { k: null, ad: 'Lokasyon', n: state.locSummary?.location_count ?? 0, tone: 'blue',
      renk: 'var(--accent)', alt: 'Aktif lokasyon', git: 'locations',
      ico: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>' },
  ];
  box.innerHTML = kartlar.map((c, i) => `
    <button class="ms-card kpi" data-st="${c.k}" data-i="${i}">
      <span class="kpi-top">
        <span class="ms-ico kpi-ico kpi-ico--${c.tone}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.ico}</svg>
        </span>
        <span class="ms-label kpi-label" style="color:${c.renk}">${c.ad}</span>
      </span>
      <span class="ms-value kpi-value" style="color:${c.renk}">${c.n}</span>
      <span class="kpi-foot">
        ${c.alt ? `<span class="kpi-sub">${c.alt}</span>`
                : `<span class="kpi-trend" id="msTrend${i}"></span>
                   <span class="kpi-spark" id="msSpark${i}"></span>`}
      </span>
    </button>`).join('');

  kartlar.forEach((c, i) => {
    if (c.alt) return;                       // Lokasyon kartında trend yok
    renderTrend(`msTrend${i}`, c.t, win);
    sparkFromSeries(`msSpark${i}`, c.seri || [], c.sc);
  });

  box.querySelectorAll('.ms-card').forEach((b, i) => b.addEventListener('click', () => {
    if (kartlar[i].git) { showView(kartlar[i].git); return; }
    const sel = $(`#filterStatus`); if (sel) sel.value = b.dataset.st;
    state.assetPage = 1; state.mobileShown = 0; paintAssetsTable();
  }));
}

/* Mobil kart listesi — tablo ile AYNI filtrelenmiş listeden çizilir.
   Sayfalama yerine kümülatif "Daha Fazla Yükle" (tasarım referansı). */
function paintAssetCards(list, per) {
  const box = $(`#assetCards`);
  if (!box) return;
  const goster = Math.min(list.length, state.mobileShown || per);
  state.mobileShown = goster;
  const dilim = list.slice(0, goster);

  box.innerHTML = dilim.length ? dilim.map(a => `
    <div class="ac-item" data-id="${a.id}">
      ${catIcon(a.category)}
      <div class="ac-body">
        <div class="ac-top">
          <span class="ac-name">${fmt(a.hostname)}</span>
          ${statusBadge(a.status)}
          <button class="ac-kebab" data-id="${a.id}" aria-label="İşlemler">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
          </button>
        </div>
        <div class="ac-code">${fmt(a.serial_number)}</div>
        <div class="ac-meta">${escapeHtml(a.category || 'Diğer')}<i>•</i>${escapeHtml((a.location || '').trim() || 'Lokasyon yok')}</div>
      </div>
    </div>`).join('')
    : `<p class="loading-cell">Filtreye uyan kayıt yok</p>`;

  const byId = (id) => (state.allAssets || []).find(x => String(x.id) === String(id));
  box.querySelectorAll('.ac-item').forEach(el => el.addEventListener('click', () => {
    const a = byId(el.dataset.id); if (a) openDeviceModal(a);
  }));
  box.querySelectorAll('.ac-kebab').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = byId(b.dataset.id); if (a) openDeviceModal(a);
  }));

  const more = $(`#loadMoreBtn`);
  if (more) more.hidden = goster >= list.length;
  const info = $(`#cardsInfo`);
  if (info) {
    const sayfa = Math.ceil(goster / per) || 1;
    const toplamSayfa = Math.max(1, Math.ceil(list.length / per));
    info.textContent = `Toplam ${list.length} varlık · Sayfa ${sayfa} / ${toplamSayfa}`;
  }
}

function paintAssetsTable() {
  const tbody = $(`#assetsBody`);
  if (!tbody) return;
  const list = filteredAssets();
  state.renderedAssets = list;

  const per = Number($(`#rowsPerPage`)?.value) || 25;
  const pages = Math.max(1, Math.ceil(list.length / per));
  if (!state.assetPage || state.assetPage > pages) state.assetPage = 1;
  const page = state.assetPage;
  const slice = list.slice((page - 1) * per, page * per);

  const countEl = $(`#assetCount`);
  if (countEl) {
    const toplam = (state.allAssets || []).length;
    countEl.textContent = list.length === toplam
      ? `${toplam} varlık bulundu`
      : `${list.length} / ${toplam} varlık`;
  }

  // Sıralama başlıkları
  $$('.asset-table--v2 th.sortable').forEach(th => {
    const k = th.dataset.sort;
    const aktif = state.assetSort?.key === k;
    th.className = 'sortable th-sort' + (aktif ? ' active' : '');
    th.innerHTML = `${ASSET_SORT_LABEL[k] || k}${aktif ? `<span class="arr">${state.assetSort.dir === 'desc' ? '▼' : '▲'}</span>` : ''}`;
  });

  const sel = state.selectedAssets || new Set();

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">Filtreye uyan kayıt yok</td></tr>`;
    renderPager(0, per);
    updateBulkBar();
    paintAssetCards(list, per);
    renderMiniStats();
    return;
  }

  tbody.innerHTML = slice.map((a) => `
    <tr class="asset-row${sel.has(a.id) ? ' selected' : ''}" data-id="${a.id}">
      <td class="col-check"><input type="checkbox" class="row-check" data-id="${a.id}" ${sel.has(a.id) ? 'checked' : ''} aria-label="Satırı seç"></td>
      <td class="code-cell" title="${escapeHtml(a.serial_number || '')}">${fmt(a.serial_number)}</td>
      <td class="hostname-cell">${fmt(a.hostname)}</td>
      <td>${categoryBadge(a.category)}</td>
      <td>${a.location ? `<span class="location-tag">${escapeHtml(a.location)}</span>` : '—'}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${escapeHtml(state.assignments?.[a.id] || '—')}</td>
      <td class="col-actions">
        <span class="row-actions">
          <button class="ra-btn" data-act="view" data-id="${a.id}" title="Detay">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="ra-btn" data-act="edit" data-id="${a.id}" title="Zimmet / lokasyon düzenle">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="ra-btn" data-act="lifecycle" data-id="${a.id}" title="Yaşam döngüsü kaydı">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 3 3 8 8 8"/><path d="M12 7v5l3 2"/></svg>
          </button>
        </span>
      </td>
    </tr>`).join('');

  const byId = (id) => (state.allAssets || []).find(x => String(x.id) === String(id));

  tbody.querySelectorAll('.asset-row').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.ra-btn') || e.target.closest('.row-check')) return;
      const a = byId(tr.dataset.id); if (a) openDeviceModal(a);
    });
  });
  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      state.selectedAssets = state.selectedAssets || new Set();
      const id = Number(cb.dataset.id);
      if (cb.checked) state.selectedAssets.add(id); else state.selectedAssets.delete(id);
      cb.closest('tr')?.classList.toggle('selected', cb.checked);
      updateBulkBar();
    });
  });
  tbody.querySelectorAll('.ra-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = byId(b.dataset.id); if (!a) return;
      if (b.dataset.act === 'lifecycle') { showView('lifecycle'); return; }
      openDeviceModal(a);   // detay + zimmet/lokasyon düzenleme aynı modalda
    });
  });

  renderPager(list.length, per);
  updateBulkBar();
  paintAssetCards(list, per);
  renderMiniStats();
  renderAssetsRail();
}

/* Sayfalama — 1 2 … n-1 [n] n+1 … son */
function renderPager(total, per) {
  const nav = $(`#assetsPager`);
  if (!nav) return;
  const pages = Math.max(1, Math.ceil(total / per));
  const cur = state.assetPage || 1;
  if (pages <= 1) { nav.innerHTML = ''; return; }

  const nums = [];
  const push = (n) => { if (!nums.includes(n) && n >= 1 && n <= pages) nums.push(n); };
  push(1); push(2);
  for (let i = cur - 1; i <= cur + 1; i++) push(i);
  push(pages - 1); push(pages);
  nums.sort((a, b) => a - b);

  let html = `<button data-p="${cur - 1}" ${cur === 1 ? 'disabled' : ''} aria-label="Önceki">‹</button>`;
  let prev = 0;
  nums.forEach(n => {
    if (prev && n - prev > 1) html += `<span class="gap">…</span>`;
    html += `<button data-p="${n}" class="${n === cur ? 'active' : ''}">${n}</button>`;
    prev = n;
  });
  html += `<button data-p="${cur + 1}" ${cur === pages ? 'disabled' : ''} aria-label="Sonraki">›</button>`;
  nav.innerHTML = html;
  nav.querySelectorAll('button[data-p]').forEach(b => b.addEventListener('click', () => {
    const p = Number(b.dataset.p);
    if (p >= 1 && p <= pages) { state.assetPage = p; paintAssetsTable(); }
  }));
}

function updateBulkBar() {
  const bar = $(`#bulkBar`), cnt = $(`#bulkCount`);
  const n = (state.selectedAssets || new Set()).size;
  if (cnt) cnt.textContent = n;
  if (bar) bar.hidden = n === 0;
  const all = $(`#selectAll`);
  if (all) {
    const gorunen = state.renderedAssets || [];
    all.checked = n > 0 && gorunen.length > 0 && gorunen.every(a => state.selectedAssets?.has(a.id));
    all.indeterminate = n > 0 && !all.checked;
  }
}

/* ─── Licenses View ──────────────────────────────────────────────────────── */
const LIC_TYPE_CLS = {
  'ESD': 'esd', 'Volume': 'volume', 'Subscription': 'subscription', 'OEM': 'oem', 'Free': 'free',
};

function licTypeBadge(type) {
  if (!type || type === 'Unknown') return '<span class="lic-type lic-type--unknown">Unknown</span>';
  const cls = LIC_TYPE_CLS[type] || 'unknown';
  return `<span class="lic-type lic-type--${cls}">${type}</span>`;
}

function licStatusBadge(status) {
  if (!status) return '<span class="lic-status lic-status--unknown">—</span>';
  const s = status.toLowerCase();
  if (s === 'licensed')   return `<span class="lic-status lic-status--licensed">Lisanslı</span>`;
  if (s === 'unlicensed') return `<span class="lic-status lic-status--unlicensed">Lisanssız</span>`;
  if (s.includes('grace') || s.includes('notification')) return `<span class="lic-status lic-status--grace">${status}</span>`;
  return `<span class="lic-status lic-status--unknown">${status}</span>`;
}

async function loadLicenses() {
  const tbody = $(`#licenseBody`);
  const countEl = $(`#licenseCount`);
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="loading-cell">Yükleniyor...</td></tr>`;

  try {
    const [licData, stats] = await Promise.all([fetchLicenses({ size: 200 }), fetchLicenseStats()]);
    let licenses = licData.results || [];
    state.licenses = licenses;

    // Render stats
    const total = $(`#licTotal`);
    const licensed = $(`#licLicensed`);
    const unlicensed = $(`#licUnlicensed`);
    const expiring = $(`#licExpiring`);
    if (total) animateCount(total, stats.total || 0);
    if (licensed) animateCount(licensed, stats.by_status?.Licensed || 0);
    if (unlicensed) animateCount(unlicensed, stats.unlicensed || 0);
    if (expiring) animateCount(expiring, stats.expiring_soon || 0);

    // Software bar chart
    renderLicSoftwareChart(stats.by_software || {});
    renderLicStatusRings(stats.by_status || {});
    renderLicTypeChart(stats.by_type || {});

    renderLicenseTable(licenses);
    if (countEl) countEl.textContent = `${licenses.length} yazılım kaydı bulundu`;
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="loading-cell" style="color:#ef4444">${err.message}</td></tr>`;
  }
}

function renderLicSoftwareChart(bySoftware) {
  const entries = Object.entries(bySoftware).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = entries[0]?.[1] || 1;
  const container = $(`#licSoftwareBars`);
  if (!container) return;
  container.innerHTML = entries.map(([name, count]) => `
    <div class="bar-row">
      <span class="bar-label" title="${name}">${name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:0%" data-pct="${Math.round((count/max)*100)}"></div></div>
      <span class="bar-count">${count}</span>
    </div>`).join('') || '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';
  setTimeout(() => container.querySelectorAll('.bar-fill').forEach(el => el.style.width = el.dataset.pct + '%'), 100);
}

function renderLicStatusRings(byStatus) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  const container = $(`#licStatusRings`);
  if (!container) return;
  const items = [
    { key: 'Licensed',   label: 'Lisanslı',   cls: 'online' },
    { key: 'Unlicensed', label: 'Lisanssız',  cls: 'offline' },
    { key: 'Unknown',    label: 'Bilinmiyor', cls: 'unknown' },
  ];
  container.innerHTML = items.map(({ key, label, cls }) => {
    const count = byStatus[key] || 0;
    const pct = Math.round((count / total) * 100);
    return `
      <div class="ring-row">
        <span class="ring-dot ring-dot--${cls}"></span>
        <div class="ring-info">
          <div style="display:flex;justify-content:space-between;"><span class="ring-name">${label}</span><span style="font-size:12px;color:var(--text-muted)">${count}</span></div>
          <div class="ring-track"><div class="ring-fill ring-fill--${cls}" style="width:0%" data-pct="${pct}"></div></div>
        </div>
        <span class="ring-pct">${pct}%</span>
      </div>`;
  }).join('');
  setTimeout(() => container.querySelectorAll('.ring-fill').forEach(el => el.style.width = el.dataset.pct + '%'), 100);
}

function renderLicTypeChart(byType) {
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
  const TYPE_COLORS = { ESD: 'var(--blue)', Volume: 'var(--purple)', Subscription: 'var(--teal)', OEM: 'var(--orange)', Unknown: 'var(--text-muted)' };
  const container = $(`#licTypeBars`);
  if (!container) return;
  container.innerHTML = entries.map(([type, count]) => {
    const color = TYPE_COLORS[type] || 'var(--text-muted)';
    return `
      <div class="bar-row">
        <span class="bar-label" title="${type}">${type}</span>
        <div class="bar-track"><div class="bar-fill" style="width:0%;background:${color}" data-pct="${Math.round((count/max)*100)}"></div></div>
        <span class="bar-count">${count}</span>
      </div>`;
  }).join('') || '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';
  setTimeout(() => container.querySelectorAll('.bar-fill').forEach(el => el.style.width = el.dataset.pct + '%'), 100);
}

function renderLicenseTable(licenses) {
  const tbody = $(`#licenseBody`);
  if (!tbody) return;

  // Apply client-side filters
  const statusF = $(`#licFilterStatus`)?.value || '';
  const typeF   = $(`#licFilterType`)?.value   || '';
  const searchF = ($(`#licSearch`)?.value || '').toLowerCase();

  // Skip empty/null rows (may come from manual Baserow entries)
  let filtered = licenses.filter(l => l.software_name);
  if (statusF) filtered = filtered.filter(l => (l.license_status || '') === statusF);
  if (typeF)   filtered = filtered.filter(l => (l.license_type || '') === typeF);
  if (searchF) filtered = filtered.filter(l =>
    (l.software_name || '').toLowerCase().includes(searchF) ||
    (l.hostname || '').toLowerCase().includes(searchF) ||
    (l.publisher || '').toLowerCase().includes(searchF));

  const countEl = $(`#licenseCount`);
  if (countEl) countEl.textContent = `${filtered.length} yazılım kaydı bulundu`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Kayıt bulunamadı</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(l => `
    <tr>
      <td style="font-weight:500;color:var(--text)">${fmt(l.software_name)}</td>
      <td class="serial-cell">${fmt(l.software_version, '—')}</td>
      <td>${fmt(l.publisher, '—')}</td>
      <td>${licTypeBadge(l.license_type)}</td>
      <td>${licStatusBadge(l.license_status)}</td>
      <td class="serial-cell">${l.key_hint ? `<span style="background:var(--bg-card2);border:1px solid var(--border);padding:2px 8px;border-radius:6px;font-size:12px;letter-spacing:0.08em">${l.key_hint}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="hostname-cell">${fmt(l.hostname)}</td>
      <td>${fmt(l.username, '—')}</td>
      <td>${l.install_date ? l.install_date.substring(0, 10) : '—'}</td>
      <td>${fmtDate(l.last_seen)}</td>
    </tr>`).join('');
}

/* ─── Alerts & Anomalies View ────────────────────────────────────────────── */
function brandModel(item) {
  const b = fmt(item.brand);
  const m = item.model && item.model !== '—' ? `<span style="color:var(--text-muted)">${item.model}</span>` : '';
  return `${b} ${m}`.trim();
}

function setPill(id, count) {
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('count-pill--zero', count === 0);
}

function humanDuration(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 24) return `${hours} saat`;
  const days = Math.floor(hours / 24);
  return `${days} gün`;
}

async function fetchLocationDrift() {
  const res = await fetch('/api/location-drift');
  if (!res.ok) throw new Error('Lokasyon sapması alınamadı');
  return res.json();
}

function renderLocationDrift(drift) {
  const items = drift.drifted || [];
  setPill('locDriftPill', items.length);
  const hint = $(`#locDriftHint`);
  if (hint) {
    // Kapsam dürüstlüğü: beklenen lokasyonu tanımsız cihazlar taramanın DIŞINDA kalır.
    // Bunu gizlemek "sapma yok ✓" ifadesini yanıltıcı yapardı.
    const scope = drift.unassigned > 0
      ? ` · ${drift.unassigned} cihaz kapsam dışı (beklenen lokasyon tanımsız)` : '';
    hint.textContent = `${drift.threshold_days}+ gündür ait olduğu lokasyonun dışında${scope}`;
  }
  const body = $(`#locDriftBody`);
  if (!body) return;
  body.innerHTML = items.length ? items.map(d => `
    <tr data-asset-id="${d.asset_id}" style="cursor:pointer">
      <td class="hostname-cell">${fmt(d.hostname)}</td>
      <td>${categoryBadge(d.category)}</td>
      <td><span class="location-tag">${escapeHtml(d.expected_location)}</span></td>
      <td><span class="location-tag" style="background:var(--red-bg);color:var(--red)">${escapeHtml(d.seen_location)}</span></td>
      <td>${d.days === null ? '<span style="color:var(--text-muted)">bilinmiyor</span>' : d.days + ' gün'}</td>
      <td style="color:var(--text-muted)">${escapeHtml(d.source)}</td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="loading-cell" style="color:var(--green)">Lokasyon sapması yok ✓</td></tr>`;

  body.querySelectorAll('tr[data-asset-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const asset = state.assets.find(x => String(x.id) === tr.dataset.assetId);
      if (asset) openDeviceModal(asset);
    });
  });
}

async function loadAlerts(showLoading = true) {
  // Reset bodies to loading (arka plan tazelemede atlanır → titreme olmaz)
  if (showLoading) {
    const setLoading = (id, cols) => { const b = $(`#${id}`); if (b) b.innerHTML = `<tr><td colspan="${cols}" class="loading-cell">Yükleniyor...</td></tr>`; };
    setLoading('offlineBody', 6);
    setLoading('lowRamBody', 4);
    setLoading('lowDiskBody', 4);
    setLoading('longUptimeBody', 4);
    setLoading('licComplianceBody', 6);
    setLoading('shadowBody', 4);
    setLoading('eolBody', 5);
    setLoading('warrantyBody', 5);
    setLoading('locDriftBody', 6);
  }

  try {
    const [anomalies, offline, compliance, shadow, eol, warranty, drift] = await Promise.all([
      fetchAnomalies(),
      fetchOfflineAlerts(),
      fetchLicenseCompliance(),
      fetchShadowIT().catch(() => ({ shadow: { count: 0, items: [] } })),
      fetchEolOs().catch(() => ({ total_issues: 0, eol: { items: [] }, approaching: { items: [] } })),
      fetchWarranty().catch(() => ({ total_issues: 0, expired: { items: [] }, expiring_soon: { items: [] } })),
      fetchLocationDrift().catch(() => ({ count: 0, drifted: [], threshold_days: 7, unassigned: 0 })),
    ]);

    const shadowCount = shadow.shadow?.count || 0;
    const eolCount = eol.total_issues || 0;
    const warrantyCount = warranty.total_issues || 0;
    const driftCount = drift.count || 0;

    // Summary cards — kartlar birbirinden bağımsız ve nav rozetine tam toplanır
    const elA = $(`#alertTotalAnomalies`); if (elA) animateCount(elA, anomalies.total_anomalies || 0);
    const elO = $(`#alertOfflineCount`);   if (elO) animateCount(elO, offline.total_alerts || 0);
    const elL = $(`#alertLicenseIssues`);   if (elL) animateCount(elL, compliance.total_issues || 0);
    const elS = $(`#alertShadowCount`);     if (elS) animateCount(elS, shadowCount);
    const elE = $(`#alertEolCount`);        if (elE) animateCount(elE, eolCount);
    const elW = $(`#alertWarrantyCount`);   if (elW) animateCount(elW, warrantyCount);
    const elD = $(`#alertLocDriftCount`);   if (elD) animateCount(elD, driftCount);

    // Nav badge = total actionable alerts
    const totalAlerts = (anomalies.total_anomalies || 0) + (offline.total_alerts || 0)
      + (compliance.total_issues || 0) + shadowCount + eolCount + warrantyCount + driftCount;
    updateAlertsBadge(totalAlerts);

    // ── Lokasyon sapması ──
    renderLocationDrift(drift);

    // ── Offline table ──
    const offItems = [...(offline.stale?.items || []), ...(offline.offline?.items || [])];
    setPill('offlinePill', offItems.length);
    const offBody = $(`#offlineBody`);
    if (offBody) {
      offBody.innerHTML = offItems.length ? offItems.map(d => {
        const isStale = (d.hours_offline || 0) >= 7 * 24;
        return `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td>${statusBadge(d.status)}</td>
          <td>${fmtDate(d.last_seen)}</td>
          <td><span class="badge ${isStale ? 'badge--offline' : 'badge--unknown'}">${humanDuration(d.hours_offline)}</span></td>
        </tr>`;
      }).join('') : `<tr><td colspan="6" class="loading-cell" style="color:var(--green,#22c55e)">Tüm cihazlar çevrimiçi ✓</td></tr>`;
    }

    // ── Low RAM ──
    const ramItems = anomalies.low_ram?.items || [];
    setPill('lowRamPill', ramItems.length);
    const ramBody = $(`#lowRamBody`);
    if (ramBody) {
      ramBody.innerHTML = ramItems.length ? ramItems.map(d => `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td><span class="badge badge--offline">${d.ram_gb} GB</span></td>
        </tr>`).join('') : `<tr><td colspan="4" class="loading-cell">Düşük RAM'li cihaz yok ✓</td></tr>`;
    }

    // ── Low Disk ──
    const diskItems = anomalies.low_disk?.items || [];
    setPill('lowDiskPill', diskItems.length);
    const diskBody = $(`#lowDiskBody`);
    if (diskBody) {
      diskBody.innerHTML = diskItems.length ? diskItems.map(d => `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td><span class="badge badge--offline">${d.storage_gb} GB</span></td>
        </tr>`).join('') : `<tr><td colspan="4" class="loading-cell">Düşük diskli cihaz yok ✓</td></tr>`;
    }

    // ── Long uptime (yeniden başlatma) ──
    const uptimeItems = anomalies.long_uptime?.items || [];
    setPill('longUptimePill', uptimeItems.length);
    const uptimeBody = $(`#longUptimeBody`);
    if (uptimeBody) {
      uptimeBody.innerHTML = uptimeItems.length ? uptimeItems.map(d => `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td><span class="badge badge--unknown">${d.uptime_days} gün</span></td>
        </tr>`).join('') : `<tr><td colspan="4" class="loading-cell">30+ gün açık cihaz yok ✓</td></tr>`;
    }

    // ── License compliance ──
    const licItems = [
      ...(compliance.unlicensed?.items   || []),
      ...(compliance.expired?.items      || []),
      ...(compliance.expiring_soon?.items|| []),
    ];
    // De-dup by software+hostname
    const seen = new Set();
    const licUnique = licItems.filter(l => {
      const k = `${l.software_name}|${l.hostname}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    setPill('licIssuePill', licUnique.length);
    const licBody = $(`#licComplianceBody`);
    if (licBody) {
      licBody.innerHTML = licUnique.length ? licUnique.map(l => `
        <tr>
          <td style="font-weight:500;color:var(--text)">${fmt(l.software_name)}</td>
          <td class="serial-cell">${fmt(l.version)}</td>
          <td class="hostname-cell">${fmt(l.hostname)}</td>
          <td>${fmt(l.username)}</td>
          <td>${licStatusBadge(l.license_status)}</td>
          <td>${l.expiry_date ? fmtDate(l.expiry_date) : '—'}</td>
        </tr>`).join('') : `<tr><td colspan="6" class="loading-cell">Lisans sorunu yok ✓</td></tr>`;
    }

    // ── Shadow IT / Kayıt dışı cihazlar ──
    const shadowItems = shadow.shadow?.items || [];
    setPill('shadowPill', shadowItems.length);
    const shadowBody = $(`#shadowBody`);
    if (shadowBody) {
      shadowBody.innerHTML = shadowItems.length ? shadowItems.map(d => `
        <tr>
          <td class="serial-cell">${fmt(d.ip)}</td>
          <td class="serial-cell">${fmt(d.mac)}</td>
          <td class="hostname-cell">${d.hostname ? fmt(d.hostname) : '—'}</td>
          <td>${d.vendor ? fmt(d.vendor) : '—'}</td>
        </tr>`).join('') : `<tr><td colspan="4" class="loading-cell" style="color:var(--green,#22c55e)">Kayıt dışı cihaz yok ✓</td></tr>`;
    }

    // ── EOL / Eski işletim sistemi ──
    const eolItems = [
      ...(eol.eol?.items || []).map(d => ({ ...d, _state: 'eol' })),
      ...(eol.approaching?.items || []).map(d => ({ ...d, _state: 'soon' })),
    ];
    setPill('eolPill', eolItems.length);
    const eolBody = $(`#eolBody`);
    if (eolBody) {
      eolBody.innerHTML = eolItems.length ? eolItems.map(d => {
        const badge = d._state === 'eol'
          ? `<span class="badge badge--offline">${d.days_past} gün önce bitti</span>`
          : `<span class="badge badge--unknown">${d.days_left} gün kaldı</span>`;
        return `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.os)}</td>
          <td>${fmt(d.username)}</td>
          <td>${badge}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="5" class="loading-cell" style="color:var(--green,#22c55e)">Desteği biten işletim sistemi yok ✓</td></tr>`;
    }

    // ── Garanti takibi ──
    const warrItems = [
      ...(warranty.expired?.items || []).map(d => ({ ...d, _state: 'exp' })),
      ...(warranty.expiring_soon?.items || []).map(d => ({ ...d, _state: 'soon' })),
    ];
    setPill('warrantyPill', warrItems.length);
    const warrBody = $(`#warrantyBody`);
    if (warrBody) {
      warrBody.innerHTML = warrItems.length ? warrItems.map(d => {
        const badge = d._state === 'exp'
          ? `<span class="badge badge--offline">${d.days_past} gün önce bitti</span>`
          : `<span class="badge badge--unknown">${d.days_left} gün kaldı</span>`;
        return `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td>${fmtDate(d.warranty_expiry)}</td>
          <td>${badge}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="5" class="loading-cell" style="color:var(--green,#22c55e)">Garanti sorunu yok ✓</td></tr>`;
    }
  } catch (err) {
    console.error('Alerts load error:', err);
    const offBody = $(`#offlineBody`);
    if (offBody) offBody.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color:#ef4444">${err.message}</td></tr>`;
  }
}

function updateAlertsBadge(count) {
  // Topbar zil rozeti aynı sayıyı gösterir
  const bell = $(`#bellBadge`);
  if (bell) {
    bell.textContent = count > 99 ? '99+' : count;
    bell.style.display = count > 0 ? '' : 'none';
  }
  const tabB = $(`#tabAlertBadge`);
  if (tabB) {
    tabB.textContent = count > 99 ? '99+' : count;
    tabB.style.display = count > 0 ? '' : 'none';
  }
  const badge = $(`#alertsNavBadge`);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// Sessiz arka plan: uyarı sayısını başlangıçta yükle (sidebar rozeti için)
async function preloadAlertsBadge() {
  try {
    const [anomalies, offline, compliance, shadow, eol, warranty, drift] = await Promise.all([
      fetchAnomalies(), fetchOfflineAlerts(), fetchLicenseCompliance(),
      fetchShadowIT().catch(() => ({ shadow: { count: 0 } })),
      fetchEolOs().catch(() => ({ total_issues: 0 })),
      fetchWarranty().catch(() => ({ total_issues: 0 })),
      fetchLocationDrift().catch(() => ({ count: 0 })),
    ]);
    const total = (anomalies.total_anomalies || 0) + (offline.total_alerts || 0)
      + (compliance.total_issues || 0) + (shadow.shadow?.count || 0)
      + (eol.total_issues || 0) + (warranty.total_issues || 0) + (drift.count || 0);
    updateAlertsBadge(total);
  } catch (_) { /* sessiz */ }
}

// Periyodik tazeleme: yeni uyarı geldiğinde rozet + (açıksa) panel otomatik güncellensin.
// Uyarılar görünümü açıksa tabloları sessizce (spinner'sız) yeniler; değilse yalnız rozeti.
function startAlertsAutoRefresh(intervalMs = 60000) {
  setInterval(() => {
    if (state.currentView === 'alerts') {
      loadAlerts(false);            // tabloları + rozeti sessizce tazele
    } else {
      preloadAlertsBadge();         // yalnız rozeti tazele
    }
    if (state.currentView === 'lifecycle') {
      loadLifecycle(false);         // çelişki + log + rozet sessizce tazele
    } else {
      preloadLifecycleBadge();      // yalnız lifecycle rozetini tazele
    }
  }, intervalMs);
}

/* ─── Cihaz Yaşam Döngüsü & Audit Log ───────────────────────────────────────── */
const SEVERITY_META = {
  critical: { label: 'KRİTİK', cls: 'badge--offline' },
  high:     { label: 'YÜKSEK', cls: 'badge--offline' },
  medium:   { label: 'ORTA',   cls: 'badge--unknown' },
  low:      { label: 'DÜŞÜK',  cls: 'badge--unknown' },
};
const CONFLICT_LABEL = {
  depoda_ama_aktif:    'Depoda ama ağda aktif',
  kayip_suphesi:       'Kayıp şüphesi (depo girişi yok)',
  kritik_kayip:        'Kritik cihaz kayıp',
  kayip:               'Cihaz kayıp/belirsiz',
  imzasiz_kritik_islem:'Güvenlik ihlali (imzasız kritik işlem)',
  onay_zaman_asimi:    'Onay süresi doldu (yetkisiz/askıda)',
  onay_bekliyor:       'Dijital onay bekleniyor',
};

let lifecycleMetaCache = null; // { states, approvers, requires_approval }

async function getLifecycleMeta() {
  if (!lifecycleMetaCache) {
    try {
      const v = await fetchLifecycleVerify();
      lifecycleMetaCache = {
        states: v.states || [],
        approvers: v.approvers || [],
        requires_approval: v.requires_approval || [],
      };
    } catch { lifecycleMetaCache = { states: [], approvers: [], requires_approval: [] }; }
  }
  return lifecycleMetaCache;
}

async function populateLifecycleForm() {
  // Cihaz listesi
  const sel = $('#lifeAssetSelect');
  if (sel) {
    let assets = state.assets && state.assets.length ? state.assets : null;
    if (!assets) { try { assets = (await fetchAssets({ size: 200 })).results || []; state.assets = assets; } catch { assets = []; } }
    const opts = assets
      .slice()
      .sort((a, b) => (a.hostname || '').localeCompare(b.hostname || ''))
      .map(a => `<option value="${escapeHtml(a.serial_number || '')}" data-hostname="${escapeHtml(a.hostname || '')}" data-id="${a.id}">${escapeHtml(a.hostname || '—')} (${escapeHtml(a.serial_number || '—')})</option>`)
      .join('');
    sel.innerHTML = `<option value="">— Cihaz seçin —</option>${opts}`;
  }
  const meta = await getLifecycleMeta();
  // Durum listesi
  const ssel = $('#lifeStatusSelect');
  if (ssel) {
    ssel.innerHTML = meta.states.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    ssel.onchange = updateApproverRequirement;
  }
  // Onaylayan listesi
  const asel = $('#lifeApprover');
  if (asel) {
    asel.innerHTML = `<option value="">— Onaylayan seçin —</option>` +
      meta.approvers.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  }
  updateApproverRequirement();
}

// Seçili durum kritikse onaylayan alanını "zorunlu" göster + uyarı metni
function updateApproverRequirement() {
  const meta = lifecycleMetaCache || { requires_approval: [] };
  const status = $('#lifeStatusSelect')?.value;
  const req = meta.requires_approval.includes(status);
  const star = $('#lifeApproverReq');
  const hint = $('#lifeApproverHint');
  if (star) star.style.display = req ? '' : 'none';
  if (hint) {
    hint.textContent = req
      ? `⚠ "${status}" kritik bir durumdur — çift onay (dijital imza) gerektirir. Onaylayan seçilmezse işlem GÜVENLİK İHLALİ olarak loglanır.`
      : '';
    hint.style.color = req ? 'var(--orange, #f59e0b)' : 'var(--text-muted)';
  }
}

async function loadLifecycle(showLoading = true) {
  if (showLoading) {
    const cl = $('#lifeConflictList'); if (cl) cl.innerHTML = '<p class="loading-cell">Yükleniyor...</p>';
    const lb = $('#lifeLogBody');      if (lb) lb.innerHTML = '<tr><td colspan="8" class="loading-cell">Yükleniyor...</td></tr>';
    populateLifecycleForm();
  }
  try {
    const [conf, log, netscan, backup] = await Promise.all([
      fetchLifecycleConflicts(),
      fetchLifecycleLog(100),
      fetchNetworkScan().catch(() => ({ alarm: false, findings: { count: 0, items: [] } })),
      fetchBackupStatus().catch(() => null),
    ]);

    renderNetworkAlarm(netscan);
    renderBackupStatus(backup);

    // Özet kartları
    const critical = conf.by_severity?.critical || 0;
    const elC = $('#lifeConflictCount'); if (elC) animateCount(elC, conf.total_conflicts || 0);
    const elK = $('#lifeCriticalCount'); if (elK) animateCount(elK, critical);
    const elT = $('#lifeTotalEvents');   if (elT) animateCount(elT, conf.total_events || 0);

    // Bütünlük: hash zinciri sağlam VE imzasız kritik işlem yok
    const chain = conf.chain || { valid: true };
    const intact = conf.integrity_ok !== undefined ? conf.integrity_ok : chain.valid;
    const ct = $('#chainStatusText'), ci = $('#chainStatusIcon');
    if (ct) {
      ct.textContent = !chain.valid ? 'ZİNCİR BOZULDU!' : (intact ? 'Mühürlü ✓' : 'İHLAL VAR!');
      ct.title = !chain.valid ? (chain.reason || 'Hash zinciri tutarsız')
        : (intact ? `${chain.total} kayıt mühürlü · ${chain.signed_count || 0} dijital imza` : `${conf.security_breaches} imzasız kritik işlem (güvenlik ihlali)`);
    }
    if (ci) ci.className = 'stat-icon ' + (intact ? 'stat-icon--green' : 'stat-icon--red');

    // Nav badge (lifecycle'a özel, bağımsız)
    updateLifecycleBadge(conf.total_conflicts || 0);

    // Çelişki listesi
    setPill('lifeConflictPill', conf.total_conflicts || 0);
    const list = $('#lifeConflictList');
    if (list) {
      const items = conf.conflicts || [];
      list.innerHTML = items.length ? items.map(c => {
        const sev = SEVERITY_META[c.severity] || SEVERITY_META.high;
        const label = CONFLICT_LABEL[c.type] || c.type;
        const renewBtn = c.type === 'onay_zaman_asimi' && c.approval_id
          ? `<button class="btn-report life-renew-btn" data-approval-id="${escapeHtml(c.approval_id)}" style="margin-top:8px;font-size:12px;padding:6px 12px;">Onay talebini yenile</button>`
          : '';
        return `
        <div class="shadow-alert" style="margin-bottom:10px;">
          <p class="shadow-warn" style="display:flex;align-items:center;gap:8px;">
            <span class="badge ${sev.cls}">${sev.label}</span>
            <strong>${escapeHtml(c.hostname)}</strong>
            <span style="color:var(--text-muted);font-weight:400;">· ${escapeHtml(label)}</span>
          </p>
          <p style="margin:6px 0 4px;">${escapeHtml(c.message)}</p>
          <p class="shadow-rec">Loglayan: ${escapeHtml(c.logged_by)} · ${fmtDate(c.logged_at)} · Durum: <strong>${escapeHtml(c.lifecycle_status)}</strong>${c.approver ? ' · Onaylayan: ' + escapeHtml(c.approver) : ''}</p>
          ${renewBtn}
        </div>`;
      }).join('') : `<p class="loading-cell" style="color:var(--green,#22c55e)">Yaşam döngüsü çelişkisi tespit edilmedi ✓</p>`;
      list.querySelectorAll('.life-renew-btn').forEach(b => b.addEventListener('click', () => handleLifecycleRenew(b.dataset.approvalId)));
    }

    // Zaman çizelgesi
    setPill('lifeLogPill', log.total || 0);
    const body = $('#lifeLogBody');
    if (body) {
      const evs = log.events || [];
      body.innerHTML = evs.length ? evs.map(e => `
        <tr>
          <td class="serial-cell">${e.seq}</td>
          <td>${fmtDate(e.timestamp)}</td>
          <td class="hostname-cell">${fmt(e.hostname)}</td>
          <td>${e.from_status ? `<span class="badge badge--unknown">${escapeHtml(e.from_status)}</span> → ` : ''}<span class="badge ${LOST_OR_STORAGE(e.to_status)}">${escapeHtml(e.to_status)}</span></td>
          <td class="upn-cell">${actorIdentityCell(e)}</td>
          <td>${signoffSeal(e)}</td>
          <td class="note-cell" title="${e.note ? escapeHtml(e.note) : ''}">${e.note ? escapeHtml(e.note) : '—'}</td>
          <td class="serial-cell" title="${e.hash}" style="color:var(--text-muted);white-space:nowrap;">${String(e.hash).slice(0, 10)}…</td>
        </tr>`).join('') : `<tr><td colspan="8" class="loading-cell">Henüz log kaydı yok</td></tr>`;
    }
  } catch (err) {
    console.error('Lifecycle load error:', err);
    const cl = $('#lifeConflictList'); if (cl) cl.innerHTML = `<p class="loading-cell" style="color:#ef4444">${err.message}</p>`;
  }
}

// Sign-off / dijital imza mührü (durum ikonu + hover bilgisi)
function signoffSeal(e) {
  const lock = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const warn = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const clock = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  if (e.signed && e.approver) {
    return `<span class="signoff signoff--ok" title="Onaylayan: ${escapeHtml(e.approver)} — Dijital Olarak İmzalandı">${lock}</span>`;
  }
  if (e.security_flag === 'imzasiz_kritik') {
    return `<span class="signoff signoff--breach" title="İMZASIZ — Güvenlik İhlali: kritik durum dijital onay olmadan değiştirildi">${warn}</span>`;
  }
  if (e.approval_status === 'expired') {
    return `<span class="signoff signoff--breach" title="Onay süresi doldu — ${escapeHtml(e.approver || '')} zamanında onaylamadı">${warn}</span>`;
  }
  if (e.approval_status === 'pending') {
    return `<span class="signoff signoff--pending" title="Onay bekliyor — ${escapeHtml(e.approver || '')} dijital imzası bekleniyor">${clock}</span>`;
  }
  return `<span style="color:var(--text-muted);">—</span>`;
}

// İşlem yapan kimlik hücresi: AD UPN + IP + MFA rozeti
function actorIdentityCell(e) {
  const upn = e.actor_upn || e.actor || '—';
  const ipm = (e.actor_ip && e.actor_ip !== '—') ? `${escapeHtml(e.actor_ip)}` : '';
  const mfa = e.mfa_verified === false
    ? `<span class="mfa-badge mfa-no" title="MFA doğrulanmadı / bypass">MFA ✗</span>`
    : `<span class="mfa-badge mfa-ok" title="${escapeHtml(e.mfa_method || 'MFA doğrulandı')}">MFA ✓</span>`;
  return `<div class="upn-cell"><div class="upn">${escapeHtml(upn)}</div><div class="ipm">${ipm}</div>${mfa}</div>`;
}

// Canlı ağ keşfi alarm banner'ı (kritik cihaz ağda aktifse kırmızı)
function renderNetworkAlarm(scan) {
  const el = $('#netAlarmBanner');
  if (!el) return;
  const items = scan?.findings?.items || [];
  if (!items.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <h4><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    CANLI AĞ KEŞFİ — ${items.length} KARANTİNA CİHAZI AĞDA AKTİF!</h4>
    <ul>${items.map(f => `<li>${escapeHtml(f.message)}</li>`).join('')}</ul>`;
}

// WORM yedek bütünlük kartı
function renderBackupStatus(b) {
  if (!b) return;
  const pill = $('#backupSyncPill');
  if (pill) { pill.textContent = b.in_sync ? 'SENKRON' : (b.recovery_needed ? 'KURTARMA GEREKLİ' : 'KONTROL'); }
  const lc = $('#backupLocalCount'); if (lc) lc.textContent = b.local_count;
  const rc = $('#backupRemoteCount'); if (rc) rc.textContent = b.backup_count;
  const det = $('#backupDetail');
  if (det) { det.textContent = b.detail; det.style.color = b.recovery_needed ? 'var(--red,#ef4444)' : 'var(--text-muted)'; }
  const btn = $('#backupRestoreBtn');
  if (btn) btn.style.display = b.recovery_needed ? '' : 'none';
}

function LOST_OR_STORAGE(status) {
  if (status === 'Kayıp' || status === 'Belirsiz') return 'badge--offline';
  if (status === 'Ayrılan Personelden Teslim Alındı' || status === 'Bakımda') return 'badge--unknown';
  return 'badge--online';
}

function updateLifecycleBadge(count) {
  const badge = $('#lifecycleNavBadge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = ''; }
  else badge.style.display = 'none';
}

async function preloadLifecycleBadge() {
  try { const c = await fetchLifecycleConflicts(); updateLifecycleBadge(c.total_conflicts || 0); } catch (_) {}
}

async function handleLifecycleRecord() {
  const sel = $('#lifeAssetSelect');
  const opt = sel && sel.options[sel.selectedIndex];
  const msg = $('#lifeRecordMsg');
  if (!opt || !opt.value && !opt.dataset.hostname) {
    if (msg) { msg.textContent = 'Lütfen bir cihaz seçin.'; msg.style.color = '#ef4444'; }
    return;
  }
  const to_status = $('#lifeStatusSelect')?.value;
  const approver = $('#lifeApprover')?.value || null;
  const note = $('#lifeNote')?.value?.trim() || null;
  const btn = $('#lifeRecordBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor...'; }
  try {
    const r = await postLifecycleEvent({
      serial_number: opt.value || null,
      hostname: opt.dataset.hostname || null,
      asset_id: opt.dataset.id ? Number(opt.dataset.id) : null,
      to_status, approver, note,
    });
    if (msg) {
      if (r.security_breach) {
        msg.style.color = '#ef4444';
        msg.innerHTML = `⚠ GÜVENLİK İHLALİ olarak loglandı (#${r.entry.seq}): "${escapeHtml(to_status)}" kritik durumu dijital onay olmadan kaydedildi. Alarm tetiklendi 🔔`;
      } else if (r.kind === 'pending') {
        msg.style.color = 'var(--accent-light, #818cf8)';
        msg.innerHTML = `🕓 Onaya sunuldu (#${r.entry.seq}). <b>${escapeHtml(approver)}</b> onaylayana kadar durum UYGULANMAZ.` +
          `<div style="margin-top:8px;padding:10px;background:var(--bg-hover,#1e293b);border-radius:8px;">` +
          `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Onaylayana gönderilecek tek kullanımlık dijital onay bağlantısı:</div>` +
          `<a href="${r.approval_link}" target="_blank" style="color:var(--accent-light,#818cf8);word-break:break-all;">${r.approval_link}</a>` +
          `<div style="margin-top:8px;display:flex;gap:8px;">` +
          `<button class="btn-report" id="lifeCopyLink" style="font-size:12px;padding:6px 12px;">Linki kopyala</button>` +
          `<button class="btn-report" id="lifeOpenApprove" style="font-size:12px;padding:6px 12px;">Onay sayfasını aç (onaylayan simülasyonu)</button>` +
          `</div></div>`;
        const copyBtn = $('#lifeCopyLink');
        if (copyBtn) copyBtn.addEventListener('click', () => { navigator.clipboard?.writeText(r.approval_link); copyBtn.textContent = 'Kopyalandı ✓'; });
        const openBtn = $('#lifeOpenApprove');
        if (openBtn) openBtn.addEventListener('click', () => { window.open(r.approval_link, '_blank'); setTimeout(() => loadLifecycle(false), 800); });
      } else {
        msg.style.color = 'var(--green,#22c55e)';
        msg.textContent = `Kaydedildi (#${r.entry.seq}) · ${to_status}${r.notified ? ' · Bildirim gönderildi 🔔' : ''}`;
      }
    }
    if ($('#lifeNote')) $('#lifeNote').value = '';
    if ($('#lifeApprover')) $('#lifeApprover').value = '';
    await loadLifecycle(false); // listeyi + çelişkileri tazele
  } catch (err) {
    if (msg) { msg.style.color = '#ef4444'; msg.textContent = 'Hata: ' + err.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Kaydı Ekle'; }
  }
}

async function postLifecycleRenew(approval_id) {
  const res = await fetch('/api/lifecycle/renew', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approval_id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}

async function handleLifecycleRenew(approval_id) {
  const msg = $('#lifeRecordMsg');
  try {
    const r = await postLifecycleRenew(approval_id);
    if (msg) {
      msg.style.color = 'var(--accent-light, #818cf8)';
      msg.innerHTML = `🔄 Onay talebi yenilendi. Yeni tek kullanımlık bağlantı:` +
        `<div style="margin-top:8px;padding:10px;background:var(--bg-hover,#1e293b);border-radius:8px;">` +
        `<a href="${r.approval_link}" target="_blank" style="color:var(--accent-light,#818cf8);word-break:break-all;">${r.approval_link}</a>` +
        `<div style="margin-top:8px;"><button class="btn-report" id="lifeOpenApprove2" style="font-size:12px;padding:6px 12px;">Onay sayfasını aç</button></div></div>`;
      const ob = $('#lifeOpenApprove2');
      if (ob) ob.addEventListener('click', () => { window.open(r.approval_link, '_blank'); setTimeout(() => loadLifecycle(false), 800); });
    }
    // Yenileme eski ihlali çözer → listeyi tazele
    document.querySelector('#view-lifecycle')?.scrollIntoView({ behavior: 'smooth' });
    await loadLifecycle(false);
  } catch (err) {
    if (msg) { msg.style.color = '#ef4444'; msg.textContent = 'Yenileme hatası: ' + err.message; }
  }
}

/* ─── Search ─────────────────────────────────────────────────────────────── */
function filterTableBySearch(query) {
  const q = query.toLowerCase();
  const rows = $$('.asset-table tbody tr');
  rows.forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(q) ? '' : 'none';
  });
}

/* ─── Chat ──────────────────────────────────────────────────────────────── */
function toggleChat() {
  state.chatOpen = !state.chatOpen;
  const panel = $(`#chatPanel`);
  const fab = $(`#chatFab`);
  panel.classList.toggle('open', state.chatOpen);
  fab.classList.toggle('active', state.chatOpen);
  if (state.chatOpen) $(`#chatInput`)?.focus();
}

function appendMessage(role, text) {
  const container = $(`#chatMessages`);
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const el = document.createElement('div');
  el.className = `msg msg--${role === 'user' ? 'user' : 'ai'}`;
  const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div><span class="msg-time">${now}</span>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

function showTyping() {
  const container = $(`#chatMessages`);
  const el = document.createElement('div');
  el.className = 'msg msg--ai';
  el.id = 'typingIndicator';
  el.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  $(`#typingIndicator`)?.remove();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

async function handleSendChat(message) {
  if (!message.trim()) return;
  const input = $(`#chatInput`);
  const sendBtn = $(`#chatSend`);
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  appendMessage('user', message);
  showTyping();

  try {
    const data = await sendChat(message);
    removeTyping();
    appendMessage('ai', sanitizeAiResponse(data.reply));
  } catch (err) {
    removeTyping();
    appendMessage('ai', `Hata: ${err.message}`);
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ─── AI Yanıt Temizleyici ────────────────────────────────────────────────── */
function sanitizeAiResponse(text) {
  const lines = text.split('\n');
  const clean = [];
  let inJsonBlock = false;

  for (const line of lines) {
    const t = line.trim();

    // Araç çağrısı JSON satırları (model bazen bunları yanıta karıştırıyor)
    if (/^\{"name"\s*:/.test(t) || /^\{"tool"\s*:/.test(t)) continue;

    // JSON bloğu başlangıcı/sonu (```json ... ```)
    if (/^```(json)?/.test(t)) { inJsonBlock = !inJsonBlock; continue; }
    if (inJsonBlock) continue;

    // Sadece > içeren satırlar (boş blockquote) — atla
    if (t === '>') continue;

    // > ile başlayan blockquote → içeriği al
    if (/^>\s/.test(t)) {
      clean.push(t.replace(/^>\s*/, ''));
      continue;
    }

    clean.push(line);
  }

  // "**Etiket:**\nDeğer" → "**Etiket:** Değer" (SADECE tek newline, tablo/liste değilse)
  let result = clean.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  result = result.replace(/(\*\*[^*\n]+:\*\*)\n([A-ZÇĞİÖŞÜa-zçğışöşü])/g, '$1 $2');

  // Yaygın yazım hataları
  result = result.replace(/çevrimiçe/gi, 'çevrimiçi');
  result = result.replace(/çevrimdışe/gi, 'çevrimdışı');

  // Model bazen "X cihaz yeni günden bugünü..." gibi hatalı cümle kuruyor → düzelt
  result = result.replace(
    /(\d+)\s+cihaz\s+yeni\s+gün[^\n.]*(?:güncellenmiştir|eklenmiştir|bulunmaktadır)[^\n]*/gi,
    'Bugün $1 yeni cihaz eklenmiştir.'
  );
  result = result.replace(
    /yeni\s+günden\s+bugün[ü]?[^\n]*/gi,
    'Bugün yeni cihaz eklenmiştir.'
  );

  return result;
}

/* ─── Markdown → HTML ────────────────────────────────────────────────────── */
function markdownToHtml(md) {
  const lines = md.split('\n');
  const html = [];
  let inTable = false;
  let inList  = false;
  let tableHeaderDone = false;

  const inlineFormat = (text) =>
    text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Heading
    if (/^###\s/.test(line)) {
      if (inList)  { html.push('</ul>'); inList = false; }
      if (inTable) { html.push('</tbody></table>'); inTable = false; }
      html.push(`<h3 class="rpt-h3">${inlineFormat(line.replace(/^###\s/, ''))}</h3>`);
      continue;
    }
    if (/^##\s/.test(line)) {
      if (inList)  { html.push('</ul>'); inList = false; }
      if (inTable) { html.push('</tbody></table>'); inTable = false; }
      html.push(`<h2 class="rpt-h2">${inlineFormat(line.replace(/^##\s/, ''))}</h2>`);
      continue;
    }
    if (/^#\s/.test(line)) {
      if (inList)  { html.push('</ul>'); inList = false; }
      if (inTable) { html.push('</tbody></table>'); inTable = false; }
      html.push(`<h1 class="rpt-h1">${inlineFormat(line.replace(/^#\s/, ''))}</h1>`);
      continue;
    }

    // Table row
    if (/^\|/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      // Separator row (---|---) → skip, marks header done
      if (cells.every(c => /^[-:]+$/.test(c))) {
        tableHeaderDone = true;
        continue;
      }
      if (!inTable) {
        html.push('<table class="rpt-table"><thead>');
        html.push('<tr>' + cells.map(c => `<th>${inlineFormat(c)}</th>`).join('') + '</tr>');
        html.push('</thead><tbody>');
        inTable = true;
        tableHeaderDone = false;
      } else {
        html.push('<tr>' + cells.map(c => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>');
      }
      continue;
    }

    // Close table if open
    if (inTable && !/^\|/.test(line)) {
      html.push('</tbody></table>');
      inTable = false;
    }

    // List item (-, *, +, •, veya 1. 2. gibi numaralı)
    if (/^[-*+•]\s/.test(line) || /^\d+\.\s/.test(line)) {
      if (!inList) { html.push('<ul class="rpt-list">'); inList = true; }
      const text = line.replace(/^[-*+•]\s/, '').replace(/^\d+\.\s/, '');
      html.push(`<li>${inlineFormat(text)}</li>`);
      continue;
    }

    // Close list if open
    if (inList && !/^[-*+•]\s/.test(line) && !/^\d+\.\s/.test(line)) {
      html.push('</ul>');
      inList = false;
    }

    // Horizontal rule
    if (/^---+$/.test(line)) {
      html.push('<hr class="rpt-hr">');
      continue;
    }

    // Empty line
    if (!line) {
      html.push('<div class="rpt-spacer"></div>');
      continue;
    }

    // Paragraph
    html.push(`<p class="rpt-p">${inlineFormat(line)}</p>`);
  }

  if (inList)  html.push('</ul>');
  if (inTable) html.push('</tbody></table>');
  return html.join('\n');
}

/* ─── PDF Print ─────────────────────────────────────────────────────────── */
function printReport() {
  const title   = $(`#reportTitle`)?.textContent || 'Rapor';
  const content = $(`#reportContent`)?.innerHTML || '';
  const now     = new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' });

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8"/>
  <title>${title} — AssetMan</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Hanken Grotesk", -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1815; background: #fff; font-size: 13px; line-height: 1.7; -webkit-font-smoothing: antialiased; letter-spacing: -0.006em; }

    /* ── Header (editoryal, açık zemin) ── */
    .pdf-header { padding: 44px 48px 0; }
    .pdf-header-top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 22px; border-bottom: 1px solid #ece5da; }
    .pdf-brand { display: flex; align-items: center; gap: 11px; }
    .pdf-brand-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #6b5cff, #8a7dff); border-radius: 9px; display: flex; align-items: center; justify-content: center; }
    .pdf-brand-icon svg { width: 19px; height: 19px; stroke: #fff; fill: none; stroke-width: 1.8; }
    .pdf-brand-name { font-family: "Fraunces", Georgia, serif; font-size: 17px; font-weight: 600; color: #1a1815; letter-spacing: -0.01em; }
    .pdf-brand-sub  { font-size: 11px; color: #8a8378; margin-top: 1px; }
    .pdf-meta { text-align: right; font-size: 11px; color: #8a8378; line-height: 1.6; }
    .pdf-meta strong { color: #1a1815; font-weight: 600; }
    .pdf-title-block { padding: 30px 0 4px; }
    .pdf-chip { display: inline-flex; align-items: center; gap: 6px; background: #eeecff; color: #6b5cff; font-size: 10.5px; font-weight: 600; padding: 4px 11px; border-radius: 999px; letter-spacing: 0.02em; margin-bottom: 14px; }
    .pdf-chip::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #6b5cff; }
    .pdf-title { font-family: "Fraunces", Georgia, serif; font-size: 30px; font-weight: 600; letter-spacing: -0.01em; color: #1a1815; }
    .pdf-subtitle { font-size: 12.5px; color: #8a8378; margin-top: 6px; }

    /* ── Body ── */
    .pdf-body { padding: 30px 48px 44px; max-width: 820px; }

    /* ── Typography ── */
    .rpt-h1 { font-size: 17px; font-weight: 600; color: #1a1815; margin: 26px 0 10px; padding-bottom: 8px; border-bottom: 1px solid #ece5da; letter-spacing: -0.01em; }
    .rpt-h2 { font-size: 14.5px; font-weight: 600; color: #1a1815; margin: 20px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #f0e9de; }
    .rpt-h3 { font-size: 11px; font-weight: 600; color: #8a8378; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: 0.06em; }
    .rpt-p  { color: #5a544c; margin: 6px 0; font-size: 13px; }
    .rpt-spacer { height: 8px; }
    .rpt-hr { border: none; border-top: 1px solid #f0e9de; margin: 16px 0; }
    strong { font-weight: 600; color: #1a1815; }
    code { background: #f4efe7; border: 1px solid #ece5da; border-radius: 5px; padding: 1px 6px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; color: #6b5cff; }

    /* ── Table (hairline, sıcak nötr başlık) ── */
    .rpt-table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 12px; }
    .rpt-table th { background: #f7f2ea; color: #5a544c; font-weight: 600; padding: 10px 14px; text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e4dbcf; }
    .rpt-table td { padding: 9px 14px; border-bottom: 1px solid #f0e9de; color: #5a544c; font-variant-numeric: tabular-nums; }
    .rpt-table tr:last-child td { border-bottom: none; }

    /* ── List ── */
    .rpt-list { padding-left: 20px; margin: 8px 0 10px; }
    .rpt-list li { padding: 3px 0; color: #5a544c; }
    .rpt-list li::marker { color: #b3a89a; }

    /* ── Footer ── */
    .pdf-footer { margin: 0 48px; padding: 16px 0; border-top: 1px solid #ece5da; display: flex; justify-content: space-between; font-size: 10.5px; color: #b3a89a; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .pdf-brand-icon, .pdf-chip, .rpt-table th, code { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 0; size: A4; }
    }
  </style>
</head>
<body>
  <div class="pdf-header">
    <div class="pdf-header-top">
      <div class="pdf-brand">
        <div class="pdf-brand-icon">
          <svg viewBox="0 0 24 24" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>
        </div>
        <div>
          <div class="pdf-brand-name">AssetMan</div>
          <div class="pdf-brand-sub">IT Asset Management</div>
        </div>
      </div>
      <div class="pdf-meta">
        <div>Oluşturulma Tarihi</div>
        <div><strong>${now}</strong></div>
      </div>
    </div>
    <div class="pdf-title-block">
      <div class="pdf-chip">Yapay Zeka Analizi</div>
      <div class="pdf-title">${title}</div>
      <div class="pdf-subtitle">AssetMan tarafından otomatik oluşturulmuştur</div>
    </div>
  </div>

  <div class="pdf-body">
    ${content}
  </div>

  <div class="pdf-footer">
    <span>AssetMan — IT Asset Management</span>
    <span>Bu rapor yapay zeka destekli analiz ile oluşturulmuştur.</span>
  </div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`);
  win.document.close();
}

/* ─── Reports ────────────────────────────────────────────────────────────── */
async function runReport(prompt, title, appendShadow) {
  const output  = $(`#reportOutput`);
  const content = $(`#reportContent`);
  const titleEl = $(`#reportTitle`);
  const pdfBtn  = $(`#pdfBtn`);

  output.style.display = 'block';
  titleEl.textContent  = title;
  if (pdfBtn) pdfBtn.style.display = 'none';
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:32px 20px;color:var(--text-muted);">
      <div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
      <span style="font-size:13px;">Analiz yapılıyor, lütfen bekleyin...</span>
    </div>`;
  output.scrollIntoView({ behavior: 'smooth' });

  try {
    const data = await sendChat(prompt);
    const cleaned = sanitizeAiResponse(data.reply);
    content.innerHTML = markdownToHtml(cleaned);
    if (appendShadow) {
      try {
        const sdata = await fetchShadowIT();
        content.innerHTML += shadowItReportHtml(sdata);
      } catch (e) { /* Shadow IT taraması başarısızsa rapor yine de gösterilir */ }
      try {
        const edata = await fetchEolOs();
        content.innerHTML += eolReportHtml(edata);
      } catch (e) { /* EOL taraması başarısızsa rapor yine de gösterilir */ }
      try {
        const wdata = await fetchWarranty();
        content.innerHTML += warrantyReportHtml(wdata);
      } catch (e) { /* Garanti taraması başarısızsa rapor yine de gösterilir */ }
    }
    if (pdfBtn) pdfBtn.style.display = 'flex';
  } catch (err) {
    content.innerHTML = `<p style="color:#ef4444;padding:20px;">Hata: ${err.message}</p>`;
  }
}

/* ─── Event Listeners ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Navigation
  $$('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      showView(item.dataset.view);
    });
  });

  // Link to assets from dashboard
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-view]');
    if (link && !link.classList.contains('nav-item')) {
      e.preventDefault();
      showView(link.dataset.view);
    }
  });

  // Refresh button
  $(`#refreshBtn`)?.addEventListener('click', () => {
    const icon = $(`#refreshBtn svg`);
    icon.classList.add('spinning');
    loadDashboard().finally(() => setTimeout(() => icon.classList.remove('spinning'), 500));
  });

  // Çıkış yap
  $(`#logoutBtn`)?.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
    window.location.href = '/login';
  });

  // Topbar tema düğmesi — Ayarlar'daki tercihle aynı anahtarı kullanır
  $(`#themeToggle`)?.addEventListener('click', () => {
    const cur = localStorage.getItem('theme') || 'auto';
    const isDark = cur === 'dark' ||
      (cur === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
    const sel = $(`#setTheme`); if (sel) sel.value = next;
  });

  // Bildirim zili → Uyarılar görünümü
  $(`#bellBtn`)?.addEventListener('click', () => showView('alerts'));

  // TV modu: kayıtlı tercih yoksa yalnız çok geniş ekranda (≥2200) önerilir
  const savedTv = localStorage.getItem('tvMode');
  applyTvMode(savedTv === null ? window.matchMedia('(min-width: 2200px)').matches : savedTv === '1');
  $(`#tvToggle`)?.addEventListener('click', () =>
    applyTvMode(!document.body.classList.contains('tv-mode')));

  // Hesap menüsü (topbar avatar + sidebar üç nokta)
  const userMenu = $(`#userMenu`);
  const toggleUserMenu = (e) => { e.stopPropagation(); userMenu?.classList.toggle('open'); };
  $(`#userChip`)?.addEventListener('click', toggleUserMenu);
  $(`#sbUserMenu`)?.addEventListener('click', toggleUserMenu);
  document.addEventListener('click', (e) => {
    if (userMenu && !e.target.closest('#userMenu')) userMenu.classList.remove('open');
  });
  $(`#menuSettings`)?.addEventListener('click', () => {
    userMenu?.classList.remove('open');
    if (state.role === 'admin') showView('settings');
    else alert('Ayarlar yalnızca yönetici rolündeki kullanıcılara açıktır.');
  });

  // Hızlı İşlemler
  $(`#qaAddAsset`)?.addEventListener('click', () => $(`#qrModalOverlay`)?.classList.add('open'));
  $(`#qaBulk`)?.addEventListener('click', () => {
    $(`#qrModalOverlay`)?.classList.add('open');
    $(`.modal-tab[data-tab="bulk"]`)?.click();
  });
  $(`#qaLifecycle`)?.addEventListener('click', () => showView('lifecycle'));
  $(`#qaReport`)?.addEventListener('click', () => showView('reports'));

  // İşlemler görünümü + Kullanıcı ekle
  $(`#opAddAsset`)?.addEventListener('click', () => $(`#qrModalOverlay`)?.classList.add('open'));
  $(`#opBulk`)?.addEventListener('click', () => {
    $(`#qrModalOverlay`)?.classList.add('open');
    $(`.modal-tab[data-tab="bulk"]`)?.click();
  });
  $(`#opLifecycle`)?.addEventListener('click', () => showView('lifecycle'));
  $(`#opReport`)?.addEventListener('click', () => showView('reports'));
  $(`#openUserModal`)?.addEventListener('click', createUserPrompt);

  // KPI kartından duruma göre filtrelenmiş Varlıklar görünümü
  $$('.kpi[data-status]').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const sel = $(`#filterStatus`);
      if (sel) sel.value = card.dataset.status;
      showView('assets');
    });
  });

  // Sidebar daralt/genişlet (tercih localStorage'da saklanır)
  if (localStorage.getItem('sidebarCollapsed') === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
  // Masaüstünde daralt/genişlet, mobilde drawer aç/kapa (aynı düğme)
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  const openDrawer = () => {
    document.body.classList.add('drawer-open');
    const sc = $(`#drawerScrim`); if (sc) sc.hidden = false;
  };
  const closeDrawer = () => document.body.classList.remove('drawer-open');

  $(`#sidebarToggle`)?.addEventListener('click', () => {
    if (isMobile()) {
      document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer();
      return;
    }
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  });
  $(`#drawerClose`)?.addEventListener('click', closeDrawer);
  $(`#drawerScrim`)?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  // Menüden bir sayfa seçilince drawer kapanır
  $$('.nav-item[data-view]').forEach((n) => n.addEventListener('click', () => { if (isMobile()) closeDrawer(); }));
  // Masaüstüne dönülürse drawer durumu temizlenir
  window.addEventListener('resize', () => { if (!isMobile()) closeDrawer(); });

  // Alt sekme çubuğu
  $$('.tab[data-view]').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $(`#tabMore`)?.addEventListener('click', openDrawer);

  // Topbar araması → Varlıklar sayfasındaki aramayı besler
  $(`#searchInput`)?.addEventListener('input', (e) => {
    const box = $(`#assetSearch`);
    if (box) { box.value = e.target.value; }
    if (state.currentView === 'assets') { state.assetPage = 1; paintAssetsTable(); }
    else if (e.target.value.trim()) showView('assets');
  });

  /* ── Varlıklar v2: filtreler istemcide, sunucuya tekrar gidilmez ── */
  const yenidenCiz = () => { state.assetPage = 1; state.mobileShown = 0; paintAssetsTable(); };
  let aramaZaman = null;
  $(`#assetSearch`)?.addEventListener('input', () => {
    clearTimeout(aramaZaman);
    aramaZaman = setTimeout(yenidenCiz, 180);   // her tuşta yeniden çizme
  });
  ['filterCategory', 'filterLocation', 'filterStatus'].forEach(id =>
    $('#' + id)?.addEventListener('change', yenidenCiz));
  $(`#rowsPerPage`)?.addEventListener('change', yenidenCiz);
  $(`#clearFiltersBtn`)?.addEventListener('click', () => {
    ['assetSearch', 'filterCategory', 'filterLocation', 'filterStatus'].forEach(id => {
      const el = $('#' + id); if (el) el.value = '';
    });
    const t = $(`#searchInput`); if (t) t.value = '';
    state.assetSort = null;
    yenidenCiz();
  });

  // Sütun başlığına tıkla → sırala (aynı sütun tekrar → yön değişir)
  $$('.asset-table--v2 th.sortable').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.assetSort?.key === k) {
      state.assetSort = state.assetSort.dir === 'asc' ? { key: k, dir: 'desc' } : null;
    } else state.assetSort = { key: k, dir: 'asc' };
    yenidenCiz();
  }));

  // Mobil: kümülatif yükleme
  $(`#loadMoreBtn`)?.addEventListener('click', () => {
    const per = Number($(`#rowsPerPage`)?.value) || 25;
    state.mobileShown = (state.mobileShown || per) + per;
    paintAssetsTable();
  });

  // Toplu seçim
  $(`#selectAll`)?.addEventListener('change', (e) => {
    state.selectedAssets = state.selectedAssets || new Set();
    // "Tümü" YALNIZ filtre kapsamındakileri seçer (görünmeyeni sessizce seçmez)
    (state.renderedAssets || []).forEach(a =>
      e.target.checked ? state.selectedAssets.add(a.id) : state.selectedAssets.delete(a.id));
    paintAssetsTable();
  });
  $(`#bulkClearBtn`)?.addEventListener('click', () => {
    state.selectedAssets = new Set();
    paintAssetsTable();
  });
  $(`#bulkExportBtn`)?.addEventListener('click', () => {
    const sel = state.selectedAssets || new Set();
    exportAssetsCSV((state.allAssets || []).filter(a => sel.has(a.id)));
  });

  // Başlıktaki "diğer işlemler" menüsü
  $(`#assetsMoreBtn`)?.addEventListener('click', (e) => {
    e.stopPropagation(); $(`#assetsMoreMenu`)?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#assetsMoreBtn')) $(`#assetsMoreMenu`)?.classList.remove('open');
  });
  $(`#assetsRefreshBtn`)?.addEventListener('click', () => {
    $(`#assetsMoreMenu`)?.classList.remove('open'); renderAssetsTable();
  });
  $(`#bulkStockBtn`)?.addEventListener('click', () => {
    $(`#assetsMoreMenu`)?.classList.remove('open');
    $(`#qrModalOverlay`)?.classList.add('open');
    $(`.modal-tab[data-tab="bulk"]`)?.click();
  });

  // Chat FAB
  $(`#chatFab`)?.addEventListener('click', toggleChat);
  $(`#closeChat`)?.addEventListener('click', toggleChat);

  // Clear chat
  $(`#clearChat`)?.addEventListener('click', async () => {
    await clearChatSession();
    const container = $(`#chatMessages`);
    container.innerHTML = `
      <div class="chat-welcome">
        <div class="msg msg--ai">
          <div class="msg-bubble">Merhaba, ben AssetMan Asistan. Size nasıl yardımcı olabilirim?</div>
        </div>
        <div class="quick-prompts">
          <button class="quick-btn" data-q="Kaç cihazım var? Genel bir özet ver.">Genel Özet</button>
          <button class="quick-btn" data-q="Hangi markalar var ve dağılımı nedir?">Marka Analizi</button>
          <button class="quick-btn" data-q="En az RAM'e sahip 5 cihazı listele.">Düşük RAM</button>
          <button class="quick-btn" data-q="Cevrimdışı olan cihazlar var mı?">Çevrimdışı</button>
        </div>
      </div>`;
  });

  // Chat send
  $(`#chatSend`)?.addEventListener('click', () => {
    handleSendChat($(`#chatInput`).value);
  });
  $(`#chatInput`)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat($(`#chatInput`).value);
    }
  });

  // Quick prompts
  $(`#chatMessages`)?.addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-btn');
    if (btn) {
      toggleChat(); // make sure open
      if (!state.chatOpen) toggleChat();
      handleSendChat(btn.dataset.q);
    }
  });

  // License filters
  $(`#licFilterStatus`)?.addEventListener('change', () => state.licenses && renderLicenseTable(state.licenses));
  $(`#licFilterType`)?.addEventListener('change', () => state.licenses && renderLicenseTable(state.licenses));
  $(`#licSearch`)?.addEventListener('input', () => state.licenses && renderLicenseTable(state.licenses));

  // Report buttons
  $$('.btn-report').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.report-card');
      if (!card) return; // #generateQr / #createBulk de btn-report sınıfı taşıyor ama report-card içinde değil
      const prompt = btn.dataset.prompt;
      const title = card.querySelector('h4').textContent;
      runReport(prompt, title, btn.dataset.shadow === '1');
    });
  });

  // Close report
  $(`#closeReport`)?.addEventListener('click', () => {
    $(`#reportOutput`).style.display = 'none';
  });

  // QR ile Cihaz Ekle modalı
  const qrOverlay = $(`#qrModalOverlay`);
  $(`#openAddModal`)?.addEventListener('click', () => qrOverlay?.classList.add('open'));
  $(`#closeQrModal`)?.addEventListener('click', () => qrOverlay?.classList.remove('open'));
  qrOverlay?.addEventListener('click', (e) => { if (e.target === qrOverlay) qrOverlay.classList.remove('open'); });

  // Excel/CSV dışa aktarım
  $(`#exportCsvBtn`)?.addEventListener('click', exportAssetsCSV);

  // Cihaz detay modalı
  const devOverlay = $(`#deviceModalOverlay`);
  $(`#closeDeviceModal`)?.addEventListener('click', () => devOverlay?.classList.remove('open'));
  devOverlay?.addEventListener('click', (e) => { if (e.target === devOverlay) devOverlay.classList.remove('open'); });
  $(`#handoverPdfBtn`)?.addEventListener('click', () => printHandoverReceipt(_deviceModalAsset));

  // Ayarlar kaydet butonları
  $(`#saveThresholds`)?.addEventListener('click', saveThresholds);
  $(`#seedExpectedBtn`)?.addEventListener('click', seedExpectedLocations);

  /* Tarih aralığı + Filtrele: tasarımda ≥901px'te TOPBAR'da, mobilde başlık
     altında duruyor. CSS iki farklı kapsayıcı arasında taşıyamaz → tek öğe
     JS ile uygun montaj noktasına taşınır (kopya YOK, olay bağları korunur). */
  const toolbar = $(`.dash-toolbar`);
  const slot = $(`#topbarToolbarSlot`);
  const headerMount = $(`#view-dashboard .page-header`);
  function placeToolbar() {
    if (!toolbar || !slot || !headerMount) return;
    const wide = window.matchMedia('(min-width: 901px)').matches;
    const target = wide ? slot : headerMount;
    if (toolbar.parentElement !== target) target.appendChild(toolbar);
  }
  placeToolbar();
  window.addEventListener('resize', placeToolbar);

  // ── Tarih aralığı seçici: trend penceresini VE zaman bazlı kartları etkiler ──
  state.rangeDays = Number(localStorage.getItem('dashRangeDays')) || 30;
  const rangeLbl = { 7: 'Son 7 gün', 30: 'Son 30 gün', 90: 'Son 90 gün', 365: 'Son 1 yıl' };
  const setRangeLabel = () => {
    const el = $(`#dateRangeLabel`); if (el) el.textContent = rangeLbl[state.rangeDays] || 'Son 30 gün';
    $$('#dateRangeMenu button').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === state.rangeDays));
  };
  setRangeLabel();
  $(`#dateRangeBtn`)?.addEventListener('click', (e) => {
    e.stopPropagation(); $(`#filterMenu`)?.classList.remove('open');
    $(`#dateRangeMenu`)?.classList.toggle('open');
  });
  $$('#dateRangeMenu button').forEach((b) => b.addEventListener('click', () => {
    state.rangeDays = Number(b.dataset.days) || 30;
    localStorage.setItem('dashRangeDays', String(state.rangeDays));
    setRangeLabel();
    $(`#dateRangeMenu`)?.classList.remove('open');
    loadDashboard();
  }));

  // ── Filtrele: kategoriye göre dashboard'ı daralt ──
  $(`#filterBtn`)?.addEventListener('click', (e) => {
    e.stopPropagation(); $(`#dateRangeMenu`)?.classList.remove('open');
    $(`#filterMenu`)?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dash-toolbar')) {
      $(`#dateRangeMenu`)?.classList.remove('open');
      $(`#filterMenu`)?.classList.remove('open');
    }
  });

  // ── Harita yakınlaştırma (balon ölçeği) ──
  state.mapZoom = 1;
  const zoom = (f) => {
    state.mapZoom = Math.min(2.5, Math.max(0.6, (state.mapZoom || 1) * f));
    renderLocationMap(state.locations || {});
  };
  $(`#mapZoomIn`)?.addEventListener('click', () => zoom(1.25));
  $(`#mapZoomOut`)?.addEventListener('click', () => zoom(0.8));

  // Lokasyon kartı: harita/liste geçişi + KPI kartından liste görünümüne atlama
  $(`#locViewMode`)?.addEventListener('change', () => applyLocViewMode(state.locations || {}));
  $(`#kpiLocCard`)?.addEventListener('click', (e) => {
    e.preventDefault();
    const sel = $(`#locViewMode`);
    if (sel) { sel.value = 'list'; applyLocViewMode(state.locations || {}); }
    $(`#locListWrap`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Şiddet satırları → Uyarılar görünümü
  $$('.sev-row').forEach((r) => r.addEventListener('click', () => showView('alerts')));
  $(`#saveAppearance`)?.addEventListener('click', saveAppearance);

  // Hat (Turkcell) modalı + CSV import
  const lineOverlay = $(`#lineModalOverlay`);
  $(`#openAddLine`)?.addEventListener('click', openLineModal);
  $(`#closeLineModal`)?.addEventListener('click', () => lineOverlay?.classList.remove('open'));
  lineOverlay?.addEventListener('click', (e) => { if (e.target === lineOverlay) lineOverlay.classList.remove('open'); });
  $(`#saveLineBtn`)?.addEventListener('click', saveLine);
  $(`#importLinesBtn`)?.addEventListener('click', () => $(`#lineCsvInput`)?.click());
  $(`#lineCsvInput`)?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { importLinesCsv(String(reader.result || '')); e.target.value = ''; };
    reader.readAsText(file, 'utf-8');
  });

  $(`#generateQr`)?.addEventListener('click', () => {
    // Mobil kayıt URL'sini bu tarayıcının origin'inden kur (aynı ağdaki telefon erişebilsin)
    const params = new URLSearchParams();
    const cat  = $(`#qrCategory`)?.value || '';
    const loc  = $(`#qrLocation`)?.value.trim() || '';
    const user = $(`#qrUsername`)?.value.trim() || '';
    if (cat)  params.set('category', cat);
    if (loc)  params.set('location', loc);
    if (user) params.set('username', user);

    const registerUrl = `${location.origin}/register${params.toString() ? '?' + params.toString() : ''}`;
    const qrSrc = `/api/qr?data=${encodeURIComponent(registerUrl)}`;

    $(`#qrImg`).src = qrSrc;
    $(`#qrLink`).textContent = registerUrl;
    $(`#qrLink`).href = registerUrl;
    $(`#qrPlaceholder`).style.display = 'none';
    $(`#qrBox`).style.display = 'flex';
    $(`#printQr`).style.display = 'flex';
  });

  $(`#printQr`)?.addEventListener('click', () => {
    const src = $(`#qrImg`)?.src;
    const url = $(`#qrLink`)?.textContent || '';
    if (!src) return;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/><title>Cihaz Kayıt QR — AssetMan</title>
      <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center;padding:60px 20px;color:#1e293b}
      h1{font-size:22px;margin-bottom:8px}p{color:#64748b;font-size:14px;margin-bottom:28px}
      img{width:300px;height:300px;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
      .u{margin-top:20px;font-size:12px;color:#94a3b8;word-break:break-all}</style></head>
      <body><h1>AssetMan — Cihaz Kaydı</h1><p>Telefonunuzla bu QR kodu okutarak cihazınızı envantere ekleyin.</p>
      <img src="${src}" alt="QR"/><div class="u">${url}</div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
    win.document.close();
  });

  // Modal sekme geçişi
  $$('.modal-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.modal-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.modal-tabpane').forEach((p) => p.style.display = 'none');
      const pane = $(`#tab-${tab.dataset.tab}`);
      if (pane) pane.style.display = 'block';
    });
  });

  // Toplu depo kaydı
  $(`#createBulk`)?.addEventListener('click', async () => {
    const btn = $(`#createBulk`);
    const resultEl = $(`#bulkResult`);
    const category = $(`#bulkCategory`)?.value || 'Diğer';
    const quantity = parseInt($(`#bulkQty`)?.value, 10) || 0;
    const location = $(`#bulkLocation`)?.value.trim() || '';
    const prefix   = $(`#bulkPrefix`)?.value.trim() || '';

    if (quantity < 1 || quantity > 200) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<span style="color:var(--red)">Adet 1-200 arası olmalı.</span>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Oluşturuluyor...';
    resultEl.style.display = 'none';

    try {
      const res = await fetch('/api/register/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, quantity, location, prefix }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'Hata');

      const first = data.items[0]?.hostname || '';
      const last  = data.items[data.items.length - 1]?.hostname || '';
      resultEl.style.display = 'block';
      resultEl.innerHTML =
        `<div class="ok-line">✓ ${data.count} adet "${category}" taslağı oluşturuldu.</div>` +
        `<div>ID aralığı: <code>${first}</code> – <code>${last}</code></div>` +
        `<div style="margin-top:6px;color:var(--text-muted)">Durum: depoda · Cihazlar açılıp tanımlanınca Varlıklar sayfasından düzenlenebilir.</div>`;

      // Envanteri tazele
      loadDashboard();
      if (state.currentView === 'assets') renderAssetsTable();
    } catch (ex) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<span style="color:var(--red)">Hata: ${ex.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Taslak Kayıtları Oluştur';
    }
  });

  // Yaşam döngüsü: durum kaydı ekle
  $(`#lifeRecordBtn`)?.addEventListener('click', handleLifecycleRecord);

  // WORM yedekten geri yükle
  $(`#backupRestoreBtn`)?.addEventListener('click', async () => {
    const btn = $(`#backupRestoreBtn`);
    btn.disabled = true; btn.textContent = 'Geri yükleniyor...';
    try {
      const r = await postBackupRestore();
      const det = $('#backupDetail');
      if (det) { det.style.color = 'var(--green,#22c55e)'; det.textContent = `Yedekten ${r.restored} kayıt geri yüklendi, bütünlük yeniden sağlandı ✓`; }
      await loadLifecycle(false);
    } catch (err) {
      const det = $('#backupDetail'); if (det) { det.style.color = 'var(--red,#ef4444)'; det.textContent = 'Geri yükleme hatası: ' + err.message; }
    } finally { btn.disabled = false; btn.textContent = 'Yedekten Geri Yükle'; }
  });

  // Kaydedilmiş temayı uygula (auto → sistem tercihi)
  applyTheme(localStorage.getItem('theme') || 'auto');

  // Initial load
  loadDashboard();
  loadAiProviderInfo();
  setInterval(loadAiProviderInfo, 15000); // sunucu durumunu canlı izle (yeşil/kırmızı ışık)
  preloadAlertsBadge();
  preloadLifecycleBadge();
  startAlertsAutoRefresh(60000); // 60 sn'de bir rozet + (açıksa) panel otomatik tazele
  loadCurrentUser();
});
