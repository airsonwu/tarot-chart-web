// LINE 會員版後端（Cloudflare Worker）
// - 以 LINE LIFF 的 ID Token 辨識使用者（向 LINE 伺服器驗證）
// - 會員資料存在 D1 資料庫
// - 排盤在後端計算；未開通或已到期者只能看本人生日的個人排盤
import { computeChart, computePair, isValidDate, todayTaipei, parse, pad } from './calc.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const fail = (status, message, code) => json({ error: message, code }, status);
const nowIso = () => new Date().toISOString();

// ---------- 身分驗證 ----------
const tokenCache = new Map(); // idToken -> { user, exp }

async function verifyLineToken(idToken, env) {
  const hit = tokenCache.get(idToken);
  if (hit && hit.exp > Date.now()) return hit.user;
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.LINE_CHANNEL_ID }),
  });
  if (!res.ok) return null;
  const p = await res.json();
  if (!p.sub) return null;
  const user = { id: p.sub, name: p.name || '' };
  const exp = Math.min((p.exp || 0) * 1000, Date.now() + 10 * 60e3);
  if (tokenCache.size > 5000) tokenCache.clear();
  tokenCache.set(idToken, { user, exp });
  return user;
}

async function getUser(request, env) {
  // 本機開發模式（正式環境不可設定 DEV_AUTH）
  if (env.DEV_AUTH === '1') {
    const dev = request.headers.get('x-dev-user');
    if (dev) return { id: dev, name: request.headers.get('x-dev-name') || dev };
  }
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyLineToken(m[1], env);
}

