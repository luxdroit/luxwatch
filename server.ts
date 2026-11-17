import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  COVERS_DIR,
  ensureStorageDirectories,
  PORT,
  TEMP_DIR,
  TRANSCODES_DIR,
  VIDEOS_DIR,
} from './server/config.ts';
import { getDb } from './server/db.ts';
import {
  enqueueVariantTranscodes,
  probeVideoFile,
  streamVideoWithRange,
} from './server/media.ts';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  clearSessionCookie,
  hashPassword,
  parseCookies,
  resolveSafeStoragePath,
  securityHeadersMiddleware,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from './server/security.ts';
import type { AuthenticatedRequest } from './server/security.ts';
import {
  canCreateUserWithRole,
  canDeleteUser,
  canManageContent,
  canViewUserInManagement,
} from './src/utils/rbacLogic.ts';
import {
  isValidAudioDub,
  isValidPassword,
  isValidPreferredQuality,
  isValidSubtitleMode,
  isValidUsername,
  parseNonNegativeIntOrNull,
  parsePositiveInt,
  sanitizeText,
} from './src/utils/securityValidation.ts';
import {
  calculateTotalWatchSeconds,
  parseExternalVideoSource,
} from './src/utils/playerLogic.ts';
import type {
  AnimeDetail,
  AnimeRelation,
  AnimeSummary,
  AudioDub,
  ContinueWatchingItem,
  Episode,
  EpisodeVariant,
  Genre,
  QualityTier,
  SubtitleMode,
  UserAccount,
  UserRole,
} from './src/types.ts';

ensureStorageDirectories();
const db = getDb();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeadersMiddleware);

// Raw binary routes must be registered before express.json()
interface UploadSession {
  id: string;
  episodeId: number;
  audioDub: AudioDub;
  subtitleMode: SubtitleMode;
  ext: string;
  totalSize: number;
  bytesWritten: number;
  tempFilePath: string;
  userId: number;
  createdAt: number;
}
const uploadSessions = new Map<string, UploadSession>();

function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const queryToken = req.query?.st;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  return null;
}

function getAuthFromRequest(req: Request): {
  id: number;
  username: string;
  role: UserRole;
  token: string;
} | null {
  const token = extractTokenFromRequest(req);
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const row = db
    .prepare('SELECT id, username, role FROM users WHERE id = ?')
    .get(payload.userId) as
    | { id: number; username: string; role: UserRole }
    | undefined;
  if (!row) return null;
  return { ...row, token };
}

function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const user = getAuthFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Wymagane logowanie.' });
    return;
  }
  req.authUser = user;
  next();
}

function requireAdminOrOwner(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const user = getAuthFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Wymagane logowanie.' });
    return;
  }
  if (!canManageContent(user.role)) {
    res.status(403).json({ error: 'Brak uprawnień administratora.' });
    return;
  }
  req.authUser = user;
  next();
}

// Raw chunk upload route (supports up to 16MB slices for multi-GB files)
app.put(
  '/api/uploads/:uploadId/chunk',
  requireAdminOrOwner,
  express.raw({ type: 'application/octet-stream', limit: '20mb' }),
  async (req: AuthenticatedRequest, res: Response) => {
    const uploadId = String(req.params.uploadId || '');
    const session = uploadSessions.get(uploadId);
    if (!session || session.userId !== req.authUser?.id) {
      res.status(404).json({ error: 'Nie znaleziono sesji przesyłania.' });
      return;
    }
    const offset = Number(req.headers['x-offset'] || 0);
    if (!Number.isInteger(offset) || offset < 0) {
      res.status(400).json({ error: 'Nieprawidłowy offset paczki.' });
      return;
    }
    const chunk = req.body;
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      res.status(400).json({ error: 'Pusta paczka danych.' });
      return;
    }

    try {
      const fh = await fs.promises.open(session.tempFilePath, 'a+');
      try {
        await fh.write(chunk, 0, chunk.length, offset);
      } finally {
        await fh.close();
      }
      session.bytesWritten += chunk.length;
      res.json({
        ok: true,
        bytesWritten: session.bytesWritten,
      });
    } catch {
      res.status(500).json({ error: 'Błąd zapisu fragmentu na dysk.' });
    }
  }
);

// Cover image upload route (raw binary up to 10MB)
app.post(
  '/api/media/covers',
  requireAdminOrOwner,
  express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: '10mb',
  }),
  (req: AuthenticatedRequest, res: Response) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 16) {
      res.status(400).json({ error: 'Nieprawidłowy plik obrazu.' });
      return;
    }
    let ext: string | null = null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      ext = '.jpg';
    } else if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      ext = '.png';
    } else if (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      ext = '.webp';
    }

    if (!ext) {
      res.status(400).json({
        error: 'Obsługiwane formaty okładek to wyłącznie JPG, PNG oraz WebP.',
      });
      return;
    }

    const fileName = `cover_${crypto.randomUUID()}${ext}`;
    const safePath = resolveSafeStoragePath(COVERS_DIR, fileName);
    if (!safePath) {
      res.status(400).json({ error: 'Nieprawidłowa ścieżka zapisu.' });
      return;
    }
    fs.writeFileSync(safePath, buf);
    res.json({
      coverPath: fileName,
      coverUrl: `/api/media/covers/${fileName}`,
    });
  }
);

app.use(express.json({ limit: '2mb' }));

// -------------------- AUTH ROUTES --------------------

function mapUserRow(row: Record<string, unknown>): UserAccount {
  return {
    id: Number(row.id),
    username: String(row.username),
    role: row.role as UserRole,
    preferredDub: row.preferred_dub as AudioDub,
    preferredSub: row.preferred_sub as SubtitleMode,
    preferredQuality: row.preferred_quality as UserAccount['preferredQuality'],
    createdAt: String(row.created_at),
  };
}

