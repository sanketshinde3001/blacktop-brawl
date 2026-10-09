import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads KEY=VALUE pairs from .env into process.env (no dependency needed). */
export function loadEnv(root = process.cwd()): void {
  const file = resolve(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function apiKey(): string {
  loadEnv();
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing. Copy .env.example to .env and set your key.');
  return key;
}
