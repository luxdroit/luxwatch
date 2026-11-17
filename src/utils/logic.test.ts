import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTotalWatchSeconds,
  clampSeekTime,
  computeTimelineMarkers,
  CONTINUE_WATCHING_LIMIT,
  extractGoogleDriveFileId,
  formatDurationHuman,
  formatTimecode,
  getAllowedQualitiesFromHeight,
  getSkipOverlayState,
  limitContinueWatching,
  parseExternalVideoSource,
  parseTimecodeToSeconds,
  resolveBestQuality,
  resolveStageTapZone,
  selectBestVariant,
  shouldIgnorePlayerShortcut,
} from './playerLogic.ts';
import {
  canCreateUserWithRole,
  canDeleteUser,
  canManageContent,
  canViewUserInManagement,
} from './rbacLogic.ts';
import {
  isValidPassword,
  isValidUsername,
  sanitizeText,
} from './securityValidation.ts';
import type { EpisodeVariant } from '../types.ts';

const sampleVariants: EpisodeVariant[] = [
  {
    id: 1,
    episodeId: 10,
    audioDub: 'jp',
    subtitleMode: 'en',
    sourceType: 'upload',
    externalUrl: '',
    externalProvider: '',
    fileSizeBytes: 500_000_000,
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 1420,
    availableQualities: ['1080p', '720p', '480p'],
    readyQualities: ['1080p', '720p', '480p'],
    transcodeStatus: 'ready',
  },
  {
    id: 2,
    episodeId: 10,
    audioDub: 'en',
    subtitleMode: 'none',
    sourceType: 'upload',
    externalUrl: '',
    externalProvider: '',
    fileSizeBytes: 600_000_000,
    sourceWidth: 2560,
    sourceHeight: 1440,
    durationSeconds: 1420,
    availableQualities: ['2k', '1080p', '720p', '480p'],
    readyQualities: ['2k', '1080p'],
    transcodeStatus: 'processing',
  },
];

test('selectBestVariant picks exact match without fallback notice', () => {
  const res = selectBestVariant(sampleVariants, {
    preferredDub: 'jp',
    preferredSub: 'en',
  });
  assert.equal(res.variant?.id, 1);
  assert.equal(res.fallbackUsed, false);
  assert.equal(res.fallbackReason, null);
});

test('selectBestVariant falls back gracefully and reports clear Polish reason', () => {
  const res = selectBestVariant(sampleVariants, {
    preferredDub: 'jp',
    preferredSub: 'pl',
  });
  assert.equal(res.variant?.id, 1);
  assert.equal(res.fallbackUsed, true);
  assert.ok(res.fallbackReason?.includes('Polskie napisy'));
  assert.ok(res.fallbackReason?.includes('Angielskie napisy'));
});

test('getAllowedQualitiesFromHeight unlocks 2K only for >=1440p sources', () => {
  assert.deepEqual(getAllowedQualitiesFromHeight(1440), [
    '2k',
    '1080p',
    '720p',
    '480p',
  ]);
  assert.deepEqual(getAllowedQualitiesFromHeight(1080), [
    '1080p',
    '720p',
    '480p',
  ]);
  assert.deepEqual(getAllowedQualitiesFromHeight(720), ['720p', '480p']);
});

test('resolveBestQuality defaults to highest available and degrades cleanly', () => {
  const maxRes = resolveBestQuality(['2k', '1080p', '720p', '480p'], 'max');
  assert.equal(maxRes.quality, '2k');
  assert.equal(maxRes.note, null);

  const degraded = resolveBestQuality(['1080p', '720p', '480p'], '2k');
  assert.equal(degraded.quality, '1080p');
  assert.ok(degraded.note !== null);
});

