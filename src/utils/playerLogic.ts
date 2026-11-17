import type {
  AudioDub,
  EpisodeVariant,
  PreferredQuality,
  QualityTier,
  SubtitleMode,
  UserPreferences,
} from '../types.ts';

export const QUALITY_ORDER: QualityTier[] = ['2k', '1080p', '720p', '480p'];

export const DUB_LABELS: Record<AudioDub, string> = {
  jp: 'Japoński dubbing',
  en: 'Angielski dubbing',
};

export const SUB_LABELS: Record<SubtitleMode, string> = {
  pl: 'Polskie napisy',
  en: 'Angielskie napisy',
  none: 'Bez napisów',
};

export const QUALITY_LABELS: Record<QualityTier, string> = {
  '2k': '2K (1440p)',
  '1080p': '1080p Full HD',
  '720p': '720p HD',
  '480p': '480p SD',
};

export function getAllowedQualitiesFromHeight(sourceHeight: number): QualityTier[] {
  if (sourceHeight >= 1440) {
    return ['2k', '1080p', '720p', '480p'];
  }
  if (sourceHeight >= 1080) {
    return ['1080p', '720p', '480p'];
  }
  if (sourceHeight >= 720) {
    return ['720p', '480p'];
  }
  return ['480p'];
}

export interface VariantSelectionResult {
  variant: EpisodeVariant | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
}