app.post('/api/auth/login', (req: Request, res: Response) => {
  const clientIp = req.ip || 'unknown';
  const rate = checkLoginRateLimit(clientIp);
  if (!rate.allowed) {
    res.status(429).json({
      error: `Zbyt wiele prób logowania. Spróbuj ponownie za ${rate.retryAfterSeconds} s.`,
    });
    return;
  }

  const username = sanitizeText(req.body?.username, 64);
  const password =
    typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    res.status(400).json({ error: 'Podaj nazwę użytkownika oraz hasło.' });
    return;
  }

  const row = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username) as Record<string, unknown> | undefined;

  if (!row || !verifyPassword(password, String(row.password_hash))) {
    res.status(401).json({ error: 'Nieprawidłowy login lub hasło.' });
    return;
  }

  clearLoginRateLimit(clientIp);
  const user = mapUserRow(row);
  const token = signSessionToken(user.id, user.role);
  setSessionCookie(res, token, req);
  res.json({ user, token });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const auth = getAuthFromRequest(req);
  if (!auth) {
    res.json({ user: null, token: null });
    return;
  }
  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(auth.id) as Record<string, unknown> | undefined;
  if (!row) {
    res.json({ user: null, token: null });
    return;
  }
  res.json({ user: mapUserRow(row), token: auth.token });
});

app.patch(
  '/api/auth/preferences',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const preferredDub = req.body?.preferredDub;
    const preferredSub = req.body?.preferredSub;
    const preferredQuality = req.body?.preferredQuality;

    if (
      !isValidAudioDub(preferredDub) ||
      !isValidSubtitleMode(preferredSub) ||
      !isValidPreferredQuality(preferredQuality)
    ) {
      res.status(400).json({ error: 'Nieprawidłowe wartości preferencji.' });
      return;
    }

    db.prepare(
      'UPDATE users SET preferred_dub = ?, preferred_sub = ?, preferred_quality = ? WHERE id = ?'
    ).run(preferredDub, preferredSub, preferredQuality, req.authUser!.id);

    const updated = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(req.authUser!.id) as Record<string, unknown>;
    res.json({ user: mapUserRow(updated) });
  }
);

// -------------------- USER MANAGEMENT (RBAC) --------------------

app.get(
  '/api/users',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const actor = req.authUser!;
    const rows = db
      .prepare(
        'SELECT id, username, role, preferred_dub, preferred_sub, preferred_quality, created_at FROM users ORDER BY id ASC'
      )
      .all() as Array<Record<string, unknown>>;

    const visible = rows
      .map(mapUserRow)
      .filter((u) => canViewUserInManagement(actor.role, u.role));
    res.json({ users: visible });
  }
);

app.post(
  '/api/users',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const actor = req.authUser!;
    const username = sanitizeText(req.body?.username, 32);
    const password =
      typeof req.body?.password === 'string' ? req.body.password : '';
    const targetRole = req.body?.role as UserRole;

    if (!isValidUsername(username)) {
      res.status(400).json({
        error:
          'Nick musi mieć 3–32 znaki i zawierać tylko litery, cyfry, ., _ lub -.',
      });
      return;
    }
    if (!isValidPassword(password)) {
      res.status(400).json({
        error: 'Hasło musi mieć od 6 do 128 znaków.',
      });
      return;
    }
    if (!canCreateUserWithRole(actor.role, targetRole)) {
      res.status(403).json({
        error: 'Twoja rola nie pozwala na utworzenie konta tego typu.',
      });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE lower(username) = lower(?)')
      .get(username) as { id: number } | undefined;
    if (existing) {
      res.status(409).json({ error: 'Użytkownik o takim nicku już istnieje.' });
      return;
    }

    const hash = hashPassword(password);
    const result = db
      .prepare(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
      )
      .run(username, hash, targetRole);

    const created = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    res.status(201).json({ user: mapUserRow(created) });
  }
);

app.delete(
  '/api/users/:id',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const actor = req.authUser!;
    const targetId = parsePositiveInt(req.params.id);
    if (!targetId) {
      res.status(400).json({ error: 'Nieprawidłowe ID użytkownika.' });
      return;
    }

    const target = db
      .prepare('SELECT id, role FROM users WHERE id = ?')
      .get(targetId) as { id: number; role: UserRole } | undefined;
    if (!target) {
      res.status(404).json({ error: 'Użytkownik nie istnieje.' });
      return;
    }

    if (!canDeleteUser(actor.role, actor.id, target.role, target.id)) {
      res.status(403).json({
        error: 'Brak uprawnień do usunięcia tego konta.',
      });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    res.json({ ok: true });
  }
);

// -------------------- GENRES --------------------

app.get('/api/genres', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  const genres = db
    .prepare('SELECT id, name FROM genres ORDER BY name ASC')
    .all() as unknown as Genre[];
  res.json({ genres });
});

app.post(
  '/api/genres',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const name = sanitizeText(req.body?.name, 40);
    if (name.length < 2) {
      res.status(400).json({ error: 'Nazwa gatunku jest za krótka.' });
      return;
    }
    const existing = db
      .prepare('SELECT id, name FROM genres WHERE lower(name) = lower(?)')
      .get(name) as Genre | undefined;
    if (existing) {
      res.json({ genre: existing });
      return;
    }
    const inserted = db
      .prepare('INSERT INTO genres (name) VALUES (?)')
      .run(name);
    res.status(201).json({
      genre: { id: Number(inserted.lastInsertRowid), name },
    });
  }
);

app.delete(
  '/api/genres/:id',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Nieprawidłowe ID gatunku.' });
      return;
    }
    db.prepare('DELETE FROM genres WHERE id = ?').run(id);
    res.json({ ok: true });
  }
);

// -------------------- ANIME CATALOG & DETAILS --------------------

function buildCoverUrl(coverPath: string): string {
  if (!coverPath) return '';
  return `/api/media/covers/${encodeURIComponent(path.basename(coverPath))}`;
}

