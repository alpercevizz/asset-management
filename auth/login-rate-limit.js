/* Login brute-force koruması (IP başına kayan pencere).
 *
 * TASARIM KARARI — sayaç YALNIZ BAŞARISIZ denemede artar ve başarılı girişte
 * sıfırlanır. Önceki sürüm her isteği sayıyordu; tek NAT IP'sinin arkasındaki
 * ofiste 15 dakikada 10 NORMAL giriş tüm şirketi kilitliyor, kullanıcıya bu
 * "parola doğru ama panel açılmıyor" diye görünüyordu.
 *
 * Bellekte tutulur (tek süreç). Çok örnekli kurulumda paylaşımlı bir depo
 * (Redis vb.) gerekir — bu kurulum tek süreç olduğu için bilinçli olarak basit.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;

function createLoginRateLimit({ windowMs = WINDOW_MS, max = MAX_FAILS, now = Date.now } = {}) {
  const fails = new Map(); // ip → { count, resetAt }

  function clientIp(req) {
    return (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '')
      .split(',')[0].trim();
  }

  /** Aktif kilit varsa kalan saniye, yoksa 0. */
  function blockedFor(ip) {
    const t = now();
    const rec = fails.get(ip);
    if (!rec) return 0;
    if (rec.resetAt <= t) { fails.delete(ip); return 0; }
    return rec.count >= max ? Math.ceil((rec.resetAt - t) / 1000) : 0;
  }

  function fail(ip) {
    const t = now();
    let rec = fails.get(ip);
    if (!rec || rec.resetAt <= t) rec = { count: 0, resetAt: t + windowMs };
    rec.count++;
    fails.set(ip, rec);
    // Kova büyürse süresi dolmuşları temizle
    if (fails.size > 5000) for (const [k, v] of fails) if (v.resetAt <= t) fails.delete(k);
    return rec.count;
  }

  function succeed(ip) { fails.delete(ip); }

  return { clientIp, blockedFor, fail, succeed, max, windowMs };
}

module.exports = { createLoginRateLimit, WINDOW_MS, MAX_FAILS };
