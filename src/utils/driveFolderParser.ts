import { buildLuxSourceDriveUrl } from './playerLogic.ts';

const GDRIVE_ID_RE = /^[a-zA-Z0-9_-]{10,120}$/;

const NON_VIDEO_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.txt',
  '.md',
  '.nfo',
  '.json',
  '.xml',
  '.srt',
  '.ass',
  '.ssa',
  '.vtt',
  '.sub',
  '.idx',
  '.pdf',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.mp3',
  '.flac',
  '.aac',
  '.wav',
  '.ogg',
]);

const VIDEO_EXTENSION_RE = /\.(mp4|mkv|webm|mov|avi|m4v|ts|flv|wmv)$/i;

export interface ParsedFolderEpisode {
  fileId: string;
  filename: string;
  episodeNumber: number;
  title: string;
  luxSourceUrl: string;
}

export function extractGoogleDriveFolderId(input: string): string | null {
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
    if (host !== 'drive.google.com' && !host.endsWith('.drive.google.com')) {
      return null;
    }

    // Reject explicit file links so users don't confuse file vs folder
    if (/\/file\/(?:u\/\d+\/)?d\//.test(url.pathname)) {
      return null;
    }

    const folderMatch = /\/folders\/([a-zA-Z0-9_-]{10,120})/.exec(url.pathname);
    if (folderMatch?.[1]) {
      return folderMatch[1];
    }

    if (
      url.pathname.includes('embeddedfolderview') ||
      url.pathname.includes('folderview')
    ) {
      const idParam = url.searchParams.get('id');
      if (idParam && GDRIVE_ID_RE.test(idParam)) {
        return idParam;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function decodeHtmlAndEscapes(raw: string): string {
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, num: string) => {
      const code = Number(num);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

export function parseEpisodeFilename(
  filename: string
): { episodeNumber: number; title: string } | null {
  const cleanName = decodeHtmlAndEscapes(filename).trim();
  if (!cleanName) return null;

  const dotIdx = cleanName.lastIndexOf('.');
  if (dotIdx > 0) {
    const ext = cleanName.slice(dotIdx).toLowerCase();
    if (NON_VIDEO_EXTENSIONS.has(ext)) {
      return null;
    }
  }

  const withoutExt = cleanName.replace(VIDEO_EXTENSION_RE, '').trim();
  if (!withoutExt) return null;

  // Primary format requested by user: "1. [tytuł]", "2. [tytuł]"
  const dotMatch = /^\s*(\d{1,4})\s*\.\s*(.+)$/.exec(withoutExt);
  if (dotMatch) {
    const episodeNumber = Number(dotMatch[1]);
    const title = dotMatch[2].trim();
    if (
      Number.isInteger(episodeNumber) &&
      episodeNumber >= 1 &&
      episodeNumber <= 2000 &&
      title.length > 0
    ) {
      return { episodeNumber, title };
    }
  }

  return null;
}

export function parseGoogleDriveFolderHtml(
  html: string
): ParsedFolderEpisode[] {
  if (!html || typeof html !== 'string') return [];

  const byFileId = new Map<string, ParsedFolderEpisode>();

  const register = (fileId: string, rawFilename: string) => {
    if (!GDRIVE_ID_RE.test(fileId)) return;
    if (byFileId.has(fileId)) return;
    const filename = decodeHtmlAndEscapes(rawFilename)
      .replace(/<[^>]+>/g, '')
      .trim();
    const parsed = parseEpisodeFilename(filename);
    if (!parsed) return;

    byFileId.set(fileId, {
      fileId,
      filename,
      episodeNumber: parsed.episodeNumber,
      title: parsed.title,
      luxSourceUrl: buildLuxSourceDriveUrl(fileId),
    });
  };

  // Strategy 1: Google Drive embeddedfolderview DOM entries
  // e.g. <div class="flip-entry" id="entry-FILE_ID"> ... <div class="flip-entry-title">1. Tytul.mp4</div>
  const entrySplitRe = /id="entry-([a-zA-Z0-9_-]{10,120})"/g;
  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entrySplitRe.exec(html)) !== null) {
    const fileId = entryMatch[1];
    const windowSlice = html.slice(
      entryMatch.index,
      Math.min(html.length, entryMatch.index + 2400)
    );
    const titleMatch =
      /class="[^"]*flip-entry-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
        windowSlice
      );
    if (titleMatch?.[1]) {
      register(fileId, titleMatch[1]);
    }
  }

  // Strategy 2: Anchors linking directly to /file/d/<ID>/ followed by flip-entry-title
  const anchorMatchRe =
    /href="https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,120})\/[^"]*"[\s\S]{0,1200}?class="[^"]*flip-entry-title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = anchorMatchRe.exec(html)) !== null) {
    register(anchorMatch[1], anchorMatch[2]);
  }

  // Strategy 3: Google Drive folder page embedded JSON/JS payloads (e.g. AF_initDataCallback / _DRIVE_ivd)
  // Matches ["FILE_ID", ["PARENT_ID"], "FILENAME", ...] or ["FILE_ID", null, "FILENAME", ...]
  const normalizedScript = html
    .replace(/\\x22/g, '"')
    .replace(/\\x5b/gi, '[')
    .replace(/\\x5d/gi, ']')
    .replace(/\\u0022/gi, '"');

  const jsonEntryRe =
    /\["([a-zA-Z0-9_-]{20,120})",(?:\[[^\]]*\]|null),"([^"\\]{1,220}(?:\\.[^"\\]{0,220})*)"/g;
  let jsonMatch: RegExpExecArray | null;
  while ((jsonMatch = jsonEntryRe.exec(normalizedScript)) !== null) {
    const candidateName = jsonMatch[2];
    if (/^\s*\d{1,4}\s*\./.test(decodeHtmlAndEscapes(candidateName))) {
      register(jsonMatch[1], candidateName);
    }
  }

  // Deduplicate by episodeNumber (first found wins) and sort numerically ascending
  const byEpNum = new Map<number, ParsedFolderEpisode>();
  for (const item of byFileId.values()) {
    if (!byEpNum.has(item.episodeNumber)) {
      byEpNum.set(item.episodeNumber, item);
    }
  }

  return Array.from(byEpNum.values()).sort(
    (a, b) => a.episodeNumber - b.episodeNumber
  );
}