function getAnimeSummariesForUser(userId: number): AnimeSummary[] {
  const animeRows = db
    .prepare('SELECT * FROM anime ORDER BY created_at DESC, id DESC')
    .all() as Array<Record<string, unknown>>;

  const genreRows = db
    .prepare(
      `SELECT ag.anime_id, g.id, g.name
       FROM anime_genres ag
       JOIN genres g ON g.id = ag.genre_id
       ORDER BY g.name ASC`
    )
    .all() as Array<{ anime_id: number; id: number; name: string }>;

  const genresByAnime = new Map<number, Genre[]>();
  for (const r of genreRows) {
    const list = genresByAnime.get(r.anime_id) || [];
    list.push({ id: r.id, name: r.name });
    genresByAnime.set(r.anime_id, list);
  }

  const epStatsRows = db
    .prepare(
      `SELECT e.anime_id,
              COUNT(e.id) as ep_count,
              SUM(CASE WHEN wp.completed = 1 THEN 1 ELSE 0 END) as watched_count
       FROM episodes e
       LEFT JOIN watch_progress wp ON wp.episode_id = e.id AND wp.user_id = ?
       GROUP BY e.anime_id`
    )
    .all(userId) as Array<{
    anime_id: number;
    ep_count: number;
    watched_count: number;
  }>;

  const statsByAnime = new Map<
    number,
    { epCount: number; watchedCount: number }
  >();
  for (const s of epStatsRows) {
    statsByAnime.set(s.anime_id, {
      epCount: Number(s.ep_count) || 0,
      watchedCount: Number(s.watched_count) || 0,
    });
  }

  const watchedSeriesRows = db
    .prepare('SELECT anime_id FROM watched_anime WHERE user_id = ?')
    .all(userId) as Array<{ anime_id: number }>;
  const watchedSeriesSet = new Set(watchedSeriesRows.map((w) => w.anime_id));

  return animeRows.map((a) => {
    const id = Number(a.id);
    const stats = statsByAnime.get(id) || { epCount: 0, watchedCount: 0 };
    return {
      id,
      title: String(a.title),
      originalTitle: String(a.original_title || ''),
      synopsis: String(a.synopsis || ''),
      releaseYear: Number(a.release_year),
      studio: String(a.studio || ''),
      status: a.status as AnimeSummary['status'],
      coverUrl: buildCoverUrl(String(a.cover_path || '')),
      genres: genresByAnime.get(id) || [],
      episodeCount: stats.epCount,
      watchedEpisodeCount: stats.watchedCount,
      isSeriesWatched: watchedSeriesSet.has(id),
      createdAt: String(a.created_at),
    };
  });
}

app.get('/api/anime', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const q = sanitizeText(req.query.q, 100).toLowerCase();
  const genreFilter = parsePositiveInt(req.query.genre);
  const statusFilter = sanitizeText(req.query.status, 30);

  let list = getAnimeSummariesForUser(userId);
  if (q) {
    list = list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.originalTitle.toLowerCase().includes(q) ||
        a.studio.toLowerCase().includes(q)
    );
  }
  if (genreFilter) {
    list = list.filter((a) => a.genres.some((g) => g.id === genreFilter));
  }
  if (
    statusFilter === 'Zakończone' ||
    statusFilter === 'Emitowane' ||
    statusFilter === 'Planowane'
  ) {
    list = list.filter((a) => a.status === statusFilter);
  }

  res.json({ anime: list });
});

app.get(
  '/api/anime/:id',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const animeId = parsePositiveInt(req.params.id);
    if (!animeId) {
      res.status(400).json({ error: 'Nieprawidłowe ID anime.' });
      return;
    }

    const userId = req.authUser!.id;
    const summary = getAnimeSummariesForUser(userId).find(
      (a) => a.id === animeId
    );
    if (!summary) {
      res.status(404).json({ error: 'Nie znaleziono anime.' });
      return;
    }

    const epRows = db
      .prepare(
        `SELECT e.*,
                COALESCE(wp.completed, 0) as user_completed,
                COALESCE(wp.position_seconds, 0) as user_position
         FROM episodes e
         LEFT JOIN watch_progress wp ON wp.episode_id = e.id AND wp.user_id = ?
         WHERE e.anime_id = ?
         ORDER BY e.episode_number ASC`
      )
      .all(userId, animeId) as Array<Record<string, unknown>>;

    const variantRows = db
      .prepare(
        `SELECT v.*
         FROM episode_variants v
         JOIN episodes e ON e.id = v.episode_id
         WHERE e.anime_id = ?
         ORDER BY v.id ASC`
      )
      .all(animeId) as Array<Record<string, unknown>>;

    const variantsByEp = new Map<number, EpisodeVariant[]>();
    for (const v of variantRows) {
      const epId = Number(v.episode_id);
      let avail: QualityTier[] = ['1080p', '720p', '480p'];
      let transcoded: Record<string, string> = {};
      try {
        avail = JSON.parse(String(v.available_qualities_json)) as QualityTier[];
      } catch {
        // default fallback
      }
      try {
        transcoded = JSON.parse(String(v.transcoded_paths_json)) as Record<
          string,
          string
        >;
      } catch {
        // default fallback
      }
      const readyQualities = avail.filter((q) => Boolean(transcoded[q]));
      if (readyQualities.length === 0 && avail.length > 0) {
        readyQualities.push(avail[0]);
      }

      const list = variantsByEp.get(epId) || [];
      list.push({
        id: Number(v.id),
        episodeId: epId,
        audioDub: v.audio_dub as AudioDub,
        subtitleMode: v.subtitle_mode as SubtitleMode,
        sourceType: (v.source_type === 'external' ? 'external' : 'upload'),
        externalUrl: String(v.external_url || ''),
        externalProvider: String(v.external_provider || '') as EpisodeVariant['externalProvider'],
        fileSizeBytes: Number(v.file_size_bytes),
        sourceWidth: Number(v.source_width),
        sourceHeight: Number(v.source_height),
        durationSeconds: Number(v.duration_seconds),
        availableQualities: avail,
        readyQualities,
        transcodeStatus: v.transcode_status as EpisodeVariant['transcodeStatus'],
      });
      variantsByEp.set(epId, list);
    }

    const episodes: Episode[] = epRows.map((e) => {
      const id = Number(e.id);
      const variants = variantsByEp.get(id) || [];
      const fallbackDuration = variants[0]?.durationSeconds || 0;
      return {
        id,
        animeId,
        episodeNumber: Number(e.episode_number),
        title: String(e.title),
        synopsis: String(e.synopsis || ''),
        durationSeconds: Number(e.duration_seconds) || fallbackDuration,
        introStart: e.intro_start !== null ? Number(e.intro_start) : null,
        introEnd: e.intro_end !== null ? Number(e.intro_end) : null,
        outroStart: e.outro_start !== null ? Number(e.outro_start) : null,
        outroEnd: e.outro_end !== null ? Number(e.outro_end) : null,
        variants,
        watched: Number(e.user_completed) === 1,
        progressSeconds: Number(e.user_position) || 0,
      };
    });

    const relRows = db
      .prepare(
        `SELECT r.id, r.source_anime_id, r.target_anime_id, r.relation_type,
                a.title as target_title, a.cover_path as target_cover, a.release_year as target_year
         FROM anime_relations r
         JOIN anime a ON a.id = r.target_anime_id
         WHERE r.source_anime_id = ?
         ORDER BY r.id ASC`
      )
      .all(animeId) as Array<Record<string, unknown>>;

    const relations: AnimeRelation[] = relRows.map((r) => ({
      id: Number(r.id),
      sourceAnimeId: Number(r.source_anime_id),
      targetAnimeId: Number(r.target_anime_id),
      targetTitle: String(r.target_title),
      targetCoverUrl: buildCoverUrl(String(r.target_cover || '')),
      targetYear: Number(r.target_year),
      relationType: String(r.relation_type),
    }));

    const detail: AnimeDetail = {
      ...summary,
      episodes,
      relations,
    };

    res.json({ anime: detail });
  }
);

