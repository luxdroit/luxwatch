import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { TRANSCODES_DIR, VIDEOS_DIR } from './config.ts';
import { resolveSafeStoragePath } from './security.ts';
import { getAllowedQualitiesFromHeight } from '../src/utils/playerLogic.ts';
import type { QualityTier } from '../src/types.ts';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  width: number;
  height: number;
  durationSeconds: number;
  availableQualities: QualityTier[];
}

export async function probeVideoFile(filePath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 15000 }
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const width = Number(stream?.width) || 1920;
    const height = Number(stream?.height) || 1080;
    const durationSeconds = Math.max(
      1,
      Math.round(Number(parsed.format?.duration) || 0)
    );
    return {
      width,
      height,
      durationSeconds,
      availableQualities: getAllowedQualitiesFromHeight(height),
    };
  } catch {
    return {
      width: 1920,
      height: 1080,
      durationSeconds: 1440,
      availableQualities: ['1080p', '720p', '480p'],
    };
  }
}

const QUALITY_HEIGHTS: Record<QualityTier, number> = {
  '2k': 1440,
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
};

interface TranscodeJob {
  variantId: number;
  sourceFileName: string;
  availableQualities: QualityTier[];
  onProgress: (
    variantId: number,
    paths: Partial<Record<QualityTier, string>>,
    status: 'ready' | 'processing' | 'failed'
  ) => void;
}

const transcodeQueue: TranscodeJob[] = [];
let isProcessingQueue = false;

export function enqueueVariantTranscodes(job: TranscodeJob): void {
  transcodeQueue.push(job);
  if (!isProcessingQueue) {
    void processTranscodeQueue();
  }
}

async function isMp4FastStart(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const stat = await fd.stat();
      const fileSize = stat.size;
      const headerBuf = Buffer.alloc(16);
      let offset = 0;

      while (offset + 8 <= fileSize) {
        const { bytesRead } = await fd.read(headerBuf, 0, 16, offset);
        if (bytesRead < 8) break;

        let boxSize = headerBuf.readUInt32BE(0);
        const boxType = headerBuf.subarray(4, 8).toString('ascii');

        if (boxType === 'moov') return true;
        if (boxType === 'mdat') return false;

        if (boxSize === 1) {
          if (bytesRead < 16) break;
          const bigSize = headerBuf.readBigUInt64BE(8);
          if (bigSize < 16n) break;
          offset += Number(bigSize);
        } else if (boxSize === 0) {
          break;
        } else if (boxSize < 8) {
          break;
        } else {
          offset += boxSize;
        }
      }
    } finally {
      await fd.close();
    }
  } catch {
    return true;
  }
  return true;
}

async function ensureMp4FastStart(filePath: string): Promise<void> {
  if (path.extname(filePath).toLowerCase() !== '.mp4') return;
  const alreadyFastStart = await isMp4FastStart(filePath);
  if (alreadyFastStart) return;

  const tmpPath = `${filePath}.faststart.mp4`;
  try {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', filePath, '-c', 'copy', '-movflags', '+faststart', tmpPath],
      { timeout: 10 * 60 * 1000 }
    );
    const stat = fs.statSync(tmpPath);
    if (stat.size > 0) {
      fs.renameSync(tmpPath, filePath);
    } else if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  } catch {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup error
      }
    }
  }
}

async function processTranscodeQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (transcodeQueue.length > 0) {
    const job = transcodeQueue.shift();
    if (!job) continue;

    const sourcePath = resolveSafeStoragePath(VIDEOS_DIR, job.sourceFileName);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      job.onProgress(job.variantId, {}, 'failed');
      continue;
    }

    // Lossless +faststart moov relocation for native MP4 files so playback starts immediately
    await ensureMp4FastStart(sourcePath);

    const nativeQuality = job.availableQualities[0] || '480p';
    const paths: Partial<Record<QualityTier, string>> = {
      [nativeQuality]: job.sourceFileName,
    };

    const lowerQualities = job.availableQualities.slice(1);
    if (lowerQualities.length === 0) {
      job.onProgress(job.variantId, paths, 'ready');
      continue;
    }

    job.onProgress(job.variantId, paths, 'processing');

    try {
      for (const tier of lowerQualities) {
        const targetHeight = QUALITY_HEIGHTS[tier];
        const outName = `v${job.variantId}_${tier}.mp4`;
        const outPath = resolveSafeStoragePath(TRANSCODES_DIR, outName);
        if (!outPath) continue;

        if (!fs.existsSync(outPath)) {
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-i',
              sourcePath,
              '-vf',
              `scale=-2:${targetHeight}`,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '23',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-movflags',
              '+faststart',
              outPath,
            ],
            { timeout: 30 * 60 * 1000 }
          );
        }
        paths[tier] = outName;
        job.onProgress(job.variantId, paths, 'processing');
      }
      job.onProgress(job.variantId, paths, 'ready');
    } catch {
      job.onProgress(job.variantId, paths, 'ready');
    }
  }

  isProcessingQueue = false;
}

export async function generateDemoClip(
  outFileName: string,
  width: number,
  height: number,
  durationSeconds: number,
  audioFreq: number
): Promise<boolean> {
  const outPath = resolveSafeStoragePath(VIDEOS_DIR, outFileName);
  if (!outPath) return false;
  if (fs.existsSync(outPath)) return true;

  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${width}x${height}:rate=24:duration=${durationSeconds}`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${audioFreq}:duration=${durationSeconds}`,
        '-filter_complex',
        '[0:v]eq=brightness=-0.12:saturation=0.75[v];[1:a]volume=0.04[a]',
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        '+faststart',
        outPath,
      ],
      { timeout: 30000 }
    );
    return true;
  } catch {
    return false;
  }
}

function getVideoContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'video/mp4';
}

const DEFAULT_OPEN_RANGE_CHUNK_BYTES = 8 * 1024 * 1024;
const STREAM_READ_HIGH_WATER_MARK = 256 * 1024;

export function streamVideoWithRange(
  req: Request,
  res: Response,
  filePath: string
): void {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Plik wideo nie został znaleziony.' });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getVideoContentType(filePath);
  const etag = `W/"${fileSize}-${Math.floor(stat.mtimeMs)}"`;
  const cacheControl = 'private, max-age=3600';
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    let start = match[1] ? Number(match[1]) : 0;
    let end: number;
    if (!match[1] && match[2]) {
      // Suffix byte range: bytes=-N
      const suffixLen = Number(match[2]);
      start = Math.max(0, fileSize - suffixLen);
      end = fileSize - 1;
    } else {
      end = match[2]
        ? Math.min(Number(match[2]), fileSize - 1)
        : Math.min(start + DEFAULT_OPEN_RANGE_CHUNK_BYTES - 1, fileSize - 1);
    }

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start >= fileSize ||
      end < start
    ) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      ETag: etag,
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath, {
      start,
      end,
      highWaterMark: STREAM_READ_HIGH_WATER_MARK,
    });
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.end();
      }
    });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    ETag: etag,
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath, {
    highWaterMark: STREAM_READ_HIGH_WATER_MARK,
  });
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}
