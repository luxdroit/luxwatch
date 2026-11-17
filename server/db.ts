import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  COVERS_DIR,
  DB_DIR,
  ensureStorageDirectories,
  VIDEOS_DIR,
} from './config.ts';
import { enqueueVariantTranscodes, generateDemoClip } from './media.ts';
import { hashPassword } from './security.ts';
import type { QualityTier } from '../src/types.ts';
import {
  buildLuxSourceDriveUrl,
  extractGoogleDriveFileId,
} from '../src/utils/playerLogic.ts';

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  ensureStorageDirectories();
  const oldDbPath = path.join(DB_DIR, 'kurovault.sqlite');
  const dbPath = path.join(DB_DIR, 'luxwatch.sqlite');
  if (fs.existsSync(oldDbPath) && !fs.existsSync(dbPath)) {
    fs.copyFileSync(oldDbPath, dbPath);
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  seedDefaults(db);
  dbInstance = db;
  return db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'normal')),
      preferred_dub TEXT NOT NULL DEFAULT 'jp' CHECK(preferred_dub IN ('jp', 'en', 'pl', 'none')),
      preferred_sub TEXT NOT NULL DEFAULT 'pl' CHECK(preferred_sub IN ('pl', 'en', 'none')),
      preferred_quality TEXT NOT NULL DEFAULT 'max' CHECK(preferred_quality IN ('max', '2k', '1080p', '720p', '480p')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS anime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_title TEXT NOT NULL DEFAULT '',
      synopsis TEXT NOT NULL DEFAULT '',
      release_year INTEGER NOT NULL DEFAULT 2025,
      studio TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Zakończone' CHECK(status IN ('Zakończone', 'Emitowane', 'Planowane')),
      cover_path TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS anime_genres (
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
      PRIMARY KEY (anime_id, genre_id)
    );

    CREATE TABLE IF NOT EXISTS anime_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      target_anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_anime_id, target_anime_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      episode_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      synopsis TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      intro_start INTEGER,
      intro_end INTEGER,
      outro_start INTEGER,
      outro_end INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(anime_id, episode_number)
    );

    CREATE TABLE IF NOT EXISTS episode_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      audio_dub TEXT NOT NULL CHECK(audio_dub IN ('jp', 'en', 'pl', 'none')),
      subtitle_mode TEXT NOT NULL CHECK(subtitle_mode IN ('pl', 'en', 'none')),
      source_type TEXT NOT NULL DEFAULT 'upload' CHECK(source_type IN ('upload', 'external')),
      external_url TEXT NOT NULL DEFAULT '',
      external_provider TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      source_width INTEGER NOT NULL DEFAULT 1920,
      source_height INTEGER NOT NULL DEFAULT 1080,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      available_qualities_json TEXT NOT NULL DEFAULT '["1080p","720p","480p"]',
      transcoded_paths_json TEXT NOT NULL DEFAULT '{}',
      transcode_status TEXT NOT NULL DEFAULT 'ready' CHECK(transcode_status IN ('ready', 'processing', 'failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(episode_id, audio_dub, subtitle_mode)
    );

    CREATE TABLE IF NOT EXISTS watch_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      position_seconds INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, episode_id)
    );

    CREATE TABLE IF NOT EXISTS watched_anime (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      marked_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, anime_id)
    );

    CREATE TABLE IF NOT EXISTS watching_anime (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      marked_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, anime_id)
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Safe migration for existing databases adding external video source columns
  const cols = db
    .prepare("PRAGMA table_info('episode_variants')")
    .all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('source_type')) {
    db.exec(
      "ALTER TABLE episode_variants ADD COLUMN source_type TEXT NOT NULL DEFAULT 'upload'"
    );
  }
  if (!colNames.has('external_url')) {
    db.exec(
      "ALTER TABLE episode_variants ADD COLUMN external_url TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!colNames.has('external_provider')) {
    db.exec(
      "ALTER TABLE episode_variants ADD COLUMN external_provider TEXT NOT NULL DEFAULT ''"
    );
  }

  // One-time migration: upgrade previously saved Google Drive iframe/preview links to LuxSource Worker stream URLs
  const migratedRow = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('migrated_gdrive_to_luxsource_v1') as { value: string } | undefined;
  if (!migratedRow) {
    const legacyDriveVariants = db
      .prepare(
        `SELECT id, external_url
         FROM episode_variants
         WHERE source_type = 'external'
           AND (external_provider = 'gdrive_preview' OR external_url LIKE '%drive.google.com%' OR external_url LIKE '%docs.google.com%')`
      )
      .all() as Array<{ id: number; external_url: string }>;
    const updateStmt = db.prepare(
      `UPDATE episode_variants
       SET external_provider = 'gdrive_direct', external_url = ?
       WHERE id = ?`
    );
    for (const row of legacyDriveVariants) {
      const fileId = extractGoogleDriveFileId(row.external_url);
      if (fileId) {
        updateStmt.run(buildLuxSourceDriveUrl(fileId), row.id);
      }
    }
    db.prepare(
      'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)'
    ).run('migrated_gdrive_to_luxsource_v1', 'done');
  }

  // One-time migration: widen CHECK constraints on users.preferred_dub and episode_variants.audio_dub to include 'pl' and 'none'
  const dubMigrated = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('migrated_audio_dub_pl_none_v2') as { value: string } | undefined;
  if (!dubMigrated) {
    const usersSqlRow = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get() as { sql?: string } | undefined;
    const variantsSqlRow = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'episode_variants'")
      .get() as { sql?: string } | undefined;

    const needsUsersRebuild = Boolean(
      usersSqlRow?.sql && !/preferred_dub[^,)]*'pl'/i.test(usersSqlRow.sql)
    );
    const needsVariantsRebuild = Boolean(
      variantsSqlRow?.sql && !/audio_dub[^,)]*'pl'/i.test(variantsSqlRow.sql)
    );

    if (needsUsersRebuild || needsVariantsRebuild) {
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec('BEGIN;');
      try {
        if (needsUsersRebuild) {
          db.exec(`
            CREATE TABLE users_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'normal')),
              preferred_dub TEXT NOT NULL DEFAULT 'jp' CHECK(preferred_dub IN ('jp', 'en', 'pl', 'none')),
              preferred_sub TEXT NOT NULL DEFAULT 'pl' CHECK(preferred_sub IN ('pl', 'en', 'none')),
              preferred_quality TEXT NOT NULL DEFAULT 'max' CHECK(preferred_quality IN ('max', '2k', '1080p', '720p', '480p')),
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO users_new (id, username, password_hash, role, preferred_dub, preferred_sub, preferred_quality, created_at)
            SELECT id, username, password_hash, role, preferred_dub, preferred_sub, preferred_quality, created_at FROM users;
            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;
          `);
        }
        if (needsVariantsRebuild) {
          db.exec(`
            CREATE TABLE episode_variants_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
              audio_dub TEXT NOT NULL CHECK(audio_dub IN ('jp', 'en', 'pl', 'none')),
              subtitle_mode TEXT NOT NULL CHECK(subtitle_mode IN ('pl', 'en', 'none')),
              source_type TEXT NOT NULL DEFAULT 'upload' CHECK(source_type IN ('upload', 'external')),
              external_url TEXT NOT NULL DEFAULT '',
              external_provider TEXT NOT NULL DEFAULT '',
              file_path TEXT NOT NULL DEFAULT '',
              file_size_bytes INTEGER NOT NULL DEFAULT 0,
              source_width INTEGER NOT NULL DEFAULT 1920,
              source_height INTEGER NOT NULL DEFAULT 1080,
              duration_seconds INTEGER NOT NULL DEFAULT 0,
              available_qualities_json TEXT NOT NULL DEFAULT '["1080p","720p","480p"]',
              transcoded_paths_json TEXT NOT NULL DEFAULT '{}',
              transcode_status TEXT NOT NULL DEFAULT 'ready' CHECK(transcode_status IN ('ready', 'processing', 'failed')),
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(episode_id, audio_dub, subtitle_mode)
            );
            INSERT INTO episode_variants_new (
              id, episode_id, audio_dub, subtitle_mode, source_type, external_url, external_provider,
              file_path, file_size_bytes, source_width, source_height, duration_seconds,
              available_qualities_json, transcoded_paths_json, transcode_status, created_at
            )
            SELECT
              id, episode_id, audio_dub, subtitle_mode, source_type, external_url, external_provider,
              file_path, file_size_bytes, source_width, source_height, duration_seconds,
              available_qualities_json, transcoded_paths_json, transcode_status, created_at
            FROM episode_variants;
            DROP TABLE episode_variants;
            ALTER TABLE episode_variants_new RENAME TO episode_variants;
          `);
        }
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      } finally {
        db.exec('PRAGMA foreign_keys = ON;');
      }
    }

    db.prepare(
      'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)'
    ).run('migrated_audio_dub_pl_none_v2', 'done');
  }
}