app.post(
  '/api/anime',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const title = sanitizeText(req.body?.title, 160);
    const originalTitle = sanitizeText(req.body?.originalTitle, 160);
    const synopsis = sanitizeText(req.body?.synopsis, 2000);
    const releaseYear = parsePositiveInt(req.body?.releaseYear) || 2026;
    const studio = sanitizeText(req.body?.studio, 100);
    const status = req.body?.status;
    const coverPath = sanitizeText(req.body?.coverPath, 255);
    const genreIds: number[] = Array.isArray(req.body?.genreIds)
      ? req.body.genreIds
          .map((g: unknown) => parsePositiveInt(g))
          .filter((g: number | null): g is number => g !== null)
      : [];

    if (title.length < 1) {
      res.status(400).json({ error: 'Podaj tytuł anime.' });
      return;
    }
    const validStatus =
      status === 'Zakończone' || status === 'Emitowane' || status === 'Planowane'
        ? status
        : 'Zakończone';

    const safeCover = coverPath ? path.basename(coverPath) : '';

    const result = db
      .prepare(
        `INSERT INTO anime (title, original_title, synopsis, release_year, studio, status, cover_path, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title,
        originalTitle,
        synopsis,
        releaseYear,
        studio,
        validStatus,
        safeCover,
        req.authUser!.id
      );

    const animeId = Number(result.lastInsertRowid);
    const insertGenre = db.prepare(
      'INSERT OR IGNORE INTO anime_genres (anime_id, genre_id) VALUES (?, ?)'
    );
    for (const gid of genreIds) {
      insertGenre.run(animeId, gid);
    }

    res.status(201).json({ id: animeId });
  }
);

app.patch(
  '/api/anime/:id',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const animeId = parsePositiveInt(req.params.id);
    if (!animeId) {
      res.status(400).json({ error: 'Nieprawidłowe ID anime.' });
      return;
    }
    const existing = db
      .prepare('SELECT id, cover_path FROM anime WHERE id = ?')
      .get(animeId) as { id: number; cover_path: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Anime nie istnieje.' });
      return;
    }

    const title = sanitizeText(req.body?.title, 160);
    const originalTitle = sanitizeText(req.body?.originalTitle, 160);
    const synopsis = sanitizeText(req.body?.synopsis, 2000);
    const releaseYear = parsePositiveInt(req.body?.releaseYear) || 2026;
    const studio = sanitizeText(req.body?.studio, 100);
    const status = req.body?.status;
    const validStatus =
      status === 'Zakończone' || status === 'Emitowane' || status === 'Planowane'
        ? status
        : 'Zakończone';
    const coverPath = sanitizeText(req.body?.coverPath, 255);
    const safeCover = coverPath
      ? path.basename(coverPath)
      : existing.cover_path;

    if (!title) {
      res.status(400).json({ error: 'Tytuł nie może być pusty.' });
      return;
    }

    db.prepare(
      `UPDATE anime SET title = ?, original_title = ?, synopsis = ?, release_year = ?, studio = ?, status = ?, cover_path = ?
       WHERE id = ?`
    ).run(
      title,
      originalTitle,
      synopsis,
      releaseYear,
      studio,
      validStatus,
      safeCover,
      animeId
    );

    if (Array.isArray(req.body?.genreIds)) {
      db.prepare('DELETE FROM anime_genres WHERE anime_id = ?').run(animeId);
      const insertGenre = db.prepare(
        'INSERT OR IGNORE INTO anime_genres (anime_id, genre_id) VALUES (?, ?)'
      );
      for (const g of req.body.genreIds) {
        const gid = parsePositiveInt(g);
        if (gid) insertGenre.run(animeId, gid);
      }
    }

    res.json({ ok: true });
  }
);

app.delete(
  '/api/anime/:id',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const animeId = parsePositiveInt(req.params.id);
    if (!animeId) {
      res.status(400).json({ error: 'Nieprawidłowe ID anime.' });
      return;
    }

    // Cleanup associated video files on disk
    const variants = db
      .prepare(
        `SELECT v.file_path, v.transcoded_paths_json
         FROM episode_variants v
         JOIN episodes e ON e.id = v.episode_id
         WHERE e.anime_id = ?`
      )
      .all(animeId) as Array<{
      file_path: string;
      transcoded_paths_json: string;
    }>;

    db.prepare('DELETE FROM anime WHERE id = ?').run(animeId);

    for (const v of variants) {
      const orig = resolveSafeStoragePath(VIDEOS_DIR, v.file_path);
      if (orig && fs.existsSync(orig)) {
        try {
          fs.unlinkSync(orig);
        } catch {
          // ignore
        }
      }
      try {
        const trans = JSON.parse(v.transcoded_paths_json) as Record<
          string,
          string
        >;
        for (const name of Object.values(trans)) {
          if (name && name !== v.file_path) {
            const tp = resolveSafeStoragePath(TRANSCODES_DIR, name);
            if (tp && fs.existsSync(tp)) fs.unlinkSync(tp);
          }
        }
      } catch {
        // ignore
      }
    }

    res.json({ ok: true });
  }
);

// -------------------- ANIME RELATIONS --------------------

app.post(
  '/api/anime/:id/relations',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const sourceId = parsePositiveInt(req.params.id);
    const targetId = parsePositiveInt(req.body?.targetAnimeId);
    const relationType = sanitizeText(req.body?.relationType, 60);

    if (!sourceId || !targetId || !relationType) {
      res.status(400).json({ error: 'Podaj serię docelową oraz typ relacji.' });
      return;
    }
    if (sourceId === targetId) {
      res
        .status(400)
        .json({ error: 'Nie można powiązać anime z samym sobą.' });
      return;
    }

    const result = db
      .prepare(
        'INSERT OR IGNORE INTO anime_relations (source_anime_id, target_anime_id, relation_type) VALUES (?, ?, ?)'
      )
      .run(sourceId, targetId, relationType);

    res.status(201).json({ id: Number(result.lastInsertRowid) });
  }
);

app.delete(
  '/api/relations/:id',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const relId = parsePositiveInt(req.params.id);
    if (!relId) {
      res.status(400).json({ error: 'Nieprawidłowe ID relacji.' });
      return;
    }
    db.prepare('DELETE FROM anime_relations WHERE id = ?').run(relId);
    res.json({ ok: true });
  }
);

// -------------------- EPISODES & VARIANTS --------------------

app.post(
  '/api/anime/:id/episodes',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const animeId = parsePositiveInt(req.params.id);
    const episodeNumber = parsePositiveInt(req.body?.episodeNumber);
    const title = sanitizeText(req.body?.title, 160);
    const synopsis = sanitizeText(req.body?.synopsis, 1000);
    const durationSeconds =
      parseNonNegativeIntOrNull(req.body?.durationSeconds) || 0;
    const introStart = parseNonNegativeIntOrNull(req.body?.introStart);
    const introEnd = parseNonNegativeIntOrNull(req.body?.introEnd);
    const outroStart = parseNonNegativeIntOrNull(req.body?.outroStart);
    const outroEnd = parseNonNegativeIntOrNull(req.body?.outroEnd);

    if (!animeId || !episodeNumber || !title) {
      res.status(400).json({ error: 'Podaj numer oraz tytuł odcinka.' });
      return;
    }

    const exists = db
      .prepare(
        'SELECT id FROM episodes WHERE anime_id = ? AND episode_number = ?'
      )
      .get(animeId, episodeNumber) as { id: number } | undefined;
    if (exists) {
      res
        .status(409)
        .json({ error: 'Odcinek o takim numerze już istnieje w tej serii.' });
      return;
    }

    const inserted = db
      .prepare(
        `INSERT INTO episodes (anime_id, episode_number, title, synopsis, duration_seconds, intro_start, intro_end, outro_start, outro_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        animeId,
        episodeNumber,
        title,
        synopsis,
        durationSeconds,
        introStart,
        introEnd,
        outroStart,
        outroEnd
      );

    res.status(201).json({ id: Number(inserted.lastInsertRowid) });
  }
);

