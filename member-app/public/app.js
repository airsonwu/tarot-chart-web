/* LINE 會員版前端共用程式：登入、呼叫後端、畫面元件 */
'use strict';
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.y}-${pad(d.m)}-${pad(d.d)}`;
const fmt = d => `${d.y} 年 ${d.m} 月 ${d.d} 日`;
const fmtL = d => `${d.y} 年 ${d.leap ? '閏 ' : ''}${d.m} 月 ${d.d} 日`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WEEK = '日一二三四五六';

let CARDS = {}, ALERT = new Set([13, 16]);
const setCards = (cards, alert) => { CARDS = { ...CARDS, ...cards }; if (alert) ALERT = new Set(alert); };
const isAlert = n => ALERT.has(Number(n));
const card = n => CARDS[String(n)] || null;
const cardName = n => card(n)?.name || '';
const flowTag = n => `<span class="${isAlert(n) ? 'alerttag' : ''}">${n}・${esc(cardName(n))}</span>`;
const stat = (label, val, flow = false) => `<div class="stat${flow && isAlert(val) ? ' alert' : ''}"><small>${esc(label)}</small><b>${esc(val)}</b>${card(val) ? `<span class="cardname">${esc(cardName(val))}</span>` : ''}</div>`;
const explain = (n, kind = 'full', flow = false) => {
  const c = card(n);
  if (!c) return `<div class="notice">數字 ${esc(n)} 尚無牌意對應。</div>`;
  return `<details class="meaning${flow && isAlert(n) ? ' alert' : ''}"><summary><strong>${esc(n)}・${esc(c.name)}</strong><span>查看牌意</span></summary><div class="meaningbody"><p><b>牌意：</b>${esc(c.meaning)}</p><p><b>正位：</b>${esc(c.upright)}</p><p><b>逆位：</b>${esc(c.reversed)}</p>${kind === 'trait' ? `<p><b>正面特質：</b>${esc(c.positive)}</p><p><b>負面特質：</b>${esc(c.negative)}</p>` : ''}</div></details>`;
};
const sbsBlock = (title, rows, kind = 'full', flow = false) =>
  `<div class="sbs-wrap"><div class="sbs sbs-head"><div>☀ 國曆${title}</div><div>☾ 農曆${title}</div></div>` +
  rows.map(([label, a, b]) => `${label ? `<div class="sbs-label">${esc(label)}</div>` : ''}<div class="sbs"><div>${explain(a, kind, flow)}</div><div>${explain(b, kind, flow)}</div></div>`).join('') + '</div>';

// 牌意兩邊同步展開
document.addEventListener('toggle', e => {
  const d = e.target; if (!(d instanceof HTMLDetailsElement)) return;
  const row = d.closest('.sbs'); if (!row) return;
  row.querySelectorAll('details').forEach(x => { if (x !== d && x.open !== d.open) x.open = d.open; });
}, true);

// 表格左右滑動提示
function updateScrollHint() {
  document.querySelectorAll('.scrollbox').forEach(box => {
    const w = box.querySelector('.tablewrap'); if (!w) return;
    const can = w.scrollWidth > w.clientWidth + 2;
    const end = can && w.scrollLeft + w.clientWidth >= w.scrollWidth - 2;
    box.classList.toggle('can', can); box.classList.toggle('end', end);
    const t = box.querySelector('.hinttext'); if (t) t.textContent = end ? box.dataset.end : box.dataset.start;
  });
}
function bindScrollHints() {
  document.querySelectorAll('.scrollbox .tablewrap').forEach(w => w.addEventListener('scroll', updateScrollHint, { passive: true }));
  window.addEventListener('resize', updateScrollHint);
}

// ---------- 登入與 API ----------
const Auth = { headers: {}, config: null, me: null };

function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('無法載入 LINE 登入元件')); document.head.appendChild(s); });
}

async function boot() {
  const cfg = await fetch('/api/config').then(r => r.json());
  Auth.config = cfg;
  const devUser = new URLSearchParams(location.search).get('dev');
  if (cfg.devAuth && devUser) {
    Auth.headers = { 'x-dev-user': devUser, 'x-dev-name': devUser };
  } else {
    if (!cfg.liffId) throw new Error('系統尚未設定 LINE 登入（LIFF ID）。');
    await loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js');
    await liff.init({ liffId: cfg.liffId });
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return new Promise(() => {}); }
    const token = liff.getIDToken();
    if (!token) { liff.logout(); liff.login({ redirectUri: location.href }); return new Promise(() => {}); }
    Auth.headers = { authorization: `Bearer ${token}` };
  }
  Auth.me = await api('/api/me');
  return Auth.me;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...Auth.headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && window.liff && liff.isLoggedIn && liff.isLoggedIn()) {
    // ID Token 過期：重新登入
    liff.logout(); liff.login({ redirectUri: location.href });
    return new Promise(() => {});
  }
  if (!res.ok) { const e = new Error(data.error || `連線錯誤（${res.status}）`); e.code = data.code; e.status = res.status; throw e; }
  return data;
}

// 會員狀態列
function memberBar(me) {
  const st = me.isAdmin ? '管理員' : me.status === 'active' ? '有效會員' : me.status === 'expired' ? '會員已到期' : '尚未開通會員';
  const cls = me.isAdmin || me.status === 'active' ? 'ok' : 'off';
  const exp = me.expiresAt ? `・到期日 ${me.expiresAt.replace(/-/g, '/')}` : '';
  return `<div class="memberbar"><span class="mname">${esc(me.name || 'LINE 使用者')}</span><span class="mstat ${cls}">${st}</span><span class="mexp">${esc(exp)}</span>${me.isAdmin ? '<a class="madmin" href="/admin.html">管理後台</a>' : ''}</div>`;
}
function lockNotice(me) {
  const why = me.status === 'expired' ? `你的會員已於 ${me.expiresAt.replace(/-/g, '/')} 到期。` : '你目前尚未開通會員。';
  return `<div class="locknote"><strong>${why}</strong>目前只能查看本人生日的個人排盤，其他生日與雙人合盤需要有效會員。<br>${esc(Auth.config?.contact || '')}</div>`;
}
function showFatal(msg) {
  document.body.insertAdjacentHTML('afterbegin', `<div class="fatal">${esc(msg)}</div>`);
}
