import type * as MP4BoxTypes from 'mp4box';
import {
  alignChunkIndex,
  buildMseTrackMimeType,
  computeAheadBufferedSeconds,
  computeEvictionRange,
  extractTimeRanges,
  getAlignedChunkBounds,
  isHlsStreamUrl,
  isMp4FtypHeader,
  isTimeWithinBufferedRanges,
  MAX_LRU_CHUNKS,
  PARALLEL_CHUNK_CONCURRENCY,
  parseContentRangeHeader,
  planAlignedByteChunks,
  PROBE_CHUNK_BYTES,
  SEGMENT_CHUNK_BYTES,
  shouldTriggerStallRecovery,
  TARGET_BUFFER_AHEAD_SECONDS,
} from './segmentedStreamLogic';
import type { ByteChunkSpec } from './segmentedStreamLogic';

export type StreamEngineMode = 'segmented-mp4' | 'hls' | 'direct';

export interface StreamEngineCallbacks {
  onModeChange?: (mode: StreamEngineMode) => void;
  onBufferingChange?: (isBuffering: boolean) => void;
  onError?: (message: string | null) => void;
  onResumeRestore?: (seconds: number) => void;
}

export interface StreamEngineHandle {
  retry: () => void;
  destroy: () => void;
}

const CHUNK_TIMEOUT_MS = 15_000;
const CHUNK_MAX_RETRIES = 4;
const DIRECT_MAX_RETRIES = 3;

function getMediaSourceCtor(): typeof MediaSource | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    ManagedMediaSource?: typeof MediaSource;
    MediaSource?: typeof MediaSource;
  };
  return win.ManagedMediaSource || win.MediaSource || null;
}

function isSameOriginUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

async function fetchRangeBytes(
  url: string,
  start: number,
  end: number,
  parentSignal: AbortSignal,
  timeoutMs = CHUNK_TIMEOUT_MS
): Promise<{
  status: number;
  buffer: ArrayBuffer;
  contentRange: string | null;
}> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onParentAbort, { once: true });
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      credentials: isSameOriginUrl(url) ? 'include' : 'omit',
      headers: {
        Range: `bytes=${start}-${end}`,
      },
      signal: controller.signal,
    });

    if (resp.status !== 206) {
      // Abort stream immediately so servers ignoring Range don't dump GBs
      try {
        await resp.body?.cancel();
      } catch {
        // ignore cancel error
      }
      return {
        status: resp.status,
        buffer: new ArrayBuffer(0),
        contentRange: resp.headers.get('Content-Range'),
      };
    }

    const buffer = await resp.arrayBuffer();
    return {
      status: resp.status,
      buffer,
      contentRange: resp.headers.get('Content-Range'),
    };
  } finally {
    window.clearTimeout(timerId);
    parentSignal.removeEventListener('abort', onParentAbort);
  }
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

class SourceBufferQueue {
  private readonly sb: SourceBuffer;
  private readonly video: HTMLVideoElement;
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  private destroyed = false;

  constructor(sb: SourceBuffer, video: HTMLVideoElement) {
    this.sb = sb;
    this.video = video;
  }

  clearPending(): void {
    this.queue = [];
  }

  destroy(): void {
    this.destroyed = true;
    this.queue = [];
  }

