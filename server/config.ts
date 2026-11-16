import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PORT = Number(process.env.PORT) || 3000;
export const STORAGE_DIR = path.resolve(
  process.env.STORAGE_DIR || path.join(process.cwd(), 'storage')
);

export const DB_DIR = path.join(STORAGE_DIR, 'db');
export const VIDEOS_DIR = path.join(STORAGE_DIR, 'videos');
export const TRANSCODES_DIR = path.join(STORAGE_DIR, 'transcodes');
export const COVERS_DIR = path.join(STORAGE_DIR, 'covers');
export const TEMP_DIR = path.join(STORAGE_DIR, 'temp');

export function ensureStorageDirectories(): void {
  for (const dir of [
    STORAGE_DIR,
    DB_DIR,
    VIDEOS_DIR,
    TRANSCODES_DIR,
    COVERS_DIR,
    TEMP_DIR,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

let cachedSecret: string | null = null;

export function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    cachedSecret = process.env.SESSION_SECRET;
    return cachedSecret;
  }
  ensureStorageDirectories();
  const secretFile = path.join(DB_DIR, '.session_secret');
  if (fs.existsSync(secretFile)) {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) {
      cachedSecret = existing;
      return cachedSecret;
    }
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  cachedSecret = generated;
  return cachedSecret;
}