app.patch(
  '/api/episodes/:id',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const epId = parsePositiveInt(req.params.id);
    if (!epId) {
      res.status(400).json({ error: 'Nieprawidłowe ID odcinka.' });
      return;
    }
    const existing = db
      .prepare('SELECT * FROM episodes WHERE id = ?')
      .get(epId) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Odcinek nie istnieje.' });
      return;
    }

    const title = sanitizeText(req.body?.title, 160) || String(existing.title);
    const synopsis = sanitizeText(req.body?.synopsis, 1000);
    const introStart = parseNonNegativeIntOrNull(req.body?.introStart);
    const introEnd = parseNonNegativeIntOrNull(req.body?.introEnd);
    const outroStart = parseNonNegativeIntOrNull(req.body?.outroStart);
    const outroEnd = parseNonNegativeIntOrNull(req.body?.outroEnd);

    db.prepare(
      `UPDATE episodes
       SET title = ?, synopsis = ?, intro_start = ?, intro_end = ?, outro_start = ?, outro_end = ?
       WHERE id = ?`
    ).run(title, synopsis, introStart, introEnd, outroStart, outroEnd, epId);

    res.json({ ok: true });
  }
);

app.delete(
  '/api/episodes/:id',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const epId = parsePositiveInt(req.params.id);
    if (!epId) {
      res.status(400).json({ error: 'Nieprawidłowe ID odcinka.' });
      return;
    }
    const variants = db
      .prepare(
        'SELECT file_path, transcoded_paths_json FROM episode_variants WHERE episode_id = ?'
      )
      .all(epId) as Array<{
      file_path: string;
      transcoded_paths_json: string;
    }>;

    db.prepare('DELETE FROM episodes WHERE id = ?').run(epId);

    for (const v of variants) {
      const orig = resolveSafeStoragePath(VIDEOS_DIR, v.file_path);
      if (orig && fs.existsSync(orig)) {
        try {
          fs.unlinkSync(orig);
        } catch {
          // ignore
        }
      }
      try {
        const trans = JSON.parse(v.transcoded_paths_json) as Record<
          string,
          string
        >;
        for (const name of Object.values(trans)) {
          if (name && name !== v.file_path) {
            const tp = resolveSafeStoragePath(TRANSCODES_DIR, name);
            if (tp && fs.existsSync(tp)) fs.unlinkSync(tp);
          }
        }
      } catch {
        // ignore
      }
    }

    res.json({ ok: true });
  }
);

app.delete(
  '/api/variants/:id',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const variantId = parsePositiveInt(req.params.id);
    if (!variantId) {
      res.status(400).json({ error: 'Nieprawidłowe ID wersji wideo.' });
      return;
    }
    const v = db
      .prepare(
        'SELECT source_type, file_path, transcoded_paths_json FROM episode_variants WHERE id = ?'
      )
      .get(variantId) as
      | { source_type: string; file_path: string; transcoded_paths_json: string }
      | undefined;

    if (v) {
      db.prepare('DELETE FROM episode_variants WHERE id = ?').run(variantId);
      if (v.source_type !== 'external' && v.file_path) {
        const orig = resolveSafeStoragePath(VIDEOS_DIR, v.file_path);
        if (orig && fs.existsSync(orig)) {
          try {
            fs.unlinkSync(orig);
          } catch {
            // ignore
          }
        }
      }
    }
    res.json({ ok: true });
  }
);