  private waitForUpdateEnd(): Promise<void> {
    if (!this.sb.updating) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error('SourceBuffer update error'));
      };
      const cleanup = () => {
        this.sb.removeEventListener('updateend', onEnd);
        this.sb.removeEventListener('error', onErr);
      };
      this.sb.addEventListener('updateend', onEnd);
      this.sb.addEventListener('error', onErr);
    });
  }

  private async runQueue(): Promise<void> {
    if (this.running || this.destroyed) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.destroyed) {
        const task = this.queue.shift();
        if (!task) continue;
        await task();
      }
    } finally {
      this.running = false;
    }
  }

  enqueueAppend(data: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        resolve();
        return;
      }
      this.queue.push(async () => {
        if (this.destroyed) {
          resolve();
          return;
        }
        try {
          await this.waitForUpdateEnd();
          if (this.destroyed) {
            resolve();
            return;
          }
          try {
            this.sb.appendBuffer(data);
            await this.waitForUpdateEnd();
          } catch (err) {
            if (
              err instanceof DOMException &&
              err.name === 'QuotaExceededError'
            ) {
              // Evict buffered memory far from current playhead and retry once
              await this.evictSafeWindow();
              await this.waitForUpdateEnd();
              this.sb.appendBuffer(data);
              await this.waitForUpdateEnd();
            } else {
              throw err;
            }
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      void this.runQueue();
    });
  }

  enqueueRemove(start: number, end: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.destroyed || end <= start) {
        resolve();
        return;
      }
      this.queue.push(async () => {
        if (this.destroyed) {
          resolve();
          return;
        }
        try {
          await this.waitForUpdateEnd();
          if (this.sb.buffered.length > 0 && end > start) {
            this.sb.remove(start, end);
            await this.waitForUpdateEnd();
          }
        } catch {
          // ignore non-critical eviction failure
        }
        resolve();
      });
      void this.runQueue();
    });
  }

  private async evictSafeWindow(): Promise<void> {
    const now = this.video.currentTime || 0;
    try {
      await this.waitForUpdateEnd();
      if (now > 15) {
        this.sb.remove(0, Math.floor(now - 12));
        await this.waitForUpdateEnd();
      }
      if (
        this.sb.buffered.length > 0 &&
        this.sb.buffered.end(this.sb.buffered.length - 1) > now + 45
      ) {
        this.sb.remove(
          now + 45,
          this.sb.buffered.end(this.sb.buffered.length - 1) + 1
        );
        await this.waitForUpdateEnd();
      }
    } catch {
      // ignore
    }
  }

  async waitIdle(): Promise<void> {
    while ((this.running || this.sb.updating) && !this.destroyed) {
      await this.waitForUpdateEnd();
      await new Promise((r) => window.setTimeout(r, 10));
    }
  }
}

export function attachVideoStreamEngine(
  video: HTMLVideoElement,
  src: string,
  callbacks: StreamEngineCallbacks = {}
): StreamEngineHandle {
  let destroyed = false;
  let activeCleanup: (() => void) | null = null;

  const startAttempt = () => {
    if (destroyed) return;
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }
    callbacks.onError?.(null);

    if (!src.trim()) {
      video.removeAttribute('src');
      return;
    }

    if (isHlsStreamUrl(src)) {
      activeCleanup = attachHlsEngine(video, src, callbacks, () => destroyed);
      return;
    }

    const MSE = getMediaSourceCtor();
    if (MSE) {
      activeCleanup = attachSegmentedMp4Engine(
        video,
        src,
        MSE,
        callbacks,
        () => destroyed,
        () => {
          if (destroyed) return;
          activeCleanup = attachDirectWithRecovery(
            video,
            src,
            callbacks,
            () => destroyed
          );
        }
      );
      return;
    }

    activeCleanup = attachDirectWithRecovery(
      video,
      src,
      callbacks,
      () => destroyed
    );
  };

  startAttempt();

  return {
    retry: () => {
      startAttempt();
    },
    destroy: () => {
      destroyed = true;
      if (activeCleanup) {
        activeCleanup();
        activeCleanup = null;
      }
    },
  };
}

