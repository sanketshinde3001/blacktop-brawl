/**
 * Optional online scoreboards for Blacktop Brawl: a Cloudflare Worker backed by one KV namespace.
 *
 *   GET  /board/endless             -> { entries: [{ name, score, stage, date }] }   (top 20)
 *   GET  /board/daily-2026-10-02
 *   POST /board/<id>  { name, score, stage }  -> { rank }
 *
 * Deploy: see server/README.md. The game only talks to it when built with VITE_LEADERBOARD_URL.
 * It is a casual board: the game runs in the browser, so scores can't be fully trusted. The checks
 * below just keep out junk (bad names, absurd scores, spam).
 */
const MAX_KEEP = 50;
const MAX_RETURN = 20;
const NAME = /^[A-Z0-9 ]{1,8}$/;
const BOARD = /^(endless|daily-\d{4}-\d{2}-\d{2})$/;
/** generous ceilings: a stage is worth at most a few thousand points */
const MAX_SCORE = { endless: 400000, daily: 60000 };

function cors(env, extra = {}) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
}

const json = (env, body, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(env, { 'Content-Type': 'application/json' }) });

function dayOk(board) {
  if (!board.startsWith('daily-')) return true;
  // only today's board (with a day of slack for time zones) takes new scores
  const day = Date.parse(board.slice(6) + 'T12:00:00Z');
  return Math.abs(Date.now() - day) < 36 * 3600 * 1000;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/board\/([a-z0-9-]+)$/);
    if (!m || !BOARD.test(m[1])) return json(env, { error: 'unknown board' }, 404);
    const board = m[1];
    const key = `board:${board}`;
    const list = (await env.SCORES.get(key, 'json')) || [];

    if (req.method === 'GET') return json(env, { entries: list.slice(0, MAX_RETURN) });
    if (req.method !== 'POST') return json(env, { error: 'method' }, 405);

    // one score per address per minute (KV TTLs start at 60 s)
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = `rate:${ip}`;
    if (await env.SCORES.get(rateKey)) return json(env, { error: 'slow down' }, 429);
    await env.SCORES.put(rateKey, '1', { expirationTtl: 60 });

    let body;
    try {
      body = await req.json();
    } catch {
      return json(env, { error: 'bad json' }, 400);
    }
    const name = String(body.name || '').toUpperCase().trim();
    const score = Math.round(Number(body.score));
    const stage = Math.max(0, Math.min(999, Math.round(Number(body.stage) || 0)));
    const cap = board === 'endless' ? MAX_SCORE.endless : MAX_SCORE.daily;
    if (!NAME.test(name) || !Number.isFinite(score) || score <= 0 || score > cap || !dayOk(board)) return json(env, { error: 'rejected' }, 400);

    const entry = { name, score, stage, date: new Date().toISOString().slice(0, 10) };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    list.splice(MAX_KEEP);
    // daily boards expire after a week
    await env.SCORES.put(key, JSON.stringify(list), board === 'endless' ? {} : { expirationTtl: 8 * 86400 });
    const rank = list.indexOf(entry) + 1;
    return json(env, { rank: rank || null });
  },
};
