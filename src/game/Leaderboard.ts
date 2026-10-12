/**
 * Scoreboards for endless runs and the daily challenge.
 *
 * Always kept locally (top 10 on this device). If the build sets VITE_LEADERBOARD_URL to a
 * deployed copy of server/leaderboard-worker.js, scores are also posted there and the boards
 * screen shows the online top 20. With no URL set, nothing ever leaves the device.
 */
import type { BoardEntry, Records } from './Storage';

const URL_BASE = (import.meta.env?.VITE_LEADERBOARD_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const ONLINE = URL_BASE.length > 0;

export type BoardId = 'endless' | `daily-${string}`;

const LOCAL_MAX = 10;

/** Adds a score to this device's board; returns its rank (1-based) or 0 if it didn't make it. */
export function addLocal(rec: Records, board: BoardId, entry: BoardEntry): number {
  const list = board === 'endless' ? rec.boards.endless : (rec.boards.daily[board.slice(6)] ??= []);
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list.splice(LOCAL_MAX);
  // keep only the last week of daily boards
  const days = Object.keys(rec.boards.daily).sort();
  for (const d of days.slice(0, Math.max(0, days.length - 7))) delete rec.boards.daily[d];
  return list.indexOf(entry) + 1;
}

export function localBoard(rec: Records, board: BoardId): BoardEntry[] {
  return board === 'endless' ? rec.boards.endless : rec.boards.daily[board.slice(6)] ?? [];
}

/** Posts a score to the online board (if configured). Resolves to the online rank or null. */
export async function submitOnline(board: BoardId, entry: BoardEntry): Promise<number | null> {
  if (!ONLINE) return null;
  try {
    const res = await fetch(`${URL_BASE}/board/${board}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: entry.name, score: Math.round(entry.score), stage: entry.stage ?? 0 }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json.rank === 'number' ? json.rank : null;
  } catch {
    return null;
  }
}

/** Online top 20, or null when offline / not configured / unreachable. */
export async function fetchOnline(board: BoardId): Promise<BoardEntry[] | null> {
  if (!ONLINE) return null;
  try {
    const res = await fetch(`${URL_BASE}/board/${board}`);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json.entries) ? (json.entries as BoardEntry[]) : null;
  } catch {
    return null;
  }
}