const adminIds = env => String(env.ADMIN_LINE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

function statusOf(row, today) {
  if (!row || !row.expires_at) return 'none';
  return row.expires_at >= today ? 'active' : 'expired';
}

async function loadMember(env, user) {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO members (line_user_id, display_name, created_at, updated_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?3, ?3)
     ON CONFLICT(line_user_id) DO UPDATE SET display_name = COALESCE(NULLIF(?2, ''), display_name), last_seen_at = ?3`
  ).bind(user.id, user.name, now).run();
  return env.DB.prepare('SELECT * FROM members WHERE line_user_id = ?1').bind(user.id).first();
}

function meView(row, user, env) {
  const today = todayTaipei();
  const isAdmin = adminIds(env).includes(user.id);
  const status = statusOf(row, today);
  return {
    userId: user.id, name: row.display_name || user.name, birth: row.birth || null,
    plan: row.plan || null, expiresAt: row.expires_at || null,
    status, active: isAdmin || status === 'active', isAdmin, today,
  };
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function addYears(isoDate, years) {
  const d = parse(isoDate);
  const t = new Date(Date.UTC(d.y + years, d.m - 1, d.d));
  if (t.getUTCMonth() !== d.m - 1) t.setUTCDate(0); // 2/29 → 2/28
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// ---------- API ----------
async function handleApi(request, env, url) {
  const path = url.pathname;
  if (path === '/api/config') {
    return json({ liffId: env.LIFF_ID || '', devAuth: env.DEV_AUTH === '1', contact: env.CONTACT_TEXT || '' });
  }

  const user = await getUser(request, env);
  if (!user) return fail(401, '請從 LINE 重新開啟並登入。', 'auth');
  const row = await loadMember(env, user);
  const me = meView(row, user, env);

  if (path === '/api/me' && request.method === 'GET') return json(me);

  if (path === '/api/me/birth' && request.method === 'POST') {
    if (row.birth) return fail(409, '已經登記過生日，如需更改請聯絡管理員。', 'birth_locked');
    const { birth } = await readBody(request);
    if (!isValidDate(birth)) return fail(400, '生日格式不正確，或超出 1900–2100 年範圍。', 'bad_birth');
    await env.DB.prepare('UPDATE members SET birth = ?1, updated_at = ?2 WHERE line_user_id = ?3')
      .bind(birth, nowIso(), user.id).run();
    return json({ ...me, birth });
  }

  if (path === '/api/chart' && request.method === 'POST') {
    const body = await readBody(request);
    const today = todayTaipei();
    let birth;
    if (me.active) birth = body.birth || me.birth;
    else {
      if (!me.birth) return fail(403, '請先登記本人生日。', 'need_birth');
      birth = me.birth; // 未開通或已到期：只能看本人生日
    }
    if (!isValidDate(birth)) return fail(400, '生日格式不正確，或超出 1900–2100 年範圍。', 'bad_birth');
    let year = Number(body.year) || Number(today.slice(0, 4));
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return fail(400, '查詢流年須在 1900–2100 年之間。', 'bad_year');
    let day = body.day;
    if (!isValidDate(day)) day = today.startsWith(`${year}-`) ? today : `${year}-01-01`;
    const chart = computeChart({ birth, year, day, today });
    return json({ locked: !me.active, me, chart });
  }

  if (path === '/api/pair' && request.method === 'POST') {
    if (!me.active) return fail(403, '雙人合盤僅限有效會員使用。', 'not_member');
    const { birthA, birthB } = await readBody(request);
    if (!isValidDate(birthA) || !isValidDate(birthB)) return fail(400, '請輸入兩個人有效的生日（1900–2100 年）。', 'bad_birth');
    return json(computePair({ birthA, birthB, today: todayTaipei() }));
  }

  // ---------- 管理後台 ----------
  if (path.startsWith('/api/admin/')) {
    if (!me.isAdmin) return fail(403, '沒有管理權限。', 'not_admin');
    const today = todayTaipei();

    if (path === '/api/admin/members' && request.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      const like = `%${q}%`;
      const rs = await env.DB.prepare(
        `SELECT * FROM members
         WHERE ?1 = '' OR display_name LIKE ?2 OR line_user_id LIKE ?2 OR birth LIKE ?2 OR note LIKE ?2
         ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT 500`
      ).bind(q, like).all();
      const list = rs.results.map(r => ({ ...r, status: statusOf(r, today) }));
      const counts = { active: 0, expired: 0, none: 0 };
      for (const r of list) counts[r.status]++;
      return json({ today, counts, members: list });
    }

    if (path === '/api/admin/member' && request.method === 'POST') {
      const b = await readBody(request);
      const target = await env.DB.prepare('SELECT * FROM members WHERE line_user_id = ?1').bind(b.userId || '').first();
      if (!target) return fail(404, '找不到這位會員。', 'not_found');
      const next = { ...target };
      if ('birth' in b) {
        if (b.birth && !isValidDate(b.birth)) return fail(400, '生日格式不正確。', 'bad_birth');
        next.birth = b.birth || null;
      }
      if ('expiresAt' in b) {
        if (b.expiresAt && !isValidDate(b.expiresAt)) return fail(400, '到期日格式不正確。', 'bad_date');
        next.expires_at = b.expiresAt || null;
      }
      if ('plan' in b) next.plan = String(b.plan || '').slice(0, 40) || null;
      if ('note' in b) next.note = String(b.note || '').slice(0, 500) || null;
      if (Number(b.addYears) > 0) {
        const start = target.expires_at && target.expires_at >= today ? target.expires_at : today;
        next.expires_at = addYears(start, Number(b.addYears));
      }
      await env.DB.batch([
        env.DB.prepare('UPDATE members SET birth = ?1, expires_at = ?2, plan = ?3, note = ?4, updated_at = ?5 WHERE line_user_id = ?6')
          .bind(next.birth, next.expires_at, next.plan, next.note, nowIso(), target.line_user_id),
        env.DB.prepare('INSERT INTO admin_log (admin_id, target_id, action, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(user.id, target.line_user_id, 'update', JSON.stringify({
            before: { birth: target.birth, expires_at: target.expires_at, plan: target.plan },
            after: { birth: next.birth, expires_at: next.expires_at, plan: next.plan },
          }), nowIso()),
      ]);
      return json({ ...next, status: statusOf(next, today) });
    }
  }

  return fail(404, '找不到這個功能。', 'not_found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, url); }
      catch (e) { console.error(e); return fail(500, '系統忙碌中，請稍後再試。', 'server'); }
    }
    return env.ASSETS.fetch(request);
  },
};
