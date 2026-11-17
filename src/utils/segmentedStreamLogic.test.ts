import test from 'node:test';
import assert from 'node:assert/strict';
import * as MP4Box from 'mp4box';
import {
  alignChunkIndex,
  buildMseTrackMimeType,
  computeAheadBufferedSeconds,
  computeEvictionRange,
  getAlignedChunkBounds,
  isHlsStreamUrl,
  isMp4FtypHeader,
  isTimeWithinBufferedRanges,
  parseContentRangeHeader,
  planAlignedByteChunks,
  shouldTriggerStallRecovery,
} from './segmentedStreamLogic.ts';

test('parseContentRangeHeader parses valid HTTP 206 ranges and rejects malformed', () => {
  assert.deepEqual(parseContentRangeHeader('bytes 0-262143/1572864000'), {
    start: 0,
    end: 262143,
    total: 1572864000,
  });
  assert.deepEqual(parseContentRangeHeader('bytes 100-199/200'), {
    start: 100,
    end: 199,
    total: 200,
  });
  assert.equal(parseContentRangeHeader('bytes */200'), null);
  assert.equal(parseContentRangeHeader('bytes 200-100/200'), null);
  assert.equal(parseContentRangeHeader(null), null);
});

test('isMp4FtypHeader detects ISO BMFF ftyp/styp signatures', () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73]);
  const styp = new Uint8Array([0, 0, 0, 24, 0x73, 0x74, 0x79, 0x70]);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
  assert.equal(isMp4FtypHeader(mp4), true);
  assert.equal(isMp4FtypHeader(styp), true);
  assert.equal(isMp4FtypHeader(webm), false);
  assert.equal(isMp4FtypHeader(new Uint8Array(4)), false);
});

test('isHlsStreamUrl recognizes .m3u8 URLs with or without query strings', () => {
  assert.equal(isHlsStreamUrl('https://cdn.example.com/anime/ep1/master.m3u8?token=abc'), true);
  assert.equal(isHlsStreamUrl('/api/hls/ep1.M3U8'), true);
  assert.equal(isHlsStreamUrl('https://luxsource.luxdroit.workers.dev/?id=abc123'), false);
});

test('aligned byte chunk planner builds contiguous bounded segments', () => {
  const chunkSize = 1024;
  assert.equal(alignChunkIndex(0, chunkSize), 0);
  assert.equal(alignChunkIndex(1500, chunkSize), 1);

  assert.deepEqual(getAlignedChunkBounds(2, 2500, chunkSize), {
    index: 2,
    start: 2048,
    end: 2499,
  });
  assert.equal(getAlignedChunkBounds(3, 2500, chunkSize), null);

  assert.deepEqual(planAlignedByteChunks(1500, 3500, chunkSize, 4), [
    { index: 1, start: 1024, end: 2047 },
    { index: 2, start: 2048, end: 3071 },
    { index: 3, start: 3072, end: 3499 },
  ]);
});

test('buffer window helpers compute lookahead, buffered hits, and eviction ranges', () => {
  const ranges = [
    { start: 0, end: 42 },
    { start: 120, end: 155 },
  ];

  assert.equal(isTimeWithinBufferedRanges(ranges, 20), true);
  assert.equal(isTimeWithinBufferedRanges(ranges, 80), false);
  assert.equal(computeAheadBufferedSeconds(ranges, 15), 27);
  assert.equal(computeAheadBufferedSeconds(ranges, 90), 0);

  assert.equal(computeEvictionRange(ranges, 50, 60), null);
  assert.deepEqual(computeEvictionRange(ranges, 135, 60), {
    start: 0,
    end: 75,
  });
});

test('MIME track formatter and stall recovery watchdog decisions', () => {
  assert.equal(
    buildMseTrackMimeType('avc1.640028', 'video'),
    'video/mp4; codecs="avc1.640028"'
  );
  assert.equal(
    buildMseTrackMimeType('mp4a.40.2', 'audio'),
    'audio/mp4; codecs="mp4a.40.2"'
  );

  assert.equal(
    shouldTriggerStallRecovery({
      isPlaying: true,
      readyState: 2,
      stalledMs: 10500,
      retryCount: 0,
      maxRetries: 3,
    }),
    true
  );
  assert.equal(
    shouldTriggerStallRecovery({
      isPlaying: true,
      readyState: 4,
      stalledMs: 15000,
      retryCount: 0,
      maxRetries: 3,
    }),
    false
  );
  assert.equal(
    shouldTriggerStallRecovery({
      isPlaying: true,
      readyState: 1,
      stalledMs: 15000,
      retryCount: 3,
      maxRetries: 3,
    }),
    false
  );
});

test('MP4Box exports createFile and MP4BoxBuffer cleanly in Node ESM', () => {
  assert.equal(typeof MP4Box.createFile, 'function');
  assert.equal(typeof MP4Box.MP4BoxBuffer.fromArrayBuffer, 'function');
});
