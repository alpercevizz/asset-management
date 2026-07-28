#!/usr/bin/env node
/**
 * Dünya haritası verisini ÜRETİR (bir kez çalıştırılır, çıktısı repoya girer).
 *
 * NEDEN: Harita altlığı çalışma anında hiçbir dış servisten çekilmez — ürünün
 * kapalı-devre iddiası bozulmasın diye. Bu script Natural Earth 1:110m
 * (npm: world-atlas) verisini basitleştirip public/data/world-110m.json
 * dosyasına yazar; tarayıcı onu KENDİ sunucumuzdan alır.
 *
 * Çalıştırma:  npm i --no-save world-atlas topojson-client && node scripts/build-world-map.js
 * Çıktı repoya commit edilir; bağımlılıklar üretimde GEREKMEZ.
 */
const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');

const SRC = require.resolve('world-atlas/countries-110m.json');
const OUT = path.join(__dirname, '..', 'public', 'data', 'world-110m.json');

// Antarktika dünya görünümünde yer kaplıyor ama varlık lokasyonu barındırmıyor.
const ATLA = new Set(['Antarctica']);
// Bu alanın altındaki poligonlar (kabaca derece²) atılır — küçük adalar.
const MIN_ALAN = 0.9;
// Koordinat hassasiyeti: 1 ondalık ≈ 11 km. Dünya genel görünümü için fazlasıyla yeterli.
const HASSASIYET = 1;

function alan(ring) {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(a / 2);
}

const yuvarla = (v) => Number(v.toFixed(HASSASIYET));

// Ardışık aynı noktaları at (yuvarlama sonrası oluşur)
function sadelestir(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [yuvarla(x), yuvarla(y)];
    const son = out[out.length - 1];
    if (!son || son[0] !== p[0] || son[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;   // kapalı poligon için en az 4 nokta
}

function main() {
  const topo = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const geo = topojson.feature(topo, topo.objects.countries);

  const poligonlar = [];
  let atilanKucuk = 0, atilanUlke = 0;

  for (const f of geo.features) {
    const ad = f.properties && f.properties.name;
    if (ATLA.has(ad)) { atilanUlke++; continue; }
    const g = f.geometry;
    if (!g) continue;
    const parcalar = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const parca of parcalar) {
      const dis = parca[0];                       // yalnız dış halka (delikler görsel olarak gereksiz)
      if (!dis || dis.length < 4) continue;
      if (alan(dis) < MIN_ALAN) { atilanKucuk++; continue; }
      const s = sadelestir(dis);
      if (s) poligonlar.push(s);
    }
  }

  const cikti = {
    _not: 'Natural Earth 1:110m (world-atlas) türevi. scripts/build-world-map.js ile üretildi. ' +
          'Çalışma anında dış istek YOK — tarayıcı bu dosyayı kendi sunucumuzdan alır.',
    projeksiyon: 'lon/lat (WGS84) — istemci equirectangular çizer',
    polygons: poligonlar,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(cikti));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  const nokta = poligonlar.reduce((a, p) => a + p.length, 0);
  console.log(`✓ ${OUT}`);
  console.log(`  poligon: ${poligonlar.length} · nokta: ${nokta} · boyut: ${kb} KB`);
  console.log(`  atlanan: ${atilanUlke} ülke (Antarktika), ${atilanKucuk} küçük ada`);
}

main();