app.post(
  '/api/episodes/:id/external-variant',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const episodeId = parsePositiveInt(req.params.id);
    const audioDub = req.body?.audioDub;
    const subtitleMode = req.body?.subtitleMode;
    const rawUrl = sanitizeText(req.body?.externalUrl, 1000);
    const externalPlatform =
      req.body?.externalPlatform === 'other' ? 'other' : 'gdrive';
    const gdriveMode = req.body?.gdriveMode === 'direct' ? 'direct' : 'preview';
    const durationSeconds =
      parseNonNegativeIntOrNull(req.body?.durationSeconds) ?? 0;
    const maxQuality = req.body?.maxQuality;

    if (
      !episodeId ||
      !isValidAudioDub(audioDub) ||
      !isValidSubtitleMode(subtitleMode)
    ) {
      res
        .status(400)
        .json({ error: 'Nieprawidłowe parametry wariantu odcinka.' });
      return;
    }

    const ep = db
      .prepare('SELECT id, duration_seconds FROM episodes WHERE id = ?')
      .get(episodeId) as { id: number; duration_seconds: number } | undefined;
    if (!ep) {
      res.status(404).json({ error: 'Odcinek nie istnieje.' });
      return;
    }

    const effectiveMode =
      externalPlatform === 'gdrive' ? 'gdrive_worker' : gdriveMode;
    const parsed = parseExternalVideoSource(rawUrl, effectiveMode);
    if (!parsed.valid) {
      res
        .status(400)
        .json({ error: parsed.error || 'Nieprawidłowy adres źródła.' });
      return;
    }

    let availQualities: QualityTier[] = ['1080p', '720p', '480p'];
    let sourceHeight = 1080;
    let sourceWidth = 1920;
    if (maxQuality === '2k') {
      availQualities = ['2k', '1080p', '720p', '480p'];
      sourceHeight = 1440;
      sourceWidth = 2560;
    } else if (maxQuality === '720p') {
      availQualities = ['720p', '480p'];
      sourceHeight = 720;
      sourceWidth = 1280;
    } else if (maxQuality === '480p') {
      availQualities = ['480p'];
      sourceHeight = 480;
      sourceWidth = 854;
    }

    const existing = db
      .prepare(
        'SELECT id, source_type, file_path FROM episode_variants WHERE episode_id = ? AND audio_dub = ? AND subtitle_mode = ?'
      )
      .get(episodeId, audioDub, subtitleMode) as
      | { id: number; source_type: string; file_path: string }
      | undefined;

    let variantId: number;
    if (existing) {
      if (existing.source_type === 'upload' && existing.file_path) {
        const oldPath = resolveSafeStoragePath(VIDEOS_DIR, existing.file_path);
        if (oldPath && fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch {
            // ignore
          }
        }
      }
      db.prepare(
        `UPDATE episode_variants
         SET source_type = 'external', external_url = ?, external_provider = ?,
             file_path = '', file_size_bytes = 0, source_width = ?, source_height = ?,
             duration_seconds = ?, available_qualities_json = ?, transcoded_paths_json = '{}',
             transcode_status = 'ready'
         WHERE id = ?`
      ).run(
        parsed.normalizedUrl,
        parsed.provider,
        sourceWidth,
        sourceHeight,
        durationSeconds || ep.duration_seconds || 0,
        JSON.stringify(availQualities),
        existing.id
      );
      variantId = existing.id;
    } else {
      const inserted = db
        .prepare(
          `INSERT INTO episode_variants (
             episode_id, audio_dub, subtitle_mode, source_type, external_url, external_provider,
             file_path, file_size_bytes, source_width, source_height, duration_seconds,
             available_qualities_json, transcoded_paths_json, transcode_status
           ) VALUES (?, ?, ?, 'external', ?, ?, '', 0, ?, ?, ?, ?, '{}', 'ready')`
        )
        .run(
          episodeId,
          audioDub,
          subtitleMode,
          parsed.normalizedUrl,
          parsed.provider,
          sourceWidth,
          sourceHeight,
          durationSeconds || ep.duration_seconds || 0,
          JSON.stringify(availQualities)
        );
      variantId = Number(inserted.lastInsertRowid);
    }

    if (durationSeconds > 0 && (!ep.duration_seconds || ep.duration_seconds === 0)) {
      db.prepare('UPDATE episodes SET duration_seconds = ? WHERE id = ?').run(
        durationSeconds,
        episodeId
      );
    }

    res.status(201).json({
      variantId,
      provider: parsed.provider,
      externalUrl: parsed.normalizedUrl,
      availableQualities: availQualities,
    });
  }
);

// -------------------- MULTI-GB CHUNKED VIDEO UPLOAD --------------------

app.post(
  '/api/uploads/init',
  requireAdminOrOwner,
  (req: AuthenticatedRequest, res: Response) => {
    const episodeId = parsePositiveInt(req.body?.episodeId);
    const audioDub = req.body?.audioDub;
    const subtitleMode = req.body?.subtitleMode;
    const fileName = sanitizeText(req.body?.fileName, 255);
    const totalSize = Number(req.body?.totalSize);

    if (
      !episodeId ||
      !isValidAudioDub(audioDub) ||
      !isValidSubtitleMode(subtitleMode)
    ) {
      res.status(400).json({ error: 'Nieprawidłowe parametry wariantu odcinka.' });
      return;
    }

    const ep = db
      .prepare('SELECT id FROM episodes WHERE id = ?')
      .get(episodeId) as { id: number } | undefined;
    if (!ep) {
      res.status(404).json({ error: 'Odcinek nie istnieje.' });
      return;
    }

    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.mp4' && ext !== '.mkv' && ext !== '.webm') {
      res.status(400).json({
        error: 'Dozwolone formaty wideo: .mp4, .mkv, .webm.',
      });
      return;
    }

    if (!Number.isFinite(totalSize) || totalSize <= 0 || totalSize > 100 * 1024 ** 3) {
      res.status(400).json({ error: 'Nieprawidłowy rozmiar pliku.' });
      return;
    }

    const uploadId = crypto.randomUUID();
    const tempFilePath = path.join(TEMP_DIR, `${uploadId}.part`);
    fs.writeFileSync(tempFilePath, Buffer.alloc(0));

    uploadSessions.set(uploadId, {
      id: uploadId,
      episodeId,
      audioDub,
      subtitleMode,
      ext,
      totalSize,
      bytesWritten: 0,
      tempFilePath,
      userId: req.authUser!.id,
      createdAt: Date.now(),
    });

    res.json({ uploadId });
  }
);

