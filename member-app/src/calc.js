// 排盤計算（伺服器端）：國農曆換算與牌號公式。
// 公式與已驗證的網頁版 core.js 完全相同，只是搬到後端執行，前端不再看得到。
import LM from './lunar-months.json';
import CARDS from './tarot-meanings.json';

const EPOCH = Date.UTC(1900, 0, 1);
export const ALERT = [13, 16];

export const ds = n => String(n).split('').reduce((a, c) => a + Number(c), 0);
export const once = n => (n > 21 ? n - 22 : n);
export const helperNo = n => once(n + 5);
export const pad = n => String(n).padStart(2, '0');
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
export const iso = d => `${d.y}-${pad(d.m)}-${pad(d.d)}`;

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  if (s < LM.range[0] || s > LM.range[1]) return false;
  const { y, m, d } = parse(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function toLunar(s) {
  if (!isValidDate(s)) return null;
  const g = parse(s);
  const n = Math.round((Date.UTC(g.y, g.m - 1, g.d) - EPOCH) / 864e5);
  const ms = LM.months;
  let lo = 0, hi = ms.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ms[mid][0] <= n) lo = mid; else hi = mid - 1; }
  const [st, y, m, leap] = ms[lo];
  return { y, m, d: n - st + 1, leap: !!leap };
}

// 本命：本性(E3/J3)、外顯(E5/J5)、內心(E6/J6)
export function base(d) {
  const sum = ds(d.y + d.m + d.d);
  const t = parseInt(String(d.y).slice(-2), 10);
  return [t > 21 ? ds(t) : t, once(sum), sum > 21 ? ds(sum) : sum];
}
export const annual = (d, year) => once(ds(year + d.m + d.d));
export const monthNo = (d, year, m) => once(ds(d.y + d.m + d.d + year + m));
export const dayNo = (d, day) => once(ds(d.y + d.m + d.d + day.y + day.m + day.d));

// 台灣時間的今天
export function todayTaipei(now = Date.now()) {
  const t = new Date(now + 8 * 3600e3);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function cardsFor(nums) {
  const out = {};
  for (const n of nums) if (CARDS[String(n)]) out[n] = CARDS[String(n)];
  return out;
}

/** 個人排盤：birth/day 為 YYYY-MM-DD，year 為西元年 */
export function computeChart({ birth, year, day, today }) {
  const g = parse(birth), l = toLunar(birth);
  const t = parse(today), tl = toLunar(today);
  const used = new Set();
  const u = n => { used.add(n); return n; };
  const pair = (s, lu) => ({ s: u(s), l: u(lu) });

  const gb = base(g), lb = base(l);
  const natal = gb.map((n, i) => pair(n, lb[i]));
  const helper = gb.map((n, i) => pair(helperNo(n), helperNo(lb[i])));
  const todayFlow = [
    pair(annual(g, t.y), annual(l, tl.y)),
    pair(monthNo(g, t.y, t.m), monthNo(l, t.y, t.m)),
    pair(dayNo(g, t), dayNo(l, t)),
  ];
  const annualPair = pair(annual(g, year), annual(l, year));
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const lm = toLunar(`${year}-${pad(m)}-01`);
    months.push({ m, lunarMonth: lm ? { m: lm.m, leap: lm.leap } : null, ...pair(monthNo(g, year, m), monthNo(l, year, m)) });
  }
  const d = parse(day), ld = toLunar(day);
  const dayPair = pair(dayNo(g, d), dayNo(l, d));
  const daysInMonth = new Date(Date.UTC(d.y, d.m, 0)).getUTCDate();
  const dayList = [];
  for (let i = 1; i <= daysInMonth; i++) {
    const di = { y: d.y, m: d.m, d: i };
    const li = toLunar(iso(di));
    if (!li) continue;
    dayList.push({ d: i, wd: new Date(Date.UTC(d.y, d.m - 1, i)).getUTCDay(), lunar: li, ...pair(dayNo(g, di), dayNo(l, di)) });
  }
  return {
    birth: { solar: g, lunar: l }, year,
    natal, helper,
    today: { solar: t, lunar: tl, flow: todayFlow },
    annual: annualPair, months,
    day: { solar: d, lunar: ld, ...dayPair }, dayList,
    alert: ALERT, cards: cardsFor(used),
  };
}

/** 雙人合盤 */
export function computePair({ birthA, birthB, today }) {
  const t = parse(today), tl = toLunar(today);
  const used = new Set();
  const one = b => {
    const g = parse(b), l = toLunar(b);
    const gb = base(g), lb = base(l);
    const P = (s, lu) => { used.add(s); used.add(lu); return { s, l: lu }; };
    return {
      solar: g, lunar: l,
      trait: gb.map((n, i) => P(n, lb[i])),
      helper: gb.map((n, i) => P(helperNo(n), helperNo(lb[i]))),
      years: [t.y - 1, t.y, t.y + 1].map(y => ({ year: y, ...P(annual(g, y), annual(l, y)) })),
      today: [P(annual(g, t.y), annual(l, tl.y)), P(monthNo(g, t.y, t.m), monthNo(l, t.y, t.m)), P(dayNo(g, t), dayNo(l, t))],
    };
  };
  const A = one(birthA), B = one(birthB);
  return { today: { solar: t, lunar: tl }, A, B, alert: ALERT, cards: cardsFor(used) };
}