test('getSkipOverlayState activates SKIP INTRO and SKIP TO NEXT strictly inside bounds', () => {
  assert.deepEqual(getSkipOverlayState(5, 10, 95, 1300, 1420, true), {
    showSkipIntro: false,
    showSkipToNext: false,
  });
  assert.deepEqual(getSkipOverlayState(25, 10, 95, 1300, 1420, true), {
    showSkipIntro: true,
    showSkipToNext: false,
  });
  assert.deepEqual(getSkipOverlayState(1315, 10, 95, 1300, 1420, true), {
    showSkipIntro: false,
    showSkipToNext: true,
  });
  assert.deepEqual(getSkipOverlayState(1315, 10, 95, 1300, 1420, false), {
    showSkipIntro: false,
    showSkipToNext: false,
  });
});

test('calculateTotalWatchSeconds sums watched episode durations cleanly', () => {
  const eps = [
    { id: 1, durationSeconds: 1400 },
    { id: 2, durationSeconds: 1450 },
    { id: 3, durationSeconds: 1300 },
  ];
  assert.equal(calculateTotalWatchSeconds(eps, [1, 3, 1]), 2700);
});

test('timecode parsing and formatting roundtrips cleanly', () => {
  assert.equal(parseTimecodeToSeconds('01:30'), 90);
  assert.equal(parseTimecodeToSeconds('1:02:05'), 3725);
  assert.equal(parseTimecodeToSeconds('45'), 45);
  assert.equal(formatTimecode(90), '01:30');
  assert.equal(formatTimecode(3725), '1:02:05');
  assert.equal(formatDurationHuman(5400), '1 godz. 30 min');
});

test('RBAC enforces strict owner > admin > normal hierarchy', () => {
  assert.equal(canManageContent('owner'), true);
  assert.equal(canManageContent('admin'), true);
  assert.equal(canManageContent('normal'), false);

  assert.equal(canCreateUserWithRole('owner', 'admin'), true);
  assert.equal(canCreateUserWithRole('owner', 'normal'), true);
  assert.equal(canCreateUserWithRole('owner', 'owner'), false);

  assert.equal(canCreateUserWithRole('admin', 'normal'), true);
  assert.equal(canCreateUserWithRole('admin', 'admin'), false);
  assert.equal(canCreateUserWithRole('admin', 'owner'), false);

  assert.equal(canDeleteUser('admin', 2, 'admin', 3), false);
  assert.equal(canDeleteUser('admin', 2, 'owner', 1), false);
  assert.equal(canDeleteUser('admin', 2, 'normal', 4), true);
  assert.equal(canDeleteUser('owner', 1, 'admin', 2), true);
  assert.equal(canDeleteUser('owner', 1, 'owner', 1), false);

  assert.equal(canViewUserInManagement('admin', 'admin'), false);
  assert.equal(canViewUserInManagement('admin', 'owner'), false);
  assert.equal(canViewUserInManagement('admin', 'normal'), true);
});

test('security validators reject invalid usernames and control characters', () => {
  assert.equal(isValidUsername("admin' OR '1'='1"), false);
  assert.equal(isValidUsername('Luxdroit'), true);
  assert.equal(isValidPassword('123'), false);
  assert.equal(isValidPassword('securePass99'), true);
  assert.equal(sanitizeText('  Test\u0000Title  ', 20), 'TestTitle');
});

test('Google Drive and external video URL parser handles share links, IDs, direct URLs, and rejects unsafe schemes', () => {
  const driveShare =
    'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74/view?usp=sharing';
  assert.equal(
    extractGoogleDriveFileId(driveShare),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74'
  );

  const previewRes = parseExternalVideoSource(driveShare, 'preview');
  assert.equal(previewRes.valid, true);
  assert.equal(previewRes.provider, 'gdrive_preview');
  assert.equal(
    previewRes.normalizedUrl,
    'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74/preview'
  );

  const directDriveRes = parseExternalVideoSource(
    'https://drive.google.com/open?id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74',
    'direct'
  );
  assert.equal(directDriveRes.valid, true);
  assert.equal(directDriveRes.provider, 'gdrive_direct');
  assert.equal(
    directDriveRes.normalizedUrl,
    'https://drive.google.com/uc?export=download&id=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74'
  );

  const cdnRes = parseExternalVideoSource('https://cdn.example.com/ep1.mp4');
  assert.equal(cdnRes.valid, true);
  assert.equal(cdnRes.provider, 'direct');

  const xssRes = parseExternalVideoSource('javascript:alert(1)');
  assert.equal(xssRes.valid, false);
});