app.post(
  '/api/uploads/:uploadId/complete',
  requireAdminOrOwner,
  async (req: AuthenticatedRequest, res: Response) => {
    const uploadId = String(req.params.uploadId || '');
    const session = uploadSessions.get(uploadId);
    if (!session || session.userId !== req.authUser?.id) {
      res.status(404).json({ error: 'Nie znaleziono sesji przesyłania.' });
      return;
    }
    uploadSessions.delete(uploadId);

    if (!fs.existsSync(session.tempFilePath)) {
      res.status(400).json({ error: 'Plik tymczasowy nie istnieje.' });
      return;
    }

    const finalName = `ep${session.episodeId}_${crypto.randomUUID()}${session.ext}`;
    const finalPath = resolveSafeStoragePath(VIDEOS_DIR, finalName);
    if (!finalPath) {
      res.status(500).json({ error: 'Nieprawidłowa ścieżka docelowa.' });
      return;
    }

    fs.renameSync(session.tempFilePath, finalPath);
    const stat = fs.statSync(finalPath);
    const probe = await probeVideoFile(finalPath);
    const topTier = probe.availableQualities[0] || '480p';
    const initialPaths = { [topTier]: finalName };

    // Remove previous variant file if overwriting same (episode, dub, sub)
    const existing = db
      .prepare(
        'SELECT id, file_path FROM episode_variants WHERE episode_id = ? AND audio_dub = ? AND subtitle_mode = ?'
      )
      .get(session.episodeId, session.audioDub, session.subtitleMode) as
      | { id: number; file_path: string }
      | undefined;

    let variantId: number;
    if (existing) {
      const oldPath = resolveSafeStoragePath(VIDEOS_DIR, existing.file_path);
      if (oldPath && fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {
          // ignore
        }
      }
      db.prepare(
        `UPDATE episode_variants
         SET source_type = 'upload', external_url = '', external_provider = '',
             file_path = ?, file_size_bytes = ?, source_width = ?, source_height = ?,
             duration_seconds = ?, available_qualities_json = ?, transcoded_paths_json = ?,
             transcode_status = ?
         WHERE id = ?`
      ).run(
        finalName,
        stat.size,
        probe.width,
        probe.height,
        probe.durationSeconds,
        JSON.stringify(probe.availableQualities),
        JSON.stringify(initialPaths),
        probe.availableQualities.length > 1 ? 'processing' : 'ready',
        existing.id
      );
      variantId = existing.id;
    } else {
      const inserted = db
        .prepare(
          `INSERT INTO episode_variants (
             episode_id, audio_dub, subtitle_mode, file_path, file_size_bytes,
             source_width, source_height, duration_seconds, available_qualities_json,
             transcoded_paths_json, transcode_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          session.episodeId,
          session.audioDub,
          session.subtitleMode,
          finalName,
          stat.size,
          probe.width,
          probe.height,
          probe.durationSeconds,
          JSON.stringify(probe.availableQualities),
          JSON.stringify(initialPaths),
          probe.availableQualities.length > 1 ? 'processing' : 'ready'
        );
      variantId = Number(inserted.lastInsertRowid);
    }

    // Update episode duration if not yet set
    db.prepare(
      'UPDATE episodes SET duration_seconds = ? WHERE id = ? AND (duration_seconds IS NULL OR duration_seconds = 0)'
    ).run(probe.durationSeconds, session.episodeId);

    enqueueVariantTranscodes({
      variantId,
      sourceFileName: finalName,
      availableQualities: probe.availableQualities,
      onProgress: (vid, paths, status) => {
        db.prepare(
          'UPDATE episode_variants SET transcoded_paths_json = ?, transcode_status = ? WHERE id = ?'
        ).run(JSON.stringify(paths), status, vid);
      },
    });

    res.json({
      variantId,
      width: probe.width,
      height: probe.height,
      durationSeconds: probe.durationSeconds,
      availableQualities: probe.availableQualities,
    });
  }
);

// -------------------- PROTECTED MEDIA & STREAMING --------------------

app.get(
  '/api/media/covers/:filename',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const filename = String(req.params.filename || '');
    const safePath = resolveSafeStoragePath(COVERS_DIR, filename);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(safePath);
  }
);

app.get(
  '/api/stream/:variantId',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const variantId = parsePositiveInt(req.params.variantId);
    if (!variantId) {
      res.status(400).json({ error: 'Nieprawidłowe ID wideo.' });
      return;
    }

    const variant = db
      .prepare('SELECT * FROM episode_variants WHERE id = ?')
      .get(variantId) as Record<string, unknown> | undefined;

    if (!variant) {
      res.status(404).json({ error: 'Wariant wideo nie istnieje.' });
      return;
    }

    const requestedQuality = String(req.query.quality || '');
    let transcoded: Record<string, string> = {};
    try {
      transcoded = JSON.parse(
        String(variant.transcoded_paths_json || '{}')
      ) as Record<string, string>;
    } catch {
      // ignore
    }

    const origFileName = String(variant.file_path);
    const chosenTranscoded = transcoded[requestedQuality];

    let resolvedPath: string | null = null;
    if (chosenTranscoded && chosenTranscoded !== origFileName) {
      const candidate = resolveSafeStoragePath(TRANSCODES_DIR, chosenTranscoded);
      if (candidate && fs.existsSync(candidate)) {
        resolvedPath = candidate;
      }
    }

    if (!resolvedPath) {
      resolvedPath = resolveSafeStoragePath(VIDEOS_DIR, origFileName);
    }

    if (!resolvedPath) {
      res.status(404).json({ error: 'Brak pliku wideo.' });
      return;
    }

    streamVideoWithRange(req, res, resolvedPath);
  }
);

// -------------------- PROGRESS, WATCHED & PROFILE STATS --------------------

app.post(
  '/api/progress',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const episodeId = parsePositiveInt(req.body?.episodeId);
    const positionSeconds =
      parseNonNegativeIntOrNull(req.body?.positionSeconds) ?? 0;
    const clientDuration =
      parseNonNegativeIntOrNull(req.body?.durationSeconds) ?? 0;
    const explicitCompleted =
      typeof req.body?.completed === 'boolean' ? req.body.completed : null;

    if (!episodeId) {
      res.status(400).json({ error: 'Nieprawidłowe ID odcinka.' });
      return;
    }

    const ep = db
      .prepare('SELECT id, duration_seconds FROM episodes WHERE id = ?')
      .get(episodeId) as { id: number; duration_seconds: number } | undefined;
    if (!ep) {
      res.status(404).json({ error: 'Odcinek nie istnieje.' });
      return;
    }

    const duration = ep.duration_seconds || clientDuration;
    if (ep.duration_seconds === 0 && clientDuration > 0) {
      db.prepare('UPDATE episodes SET duration_seconds = ? WHERE id = ?').run(
        clientDuration,
        episodeId
      );
    }

    const existing = db
      .prepare(
        'SELECT completed FROM watch_progress WHERE user_id = ? AND episode_id = ?'
      )
      .get(userId, episodeId) as { completed: number } | undefined;

    const autoCompleted =
      duration > 0 && positionSeconds >= Math.floor(duration * 0.9);
    const finalCompleted =
      explicitCompleted !== null
        ? explicitCompleted
          ? 1
          : 0
        : existing?.completed === 1 || autoCompleted
          ? 1
          : 0;

    db.prepare(
      `INSERT INTO watch_progress (user_id, episode_id, position_seconds, duration_seconds, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, episode_id) DO UPDATE SET
         position_seconds = excluded.position_seconds,
         duration_seconds = CASE WHEN excluded.duration_seconds > 0 THEN excluded.duration_seconds ELSE watch_progress.duration_seconds END,
         completed = CASE WHEN ? IS NOT NULL THEN excluded.completed ELSE MAX(watch_progress.completed, excluded.completed) END,
         updated_at = datetime('now')`
    ).run(
      userId,
      episodeId,
      positionSeconds,
      duration,
      finalCompleted,
      explicitCompleted !== null ? 1 : null
    );

    res.json({ ok: true, completed: finalCompleted === 1 });
  }
);

app.post(
  '/api/episodes/:id/watched',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const episodeId = parsePositiveInt(req.params.id);
    const watched = Boolean(req.body?.watched);
    if (!episodeId) {
      res.status(400).json({ error: 'Nieprawidłowe ID odcinka.' });
      return;
    }
    const ep = db
      .prepare('SELECT id, duration_seconds FROM episodes WHERE id = ?')
      .get(episodeId) as { id: number; duration_seconds: number } | undefined;
    if (!ep) {
      res.status(404).json({ error: 'Odcinek nie istnieje.' });
      return;
    }

    db.prepare(
      `INSERT INTO watch_progress (user_id, episode_id, position_seconds, duration_seconds, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, episode_id) DO UPDATE SET
         completed = excluded.completed,
         position_seconds = CASE WHEN excluded.completed = 1 THEN 0 ELSE watch_progress.position_seconds END,
         updated_at = datetime('now')`
    ).run(
      userId,
      episodeId,
      watched ? ep.duration_seconds : 0,
      ep.duration_seconds,
      watched ? 1 : 0
    );

    res.json({ ok: true, watched });
  }
);

app.post(
  '/api/anime/:id/watched',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const animeId = parsePositiveInt(req.params.id);
    const watched = Boolean(req.body?.watched);
    if (!animeId) {
      res.status(400).json({ error: 'Nieprawidłowe ID anime.' });
      return;
    }

    const anime = db
      .prepare('SELECT id FROM anime WHERE id = ?')
      .get(animeId) as { id: number } | undefined;
    if (!anime) {
      res.status(404).json({ error: 'Anime nie istnieje.' });
      return;
    }

    if (watched) {
      db.prepare(
        "INSERT OR IGNORE INTO watched_anime (user_id, anime_id, marked_at) VALUES (?, ?, datetime('now'))"
      ).run(userId, animeId);
    } else {
      db.prepare(
        'DELETE FROM watched_anime WHERE user_id = ? AND anime_id = ?'
      ).run(userId, animeId);
    }

    const episodes = db
      .prepare('SELECT id, duration_seconds FROM episodes WHERE anime_id = ?')
      .all(animeId) as Array<{ id: number; duration_seconds: number }>;

    const upsertEp = db.prepare(
      `INSERT INTO watch_progress (user_id, episode_id, position_seconds, duration_seconds, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, episode_id) DO UPDATE SET
         completed = excluded.completed,
         updated_at = datetime('now')`
    );

    for (const ep of episodes) {
      upsertEp.run(
        userId,
        ep.id,
        watched ? ep.duration_seconds : 0,
        ep.duration_seconds,
        watched ? 1 : 0
      );
    }

    res.json({ ok: true, watched });
  }
);

app.get(
  '/api/profile/stats',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;

    const allEps = db
      .prepare('SELECT id, duration_seconds as durationSeconds FROM episodes')
      .all() as Array<{ id: number; durationSeconds: number }>;

    const watchedEpRows = db
      .prepare(
        'SELECT episode_id FROM watch_progress WHERE user_id = ? AND completed = 1'
      )
      .all(userId) as Array<{ episode_id: number }>;

    const watchedEpIds = watchedEpRows.map((r) => r.episode_id);
    const totalWatchSeconds = calculateTotalWatchSeconds(allEps, watchedEpIds);

    const summaries = getAnimeSummariesForUser(userId);
    const watchedAnimeList = summaries.filter(
      (a) =>
        a.isSeriesWatched ||
        (a.episodeCount > 0 && a.watchedEpisodeCount >= a.episodeCount)
    );

    const cwRows = db
      .prepare(
        `SELECT a.id as anime_id, a.title as anime_title, a.cover_path,
                e.id as episode_id, e.episode_number, e.title as episode_title,
                wp.position_seconds,
                CASE WHEN e.duration_seconds > 0 THEN e.duration_seconds ELSE wp.duration_seconds END as duration_seconds,
                wp.updated_at
         FROM watch_progress wp
         JOIN episodes e ON e.id = wp.episode_id
         JOIN anime a ON a.id = e.anime_id
         WHERE wp.user_id = ? AND wp.position_seconds > 0 AND wp.completed = 0
         ORDER BY wp.updated_at DESC
         LIMIT 12`
      )
      .all(userId) as Array<Record<string, unknown>>;

    const continueWatching: ContinueWatchingItem[] = cwRows.map((r) => ({
      animeId: Number(r.anime_id),
      animeTitle: String(r.anime_title),
      coverUrl: buildCoverUrl(String(r.cover_path || '')),
      episodeId: Number(r.episode_id),
      episodeNumber: Number(r.episode_number),
      episodeTitle: String(r.episode_title),
      positionSeconds: Number(r.position_seconds),
      durationSeconds: Number(r.duration_seconds) || 1,
      updatedAt: String(r.updated_at),
    }));

    res.json({
      stats: {
        totalWatchSeconds,
        watchedEpisodesCount: watchedEpIds.length,
        completedAnimeCount: watchedAnimeList.length,
        watchedAnimeList,
        continueWatching,
      },
    });
  }
);

// -------------------- STATIC / VITE SETUP --------------------

async function startServer(): Promise<void> {
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.argv.includes('--prod');

  if (!isProd) {
    const viteModule = await import('vite');
    const vite = await viteModule.createServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LuxWatch server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