export function selectBestVariant(
  variants: EpisodeVariant[],
  preferences: Pick<UserPreferences, 'preferredDub' | 'preferredSub'>
): VariantSelectionResult {
  if (!variants || variants.length === 0) {
    return {
      variant: null,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  const exact = variants.find(
    (v) =>
      v.audioDub === preferences.preferredDub &&
      v.subtitleMode === preferences.preferredSub
  );

  if (exact) {
    return {
      variant: exact,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  // Priority 1: same dubbing, preferred subtitle fallback order
  const sameDub = variants.find((v) => v.audioDub === preferences.preferredDub);
  // Priority 2: same subtitles
  const sameSub = variants.find(
    (v) => v.subtitleMode === preferences.preferredSub
  );
  const chosen = sameDub || sameSub || variants[0];

  const requestedDesc = `${DUB_LABELS[preferences.preferredDub]}, ${SUB_LABELS[preferences.preferredSub]}`;
  const chosenDesc = `${DUB_LABELS[chosen.audioDub]}, ${SUB_LABELS[chosen.subtitleMode]}`;

  return {
    variant: chosen,
    fallbackUsed: true,
    fallbackReason: `Ten odcinek nie posiada wersji zgodnie z Twoimi preferencjami (${requestedDesc}). Automatycznie wybrano dostępną wersję: ${chosenDesc}.`,
  };
}

export function resolveBestQuality(
  availableQualities: QualityTier[],
  preferredQuality: PreferredQuality
): { quality: QualityTier; note: string | null } {
  const ordered = QUALITY_ORDER.filter((q) => availableQualities.includes(q));
  if (ordered.length === 0) {
    return { quality: '480p', note: null };
  }

  if (preferredQuality === 'max') {
    return { quality: ordered[0], note: null };
  }

  if (ordered.includes(preferredQuality)) {
    return { quality: preferredQuality, note: null };
  }

  // Pick highest available if requested quality exceeds source resolution
  const chosen = ordered[0];
  return {
    quality: chosen,
    note: `Plik źródłowy nie obsługuje jakości ${QUALITY_LABELS[preferredQuality]}. Wybrano najwyższą dostępną: ${QUALITY_LABELS[chosen]}.`,
  };
}

export function getSkipOverlayState(
  currentTime: number,
  introStart: number | null,
  introEnd: number | null,
  outroStart: number | null,
  outroEnd: number | null,
  hasNextEpisode: boolean
): { showSkipIntro: boolean; showSkipToNext: boolean } {
  const showSkipIntro =
    introStart !== null &&
    introEnd !== null &&
    introEnd > introStart &&
    currentTime >= introStart &&
    currentTime < introEnd - 0.25;

  const showSkipToNext =
    hasNextEpisode &&
    outroStart !== null &&
    outroEnd !== null &&
    outroEnd > outroStart &&
    currentTime >= outroStart &&
    currentTime <= outroEnd + 5;

  return { showSkipIntro, showSkipToNext };
}

export function calculateTotalWatchSeconds(
  episodes: Array<{ id: number; durationSeconds: number }>,
  watchedEpisodeIds: Iterable<number>
): number {
  const watchedSet = new Set(watchedEpisodeIds);
  let total = 0;
  for (const ep of episodes) {
    if (watchedSet.has(ep.id) && ep.durationSeconds > 0) {
      total += Math.floor(ep.durationSeconds);
    }
  }
  return total;
}

export function formatTimecode(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function parseTimecodeToSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const parts = trimmed.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (secs >= 60) return null;
    return mins * 60 + secs;
  }
  if (
    parts.length === 3 &&
    /^\d+$/.test(parts[0]) &&
    /^\d+$/.test(parts[1]) &&
    /^\d+$/.test(parts[2])
  ) {
    const hrs = Number(parts[0]);
    const mins = Number(parts[1]);
    const secs = Number(parts[2]);
    if (mins >= 60 || secs >= 60) return null;
    return hrs * 3600 + mins * 60 + secs;
  }
  return null;
}

export function formatDurationHuman(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0 min';
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hours > 0) {
    return `${hours} godz. ${minutes} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${secs > 0 ? `${secs} s` : ''}`.trim();
  }
  return `${secs} s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx >= 2 ? 2 : 0)} ${units[idx]}`;
}

export interface ParsedExternalSource {
  valid: boolean;
  provider: 'gdrive_preview' | 'gdrive_direct' | 'direct';
  normalizedUrl: string;
  gdriveFileId: string | null;
  error?: string;
}

const GDRIVE_ID_RE = /^[a-zA-Z0-9_-]{10,120}$/;
export const LUXSOURCE_WORKER_BASE = 'https://luxsource.luxdroit.workers.dev/';

export function extractGoogleDriveFileId(input: string): string | null {
  const trimmed = input.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return null;

  if (GDRIVE_ID_RE.test(trimmed) && !trimmed.includes('.')) {
    return trimmed;
  }

  const candidateUrl =
    /^https?:\/\//i.test(trimmed) || !trimmed.includes('.')
      ? trimmed
      : `https://${trimmed}`;

  try {
    const url = new URL(candidateUrl);
    const host = url.hostname.toLowerCase();
    if (host === 'luxsource.luxdroit.workers.dev') {
      const idParam = url.searchParams.get('id');
      if (idParam && GDRIVE_ID_RE.test(idParam)) return idParam;
    }
    if (
      host === 'drive.google.com' ||
      host === 'docs.google.com' ||
      host === 'drive.usercontent.google.com' ||
      host.endsWith('.drive.google.com')
    ) {
      // /file/d/<ID>/view, /file/u/0/d/<ID>/view, or /preview
      const fileMatch = /\/d\/([a-zA-Z0-9_-]{10,120})/.exec(url.pathname);
      if (fileMatch?.[1]) return fileMatch[1];

      // ?id=<ID>
      const idParam = url.searchParams.get('id');
      if (idParam && GDRIVE_ID_RE.test(idParam)) return idParam;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildLuxSourceDriveUrl(fileId: string): string {
  return `${LUXSOURCE_WORKER_BASE}?id=${encodeURIComponent(fileId)}`;
}

export const CONTINUE_WATCHING_LIMIT = 5;

export function limitContinueWatching<T>(
  items: readonly T[],
  maxItems = CONTINUE_WATCHING_LIMIT
): T[] {
  if (!Array.isArray(items) || maxItems <= 0) return [];
  return items.slice(0, maxItems);
}

export function parseExternalVideoSource(
  rawUrl: string,
  gdriveMode: 'gdrive_worker' | 'preview' | 'direct' = 'preview'
): ParsedExternalSource {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      provider: 'direct',
      normalizedUrl: '',
      gdriveFileId: null,
      error: 'Podaj link do źródła wideo lub ID pliku Google Drive.',
    };
  }

  const gdriveId = extractGoogleDriveFileId(trimmed);
  if (gdriveMode === 'gdrive_worker') {
    if (!gdriveId) {
      return {
        valid: false,
        provider: 'direct',
        normalizedUrl: '',
        gdriveFileId: null,
        error:
          'Nie rozpoznano ID pliku Google Drive. Wklej link w formacie https://drive.google.com/file/d/[ID]/view?usp=sharing lub samo ID.',
      };
    }
    return {
      valid: true,
      provider: 'gdrive_direct',
      normalizedUrl: buildLuxSourceDriveUrl(gdriveId),
      gdriveFileId: gdriveId,
    };
  }

  if (gdriveId) {
    if (gdriveMode === 'direct') {
      return {
        valid: true,
        provider: 'gdrive_direct',
        normalizedUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(gdriveId)}`,
        gdriveFileId: gdriveId,
      };
    }
    return {
      valid: true,
      provider: 'gdrive_preview',
      normalizedUrl: `https://drive.google.com/file/d/${encodeURIComponent(gdriveId)}/preview`,
      gdriveFileId: gdriveId,
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        valid: false,
        provider: 'direct',
        normalizedUrl: '',
        gdriveFileId: null,
        error: 'Dozwolone są wyłącznie adresy http:// lub https://.',
      };
    }
    return {
      valid: true,
      provider: 'direct',
      normalizedUrl: parsed.toString(),
      gdriveFileId: null,
    };
  } catch {
    return {
      valid: false,
      provider: 'direct',
      normalizedUrl: '',
      gdriveFileId: null,
      error: 'Nieprawidłowy adres URL lub ID pliku Google Drive.',
    };
  }
}

export function clampSeekTime(
  targetSeconds: number,
  durationSeconds: number
): number {
  if (!Number.isFinite(targetSeconds)) return 0;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return Math.max(0, targetSeconds);
  }
  return Math.max(0, Math.min(durationSeconds, targetSeconds));
}

export interface TimelineMarkerRange {
  leftPct: number;
  widthPct: number;
}

export function computeTimelineMarkers(
  duration: number,
  introStart: number | null,
  introEnd: number | null,
  outroStart: number | null,
  outroEnd: number | null
): { intro: TimelineMarkerRange | null; outro: TimelineMarkerRange | null } {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { intro: null, outro: null };
  }

  const calcRange = (
    start: number | null,
    end: number | null
  ): TimelineMarkerRange | null => {
    if (start === null || end === null || end <= start) return null;
    const clampedStart = Math.max(0, Math.min(duration, start));
    const clampedEnd = Math.max(clampedStart, Math.min(duration, end));
    const width = clampedEnd - clampedStart;
    if (width <= 0) return null;
    return {
      leftPct: (clampedStart / duration) * 100,
      widthPct: (width / duration) * 100,
    };
  };

  return {
    intro: calcRange(introStart, introEnd),
    outro: calcRange(outroStart, outroEnd),
  };
}

export function shouldIgnorePlayerShortcut(
  tagName: string | undefined | null,
  isContentEditable = false
): boolean {
  if (isContentEditable) return true;
  if (!tagName) return false;
  const upper = tagName.toUpperCase();
  return upper === 'INPUT' || upper === 'TEXTAREA' || upper === 'SELECT';
}

export function resolveStageTapZone(
  relativeX: number
): 'left' | 'center' | 'right' {
  if (!Number.isFinite(relativeX)) return 'center';
  if (relativeX < 0.33) return 'left';
  if (relativeX > 0.67) return 'right';
  return 'center';
}

export function resolveMaxEpisodeDuration(
  durations: ReadonlyArray<number | null | undefined>
): number {
  let maxSeconds = 0;
  for (const val of durations) {
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      const rounded = Math.round(val);
      if (rounded > maxSeconds) {
        maxSeconds = rounded;
      }
    }
  }
  return maxSeconds;
}