test('custom player timeline markers, seek clamping, and shortcut guard behave cleanly', () => {
  assert.equal(clampSeekTime(-12, 100), 0);
  assert.equal(clampSeekTime(125, 100), 100);
  assert.equal(clampSeekTime(42, 100), 42);

  const markers = computeTimelineMarkers(1000, 50, 150, 880, 980);
  assert.deepEqual(markers.intro, { leftPct: 5, widthPct: 10 });
  assert.deepEqual(markers.outro, { leftPct: 88, widthPct: 10 });

  assert.equal(shouldIgnorePlayerShortcut('INPUT', false), true);
  assert.equal(shouldIgnorePlayerShortcut('TEXTAREA', false), true);
  assert.equal(shouldIgnorePlayerShortcut('SELECT', false), true);
  assert.equal(shouldIgnorePlayerShortcut('DIV', true), true);
  assert.equal(shouldIgnorePlayerShortcut('BODY', false), false);
  assert.equal(shouldIgnorePlayerShortcut('BUTTON', false), false);
});

test('Google Drive worker mode extracts ID cleanly into luxsource worker URL and tap zones resolve accurately', () => {
  const workerRes = parseExternalVideoSource(
    'https://drive.google.com/file/d/1AbCDefGhIjKlMnOpQrStUvWxYz123456/view?usp=sharing',
    'gdrive_worker'
  );
  assert.equal(workerRes.valid, true);
  assert.equal(workerRes.provider, 'gdrive_direct');
  assert.equal(
    workerRes.normalizedUrl,
    'https://luxsource.luxdroit.workers.dev/?id=1AbCDefGhIjKlMnOpQrStUvWxYz123456'
  );

  const multiAcctRes = parseExternalVideoSource(
    'https://drive.google.com/file/u/0/d/1AbCDefGhIjKlMnOpQrStUvWxYz123456/view',
    'gdrive_worker'
  );
  assert.equal(multiAcctRes.valid, true);
  assert.equal(
    multiAcctRes.normalizedUrl,
    'https://luxsource.luxdroit.workers.dev/?id=1AbCDefGhIjKlMnOpQrStUvWxYz123456'
  );

  const luxDirect = parseExternalVideoSource(
    'https://luxsource.luxdroit.workers.dev/?id=1AbCDefGhIjKlMnOpQrStUvWxYz123456',
    'gdrive_worker'
  );
  assert.equal(luxDirect.valid, true);
  assert.equal(luxDirect.provider, 'gdrive_direct');
  assert.equal(
    luxDirect.normalizedUrl,
    'https://luxsource.luxdroit.workers.dev/?id=1AbCDefGhIjKlMnOpQrStUvWxYz123456'
  );

  const schemeless = parseExternalVideoSource(
    'drive.google.com/file/d/1AbCDefGhIjKlMnOpQrStUvWxYz123456/view?usp=sharing',
    'gdrive_worker'
  );
  assert.equal(schemeless.valid, true);
  assert.equal(
    schemeless.normalizedUrl,
    'https://luxsource.luxdroit.workers.dev/?id=1AbCDefGhIjKlMnOpQrStUvWxYz123456'
  );

  const invalidWorkerRes = parseExternalVideoSource(
    'https://example.com/not-drive.mp4',
    'gdrive_worker'
  );
  assert.equal(invalidWorkerRes.valid, false);

  assert.equal(resolveStageTapZone(0.15), 'left');
  assert.equal(resolveStageTapZone(0.5), 'center');
  assert.equal(resolveStageTapZone(0.85), 'right');
});

test('Continue Watching helper strictly limits items to maximum 5', () => {
  assert.equal(CONTINUE_WATCHING_LIMIT, 5);
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(limitContinueWatching(items), [1, 2, 3, 4, 5]);
});



