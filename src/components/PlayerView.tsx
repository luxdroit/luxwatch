import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  SkipForward,
} from 'lucide-react';
import { api, appendMediaAuth } from '../api/client';
import type {
  AnimeDetail,
  Episode,
  QualityTier,
  UserAccount,
} from '../types';
import {
  DUB_LABELS,
  formatTimecode,
  getSkipOverlayState,
  QUALITY_LABELS,
  QUALITY_ORDER,
  resolveBestQuality,
  selectBestVariant,
  SUB_LABELS,
} from '../utils/playerLogic';
import { LuxVideoPlayer } from './LuxVideoPlayer';

interface PlayerViewProps {
  anime: AnimeDetail;
  episodeId: number;
  user: UserAccount;
  onBackToAnime: () => void;
  onSelectEpisode: (episodeId: number) => void;
  onRefreshAnime: () => Promise<void>;
}

export function PlayerView({
  anime,
  episodeId,
  user,
  onBackToAnime,
  onSelectEpisode,
  onRefreshAnime,
}: PlayerViewProps) {
  const episodeIndex = anime.episodes.findIndex((e) => e.id === episodeId);
  const episode: Episode | undefined =
    episodeIndex >= 0 ? anime.episodes[episodeIndex] : anime.episodes[0];
  const prevEpisode =
    episodeIndex > 0 ? anime.episodes[episodeIndex - 1] : null;
  const nextEpisode =
    episodeIndex >= 0 && episodeIndex < anime.episodes.length - 1
      ? anime.episodes[episodeIndex + 1]
      : null;

  const initialSelection = useMemo(() => {
    if (!episode) {
      return {
        variant: null,
        fallbackUsed: false,
        fallbackReason: null,
      };
    }
    return selectBestVariant(episode.variants, {
      preferredDub: user.preferredDub,
      preferredSub: user.preferredSub,
    });
  }, [episode, user.preferredDub, user.preferredSub]);

  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(
    initialSelection.variant?.id ?? null
  );
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(
    initialSelection.fallbackReason
  );

  const activeVariant = useMemo(() => {
    if (!episode) return null;
    return (
      episode.variants.find((v) => v.id === selectedVariantId) ||
      initialSelection.variant ||
      episode.variants[0] ||
      null
    );
  }, [episode, selectedVariantId, initialSelection.variant]);

  const initialQuality = useMemo(() => {
    if (!activeVariant) return { quality: '1080p' as QualityTier, note: null };
    return resolveBestQuality(
      activeVariant.availableQualities,
      user.preferredQuality
    );
  }, [activeVariant, user.preferredQuality]);

  const [selectedQuality, setSelectedQuality] = useState<QualityTier>(
    initialQuality.quality
  );
  const [qualityNotice, setQualityNotice] = useState<string | null>(
    initialQuality.note
  );

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(episode?.durationSeconds || 0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeSeekRef = useRef<number | null>(null);
  const lastSavedRef = useRef<number>(0);
  const reportedDurationVariantsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    setSelectedVariantId(initialSelection.variant?.id ?? null);
    setFallbackNotice(initialSelection.fallbackReason);
    if (initialSelection.variant) {
      const qRes = resolveBestQuality(
        initialSelection.variant.availableQualities,
        user.preferredQuality
      );
      setSelectedQuality(qRes.quality);
      setQualityNotice(qRes.note);
    }
    const resumeAt =
      episode && !episode.watched && episode.progressSeconds > 1
        ? episode.progressSeconds
        : 0;
    resumeSeekRef.current = resumeAt;
    setCurrentTime(resumeAt);
    setDuration(episode?.durationSeconds || 0);
  }, [episode?.id, initialSelection, user.preferredQuality]);

  if (!episode) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center">
        <p className="text-[#A3A8B4] mb-4">Nie znaleziono odcinka.</p>
        <button
          type="button"
          onClick={onBackToAnime}
          className="px-4 py-2 bg-[#67E8F9] text-[#070B10] rounded-lg text-sm font-semibold cursor-pointer"
        >
          Powrót do serii
        </button>
      </div>
    );
  }

  const isExternalIframe =
    activeVariant?.sourceType === 'external' &&
    activeVariant.externalProvider === 'gdrive_preview' &&
    !activeVariant.externalUrl.includes('luxsource.luxdroit.workers.dev');

  const streamUrl = activeVariant
    ? activeVariant.sourceType === 'external'
      ? activeVariant.externalUrl
      : appendMediaAuth(
          `/api/stream/${activeVariant.id}?quality=${encodeURIComponent(selectedQuality)}`
        )
    : '';

  const skipState = getSkipOverlayState(
    currentTime,
    episode.introStart,
    episode.introEnd,
    episode.outroStart,
    episode.outroEnd,
    Boolean(nextEpisode && nextEpisode.variants.length > 0)
  );

  async function persistProgress(
    pos: number,
    dur: number,
    completed?: boolean
  ) {
    if (!episode) return;
    try {
      await api.saveProgress({
        episodeId: episode.id,
        positionSeconds: Math.floor(pos),
        durationSeconds: Math.floor(dur || episode.durationSeconds || 0),
        completed,
      });
    } catch {
      // background save failure should not interrupt playback
    }
  }

  function handleTimeUpdate() {
    const vid = videoRef.current;
    if (!vid) return;
    const now = vid.currentTime;
    setCurrentTime(now);
    if (Number.isFinite(vid.duration) && vid.duration > 0) {
      setDuration(vid.duration);
    }
    if (Math.abs(now - lastSavedRef.current) >= 4) {
      lastSavedRef.current = now;
      void persistProgress(now, vid.duration || duration);
    }
  }

  function handleLoadedMetadata() {
    const vid = videoRef.current;
    if (!vid) return;
    if (Number.isFinite(vid.duration) && vid.duration > 0) {
      setDuration(vid.duration);
      const rounded = Math.round(vid.duration);
      if (
        activeVariant &&
        rounded > 0 &&
        !reportedDurationVariantsRef.current.has(activeVariant.id) &&
        (activeVariant.durationSeconds === 0 ||
          Math.abs(rounded - activeVariant.durationSeconds) > 2)
      ) {
        reportedDurationVariantsRef.current.add(activeVariant.id);
        void api
          .reportVariantDuration(activeVariant.id, rounded)
          .catch(() => {});
      }
    }
    if (resumeSeekRef.current !== null && resumeSeekRef.current > 0) {
      vid.currentTime = Math.min(
        resumeSeekRef.current,
        Math.max(0, (vid.duration || 0) - 0.5)
      );
      resumeSeekRef.current = null;
    }
  }

  function handleSwitchVariant(newVariantId: number) {
    if (newVariantId === activeVariant?.id) return;
    const vid = videoRef.current;
    if (vid) {
      resumeSeekRef.current = vid.currentTime;
    }
    setSelectedVariantId(newVariantId);
    setFallbackNotice(null);
    const nextVar = episode?.variants.find((v) => v.id === newVariantId);
    if (nextVar) {
      const qRes = resolveBestQuality(
        nextVar.availableQualities,
        user.preferredQuality
      );
      setSelectedQuality(qRes.quality);
      setQualityNotice(qRes.note);
    }
  }

  function handleSwitchQuality(q: QualityTier) {
    if (q === selectedQuality) return;
    const vid = videoRef.current;
    if (vid) {
      resumeSeekRef.current = vid.currentTime;
    }
    setSelectedQuality(q);
    setQualityNotice(null);
  }

  function handleSkipIntro() {
    const vid = videoRef.current;
    if (!vid || episode?.introEnd === null || episode?.introEnd === undefined) {
      return;
    }
    vid.currentTime = episode.introEnd;
    setCurrentTime(episode.introEnd);
  }

  async function handleSkipToNext() {
    if (!nextEpisode || !episode) return;
    await persistProgress(duration || episode.durationSeconds, duration, true);
    await onRefreshAnime();
    onSelectEpisode(nextEpisode.id);
  }

  async function handleVideoEnded() {
    if (!episode) return;
    await persistProgress(
      duration || episode.durationSeconds,
      duration || episode.durationSeconds,
      true
    );
    await onRefreshAnime();
  }

  async function handleToggleWatched() {
    if (!episode) return;
    await api.toggleEpisodeWatched(episode.id, !episode.watched);
    await onRefreshAnime();
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToAnime}
          className="inline-flex items-center gap-2 min-h-[40px] text-sm text-[#A3A8B4] hover:text-[#F8F8FA] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate max-w-[180px] sm:max-w-none">{anime.title}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!prevEpisode}
            onClick={() => prevEpisode && onSelectEpisode(prevEpisode.id)}
            className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#111216] border border-white/15 rounded-lg text-[#F8F8FA] disabled:opacity-40 hover:border-white/30 inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Poprzedni</span>
          </button>
          <button
            type="button"
            disabled={!nextEpisode}
            onClick={() => nextEpisode && onSelectEpisode(nextEpisode.id)}
            className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#111216] border border-white/15 rounded-lg text-[#F8F8FA] disabled:opacity-40 hover:border-white/30 inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
          >
            <span>Następny</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Fallback / Preference Notification Banners */}
      {fallbackNotice && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-[#0B151A] border border-[#67E8F9]/50 text-sm text-[#CFFAFE] flex items-start gap-3"
        >
          <AlertTriangle
            className="w-4 h-4 text-[#67E8F9] shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span>{fallbackNotice}</span>
        </div>
      )}

      {qualityNotice && (
        <div
          role="status"
          className="p-3 rounded-xl bg-[#111216] border border-white/15 text-xs text-[#D4D6DE]"
        >
          {qualityNotice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Video Theater */}
        <div className="lg:col-span-9 space-y-4">
          {activeVariant ? (
            isExternalIframe ? (
              <div className="lux-player-root relative aspect-video bg-black rounded-xl overflow-hidden border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.65)] outline-none focus:outline-none">
                <iframe
                  key={activeVariant.id}
                  src={streamUrl}
                  title={`${anime.title} - Odcinek ${episode.episodeNumber}`}
                  allow="autoplay; fullscreen"
                  className="w-full h-full border-0 bg-black outline-none focus:outline-none"
                />
              </div>
            ) : (
              <LuxVideoPlayer
                animeTitle={anime.title}
                episodeNumber={episode.episodeNumber}
                episodeTitle={episode.title}
                src={streamUrl}
                variantKey={`${activeVariant.id}-${selectedQuality}`}
                videoRef={videoRef}
                currentTime={currentTime}
                duration={duration || episode.durationSeconds}
                introStart={episode.introStart}
                introEnd={episode.introEnd}
                outroStart={episode.outroStart}
                outroEnd={episode.outroEnd}
                skipState={skipState}
                availableQualities={activeVariant.availableQualities}
                selectedQuality={selectedQuality}
                canSwitchQuality={activeVariant.sourceType === 'upload'}
                onSwitchQuality={handleSwitchQuality}
                onSkipIntro={handleSkipIntro}
                onSkipToNext={() => void handleSkipToNext()}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPausePersist={() => {
                  if (videoRef.current) {
                    void persistProgress(
                      videoRef.current.currentTime,
                      videoRef.current.duration || duration
                    );
                  }
                }}
                onEnded={() => void handleVideoEnded()}
              />
            )
          ) : (
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-white/15 flex items-center justify-center text-sm text-[#A3A8B4]">
              Ten odcinek nie ma jeszcze wgranej wersji wideo.
            </div>
          )}

          {/* Google Drive Embed Quick Actions Bar */}
          {isExternalIframe && (
            <div className="bg-[#0B151A] border border-[#67E8F9]/30 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#CFFAFE]">
              <div className="flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-[#67E8F9] shrink-0" aria-hidden="true" />
                <span>
                  Odtwarzanie przez zewnętrzny odtwarzacz Google Drive.
                  {episode.introStart !== null && episode.introEnd !== null && (
                    <>
                      {' '}
                      Opening: {formatTimecode(episode.introStart)}–
                      {formatTimecode(episode.introEnd)}.
                    </>
                  )}
                </span>
              </div>
              {nextEpisode && nextEpisode.variants.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleSkipToNext()}
                  className="px-3.5 py-1.5 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Następny odcinek (SKIP TO NEXT)</span>
                </button>
              )}
            </div>
          )}

          {/* Episode Title + Player Configuration Strip */}
          <div className="bg-[#111216] border border-white/10 rounded-xl p-4 sm:p-5 space-y-4 sm:space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
              <div>
                <p className="text-xs font-mono text-[#67E8F9] tabular-nums">
                  Odcinek {episode.episodeNumber} ·{' '}
                  {isExternalIframe
                    ? `Czas odcinka: ${formatTimecode(duration || episode.durationSeconds)}`
                    : `${formatTimecode(currentTime)} / ${formatTimecode(duration || episode.durationSeconds)}`}
                </p>
                <h1 className="font-display text-lg sm:text-2xl font-semibold text-[#F8F8FA] mt-1">
                  {episode.title}
                </h1>
              </div>

              <button
                type="button"
                onClick={() => void handleToggleWatched()}
                className={`w-full sm:w-auto min-h-[44px] justify-center px-4 py-2 text-xs font-semibold rounded-lg border inline-flex items-center gap-2 shrink-0 transition-colors cursor-pointer ${
                  episode.watched
                    ? 'bg-[#67E8F9]/15 border-[#67E8F9] text-[#67E8F9]'
                    : 'bg-[#09090B] border-white/15 text-[#F8F8FA] hover:border-white/30'
                }`}
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {episode.watched
                    ? 'Oznaczono jako obejrzane'
                    : 'Oznacz odcinek jako obejrzany'}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 pt-4 border-t border-white/10">
              {/* Dubbing & Subtitles Variant Selector */}
              <div className="space-y-2">
                <span className="block text-xs font-medium text-[#A3A8B4]">
                  Wersja audio i napisów
                </span>
                <div className="flex flex-wrap gap-2">
                  {episode.variants.map((v) => {
                    const active = activeVariant?.id === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => handleSwitchVariant(v.id)}
                        className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#67E8F9] border-[#67E8F9] text-[#070B10]'
                            : 'bg-[#09090B] border-white/15 text-[#E4E4EA] hover:border-white/30'
                        }`}
                      >
                        {DUB_LABELS[v.audioDub]} · {SUB_LABELS[v.subtitleMode]}
                        {v.sourceType === 'external' ? ' (Drive/URL)' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quality Selector */}
              {activeVariant && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#A3A8B4]">
                      {isExternalIframe
                        ? 'Jakość regulowana w odtwarzaczu Google Drive'
                        : `Jakość obrazu (źródło: ${activeVariant.sourceWidth}×${activeVariant.sourceHeight})`}
                    </span>
                    {activeVariant.sourceType === 'upload' &&
                      activeVariant.transcodeStatus === 'processing' && (
                        <span className="text-xs text-[#67E8F9] whitespace-nowrap">
                          Przygotowywanie niższych jakości…
                        </span>
                      )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {QUALITY_ORDER.map((q) => {
                      const supported =
                        !isExternalIframe &&
                        activeVariant.availableQualities.includes(q);
                      const active = !isExternalIframe && selectedQuality === q;
                      return (
                        <button
                          key={q}
                          type="button"
                          disabled={!supported}
                          onClick={() => handleSwitchQuality(q)}
                          className={`min-h-[40px] px-3 py-1.5 text-xs font-mono font-medium rounded-lg border transition-colors ${
                            !supported
                              ? 'bg-[#09090B] border-white/5 text-[#525663] cursor-not-allowed'
                              : active
                                ? 'bg-[#67E8F9] border-[#67E8F9] text-[#070B10] cursor-pointer'
                                : 'bg-[#09090B] border-white/15 text-[#E4E4EA] hover:border-white/30 cursor-pointer'
                          }`}
                        >
                          {QUALITY_LABELS[q]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Episode Queue Sidebar */}
        <aside className="lg:col-span-3 bg-[#111216] border border-white/10 rounded-xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-white/10">
            <h2 className="font-display text-sm font-semibold text-[#F8F8FA]">
              Lista odcinków
            </h2>
          </div>
          <div className="divide-y divide-white/10 max-h-[540px] overflow-y-auto">
            {anime.episodes.map((ep) => {
              const isCurrent = ep.id === episode.id;
              return (
                <button
                  key={ep.id}
                  type="button"
                  disabled={ep.variants.length === 0}
                  onClick={() => onSelectEpisode(ep.id)}
                  className={`w-full text-left px-4 py-3 flex items-start justify-between gap-2 transition-colors cursor-pointer disabled:opacity-40 ${
                    isCurrent
                      ? 'bg-[#67E8F9]/15 text-[#F8F8FA]'
                      : 'hover:bg-white/[0.03] text-[#D4D6DE]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-[#67E8F9] tabular-nums">
                      Odcinek {ep.episodeNumber}
                    </div>
                    <div className="text-sm font-medium truncate mt-0.5">
                      {ep.title}
                    </div>
                  </div>
                  {ep.watched && (
                    <Check
                      className="w-4 h-4 text-[#67E8F9] shrink-0 mt-1"
                      aria-label="Obejrzane"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
