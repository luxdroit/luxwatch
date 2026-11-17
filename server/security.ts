import crypto from 'node:crypto';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getSessionSecret, STORAGE_DIR } from './config.ts';
import type { UserRole } from '../src/types.ts';

export const SESSION_COOKIE_NAME = 'kv_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: number;
  role: UserRole;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: number;
    username: string;
    role: UserRole;
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const expected = Buffer.from(hexHash, 'hex');
    const actual = crypto.scryptSync(password, salt, 64);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function signSessionToken(userId: number, role: UserRole): string {
  const payload: SessionPayload = {
    userId,
    role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;
  try {
    const expectedSig = crypto
      .createHmac('sha256', getSessionSecret())
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(providedSig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SessionPayload;
    if (
      typeof parsed.userId !== 'number' ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < Date.now()
    ) {
      return null;
    }
    if (
      parsed.role !== 'owner' &&
      parsed.role !== 'admin' &&
      parsed.role !== 'normal'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function setSessionCookie(
  res: Response,
  token: string,
  req: Request
): void {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
  });
}

export function resolveSafeStoragePath(
  baseDir: string,
  relativeName: string
): string | null {
  const cleanName = path.basename(relativeName);
  if (!cleanName || cleanName !== relativeName) {
    return null;
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, cleanName);
  if (
    !resolvedTarget.startsWith(resolvedBase + path.sep) ||
    !resolvedTarget.startsWith(STORAGE_DIR + path.sep)
  ) {
    return null;
  }
  return resolvedTarget;
}

const loginAttempts = new Map<string, number[]>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;

export function checkLoginRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const prev = (loginAttempts.get(ip) || []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  if (prev.length >= MAX_ATTEMPTS) {
    const oldest = prev[0];
    const retryAfterSeconds = Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000);
    loginAttempts.set(ip, prev);
    return { allowed: false, retryAfterSeconds };
  }
  prev.push(now);
  loginAttempts.set(ip, prev);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearLoginRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: https:; frame-src 'self' https://drive.google.com https://docs.google.com; worker-src 'self' blob:; manifest-src 'self'; connect-src 'self' https:;"
  );
  next();
}