function copySeedCover(assetFileName: string, targetFileName: string): string {
  const srcPath = path.resolve(
    process.cwd(),
    'src',
    'assets',
    'images',
    assetFileName
  );
  const dstPath = path.join(COVERS_DIR, targetFileName);
  if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
    fs.copyFileSync(srcPath, dstPath);
  }
  return targetFileName;
}

function seedDefaults(db: DatabaseSync): void {
  // Seed primary owner account silently on first initialization
  const ownerRow = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('Luxdroit') as { id: number } | undefined;

  let ownerId: number;
  if (!ownerRow) {
    const initialPass = process.env.INITIAL_OWNER_PASSWORD || 'MinePoland';
    const hash = hashPassword(initialPass);
    const inserted = db
      .prepare(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
      )
      .run('Luxdroit', hash, 'owner');
    ownerId = Number(inserted.lastInsertRowid);
  } else {
    ownerId = ownerRow.id;
  }

  // Seed default genres if empty
  const genreCount = db
    .prepare('SELECT COUNT(*) as cnt FROM genres')
    .get() as { cnt: number };
  if (genreCount.cnt === 0) {
    const defaultGenres = [
      'Akcja',
      'Dark Fantasy',
      'Sci-Fi',
      'Tajemnica',
      'Dramat',
      'Psychologiczny',
      'Seinen',
      'Cyberpunk',
      'Okruchy życia',
    ];
    const insertGenre = db.prepare('INSERT INTO genres (name) VALUES (?)');
    for (const g of defaultGenres) {
      insertGenre.run(g);
    }
  }

  // Seed initial catalog if empty so the platform is immediately inspectable and playable
  const animeCount = db
    .prepare('SELECT COUNT(*) as cnt FROM anime')
    .get() as { cnt: number };
  if (animeCount.cnt > 0) {
    return;
  }

  const cover1 = copySeedCover(
    'anime_crimson_blade_1794843748159.jpg',
    'seed_crimson_blade.jpg'
  );
  const cover2 = copySeedCover(
    'anime_astral_chronicle_1794843748867.jpg',
    'seed_astral_chronicle.jpg'
  );
  const cover3 = copySeedCover(
    'anime_nocturne_tokyo_1794843749041.jpg',
    'seed_nocturne_tokyo.jpg'
  );

  const insertAnime = db.prepare(
    `INSERT INTO anime (title, original_title, synopsis, release_year, studio, status, cover_path, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const a1 = Number(
    insertAnime.run(
      'Zaćmienie Szkarłatnego Ostrza',
      'Kurenai no Shoku: Kenki',
      'W krainie podzielonej wiecznym zaćmieniem samotny szermierz przemierza pogranicze cieni, by odnaleźć ostatnią wykutą w złocie pieczęć przed nadejściem zimy.',
      2025,
      'Studio Kuro',
      'Zakończone',
      cover1,
      ownerId
    ).lastInsertRowid
  );

  const a2 = Number(
    insertAnime.run(
      'Kroniki Astrolabium',
      'Tenmonkan no Kiseki',
      'Na orbicie złotego gazowego olbrzyma młoda nawigatorka odkrywa zapomnianą mapę grawitacyjną prowadzącą poza granice skolonizowanego układu.',
      2026,
      'Orbital Works',
      'Emitowane',
      cover2,
      ownerId
    ).lastInsertRowid
  );

  const a3 = Number(
    insertAnime.run(
      'Nokturn w Deszczowym Tokio',
      'Ame no Yoru no Shirabe',
      'Podczas niekończącej się listopadowej ulewy prywatny archiwista dźwięków odtwarza stare kasety z zaułków Shinjuku, odkrywając powiązania sprzed dwudziestu lat.',
      2024,
      'Studio Aoi',
      'Zakończone',
      cover3,
      ownerId
    ).lastInsertRowid
  );

  const getGenreId = db.prepare('SELECT id FROM genres WHERE name = ?');
  const linkGenre = db.prepare(
    'INSERT OR IGNORE INTO anime_genres (anime_id, genre_id) VALUES (?, ?)'
  );
  const assignGenres = (animeId: number, names: string[]) => {
    for (const name of names) {
      const row = getGenreId.get(name) as { id: number } | undefined;
      if (row) linkGenre.run(animeId, row.id);
    }
  };
  assignGenres(a1, ['Dark Fantasy', 'Akcja', 'Seinen']);
  assignGenres(a2, ['Sci-Fi', 'Dramat', 'Tajemnica']);
  assignGenres(a3, ['Tajemnica', 'Psychologiczny', 'Okruchy życia']);

  // Relations between seeded anime
  const insertRel = db.prepare(
    'INSERT OR IGNORE INTO anime_relations (source_anime_id, target_anime_id, relation_type) VALUES (?, ?, ?)'
  );
  insertRel.run(a1, a3, 'Spin-off');
  insertRel.run(a3, a1, 'Historia równoległa');
  insertRel.run(a2, a1, 'Sequel duchowy');

  // Episodes with intro/outro timestamps
  const insertEp = db.prepare(
    `INSERT INTO episodes (anime_id, episode_number, title, synopsis, duration_seconds, intro_start, intro_end, outro_start, outro_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const ep1 = Number(
    insertEp.run(
      a1,
      1,
      'Most pod Złotą Koroną',
      'Pierwsze spotkanie strażników przełęczy w noc krwawego zaćmienia.',
      16,
      2,
      6,
      11,
      16
    ).lastInsertRowid
  );

  const ep2 = Number(
    insertEp.run(
      a1,
      2,
      'Popiół i Stara Pieczęć',
      'Wędrówka przez dolinę mgieł i rozszyfrowanie inskrypcji na klindze.',
      16,
      2,
      6,
      11,
      16
    ).lastInsertRowid
  );

  const ep3 = Number(
    insertEp.run(
      a2,
      1,
      'Orbita Pierścienia',
      'Kalibracja głównego astrolabium przed wejściem w cień planety.',
      16,
      2,
      6,
      11,
      16
    ).lastInsertRowid
  );

  const ep4 = Number(
    insertEp.run(
      a3,
      1,
      'Taśma numer siedem',
      'Nocne nagranie z deszczowego zaułka odkrywa nieznany głos.',
      16,
      2,
      6,
      11,
      16
    ).lastInsertRowid
  );

  // Seed playable multi-variant clips asynchronously so server starts immediately
  const seedVariantDefs: Array<{
    epId: number;
    dub: 'jp' | 'en';
    sub: 'pl' | 'en' | 'none';
    fileName: string;
    width: number;
    height: number;
    qualities: QualityTier[];
    freq: number;
  }> = [
    {
      epId: ep1,
      dub: 'jp',
      sub: 'en',
      fileName: 'seed_ep1_jp_en.mp4',
      width: 2560,
      height: 1440,
      qualities: ['2k', '1080p', '720p', '480p'],
      freq: 220,
    },
    {
      epId: ep1,
      dub: 'en',
      sub: 'none',
      fileName: 'seed_ep1_en_none.mp4',
      width: 1920,
      height: 1080,
      qualities: ['1080p', '720p', '480p'],
      freq: 294,
    },
    {
      epId: ep2,
      dub: 'jp',
      sub: 'pl',
      fileName: 'seed_ep2_jp_pl.mp4',
      width: 1920,
      height: 1080,
      qualities: ['1080p', '720p', '480p'],
      freq: 262,
    },
    {
      epId: ep3,
      dub: 'jp',
      sub: 'pl',
      fileName: 'seed_ep3_jp_pl.mp4',
      width: 2560,
      height: 1440,
      qualities: ['2k', '1080p', '720p', '480p'],
      freq: 330,
    },
    {
      epId: ep4,
      dub: 'jp',
      sub: 'pl',
      fileName: 'seed_ep4_jp_pl.mp4',
      width: 1920,
      height: 1080,
      qualities: ['1080p', '720p', '480p'],
      freq: 196,
    },
  ];

  const insertVariant = db.prepare(
    `INSERT INTO episode_variants (
       episode_id, audio_dub, subtitle_mode, file_path, file_size_bytes,
       source_width, source_height, duration_seconds, available_qualities_json,
       transcoded_paths_json, transcode_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const createdVariants: Array<{
    variantId: number;
    def: (typeof seedVariantDefs)[number];
  }> = [];

  for (const def of seedVariantDefs) {
    const topTier = def.qualities[0];
    const vRes = insertVariant.run(
      def.epId,
      def.dub,
      def.sub,
      def.fileName,
      0,
      def.width,
      def.height,
      16,
      JSON.stringify(def.qualities),
      JSON.stringify({ [topTier]: def.fileName }),
      'processing'
    );
    createdVariants.push({ variantId: Number(vRes.lastInsertRowid), def });
  }

  void (async () => {
    for (const item of createdVariants) {
      const ok = await generateDemoClip(
        item.def.fileName,
        item.def.width,
        item.def.height,
        16,
        item.def.freq
      );
      if (ok) {
        const fullPath = path.join(VIDEOS_DIR, item.def.fileName);
        const size = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
        db.prepare(
          'UPDATE episode_variants SET file_size_bytes = ? WHERE id = ?'
        ).run(size, item.variantId);

        enqueueVariantTranscodes({
          variantId: item.variantId,
          sourceFileName: item.def.fileName,
          availableQualities: item.def.qualities,
          onProgress: (vid, paths, status) => {
            db.prepare(
              'UPDATE episode_variants SET transcoded_paths_json = ?, transcode_status = ? WHERE id = ?'
            ).run(JSON.stringify(paths), status, vid);
          },
        });
      }
    }
  })();
}
