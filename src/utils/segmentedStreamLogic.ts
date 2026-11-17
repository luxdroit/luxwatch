export const PROBE_CHUNK_BYTES = 256 * 1024; // 256 KB
export const SEGMENT_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB
export const PARALLEL_CHUNK_CONCURRENCY = 3;
export const TARGET_BUFFER_AHEAD_SECONDS = 40;
export const RESUME_BUFFER_AHEAD_SECONDS = 22;
export const EVICT_BEHIND_SECONDS = 60;
export const MAX_LRU_CHUNKS = 24; // 48 MB cap

export interface ByteChunkSpec {
  index: number;
  start: number;
  end: number;
}

export interface ParsedContentRange {
  start: number;
  end: number;
  total: number;
}

export interface BufferedRange {
  start: number;
  end: number;
}

export function parseContentRangeHeader(
  header: string | null | undefined
): ParsedContentRange | null {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    return null;
  }
  return { start, end, total };
}

export function isMp4FtypHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return tag === 'ftyp' || tag === 'styp';
}

export function isHlsStreamUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed, 'http://localhost');
    return parsed.pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return /\.m3u8(\?.*)?$/i.test(trimmed);
  }
}

export function alignChunkIndex(
  byteOffset: number,
  chunkSize = SEGMENT_CHUNK_BYTES
): number {
  if (!Number.isFinite(byteOffset) || byteOffset <= 0) return 0;
  return Math.floor(byteOffset / chunkSize);
}

export function getAlignedChunkBounds(
  chunkIndex: number,
  totalSize: number,
  chunkSize = SEGMENT_CHUNK_BYTES
): ByteChunkSpec | null {
  if (!Number.isFinite(totalSize) || totalSize <= 0 || chunkIndex < 0) {
    return null;
  }
  const start = chunkIndex * chunkSize;
  if (start >= totalSize) return null;
  const end = Math.min(start + chunkSize - 1, totalSize - 1);
  return { index: chunkIndex, start, end };
}

export function planAlignedByteChunks(
  startOffset: number,
  totalSize: number,
  chunkSize = SEGMENT_CHUNK_BYTES,
  maxChunks = PARALLEL_CHUNK_CONCURRENCY
): ByteChunkSpec[] {
  if (
    !Number.isFinite(startOffset) ||
    !Number.isFinite(totalSize) ||
    totalSize <= 0 ||
    startOffset >= totalSize ||
    maxChunks <= 0
  ) {
    return [];
  }

  const firstIdx = alignChunkIndex(startOffset, chunkSize);
  const result: ByteChunkSpec[] = [];
  for (let i = 0; i < maxChunks; i++) {
    const bounds = getAlignedChunkBounds(firstIdx + i, totalSize, chunkSize);
    if (!bounds) break;
    result.push(bounds);
  }
  return result;
}

export function extractTimeRanges(timeRanges: {
  length: number;
  start(index: number): number;
  end(index: number): number;
}): BufferedRange[] {
  const out: BufferedRange[] = [];
  for (let i = 0; i < timeRanges.length; i++) {
    out.push({ start: timeRanges.start(i), end: timeRanges.end(i) });
  }
  return out;
}

export function isTimeWithinBufferedRanges(
  ranges: readonly BufferedRange[],
  time: number,
  tolerance = 0.25
): boolean {
  if (!Number.isFinite(time) || time < 0) return false;
  return ranges.some(
    (r) => time >= r.start - tolerance && time <= r.end + tolerance * 0.2
  );
}

export function computeAheadBufferedSeconds(
  ranges: readonly BufferedRange[],
  currentTime: number
): number {
  if (!Number.isFinite(currentTime) || currentTime < 0) return 0;
  for (const r of ranges) {
    if (currentTime >= r.start - 0.5 && currentTime <= r.end + 0.1) {
      return Math.max(0, r.end - currentTime);
    }
  }
  return 0;
}

export function computeEvictionRange(
  ranges: readonly BufferedRange[],
  currentTime: number,
  keepBehindSeconds = EVICT_BEHIND_SECONDS
): { start: number; end: number } | null {
  if (!ranges.length || !Number.isFinite(currentTime)) return null;
  const safeCutoff = Math.floor(currentTime - keepBehindSeconds);
  if (safeCutoff <= 5) return null;
  const earliestStart = ranges[0].start;
  if (earliestStart < safeCutoff - 5) {
    return { start: 0, end: safeCutoff };
  }
  return null;
}

export function buildMseTrackMimeType(
  codec: string,
  type: 'video' | 'audio'
): string {
  const cleanCodec = codec.trim();
  return `${type}/mp4; codecs="${cleanCodec}"`;
}

export function shouldTriggerStallRecovery(params: {
  isPlaying: boolean;
  readyState: number;
  stalledMs: number;
  retryCount: number;
  maxRetries: number;
}): boolean {
  if (!params.isPlaying) return false;
  if (params.readyState >= 3) return false;
  if (params.retryCount >= params.maxRetries) return false;
  return params.stalledMs >= 10_000;
}
