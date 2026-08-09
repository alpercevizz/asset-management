/* AssetMan · assets.js
   Cihaz detay modali, TV varlik panosu, zimmet tutanagi, Varliklar gorunumu

   NOT: Bu dosya app.js'ten bolundu. ES modul DEGIL - index.html'de
   sirayla yuklenen duz scriptler; global kapsam paylasiliyor.
   Yukleme sirasi index.html'deki <script> siralamasidir. */

/* ─── Cihaz Detay & Geçmiş Modalı ───────────────────────────────────────────── */
let _deviceModalAsset = null;

/* ═══ Varlık Detayı ══════════════════════════════════════════════════════════
   Görsel MODELE bağlıdır (cihaza değil): bir kez yüklenen görsel o modeldeki
   tüm cihazlarda görünür. Eşleşme 4 kademeli (sunucuda): tam model → model
   ailesi → marka+kategori → kategori. Hiçbiri yoksa aşağıdaki YERLEŞİK
   kategori çizimi kullanılır — sayfa asla boş görünmez.
   Görseller kendi sunucumuzdan servis edilir; dış CDN/görsel API'si YOK. */
const KAT_CIZIM = {
  'Bilgisayar': `<rect x="10" y="16" width="60" height="38" rx="4"/><path d="M4 60h72l-6-6H10z"/><rect x="16" y="22" width="48" height="26" rx="2" opacity=".35"/>`,
  'Sunucu': `<rect x="14" y="12" width="52" height="16" rx="3"/><rect x="14" y="32" width="52" height="16" rx="3"/><rect x="14" y="52" width="52" height="12" rx="3"/><circle cx="22" cy="20" r="2.2" opacity=".55"/><circle cx="22" cy="40" r="2.2" opacity=".55"/>`,
  'Telefon': `<rect x="26" y="8" width="28" height="56" rx="5"/><rect x="30" y="14" width="20" height="40" rx="2" opacity=".35"/><circle cx="40" cy="59" r="2"/>`,
  'Tablet': `<rect x="18" y="10" width="44" height="54" rx="4"/><rect x="22" y="15" width="36" height="42" rx="2" opacity=".35"/><circle cx="40" cy="60" r="1.8"/>`,
  'El Terminali': `<rect x="24" y="6" width="32" height="62" rx="5"/><rect x="28" y="12" width="24" height="26" rx="2" opacity=".35"/><rect x="29" y="43" width="8" height="6" rx="1" opacity=".55"/><rect x="43" y="43" width="8" height="6" rx="1" opacity=".55"/><rect x="29" y="53" width="22" height="6" rx="1" opacity=".55"/>`,
  'Yazıcı': `<path d="M22 10h36v16H22z"/><rect x="10" y="26" width="60" height="24" rx="4"/><path d="M22 44h36v22H22z" opacity=".35"/><circle cx="60" cy="34" r="2.5" opacity=".7"/>`,
  'Ağ Aygıtı': `<rect x="8" y="40" width="64" height="20" rx="4"/><circle cx="18" cy="50" r="2.4" opacity=".7"/><circle cx="27" cy="50" r="2.4" opacity=".7"/><circle cx="36" cy="50" r="2.4" opacity=".7"/><path d="M40 40V22M28 14l12-8 12 8" stroke-width="4" fill="none"/>`,
  'Çevre Aygıtı': `<path d="M14 34a26 26 0 0 1 52 0v16a6 6 0 0 1-6 6h-8V34h14"/><path d="M14 50V34h14v22h-8a6 6 0 0 1-6-6z"/>`,
  'Diğer': `<rect x="12" y="16" width="56" height="44" rx="5"/><path d="M12 30h56" opacity=".5"/>`,
};


/* "15 saniye önce" biçimi — duvar ekranında mutlak tarihten daha okunur. */
function gecenSure(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const sn = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sn < 60) return `${sn} saniye önce`;
  if (sn < 3600) return `${Math.floor(sn / 60)} dakika önce`;
  if (sn < 86400) return `${Math.floor(sn / 3600)} saat önce`;
  return `${Math.floor(sn / 86400)} gün önce`;
}

function katCizim(kategori) {
  const p = KAT_CIZIM[kategori] || KAT_CIZIM['Diğer'];
  return `<svg viewBox="0 0 80 76" fill="currentColor" stroke="currentColor" stroke-width="0"
    aria-hidden="true" class="ad-illus">${p}</svg>`;
}