function attachHlsEngine(
  video: HTMLVideoElement,
  src: string,
  callbacks: StreamEngineCallbacks,
  isDestroyed: () => boolean
): () => void {
  let destroyedLocal = false;
  let fallbackCleanup: (() => void) | null = null;
  let hlsInstance: { destroy: () => void } | null = null;

  void (async () => {
    const { default: Hls } = await import('hls.js');
    if (destroyedLocal || isDestroyed()) return;

    if (!Hls.isSupported()) {
      fallbackCleanup = attachDirectWithRecovery(
        video,
        src,
        callbacks,
        isDestroyed
      );
      return;
    }

    callbacks.onModeChange?.('hls');
    const hls = new Hls({
      enableWorker: true,
      maxBufferLength: 40,
      maxMaxBufferLength: 75,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 700,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
    });
    hlsInstance = hls;

    let mediaRecoveryAttempts = 0;
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (destroyedLocal || isDestroyed() || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (
        data.type === Hls.ErrorTypes.MEDIA_ERROR &&
        mediaRecoveryAttempts < 2
      ) {
        mediaRecoveryAttempts++;
        hls.recoverMediaError();
      } else {
        callbacks.onError?.(
          'Nie udało się wczytać strumienia HLS. Sprawdź połączenie i spróbuj ponownie.'
        );
      }
    });

    hls.loadSource(src);
    hls.attachMedia(video);
  })();

  return () => {
    destroyedLocal = true;
    if (fallbackCleanup) {
      fallbackCleanup();
      fallbackCleanup = null;
    }
    if (hlsInstance) {
      try {
        hlsInstance.destroy();
      } catch {
        // ignore
      }
      hlsInstance = null;
    }
  };
}

function attachDirectWithRecovery(
  video: HTMLVideoElement,
  src: string,
  callbacks: StreamEngineCallbacks,
  isDestroyed: () => boolean
): () => void {
  callbacks.onModeChange?.('direct');

  let retryCount = 0;
  let stalledSince: number | null = null;
  let lastProgressTime = -1;
  let lastProgressBufferedEnd = -1;
  let pendingResumeSeconds: number | null = null;
  let intendedPlaying = true;
  let retryTimerId: number | null = null;

  const markActivity = () => {
    stalledSince = null;
    lastProgressTime = video.currentTime;
    if (video.buffered.length > 0) {
      lastProgressBufferedEnd = video.buffered.end(video.buffered.length - 1);
    }
  };

  const triggerRecover = () => {
    if (isDestroyed()) return;
    if (retryCount >= DIRECT_MAX_RETRIES) {
      callbacks.onBufferingChange?.(false);
      callbacks.onError?.(
        'Nie udało się wczytać wideo (zbyt wolne lub zerwane połączenie ze źródłem). Kliknij „Spróbuj ponownie”.'
      );
      return;
    }

    retryCount++;
    const savedTime =
      Number.isFinite(video.currentTime) && video.currentTime > 0.5
        ? video.currentTime
        : pendingResumeSeconds;
    pendingResumeSeconds = savedTime;
    stalledSince = null;
    callbacks.onBufferingChange?.(true);

    const delay = 500 * Math.pow(2, retryCount - 1);
    retryTimerId = window.setTimeout(() => {
      if (isDestroyed()) return;
      video.src = src;
      video.load();
      if (intendedPlaying) {
        void video.play().catch(() => {});
      }
    }, delay);
  };

  const onLoadedMetadata = () => {
    markActivity();
    if (pendingResumeSeconds !== null && pendingResumeSeconds > 0) {
      const target = Math.min(
        pendingResumeSeconds,
        Math.max(0, (video.duration || pendingResumeSeconds) - 0.5)
      );
      video.currentTime = target;
      callbacks.onResumeRestore?.(target);
      pendingResumeSeconds = null;
    }
  };

  const onPlay = () => {
    intendedPlaying = true;
    markActivity();
  };

  const onPause = () => {
    intendedPlaying = false;
    stalledSince = null;
  };

  const onPlayingOrCanPlay = () => {
    retryCount = 0;
    stalledSince = null;
    callbacks.onBufferingChange?.(false);
    callbacks.onError?.(null);
    markActivity();
  };

  const onWaitingOrStalled = () => {
    if (!stalledSince) {
      stalledSince = Date.now();
    }
  };

  const onError = () => {
    if (isDestroyed()) return;
    const code = video.error?.code;
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      callbacks.onBufferingChange?.(false);
      callbacks.onError?.(
        'Ten format wideo lub link zewnętrzny nie może zostać odtworzony w przeglądarce.'
      );
      return;
    }
    triggerRecover();
  };

  const watchdogId = window.setInterval(() => {
    if (isDestroyed()) return;
    const currentBufEnd =
      video.buffered.length > 0
        ? video.buffered.end(video.buffered.length - 1)
        : -1;

    if (
      video.currentTime !== lastProgressTime ||
      currentBufEnd > lastProgressBufferedEnd + 0.1
    ) {
      markActivity();
      return;
    }

    if (intendedPlaying && !video.paused && video.readyState < 3) {
      if (!stalledSince) {
        stalledSince = Date.now();
      } else if (
        shouldTriggerStallRecovery({
          isPlaying: intendedPlaying && !video.paused,
          readyState: video.readyState,
          stalledMs: Date.now() - stalledSince,
          retryCount,
          maxRetries: DIRECT_MAX_RETRIES,
        })
      ) {
        triggerRecover();
      }
    }
  }, 2000);

  video.preload = 'auto';
  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('playing', onPlayingOrCanPlay);
  video.addEventListener('canplay', onPlayingOrCanPlay);
  video.addEventListener('waiting', onWaitingOrStalled);
  video.addEventListener('stalled', onWaitingOrStalled);
  video.addEventListener('timeupdate', markActivity);
  video.addEventListener('progress', markActivity);
  video.addEventListener('error', onError);

  video.src = src;
  video.load();

  return () => {
    window.clearInterval(watchdogId);
    if (retryTimerId !== null) window.clearTimeout(retryTimerId);
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('playing', onPlayingOrCanPlay);
    video.removeEventListener('canplay', onPlayingOrCanPlay);
    video.removeEventListener('waiting', onWaitingOrStalled);
    video.removeEventListener('stalled', onWaitingOrStalled);
    video.removeEventListener('timeupdate', markActivity);
    video.removeEventListener('progress', markActivity);
    video.removeEventListener('error', onError);
  };
}

