import type { AudioDub, PreferredQuality, SubtitleMode } from '../types.ts';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export function isValidUsername(username: unknown): username is string {
  return typeof username === 'string' && USERNAME_RE.test(username.trim());
}

export function isValidPassword(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length >= 6 &&
    password.length <= 128
  );
}

export function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export function isValidAudioDub(val: unknown): val is AudioDub {
  return val === 'jp' || val === 'en';
}

export function isValidSubtitleMode(val: unknown): val is SubtitleMode {
  return val === 'pl' || val === 'en' || val === 'none';
}

export function isValidPreferredQuality(val: unknown): val is PreferredQuality {
  return (
    val === 'max' ||
    val === '2k' ||
    val === '1080p' ||
    val === '720p' ||
    val === '480p'
  );
}

export function parsePositiveInt(val: unknown): number | null {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

export function parseNonNegativeIntOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.floor(num);
}