function trTarih(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function trPara(v, cur) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sim = { TRY: '₺', USD: '$', EUR: '€' }[cur || 'TRY'] || '';
  return sim + n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ═══ TELEMETRİ SEKMESİ ═════════════════════════════════════════════════════
   HİÇBİR SAYI UYDURULMAZ. Cihaz ölçümü göndermediyse kart "ölçüm yok" der.
   Bu bilinçli: bir sunucuda pil, bir sanal makinede sıcaklık sensörü YOKTUR;
   oraya %0 veya 0°C yazmak müşteriye yanlış bilgi vermek olurdu. Aynı şekilde
   güvenlik kartında "bilinmiyor" ile "kapalı" ayrı gösterilir — biri okunamadı,
   diğeri gerçekten kapalı demektir. */

/* Sparkline: dış kütüphane yok, düz SVG polyline. */
function sparkline(degerler, renk) {
  const v = (degerler || []).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
  if (v.length < 2) return '<div class="tm-spark tm-spark--bos">grafik için en az 2 ölçüm gerekir</div>';
  const en = Math.min(...v), buyuk = Math.max(...v);
  const fark = buyuk - en || 1;         // düz çizgi: sıfıra bölme koruması
  const W = 100, H = 28;
  const nok = v.map((x, i) => {
    const px = (i / (v.length - 1)) * W;
    const py = H - ((x - en) / fark) * (H - 4) - 2;
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(' ');
  return `<svg class="tm-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${nok}" fill="none" stroke="${renk}" stroke-width="1.6"
      vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

const TVA_YENILE = Number(localStorage.getItem("tvaYenile") || 30000);  // ms
/* ═══ VARLIK DETAYI · TV / DUVAR EKRANI ══════════════════════════════════════
   TV modunda bir varlık açıldığında modal yerine tam ekran, koyu, kendini
   yenileyen tek-cihaz panosu çizilir. Duvar ekranında kimse tıklamıyor:
   her şey aynı anda görünmeli, uzaktan okunabilmeli ve kendi kendine
   tazelenmeli.

   VERİ DÜRÜSTLÜĞÜ: tasarımda lokasyon kartında bina fotoğrafı ve açık adres,
   kullanıcı kartında e-posta ve unvan var — bunların HİÇBİRİ sistemde yok.
   Uydurmak yerine sahip olduğumuz alanlar gösteriliyor (lokasyon adı,
   varsa koordinat; zimmetli kişinin adı). Eksik alan "—" kalır. */

let _tvaTimer = null;   // otomatik yenileme

/* Büyük çizgi grafik (sparkline'dan farklı: eksen etiketleri + ızgara).
   Duvar ekranından metrenin ötesinden okunacağı için etiketler iri. */
function tvaChart(seri, renk, baslik) {
  const v = (seri || []).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
  if (v.length < 2) {
    return `<div class="tva-ch">
      <div class="tva-ch-t">${escapeHtml(baslik)}</div>
      <div class="tva-ch-bos">grafik için en az 2 ölçüm gerekir</div></div>`;
  }
  const W = 300, H = 62;
  const nok = v.map((x, i) => {
    const px = (i / (v.length - 1)) * W;
    const py = H - (Math.max(0, Math.min(100, x)) / 100) * H;   // 0-100 sabit ölçek
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(' ');
  return `<div class="tva-ch">
    <div class="tva-ch-t">${escapeHtml(baslik)}</div>
    <div class="tva-ch-body">
      <div class="tva-ch-y"><span>100</span><span>50</span><span>0</span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="0.5" x2="${W}" y2="0.5"/>
        <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
        <line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>
        <polyline points="${nok}" fill="none" stroke="${renk}" stroke-width="1.8"
          vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
    </div></div>`;
}

/* Cihaza özel kritik uyarılar — HEPSİ mevcut veriden hesaplanır.
   Uyarı yoksa yeşil onay gösterilir; "sorun yok" da bir bilgidir. */
function tvaUyarilar(a, d, tel) {
  const u = [];
  const L = tel.latest, G = tel.security;

  if (String(a.status || '').toLowerCase() === 'offline') u.push(['kritik', 'Cihaz çevrimdışı']);

  const gar = Date.parse(a.warranty_expiry);
  if (!Number.isNaN(gar)) {
    const gun = Math.ceil((gar - Date.now()) / 86400000);
    if (gun < 0) u.push(['kritik', 'Garanti süresi dolmuş']);
    else if (gun <= 30) u.push(['uyari', `Garanti ${gun} gün içinde bitiyor`]);
  }

  if (L && L.disk_used_gb != null && L.disk_total_gb) {
    const pct = Math.round((L.disk_used_gb / L.disk_total_gb) * 100);
    if (pct >= 90) u.push(['kritik', `Disk %${pct} dolu`]);
    else if (pct >= 80) u.push(['uyari', `Disk %${pct} dolu`]);
  }
  if (L && L.cpu_pct != null && L.cpu_pct >= 90) u.push(['uyari', `CPU %${Math.round(L.cpu_pct)}`]);
  if (L && L.temp_c != null && L.temp_c >= 80) u.push(['kritik', `Sıcaklık ${L.temp_c}°C`]);

  if (G) {
    if (G.firewall === 'pasif') u.push(['kritik', 'Güvenlik duvarı kapalı']);
    if (G.defender === 'pasif') u.push(['kritik', 'Defender kapalı']);
    if (G.disk_encryption === 'pasif') u.push(['uyari', 'Disk şifreleme kapalı']);
    if (G.critical_patches > 0) u.push(['kritik', `${G.critical_patches} kritik yama bekliyor`]);
  }

  // Beklenen lokasyon dışında mı? (resmi kayıt vs telemetri)
  const bek = d.expected_location?.location;
  const gor = d.current_stay?.to_location || (a.location || '').trim();
  if (bek && gor && bek.toLowerCase() !== gor.toLowerCase()) {
    u.push(['uyari', `Lokasyon dışında: ${gor}`]);
  }
  return u;
}

function renderTvAsset(a, d, tel) {
  const det = d.detail || {};
  const L = tel.latest, S = tel.series || [];
  const yuzde = (kul, top) => (kul == null || !top ? null : Math.round((kul / top) * 100));
  const gorsel = d.image
    ? `<img src="${d.image.url}" alt="" class="tva-img">`
    : `<div class="tva-illus">${katCizim(a.category)}</div>`;

  const olc = (baslik, deger, alt, seri, renk) => `
    <div class="tva-m">
      <div class="tva-m-t">${escapeHtml(baslik)}</div>
      ${deger === null || deger === undefined
        ? '<div class="tva-m-yok">Ölçüm yok</div>'
        : `<div class="tva-m-v">${deger}</div><div class="tva-m-a">${alt || ''}</div>
           ${sparkline(seri, renk)}`}
    </div>`;

  const ramP = L ? yuzde(L.ram_used_gb, L.ram_total_gb) : null;
  const diskP = L ? yuzde(L.disk_used_gb, L.disk_total_gb) : null;
  const pilAd = { sarj_oluyor: 'Şarj oluyor', pilde: 'Pilde', dolu: 'Dolu' };

  const metrikler = [
    olc('CPU Kullanımı', L && L.cpu_pct != null ? `${Math.round(L.cpu_pct)}%` : null,
      L && L.cpu_pct != null ? (L.cpu_pct < 50 ? 'İyi' : L.cpu_pct < 85 ? 'Yoğun' : 'Kritik') : '',
      S.map(r => r.cpu_pct), 'var(--blue)'),
    olc('RAM Kullanımı', ramP != null ? `${ramP}%` : null,
      L && L.ram_used_gb != null ? `${L.ram_used_gb} GB / ${L.ram_total_gb || '?'} GB` : '',
      S.map(r => yuzde(r.ram_used_gb, r.ram_total_gb)), 'var(--accent)'),
    olc('Disk Kullanımı', diskP != null ? `${diskP}%` : null,
      L && L.disk_used_gb != null ? `${Math.round(L.disk_used_gb)} GB / ${Math.round(L.disk_total_gb || 0)} GB` : '',
      S.map(r => yuzde(r.disk_used_gb, r.disk_total_gb)), 'var(--purple)'),
    olc('Ağ Kullanımı', L && L.net_rx_mbps != null
      ? `${(Number(L.net_rx_mbps) + Number(L.net_tx_mbps || 0)).toFixed(1)} <small>Mbps</small>` : null,
      L && L.net_rx_mbps != null ? `↓ ${L.net_rx_mbps} &nbsp; ↑ ${L.net_tx_mbps ?? '—'}` : '',
      S.map(r => r.net_rx_mbps), 'var(--teal)'),
    olc('Pil Durumu', L && L.battery_pct != null ? `${Math.round(L.battery_pct)}%` : null,
      L ? (pilAd[L.battery_state] || '') : '', S.map(r => r.battery_pct), 'var(--green)'),
    olc('Sıcaklık', L && L.temp_c != null ? `${L.temp_c}°C` : null,
      L && L.temp_c != null ? (L.temp_c < 60 ? 'Normal' : L.temp_c < 80 ? 'Yüksek' : 'Kritik') : '',
      S.map(r => r.temp_c), 'var(--orange)'),
  ].join('');

  const upt = a.uptime_days != null
    ? `${Math.floor(a.uptime_days)} gün, ${Math.round((a.uptime_days % 1) * 24)} saat` : '—';

  const serit = [
    ['Son Görülme', gecenSure(a.last_seen)],
    ['Son Envanter Taraması', tel.latest ? fmtDate(tel.latest.measured_at) : '—'],
    ['Son Bakım', trTarih(det.last_maintenance)],
    ['Sonraki Bakım', trTarih(det.next_maintenance)],
    ['Çalışma Süresi', upt],
  ].map(([k, v]) => `<div class="tva-s"><span>${k}</span><b>${v}</b></div>`).join('');

  const G = tel.security;
  const rz = (v) => v === 'aktif' ? '<b class="tva-ok">Aktif</b>'
    : v === 'pasif' ? '<b class="tva-no">Kapalı</b>'
    : '<b class="tva-bilinmiyor">bilinmiyor</b>';

  const uyarilar = tvaUyarilar(a, d, tel);

  return `
  <div class="tva">
    <div class="tva-head">
      <div class="tva-brand"><b>AssetMan</b><span>OPERASYON MERKEZİ</span></div>
      <div class="tva-head-r">
        <span class="tva-sys"><i class="${uyarilar.some(x => x[0] === 'kritik') ? 'kirmizi' : uyarilar.length ? 'sari' : 'yesil'}"></i>
          Sistem Durumu <b>${uyarilar.some(x => x[0] === 'kritik') ? 'KRİTİK' : uyarilar.length ? 'DİKKAT' : 'TÜM SİSTEMLER NORMAL'}</b></span>
        <span class="tva-clock" id="tvaClock"></span>
        <button class="btn-icon" id="tvaExit" title="TV modundan çık" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <div class="tva-main">
      <div class="tva-dev">
        <div class="tva-photo">${gorsel}</div>
        <h2 class="tva-name">${fmt(a.hostname)}</h2>
        <div class="tva-badge ${String(a.status).toLowerCase() === 'online' ? 'on' : 'off'}">
          <i></i>${escapeHtml(a.status || 'bilinmiyor')}</div>
        <div class="tva-ident">
          <div><span>Varlık Kodu</span><b>${det.asset_code ? escapeHtml(det.asset_code) : '—'}</b></div>
          <div><span>Kategori</span><b>${escapeHtml(a.category || '—')}</b></div>
          <div><span>Lokasyon</span><b>${escapeHtml((a.location || '').trim() || '—')}</b></div>
          <div><span>Sorumlu Kişi</span><b>${escapeHtml(d.assignment?.assigned_to || 'Zimmetsiz')}</b></div>
          <div><span>İşletim Sistemi</span><b>${fmt(a.os)}</b></div>
          <div><span>Agent Versiyonu</span><b>${a.collector_ver ? escapeHtml(a.collector_ver) : '—'}</b></div>
        </div>
      </div>

      <div class="tva-metrics">${metrikler}</div>
      <div class="tva-strip">${serit}</div>
    </div>

    <div class="tva-r3">
      <div class="tva-card">
        <h4>Konum &amp; Kullanıcı</h4>
        <div class="tva-kk">
          <div class="tva-kk-i">📍</div>
          <div><b>${escapeHtml((a.location || '').trim() || 'Lokasyon yok')}</b>
            <small>${d.current_stay?.first_seen_at ? fmtDate(d.current_stay.first_seen_at) + '’den beri' : 'konaklama kaydı yok'}</small></div>
        </div>
        <div class="tva-kk">
          <div class="tva-kk-i tva-kk-av">${(d.assignment?.assigned_to || '?').slice(0, 2).toLocaleUpperCase('tr-TR')}</div>
          <div><b>${escapeHtml(d.assignment?.assigned_to || 'Zimmetsiz')}</b>
            <small>${a.username ? 'son giriş: ' + escapeHtml(a.username) : 'oturum bilgisi yok'}</small></div>
        </div>
      </div>

      <div class="tva-card">
        <h4>Sistem Bilgileri</h4>
        <div class="tva-row"><span>Üretici / Model</span><b>${fmt(a.brand)} ${fmt(a.model, '')}</b></div>
        <div class="tva-row"><span>Seri Numarası</span><b>${fmt(a.serial_number)}</b></div>
        <div class="tva-row"><span>IP Adresi</span><b>${fmt(a.ip_address)}</b></div>
        <div class="tva-row"><span>MAC Adresi</span><b>${fmt(a.mac_address)}</b></div>
        <div class="tva-row"><span>Domain</span><b>${fmt(a.domain)}</b></div>
        <div class="tva-row"><span>Satın Alma</span><b>${trTarih(det.purchase_date)}</b></div>
        <div class="tva-row"><span>Garanti Bitiş</span><b>${trTarih(a.warranty_expiry)}</b></div>
        <div class="tva-row"><span>Tedarikçi</span><b>${fmt(det.supplier)}</b></div>
      </div>

      <div class="tva-card">
        <h4>Güvenlik Durumu</h4>
        ${G ? `
          <div class="tva-row"><span>Windows Defender</span>${rz(G.defender)}</div>
          <div class="tva-row"><span>Güvenlik Duvarı</span>${rz(G.firewall)}</div>
          <div class="tva-row"><span>Disk Şifreleme</span>${rz(G.disk_encryption)}</div>
          <div class="tva-row"><span>Antivirüs</span>${G.antivirus_name
            ? `<b class="${G.antivirus === 'aktif' ? 'tva-ok' : 'tva-no'}">${escapeHtml(G.antivirus_name)}</b>` : rz(G.antivirus)}</div>
          <div class="tva-row"><span>OS Güncellemesi</span><b class="${G.os_update === 'guncel' ? 'tva-ok' : G.os_update === 'bekliyor' ? 'tva-uyari' : 'tva-bilinmiyor'}">
            ${G.os_update === 'guncel' ? 'Güncel' : G.os_update === 'bekliyor' ? 'Bekliyor' : 'bilinmiyor'}</b></div>
          <div class="tva-row"><span>Kritik Yama</span><b class="${G.critical_patches > 0 ? 'tva-no' : 'tva-ok'}">${G.critical_patches ?? '—'}</b></div>
          <div class="tva-row"><span>Bekleyen Güncelleme</span><b>${G.pending_updates ?? '—'}</b></div>`
        : '<p class="tva-bos">Bu cihazdan güvenlik durumu gelmedi.<br>Collector 1.2.0+ gerekiyor.</p>'}
      </div>

      <div class="tva-card">
        <h4>Son Telemetri Grafikleri <small>son 24 saat</small></h4>
        ${tvaChart(S.map(r => r.cpu_pct), 'var(--blue)', 'CPU Kullanımı (%)')}
        ${tvaChart(S.map(r => yuzde(r.ram_used_gb, r.ram_total_gb)), 'var(--accent)', 'RAM Kullanımı (%)')}
        ${tvaChart(S.map(r => yuzde(r.disk_used_gb, r.disk_total_gb)), 'var(--purple)', 'Disk Kullanımı (%)')}
      </div>

      <div class="tva-card tva-alerts">
        <h4>Kritik Uyarılar <em>${uyarilar.length}</em></h4>
        ${uyarilar.length
          ? `<div class="tva-ul">${uyarilar.map(([tur, mesaj]) =>
              `<div class="tva-u ${tur}"><i></i><span>${escapeHtml(mesaj)}</span></div>`).join('')}</div>`
          : `<div class="tva-temiz">
               <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>
               <b>Kritik Uyarı Yok</b>
               <small>Bu cihazda tespit edilen sorun yok.</small>
             </div>`}
      </div>
    </div>

    <div class="tva-foot" id="tvaFoot"></div>
  </div>`;
}

/* TV panosunu canlı tutar: saat her saniye, ölçümler + filo özeti TVA_YENILE
   aralığıyla yenilenir. Duvar ekranı saatlerce açık kalıyor; elle yenilemeyi
   kimse yapmaz. Zamanlayıcılar pano kapanınca MUTLAKA durdurulur — yoksa
   arka planda sonsuza kadar istek atmaya devam ederdi. */
function tvaDurdur() {
  if (_tvaTimer) { clearInterval(_tvaTimer.saat); clearInterval(_tvaTimer.veri); _tvaTimer = null; }
}

function tvaBaslat(asset) {
  tvaDurdur();
  const saatYaz = () => {
    const e = $(`#tvaClock`);
    if (e) {
      const d = new Date();
      e.innerHTML = `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}
        <b>${d.toLocaleTimeString('tr-TR')}</b>`;
    }
  };
  saatYaz();
  tvaFooter();

  $(`#tvaExit`)?.addEventListener('click', () => {
    tvaDurdur();
    $(`#deviceModalOverlay`)?.classList.remove('open', 'tva-open');
  });

  _tvaTimer = {
    saat: setInterval(saatYaz, 1000),
    veri: setInterval(async () => {
      // Pano kapandıysa kendini durdur (kapatma yolu ne olursa olsun)
      if (!$(`#deviceModalOverlay`)?.classList.contains('open')) return tvaDurdur();
      try {
        const r = await fetch(`/api/assets/${asset.id}/telemetry`);
        if (!r.ok) return;
        const yeni = await r.json();
        const d2 = _deviceModalAsset === asset ? { asset } : { asset };
        // Yalnız ölçüm bloklarını tazele; tüm panoyu yeniden çizmek
        // kaydırma/odak durumunu sıfırlar ve gözle görülür titreme yapar.
        const kok = $(`#deviceModalBody`);
        const eski = kok?.querySelector('.tva-metrics');
        if (eski) {
          const gecici = document.createElement('div');
          gecici.innerHTML = renderTvAsset(asset, window._tvaDetay || d2, yeni);
          const yeniMetrik = gecici.querySelector('.tva-metrics');
          const yeniSerit = gecici.querySelector('.tva-strip');
          if (yeniMetrik) eski.innerHTML = yeniMetrik.innerHTML;
          const serit = kok.querySelector('.tva-strip');
          if (serit && yeniSerit) serit.innerHTML = yeniSerit.innerHTML;
        }
        state.stats = null;          // filo sayıları da tazelensin
        tvaFooter();
      } catch { /* ağ kesildi: bir sonraki turda yeniden dener */ }
    }, TVA_YENILE),
  };
}

/* Alt bant: filo özeti. Tek cihaz ekranında bile duvar ekranının genel
   durumu göstermesi bekleniyor. Sayılar /api/stats'tan GERÇEK gelir. */
async function tvaFooter() {
  const el = $(`#tvaFoot`);
  if (!el) return;
  try {
    const st = state.stats || await fetchStats();
    state.stats = st;
    const by = st.by_status || {};
    const top = st.total || 0;
    const on = by.online || 0, off = by.offline || 0;
    const pct = (n) => (top ? `%${Math.round((n / top) * 100)}` : '—');
    el.innerHTML = `
      <div class="tva-f"><span>Toplam Cihaz</span><b>${top.toLocaleString('tr-TR')}</b></div>
      <div class="tva-f"><i class="yesil"></i><span>Online</span><b>${on.toLocaleString('tr-TR')} <small>${pct(on)}</small></b></div>
      <div class="tva-f"><i class="kirmizi"></i><span>Offline</span><b>${off.toLocaleString('tr-TR')} <small>${pct(off)}</small></b></div>
      <div class="tva-f"><i class="sari"></i><span>Depoda</span><b>${(by.depoda || 0).toLocaleString('tr-TR')}</b></div>
      <div class="tva-f tva-f-son"><span>Son güncelleme</span><b>${new Date().toLocaleTimeString('tr-TR')}</b>
        <small>otomatik yenileme ${TVA_YENILE / 1000}sn</small></div>`;
  } catch {
    el.innerHTML = '<div class="tva-f"><span>Filo özeti alınamadı</span></div>';
  }
}

function tmKart({ baslik, ikon, renk, deger, alt, seri, sinif }) {
  const yok = deger === null || deger === undefined;
  return `<div class="tm-card ${sinif || ''}">
    <div class="tm-h"><span class="ad-ico ${renk.sinif}">${ikon}</span>${escapeHtml(baslik)}</div>
    ${yok
      ? '<div class="tm-yok">Ölçüm yok</div>'
      : `<div class="tm-v">${deger}</div><div class="tm-alt">${alt || ''}</div>`}
    ${yok ? '' : sparkline(seri, renk.cizgi)}
  </div>`;
}

function renderTelemetri(tel, a) {
  const L = tel.latest;
  const S = tel.series || [];
  const al = (k) => S.map((r) => r[k]);
  const yuzde = (kul, top) => (kul == null || !top ? null : Math.round((kul / top) * 100));

  const R = {
    cpu:  { sinif: 'kpi-ico--blue',  cizgi: 'var(--blue)' },
    ram:  { sinif: 'kpi-ico--accent', cizgi: 'var(--accent)' },
    disk: { sinif: 'kpi-ico--purple', cizgi: 'var(--purple)' },
    ag:   { sinif: 'kpi-ico--teal',  cizgi: 'var(--teal)' },
    pil:  { sinif: 'kpi-ico--green', cizgi: 'var(--green)' },
    isi:  { sinif: 'kpi-ico--orange', cizgi: 'var(--orange)' },
  };
  const I = {
    cpu: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>',
    ram: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 17v3M12 17v3M18 17v3"/></svg>',
    disk: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
    ag: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
    pil: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/></svg>',
    isi: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg>',
  };

  const ramPct  = L ? yuzde(L.ram_used_gb, L.ram_total_gb) : null;
  const diskPct = L ? yuzde(L.disk_used_gb, L.disk_total_gb) : null;
  const pilDurum = { sarj_oluyor: 'Şarj oluyor', pilde: 'Pilde', dolu: 'Dolu' };
  const isiEtiket = (c) => (c == null ? '' : c < 60 ? 'Normal' : c < 80 ? 'Yüksek' : 'Kritik');

  const kartlar = [
    tmKart({ baslik: 'CPU Kullanımı', sinif: 'tm-card--cpu', ikon: I.cpu, renk: R.cpu,
      deger: L && L.cpu_pct != null ? `${Math.round(L.cpu_pct)}%` : null,
      alt: L && L.cpu_pct != null ? (L.cpu_pct < 50 ? 'İyi' : L.cpu_pct < 85 ? 'Yoğun' : 'Kritik') : '',
      seri: al('cpu_pct') }),
    tmKart({ baslik: 'RAM Kullanımı', sinif: 'tm-card--ram', ikon: I.ram, renk: R.ram,
      deger: ramPct != null ? `${ramPct}%` : null,
      alt: L && L.ram_used_gb != null ? `${L.ram_used_gb} GB / ${L.ram_total_gb || '?'} GB` : '',
      seri: S.map((r) => yuzde(r.ram_used_gb, r.ram_total_gb)) }),
    tmKart({ baslik: 'Disk Kullanımı', sinif: 'tm-card--disk', ikon: I.disk, renk: R.disk,
      deger: diskPct != null ? `${diskPct}%` : null,
      alt: L && L.disk_used_gb != null ? `${Math.round(L.disk_used_gb)} GB / ${Math.round(L.disk_total_gb || 0)} GB` : '',
      seri: S.map((r) => yuzde(r.disk_used_gb, r.disk_total_gb)) }),
    tmKart({ baslik: 'Ağ Kullanımı', sinif: 'tm-card--net', ikon: I.ag, renk: R.ag,
      deger: L && L.net_rx_mbps != null
        ? `<span class="tm-net">↓ ${L.net_rx_mbps} <small>Mbps</small></span><span class="tm-net">↑ ${L.net_tx_mbps ?? '—'} <small>Mbps</small></span>` : null,
      alt: '', seri: al('net_rx_mbps') }),
    tmKart({ baslik: 'Pil Durumu', sinif: 'tm-card--bat', ikon: I.pil, renk: R.pil,
      deger: L && L.battery_pct != null ? `${Math.round(L.battery_pct)}%` : null,
      alt: L ? (pilDurum[L.battery_state] || '') : '', seri: al('battery_pct') }),
    tmKart({ baslik: 'Sıcaklık', sinif: 'tm-card--temp', ikon: I.isi, renk: R.isi,
      deger: L && L.temp_c != null ? `${L.temp_c}°C` : null,
      alt: L ? isiEtiket(L.temp_c) : '', seri: al('temp_c') }),
  ].join('');

  // ── Sistem Bilgileri: TAMAMI envanterden, collector kurulu olmasa da dolu ──
  const bootTarih = a.uptime_days != null
    ? fmtDate(new Date(Date.now() - Number(a.uptime_days) * 86400000).toISOString()) : '—';
  const upt = a.uptime_days != null
    ? `${Math.floor(a.uptime_days)} gün ${Math.round((a.uptime_days % 1) * 24)} saat` : '—';
  const sistem = `
    <div class="ad-card tm-panel tm-panel--sistem">
      <div class="ad-card-h"><h4>Sistem Bilgileri</h4></div>
      <div class="ad-row"><span>Hostname</span><b>${fmt(a.hostname)}</b></div>
      <div class="ad-row"><span>Domain</span><b>${fmt(a.domain)}</b></div>
      <div class="ad-row"><span>IP Adresi</span><b class="serial-cell">${fmt(a.ip_address)}</b></div>
      <div class="ad-row"><span>MAC Adresi</span><b class="serial-cell">${fmt(a.mac_address)}</b></div>
      <div class="ad-row"><span>Uptime</span><b>${upt}</b></div>
      <div class="ad-row"><span>Son Başlatma</span><b>${bootTarih}</b></div>
    </div>`;

  // ── Güvenlik Durumu ────────────────────────────────────────────────────────
  const G = tel.security;
  const rozet = (v) => {
    if (v === 'aktif')  return '<b class="tm-ok">Aktif</b>';
    if (v === 'pasif')  return '<b class="tm-kotu">Kapalı</b>';
    if (v === 'yok')    return '<b class="tm-kotu">Yok</b>';
    return '<b class="ad-bos">bilinmiyor</b>';
  };
  const guvenlik = `
    <div class="ad-card tm-panel tm-panel--guvenlik">
      <div class="ad-card-h"><h4>Güvenlik Durumu</h4>
        ${G ? `<span class="tm-zaman">${fmtDate(G.checked_at)}</span>` : ''}</div>
      ${G ? `
        <div class="ad-row"><span>Windows Defender</span>${rozet(G.defender)}</div>
        <div class="ad-row"><span>Güvenlik Duvarı</span>${rozet(G.firewall)}</div>
        <div class="ad-row"><span>Disk Şifreleme</span>${rozet(G.disk_encryption)}</div>
        <div class="ad-row"><span>Antivirüs</span>${G.antivirus_name
          ? `<b class="${G.antivirus === 'aktif' ? 'tm-ok' : 'tm-kotu'}">${escapeHtml(G.antivirus_name)}</b>`
          : rozet(G.antivirus)}</div>
        <div class="ad-row"><span>OS Güncellemesi</span><b class="${G.os_update === 'guncel' ? 'tm-ok' : G.os_update === 'bekliyor' ? 'ad-warn' : 'ad-bos'}">
          ${G.os_update === 'guncel' ? 'Güncel' : G.os_update === 'bekliyor' ? 'Bekliyor' : 'bilinmiyor'}</b></div>
        <div class="ad-row"><span>Kritik Yama</span><b class="${G.critical_patches > 0 ? 'ad-warn' : ''}">${G.critical_patches ?? '—'}</b></div>
        <div class="ad-row"><span>Bekleyen Güncelleme</span><b>${G.pending_updates ?? '—'}</b></div>`
      : `<p class="ad-hint">Bu cihazdan güvenlik durumu gelmedi. Toplama betiği (collector)
         sürüm 1.1.0 ve üzeri bu bilgiyi gönderir; BitLocker ve Windows Update
         okuması yönetici yetkisi ister.</p>`}
    </div>`;

  const olcumVar = !!L;
  return `
    ${olcumVar ? '' : `<div class="tm-uyari">
      <strong>Bu cihazdan henüz canlı ölçüm gelmedi.</strong>
      Aşağıdaki kartlar toplama betiği (collector) sürüm 1.1.0 ve üzeri kurulduğunda dolar.
      Sistem Bilgileri paneli envanter kaydından geldiği için şimdiden dolu.
      <em>Sıcaklık ve pil her makinede okunamaz</em> — sunucuda pil, sanal makinede
      sıcaklık sensörü yoktur; o kartlar o cihazlarda boş kalır.
    </div>`}
    <div class="tm-wrap">
      <div class="tm-grid">${kartlar}</div>
      <div class="tm-panels">${sistem}${guvenlik}</div>
    </div>
    ${olcumVar ? `<p class="ad-hint">Grafikler son 24 saati gösterir (${S.length} ölçüm).
      Ölçümler ${tel.retention_days || 30} gün saklanır.</p>` : ''}`;
}

async function openDeviceModal(asset) {
  const overlay = $(`#deviceModalOverlay`);
  if (!overlay || !asset) return;
  _deviceModalAsset = asset;
  $(`#deviceModalTitle`).textContent = 'Varlık Detayı';
  const body = $(`#deviceModalBody`);
  body.innerHTML = '<p class="loading-cell">Yükleniyor...</p>';
  overlay.classList.add('open');
  const pdfBtn = $(`#handoverPdfBtn`); if (pdfBtn) pdfBtn.style.display = '';

  let d = { asset, detail: null, usage: null, image: null, assignment: null };
  /* Telemetri, 'Son Envanter Taraması' satırında da kullanıldığı için sekme
     açılışını beklemeden detayla PARALEL çekilir (iki ayrı bekleme olmasın). */
  let tel = { latest: null, series: [], security: null };
  try {
    const [r, rt] = await Promise.all([
      fetch(`/api/assets/${asset.id}/detail`),
      fetch(`/api/assets/${asset.id}/telemetry`).catch(() => null),
    ]);
    if (r.ok) d = await r.json();
    if (rt && rt.ok) tel = await rt.json();
  } catch { /* çevrimdışı: yalnız listedeki alanlarla çiz */ }

  const a = d.asset || asset;
  const det = d.detail || {};
  const gorsel = d.image
    ? `<img src="${d.image.url}" alt="${escapeHtml(a.model || a.hostname || '')}" class="ad-img">`
    : katCizim(a.category);

  const satir = (k, v, cls = '') => `<div class="ad-row"><span>${k}</span><b class="${cls}">${v}</b></div>`;

  /* TV MODU: modal yerine tam ekran tek-cihaz panosu. Duvar ekranında kimse
     tıklamıyor — sekmeli düzen orada işe yaramaz, her şey aynı anda görünmeli
     ve kendi kendine tazelenmeli. */
  if (document.body.classList.contains('tv-mode')) {
    body.innerHTML = renderTvAsset(a, d, tel);
    overlay.classList.add('tva-open');
    window._tvaDetay = d;          // yenilemede aynı detayı kullan (tek fetch)
    tvaBaslat(a);
    return;
  }
  overlay.classList.remove('tva-open');

  body.innerHTML = `
    <div class="ad-grid">
      <!-- Sol: görsel + kimlik + QR + zimmet -->
      <div class="ad-left">
        <!-- Kimlik kartı: görsel + ad + kimlik satırları + QR. Tablette tek kart
             olarak sol üstte durur (tasarım böyle), telefonda parçalanır:
             hero her sekmede görünür kalır, QR 'Zimmet & Konum' sekmesine iner. -->
        <div class="ad-idbox">
        <!-- Hero: telefonda HER SEKMEDE görünür kalır (hangi cihaza baktığını
             kaybetmeyesin). Geri kalanı mobilde sekmelere dağılır. -->
        <div class="ad-hero">
        <div class="ad-photo${d.image ? '' : ' ad-photo--illus'}">
          ${gorsel}
          ${statusBadge(a.status)}
        </div>
        <div class="ad-hero-t">
        <h3 class="ad-name">${fmt(a.hostname)}</h3>
        <div class="ad-ident">
          <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5h8v2"/></svg>${fmt(a.serial_number)}</span>
          <span>${categoryBadge(a.category)}</span>
          <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml((a.location || '').trim() || 'Lokasyon yok')}</span>
          <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${escapeHtml(d.assignment?.assigned_to || 'Zimmetsiz')}</span>
        </div>
        </div>
        </div>

        <!-- Telefonda QR bloğu gizli durur; "QR Kod" düğmesi açar. Küçük ekranda
             sürekli görünen 98px'lik QR kutusu, asıl içeriği aşağı itiyordu. -->
        <div class="ad-actions">
          <button class="btn-pdf" id="adActLabel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/></svg>
            Etiket Yazdır</button>
          <button class="btn-pdf" id="adActQr">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM19 19h2v2h-2z"/></svg>
            QR Kod</button>
        </div>

        <div class="ad-qr">
          <img id="adQr" alt="QR etiketi">
          <div>
            <b>${fmt(a.serial_number)}</b>
            <button class="btn-pdf" id="adPrintLabel">Etiket Yazdır</button>
          </div>
        </div>
        </div>

        <div class="ad-sec ad-sec--zimmet">
        <div id="deviceAssignBox"></div>
        <div id="deviceLocationBox"></div>
        ${a.category === 'Telefon' ? '<div id="deviceLineBox"></div>' : ''}
        </div>
      </div>

      <!-- Orta: temel bilgiler -->
      <div class="ad-card ad-sec ad-sec--genel ad-sec--temel">
        <div class="ad-card-h"><h4><span class="ad-ico kpi-ico--blue"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg></span>Temel Bilgiler</h4>
          ${state.role === 'admin' || state.role === 'it' ? '<button class="btn-pdf" id="adEditBasic">Düzenle</button>' : ''}<svg class="ad-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></div>
        ${satir('Varlık Kodu', det.asset_code
          ? `<span class="serial-cell">${escapeHtml(det.asset_code)}</span>`
          : '<span class="ad-bos">tanımlı değil</span>')}
        ${satir('Seri Numarası', `<span class="serial-cell">${fmt(a.serial_number)}</span>`)}
        ${satir('Üretici / Model', `${fmt(a.brand)} ${fmt(a.model, '')}`)}
        ${satir('Kategori', escapeHtml(a.category || 'Diğer'))}
        ${satir('İşletim Sistemi', fmt(a.os))}
        ${satir('CPU', fmt(a.cpu))}
        ${satir('RAM / Disk', `${a.ram_gb ? a.ram_gb + ' GB' : '—'} / ${a.storage_gb ? a.storage_gb + ' GB' : '—'}`)}
        ${satir('IP / MAC', `<span class="serial-cell">${fmt(a.ip_address)} · ${fmt(a.mac_address)}</span>`)}
        ${satir('Satın Alma Tarihi', trTarih(det.purchase_date))}
        ${satir('Satın Alma Bedeli', trPara(det.purchase_price, det.currency))}
        ${satir('Garanti Bitiş', trTarih(a.warranty_expiry))}
        ${satir('Tedarikçi', fmt(det.supplier))}
      </div>

      <!-- Sağ: durum bilgileri -->
      <div class="ad-card ad-sec ad-sec--genel ad-sec--durum">
        <div class="ad-card-h"><h4><span class="ad-ico kpi-ico--green"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>Durum Bilgileri</h4>${statusBadge(a.status)}<svg class="ad-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></div>
        ${satir('Lokasyon', escapeHtml((a.location || '').trim() || '—'))}
        ${satir('Sorumlu Kişi', escapeHtml(d.assignment?.assigned_to || '—'))}
        ${satir('Son Giriş Yapan Kullanıcı', fmt(a.username))}
        ${satir('Kullanım Süresi', d.usage || '—')}
        ${satir('Son Bakım Tarihi', trTarih(det.last_maintenance))}
        ${satir('Sonraki Bakım', trTarih(det.next_maintenance), bakimGecti(det.next_maintenance) ? 'ad-warn' : '')}
        ${satir('Son Görülme', fmtDate(a.last_seen))}
        ${satir('Son IP', a.ip_address ? `<span class="serial-cell">${escapeHtml(a.ip_address)}</span>` : '—')}
        ${satir('Agent Versiyonu', a.collector_ver
          ? escapeHtml(a.collector_ver)
          : '<span class="ad-bos">agent kurulu değil</span>')}
        ${satir('Son Envanter Taraması', tel.latest ? fmtDate(tel.latest.measured_at) : '<span class="ad-bos">ölçüm yok</span>')}
        ${satir('Durum', statusBadge(a.status))}
        ${satir('Not', det.note ? escapeHtml(det.note) : '—')}
      </div>

      <!-- Alt: sekmeler -->
      <div class="ad-tabs-wrap">
        <div class="ad-tabs">
          <button class="ad-tab" data-t="telemetri"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/></svg>Telemetri</button>
          <button class="ad-tab active" data-t="lifecycle"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>İşlem Geçmişi</button>
          <button class="ad-tab" data-t="maint"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a4 4 0 0 1 5 5l-9.4 9.4a2 2 0 0 1-2.8-2.8z"/><path d="M9 5 5 9 2 6l3-3z"/></svg>Bakım Geçmişi</button>
          <button class="ad-tab" data-t="docs"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Belgeler</button>
          <button class="ad-tab" data-t="note"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>Notlar</button>
        </div>
        <div class="ad-pane" id="adPane"></div>
      </div>
    </div>`;

  // QR (yerel üretim, dış servis yok)
  const qr = $(`#adQr`);
  if (qr) qr.src = `/api/qr?data=${encodeURIComponent(a.serial_number || a.hostname || '')}`;
  $(`#adPrintLabel`)?.addEventListener('click', () => printAssetLabel(a));
  $(`#adEditBasic`)?.addEventListener('click', () => editAssetDetail(a, det));

  // Sekmeler
  const paneler = {
    telemetri: () => renderTelemetri(tel, a),
    lifecycle: () => '<div id="deviceHistory" class="ad-hist">Yükleniyor...</div>',
    maint: () => `
      <div class="ad-maint">
        ${satir('Son Bakım', trTarih(det.last_maintenance))}
        ${satir('Sonraki Bakım', trTarih(det.next_maintenance), bakimGecti(det.next_maintenance) ? 'ad-warn' : '')}
        ${satir('Garanti Bitiş', trTarih(a.warranty_expiry))}
        <p class="ad-hint">Bakım kaydı geçmişi ayrı tutulmuyor; tarih alanları güncellenir.
        Kalıcı bakım günlüğü isterseniz yaşam döngüsüne <em>Bakımda</em> olayı kaydedin — imzalı ve denetlenebilir olur.</p>
      </div>`,
    docs: () => `
      <div class="ad-docs">
        <button class="ad-doc" id="adDocHandover">
          <span class="qa-ico kpi-ico--red"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
          <span><strong>Zimmet Teslim Tutanağı</strong><small>PDF olarak üretilir</small></span>
        </button>
        <button class="ad-doc" id="adDocLabel">
          <span class="qa-ico kpi-ico--blue"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
          <span><strong>QR Varlık Etiketi</strong><small>Yazdırılabilir etiket</small></span>
        </button>
        <p class="ad-hint">Belge yükleme/saklama henüz yok — buradaki belgeler talep anında üretilir.</p>
      </div>`,
    note: () => `
      <div class="ad-note">
        <p>${det.note ? escapeHtml(det.note) : '<span style="color:var(--text-muted)">Not girilmemiş.</span>'}</p>
        ${(state.role === 'admin' || state.role === 'it') ? '<button class="btn-pdf" id="adEditNote">Notu düzenle</button>' : ''}
      </div>`,
  };
  /* Telefonda 'genel'/'zimmet' sekmeleri #adPane'i DOLDURMAZ; grid'deki
     bölümleri gösterir/gizler (data-mtab + CSS). Böylece aynı DOM masaüstünde
     kolon, telefonda sekme olarak çalışır — içerik kopyalanmıyor. */
  const grid = body.querySelector('.ad-grid');
  const paneCiz = (t) => {
    if (grid) grid.dataset.mtab = t;
    const pane = $(`#adPane`);
    if (!pane) return;
      if (t === 'genel' || t === 'zimmet') return;   // geriye dönük: artık kullanılmıyor
    pane.innerHTML = paneler[t]();
    if (t === 'lifecycle') loadDeviceHistory(a);
    $(`#adDocHandover`)?.addEventListener('click', () => printHandoverReceipt(a));
    $(`#adDocLabel`)?.addEventListener('click', () => printAssetLabel(a));
    $(`#adEditNote`)?.addEventListener('click', () => editAssetDetail(a, det, 'note'));
  };
  $$('.ad-tab').forEach(b => b.addEventListener('click', () => {
    $$('.ad-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    paneCiz(b.dataset.t);
  }));

  /* Telefonda ilk sekme Telemetri (tasarım böyle: cihazın anlık durumu önce
     görünsün). Geniş ekranda da Telemetri ilk sekme. */
  const ilkSekme = $(`.ad-tab[data-t="telemetri"]`) ? 'telemetri' : 'lifecycle';
  $$('.ad-tab').forEach(x => x.classList.toggle('active', x.dataset.t === ilkSekme));
  paneCiz(ilkSekme);

  /* ── Telefon: bilgi kartları AKORDEON ──────────────────────────────────────
     Telefonda Temel + Durum Bilgileri 19 satır tutuyor; hepsini açık bırakmak
     asıl içeriği (telemetri) ekranın çok altına itiyordu. Tasarımda ikisi de
     kapalı, Resmi Zimmet açık geliyor. Masaüstünde akordeon YOK — kartlar
     kolonlarda zaten yan yana duruyor, gizlemenin anlamı olmaz. */
  const telefon = window.matchMedia('(max-width: 760px)').matches;
  body.querySelectorAll('.ad-sec--temel, .ad-sec--durum').forEach((kart) => {
    if (telefon) kart.classList.add('ad-kapali');
    const bas = kart.querySelector('.ad-card-h');
    if (!bas) return;
    bas.addEventListener('click', (e) => {
      // Başlıktaki "Düzenle" düğmesi akordeonu tetiklemesin
      if (e.target.closest('button.btn-pdf')) return;
      if (!window.matchMedia('(max-width: 760px)').matches) return;
      kart.classList.toggle('ad-kapali');
    });
  });

  // Telefonda QR bloğu düğmeyle açılır (sürekli görünmesi yer harcıyordu)
  $(`#adActLabel`)?.addEventListener('click', () => printAssetLabel(a));
  $(`#adActQr`)?.addEventListener('click', () => {
    const kutu = body.querySelector('.ad-qr');
    if (kutu) {
      kutu.classList.toggle('ad-qr--acik');
      if (kutu.classList.contains('ad-qr--acik')) kutu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  loadDeviceAssignment(a);
  loadDeviceLocation(a);
  if (a.category === 'Telefon' && a.id != null) loadDeviceLine(a.id);
}

function bakimGecti(tarih) {
  if (!tarih) return false;
  const t = Date.parse(tarih);
  return !Number.isNaN(t) && t < Date.now();
}

/* Ek alanları düzenle — tek diyalogda, sunucu doğrular */
async function editAssetDetail(asset, mevcut, odak) {
  const sor = (etiket, varsayilan) => prompt(etiket, varsayilan ?? '') ;
  let patch = {};
  if (odak === 'note') {
    const n = sor('Not:', mevcut.note || '');
    if (n === null) return;
    patch = { note: n };
  } else {
    const pd = sor('Satın alma tarihi (YYYY-AA-GG, boş bırakılabilir):', mevcut.purchase_date || '');
    if (pd === null) return;
    const pp = sor('Satın alma bedeli (yalnız sayı):', mevcut.purchase_price ?? '');
    if (pp === null) return;
    const cur = sor('Para birimi (TRY/USD/EUR):', mevcut.currency || 'TRY');
    if (cur === null) return;
    const sup = sor('Tedarikçi:', mevcut.supplier || '');
    if (sup === null) return;
    const lm = sor('Son bakım tarihi (YYYY-AA-GG):', mevcut.last_maintenance || '');
    if (lm === null) return;
    const nm = sor('Sonraki bakım tarihi (YYYY-AA-GG):', mevcut.next_maintenance || '');
    if (nm === null) return;
    patch = { purchase_date: pd, purchase_price: pp, currency: cur, supplier: sup,
      last_maintenance: lm, next_maintenance: nm };
  }
  try {
    const r = await fetch(`/api/assets/${asset.id}/detail`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error);
    openDeviceModal(asset);      // tazele
  } catch (err) { alert('Kaydedilemedi: ' + err.message); }
}

/* QR etiketi yazdır — yerel üretim */
function printAssetLabel(a) {
  const w = window.open('', '_blank', 'width=420,height=520');
  if (!w) { alert('Açılır pencere engellendi.'); return; }
  const kod = a.serial_number || a.hostname || '';
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Etiket — ${escapeHtml(kod)}</title>
  <style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px}
  img{width:190px;height:190px}h2{font-size:16px;margin:12px 0 2px}p{font-size:12px;color:#555;margin:0}
  @media print{@page{margin:8mm}}</style>
  <img src="/api/qr?data=${encodeURIComponent(kod)}">
  <h2>${escapeHtml(a.hostname || '')}</h2>
  <p>${escapeHtml(kod)}</p><p>${escapeHtml(a.category || '')} · ${escapeHtml((a.location || '').trim())}</p>
  <script>window.onload=()=>{window.print();}<\/script>`);
  w.document.close();
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

    const hist = (j.history || []).slice(0, 5).map(h => `
      <div style="display:flex;gap:9px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="width:7px;height:7px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="color:var(--text);font-weight:500;font-size:12px">
            ${h.from_location ? `${escapeHtml(h.from_location)} → ` : ''}${escapeHtml(h.to_location)}
          </div>
          <div style="color:var(--text-muted);font-size:11px">${fmtDate(h.first_seen_at)} · ${escapeHtml(h.source)}</div>
        </div>
      </div>`).join('') || '<p style="padding:4px 0;color:var(--text-muted);font-size:12px">Konum geçmişi yok.</p>';

    box.innerHTML = `
      <div class="ad-card" style="border-color:${drift ? 'var(--red)' : 'var(--border)'}">
        <div class="ad-card-h"><h4>Lokasyon</h4></div>
        <div class="ad-row"><span>Beklenen (resmi)</span><b>${exp ? escapeHtml(exp) : '—'}</b></div>
        <div class="ad-row"><span>Görülen (telemetri)</span>
          <b style="color:${drift ? 'var(--red)' : 'var(--text)'}">${seen ? escapeHtml(seen) : '—'}${days !== null ? ` (${days} gün)` : ''}</b></div>
        ${drift ? `<p style="color:var(--red);font-size:11.5px;margin:8px 0 0">⚠ Cihaz ait olduğu lokasyonun dışında.</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn-pdf" id="locSetExpected">${exp ? 'Beklenen lokasyonu değiştir' : 'Beklenen lokasyonu belirle'}</button>
          ${drift ? `<button class="btn-pdf" id="locAcceptMove">Transferi resmileştir</button>` : ''}
        </div>
        <div style="margin-top:10px">${hist}</div>
      </div>`;

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
    state.locGeo = null;
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
        <span class="sev-count" style="color:var(--${c.tone})">${c.n}</span>
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
    tabloKuyrugu(list, per);
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

  tabloKuyrugu(list, per);
}

/* Tablodan SONRA her durumda çalışması gerekenler. Boş ve dolu yollar ayrı
   ayrı yazıldığı için sürüklenmişti: boş yolda renderAssetsRail() çağrısı
   YOKTU ve envanteri boş bir kurulumda sağ raydaki "Son Aktiviteler" sonsuza
   kadar "Yükleniyor..." kalıyordu (yeni müşterinin gördüğü ilk ekran).
   Tek yer = tek davranış. */
function tabloKuyrugu(list, per) {
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