function attachSegmentedMp4Engine(
  video: HTMLVideoElement,
  src: string,
  MSECtor: typeof MediaSource,
  callbacks: StreamEngineCallbacks,
  isDestroyed: () => boolean,
  onFallbackToDirect: () => void
): () => void {
  const masterAbort = new AbortController();
  let streamAbort = new AbortController();
  let mediaSource: MediaSource | null = null;
  let objectUrl: string | null = null;
  let mp4File: MP4BoxTypes.ISOFile | null = null;
  let mp4BoxMod: typeof MP4BoxTypes | null = null;
  const sbQueues = new Map<number, SourceBufferQueue>();
  const chunkCache = new Map<number, ArrayBuffer>();

  let totalSize = 0;
  let generation = 0;
  let ignoreSegments = false;
  let nextFeedOffset = 0;
  let isPumping = false;
  let reachedEof = false;
  let lastEvictionAt = 0;
  let mseAttached = false;
  let pumpTimerId: number | null = null;

  const putCache = (chunkIndex: number, data: ArrayBuffer) => {
    if (chunkCache.has(chunkIndex)) {
      chunkCache.delete(chunkIndex);
    }
    chunkCache.set(chunkIndex, data);
    while (chunkCache.size > MAX_LRU_CHUNKS) {
      const oldestKey = chunkCache.keys().next().value;
      if (oldestKey === undefined) break;
      chunkCache.delete(oldestKey);
    }
  };

  const getOrFetchChunk = async (
    spec: ByteChunkSpec,
    signal: AbortSignal
  ): Promise<ArrayBuffer> => {
    const cached = chunkCache.get(spec.index);
    if (cached) {
      // Refresh LRU position
      chunkCache.delete(spec.index);
      chunkCache.set(spec.index, cached);
      return cached;
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= CHUNK_MAX_RETRIES; attempt++) {
      if (signal.aborted || isDestroyed()) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        const res = await fetchRangeBytes(
          src,
          spec.start,
          spec.end,
          signal,
          CHUNK_TIMEOUT_MS
        );
        if (res.status !== 206 || res.buffer.byteLength === 0) {
          throw new Error(`Unexpected range status ${res.status}`);
        }
        putCache(spec.index, res.buffer);
        return res.buffer;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (signal.aborted || isDestroyed()) throw err;
        }
        lastErr = err;
        if (attempt < CHUNK_MAX_RETRIES) {
          const backoff = 300 * Math.pow(2, attempt);
          await sleepWithAbort(backoff, signal);
        }
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error('Chunk download failed');
  };

  const cleanup = () => {
    masterAbort.abort();
    streamAbort.abort();
    if (pumpTimerId !== null) {
      window.clearInterval(pumpTimerId);
      pumpTimerId = null;
    }
    video.removeEventListener('seeking', onSeeking);
    video.removeEventListener('timeupdate', schedulePump);
    video.removeEventListener('waiting', onVideoWaiting);
    video.removeEventListener('error', onMseVideoError);
    for (const q of sbQueues.values()) {
      q.destroy();
    }
    sbQueues.clear();
    chunkCache.clear();
    if (mediaSource && mediaSource.readyState === 'open') {
      try {
        mediaSource.endOfStream();
      } catch {
        // ignore cleanup error
      }
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const onVideoWaiting = () => {
    if (!mseAttached) return;
    callbacks.onBufferingChange?.(true);
    schedulePump();
  };

  const onMseVideoError = () => {
    if (!mseAttached || isDestroyed()) return;
    cleanup();
    onFallbackToDirect();
  };

  const waitForQueuesIdle = async (gen: number) => {
    for (const q of sbQueues.values()) {
      if (isDestroyed() || gen !== generation) return;
      await q.waitIdle();
    }
  };

  const flushOldBuffersForSeek = async (gen: number) => {
    for (const q of sbQueues.values()) {
      q.clearPending();
    }
    await waitForQueuesIdle(gen);
    if (isDestroyed() || gen !== generation) return;
    const durationLimit =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration + 1
        : 100_000;
    await Promise.all(
      Array.from(sbQueues.values()).map((q) =>
        q.enqueueRemove(0, durationLimit)
      )
    );
  };

  const onSeeking = () => {
    if (!mseAttached || !mp4File || isDestroyed()) return;
    const target = video.currentTime;
    const ranges = extractTimeRanges(video.buffered);
    if (isTimeWithinBufferedRanges(ranges, target)) {
      schedulePump();
      return;
    }

    generation++;
    const seekGen = generation;
    ignoreSegments = true;
    streamAbort.abort();
    streamAbort = new AbortController();
    reachedEof = false;
    callbacks.onBufferingChange?.(true);

    void (async () => {
      await flushOldBuffersForSeek(seekGen);
      if (isDestroyed() || seekGen !== generation || !mp4File) return;
      const seekRes = mp4File.seek(target, true);
      nextFeedOffset = Math.max(0, seekRes.offset);
      ignoreSegments = false;
      isPumping = false;
      schedulePump();
    })();
  };

  const schedulePump = () => {
    if (!mseAttached || !mp4File || isPumping || isDestroyed()) return;
    void pumpLoop(generation);
  };

  const pumpLoop = async (gen: number) => {
    if (isPumping || isDestroyed() || gen !== generation || !mp4File) return;
    isPumping = true;

    try {
      while (!isDestroyed() && gen === generation && mp4File) {
        const ranges = extractTimeRanges(video.buffered);

        // Evict stale buffered segments far behind playhead
        const now = Date.now();
        if (now - lastEvictionAt > 8000) {
          const evict = computeEvictionRange(ranges, video.currentTime);
          if (evict) {
            lastEvictionAt = now;
            await Promise.all(
              Array.from(sbQueues.values()).map((q) =>
                q.enqueueRemove(evict.start, evict.end)
              )
            );
          }
        }

        if (reachedEof || nextFeedOffset >= totalSize) {
          reachedEof = true;
          mp4File.flush();
          await waitForQueuesIdle(gen);
          if (
            !isDestroyed() &&
            gen === generation &&
            mediaSource &&
            mediaSource.readyState === 'open'
          ) {
            try {
              mediaSource.endOfStream();
            } catch {
              // ignore
            }
          }
          break;
        }

        const ahead = computeAheadBufferedSeconds(ranges, video.currentTime);
        if (ahead >= TARGET_BUFFER_AHEAD_SECONDS) {
          break;
        }

        const specs = planAlignedByteChunks(
          nextFeedOffset,
          totalSize,
          SEGMENT_CHUNK_BYTES,
          PARALLEL_CHUNK_CONCURRENCY
        );
        if (specs.length === 0) {
          reachedEof = true;
          continue;
        }

        // Launch all chunk downloads in parallel, feed in byte order
        const fetchPromises = specs.map((spec) =>
          getOrFetchChunk(spec, streamAbort.signal).then((buf) => ({
            spec,
            buf,
          }))
        );

        for (const p of fetchPromises) {
          const { spec, buf } = await p;
          if (isDestroyed() || gen !== generation || !mp4File) return;
          if (spec.end + 1 <= nextFeedOffset) continue;

          const sliceStart = Math.max(0, nextFeedOffset - spec.start);
          if (sliceStart < buf.byteLength && mp4BoxMod) {
            const slice = buf.slice(sliceStart);
            const mp4Buf = mp4BoxMod.MP4BoxBuffer.fromArrayBuffer(
              slice,
              nextFeedOffset
            );
            mp4File.appendBuffer(mp4Buf);
            nextFeedOffset = spec.end + 1;
          }
        }

        await waitForQueuesIdle(gen);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (!isDestroyed() && gen === generation) {
        callbacks.onBufferingChange?.(false);
        callbacks.onError?.(
          'Połączenie podczas pobierania segmentów wideo zostało przerwane. Kliknij „Spróbuj ponownie”.'
        );
      }
    } finally {
      if (gen === generation) {
        isPumping = false;
      }
    }
  };

  void (async () => {
    try {
      // 1. Initial 256 KB probe to verify CORS + Range + MP4 header
      const probe = await fetchRangeBytes(
        src,
        0,
        PROBE_CHUNK_BYTES - 1,
        masterAbort.signal,
        10_000
      );
      if (isDestroyed() || masterAbort.signal.aborted) return;

      const parsedRange = parseContentRangeHeader(probe.contentRange);
      if (
        probe.status !== 206 ||
        !parsedRange ||
        probe.buffer.byteLength < 8 ||
        !isMp4FtypHeader(new Uint8Array(probe.buffer))
      ) {
        onFallbackToDirect();
        return;
      }

      totalSize = parsedRange.total;

      // 2. Lazy-load MP4Box and parse moov atom (jumps to end if moov trails mdat)
      const MP4Box = await import('mp4box');
      if (isDestroyed() || masterAbort.signal.aborted) return;
      mp4BoxMod = MP4Box;
      const parser = MP4Box.createFile(false);
      mp4File = parser;

      let movieInfo: MP4BoxTypes.Movie | null = null;
      let parseFailed = false;
      parser.onError = () => {
        parseFailed = true;
      };
      parser.onReady = (info) => {
        movieInfo = info;
      };

      let nextOffset = parser.appendBuffer(
        MP4Box.MP4BoxBuffer.fromArrayBuffer(probe.buffer, 0)
      );

      let moovSteps = 0;
      while (!movieInfo && !parseFailed && !isDestroyed()) {
        if (
          !Number.isFinite(nextOffset) ||
          nextOffset < 0 ||
          nextOffset >= totalSize ||
          moovSteps >= 32
        ) {
          break;
        }
        moovSteps++;

        const spec = getAlignedChunkBounds(
          alignChunkIndex(nextOffset, SEGMENT_CHUNK_BYTES),
          totalSize,
          SEGMENT_CHUNK_BYTES
        );
        if (!spec) break;

        const chunkBuf = await getOrFetchChunk(spec, masterAbort.signal);
        if (isDestroyed() || masterAbort.signal.aborted) return;

        const sliceStart = Math.max(0, nextOffset - spec.start);
        const slice = chunkBuf.slice(sliceStart);
        const advancedOffset = parser.appendBuffer(
          MP4Box.MP4BoxBuffer.fromArrayBuffer(slice, nextOffset)
        );
        if (advancedOffset === nextOffset) break;
        nextOffset = advancedOffset;
      }

      if (isDestroyed() || masterAbort.signal.aborted) return;

      const info = movieInfo as MP4BoxTypes.Movie | null;
      if (parseFailed || !info || info.videoTracks.length === 0) {
        onFallbackToDirect();
        return;
      }

      const videoTrack = info.videoTracks[0];
      const audioTrack = info.audioTracks[0] || null;
      const videoMime = buildMseTrackMimeType(videoTrack.codec, 'video');
      const audioMime = audioTrack
        ? buildMseTrackMimeType(audioTrack.codec, 'audio')
        : null;

      if (
        !MSECtor.isTypeSupported(videoMime) ||
        (audioMime && !MSECtor.isTypeSupported(audioMime))
      ) {
        onFallbackToDirect();
        return;
      }

      // 3. Attach MediaSource and build initialization segments
      const ms = new MSECtor();
      mediaSource = ms;
      if ('ManagedMediaSource' in window) {
        video.disableRemotePlayback = true;
      }

      objectUrl = URL.createObjectURL(ms);
      const sourceOpenPromise = new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          ms.removeEventListener('sourceopen', onOpen);
          resolve();
        };
        ms.addEventListener('sourceopen', onOpen, { once: true });
        window.setTimeout(
          () => reject(new Error('MediaSource open timeout')),
          8000
        );
      });

      video.src = objectUrl;
      await sourceOpenPromise;
      if (isDestroyed() || masterAbort.signal.aborted) return;

      if (info.duration > 0 && info.timescale > 0) {
        try {
          ms.duration = info.duration / info.timescale;
        } catch {
          // ignore duration assignment failure
        }
      }

      const videoSb = ms.addSourceBuffer(videoMime);
      sbQueues.set(videoTrack.id, new SourceBufferQueue(videoSb, video));
      parser.setSegmentOptions(videoTrack.id, 'video', {
        nbSamples: 60,
        rapAlignement: false,
      });

      if (audioTrack && audioMime) {
        const audioSb = ms.addSourceBuffer(audioMime);
        sbQueues.set(audioTrack.id, new SourceBufferQueue(audioSb, video));
        parser.setSegmentOptions(audioTrack.id, 'audio', {
          nbSamples: 60,
          rapAlignement: false,
        });
      }

      const initSegments = parser.initializeSegmentation('per-track');
      parser.onSegment = (id, _user, buffer, nextSample) => {
        if (isDestroyed() || ignoreSegments) return;
        const q = sbQueues.get(id);
        if (q) {
          void q.enqueueAppend(buffer).catch(() => {});
        }
        parser.releaseUsedSamples(id, nextSample);
      };

      await Promise.all(
        initSegments.map((seg) => {
          const q = sbQueues.get(seg.id);
          return q ? q.enqueueAppend(seg.buffer) : Promise.resolve();
        })
      );
      if (isDestroyed() || masterAbort.signal.aborted) return;

      callbacks.onModeChange?.('segmented-mp4');
      mseAttached = true;

      // Allow React's onLoadedMetadata handler to apply any saved resume position
      await new Promise((r) => window.setTimeout(r, 30));
      if (isDestroyed()) return;

      const startAt = Number.isFinite(video.currentTime)
        ? Math.max(0, video.currentTime)
        : 0;
      parser.start();
      const seekRes = parser.seek(startAt, true);
      nextFeedOffset = Math.max(0, seekRes.offset);

      video.addEventListener('seeking', onSeeking);
      video.addEventListener('timeupdate', schedulePump);
      video.addEventListener('waiting', onVideoWaiting);
      video.addEventListener('error', onMseVideoError);
      pumpTimerId = window.setInterval(schedulePump, 1200);

      schedulePump();
    } catch {
      if (!isDestroyed() && !mseAttached) {
        onFallbackToDirect();
      }
    }
  })();

  return cleanup;
}
