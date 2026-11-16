import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  FastForward,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { QualityTier } from '../types';
import {
  clampSeekTime,
  computeTimelineMarkers,
  formatTimecode,
  QUALITY_LABELS,
  QUALITY_ORDER,
  shouldIgnorePlayerShortcut,
} from '../utils/playerLogic';

interface LuxVideoPlayerProps {
  animeTitle: string;
  episodeNumber: number;
  episodeTitle: string;
  src: string;
  variantKey: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTime: number;
  duration: number;
  introStart: number | null;
  introEnd: number | null;
  outroStart: number | null;
  outroEnd: number | null;
  skipState: { showSkipIntro: boolean; showSkipToNext: boolean };
  availableQualities: QualityTier[];
  selectedQuality: QualityTier;
  canSwitchQuality: boolean;
  onSwitchQuality: (q: QualityTier) => void;
  onSkipIntro: () => void;
  onSkipToNext: () => void;
  onTimeUpdate: () => void;
  onLoadedMetadata: () => void;
  onPausePersist: () => void;
  onEnded: () => void;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function LuxVideoPlayer({
  animeTitle,
  episodeNumber,
  episodeTitle,
  src,
  variantKey,
  videoRef,
  currentTime,
  duration,
  introStart,
  introEnd,
  outroStart,
  outroEnd,
  skipState,
  availableQualities,
  selectedQuality,
  canSwitchQuality,
  onSwitchQuality,
  onSkipIntro,
  onSkipToNext,
  onTimeUpdate,
  onLoadedMetadata,
  onPausePersist,
  onEnded,
}: LuxVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const hudFlashTimerRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isHoveringHud, setIsHoveringHud] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverTime, setHoverTime] = useState<{
    seconds: number;
    pct: number;
    tag: string | null;
  } | null>(null);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [hudFlash, setHudFlash] = useState<string | null>(null);

  const triggerHudFlash = useCallback((label: string) => {
    setHudFlash(label);
    if (hudFlashTimerRef.current) {
      window.clearTimeout(hudFlashTimerRef.current);
    }
    hudFlashTimerRef.current = window.setTimeout(() => {
      setHudFlash(null);
    }, 750);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      const vid = videoRef.current;
      if (vid && !vid.paused && !isHoveringHud && !isScrubbing) {
        setControlsVisible(false);
        setQualityMenuOpen(false);
        setSpeedMenuOpen(false);
      }
    }, 2600);
  }, [isHoveringHud, isScrubbing, videoRef]);

  useEffect(() => {
    if (!isPlaying) {
      setControlsVisible(true);
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    } else {
      revealControls();
    }
  }, [isPlaying, revealControls]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      if (hudFlashTimerRef.current) window.clearTimeout(hudFlashTimerRef.current);
    };
  }, []);

  const togglePlayPause = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      void vid.play().catch(() => {});
      triggerHudFlash('Odtwarzanie');
    } else {
      vid.pause();
      triggerHudFlash('Pauza');
    }
    revealControls();
  }, [revealControls, triggerHudFlash, videoRef]);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const vid = videoRef.current;
      if (!vid) return;
      const total = Number.isFinite(vid.duration) && vid.duration > 0
        ? vid.duration
        : duration;
      const next = clampSeekTime(vid.currentTime + deltaSeconds, total);
      vid.currentTime = next;
      onTimeUpdate();
      triggerHudFlash(
        deltaSeconds > 0 ? `+${deltaSeconds} s` : `${deltaSeconds} s`
      );
      revealControls();
    },
    [duration, onTimeUpdate, revealControls, triggerHudFlash, videoRef]
  );

  const toggleMute = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextMuted = !vid.muted;
    vid.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && vid.volume === 0) {
      vid.volume = 0.7;
      setVolume(0.7);
    }
    triggerHudFlash(nextMuted ? 'Wyciszono' : `Głośność ${Math.round(vid.volume * 100)}%`);
    revealControls();
  }, [revealControls, triggerHudFlash, videoRef]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen?.().catch(() => {});
    }
    revealControls();
  }, [revealControls]);

  // Global keyboard shortcuts: works immediately without clicking/focusing the video
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      if (
        shouldIgnorePlayerShortcut(
          active?.tagName,
          Boolean(active?.isContentEditable)
        )
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;
      if (key === ' ' || key === 'Spacebar' || key === 'k' || key === 'K') {
        e.preventDefault();
        if (active && active.tagName === 'BUTTON') {
          active.blur();
        }
        togglePlayPause();
        return;
      }
      if (key === 'ArrowRight' || key === 'l' || key === 'L') {
        e.preventDefault();
        seekBy(key === 'ArrowRight' ? 5 : 10);
        return;
      }
      if (key === 'ArrowLeft' || key === 'j' || key === 'J') {
        e.preventDefault();
        seekBy(key === 'ArrowLeft' ? -5 : -10);
        return;
      }
      if (key === 'ArrowUp') {
        e.preventDefault();
        const vid = videoRef.current;
        if (!vid) return;
        const nextVol = Math.min(1, Math.round((vid.volume + 0.1) * 10) / 10);
        vid.volume = nextVol;
        vid.muted = false;
        setVolume(nextVol);
        setIsMuted(false);
        triggerHudFlash(`Głośność ${Math.round(nextVol * 100)}%`);
        revealControls();
        return;
      }
      if (key === 'ArrowDown') {
        e.preventDefault();
        const vid = videoRef.current;
        if (!vid) return;
        const nextVol = Math.max(0, Math.round((vid.volume - 0.1) * 10) / 10);
        vid.volume = nextVol;
        vid.muted = nextVol === 0;
        setVolume(nextVol);
        setIsMuted(nextVol === 0);
        triggerHudFlash(`Głośność ${Math.round(nextVol * 100)}%`);
        revealControls();
        return;
      }
      if (key === 'm' || key === 'M') {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (key === 'f' || key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    revealControls,
    seekBy,
    toggleFullscreen,
    toggleMute,
    togglePlayPause,
    triggerHudFlash,
    videoRef,
  ]);

  const effectiveDuration = duration > 0 ? duration : 0;
  const progressPct =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100))
      : 0;

  const markers = useMemo(
    () =>
      computeTimelineMarkers(
        effectiveDuration,
        introStart,
        introEnd,
        outroStart,
        outroEnd
      ),
    [effectiveDuration, introStart, introEnd, outroStart, outroEnd]
  );

  function computeSeekPositionFromClientX(clientX: number) {
    const bar = progressBarRef.current;
    if (!bar || effectiveDuration <= 0) return null;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))
    );
    const seconds = ratio * effectiveDuration;
    let tag: string | null = null;
    if (
      introStart !== null &&
      introEnd !== null &&
      seconds >= introStart &&
      seconds <= introEnd
    ) {
      tag = 'Opening';
    } else if (
      outroStart !== null &&
      outroEnd !== null &&
      seconds >= outroStart &&
      seconds <= outroEnd
    ) {
      tag = 'Ending';
    }
    return { seconds, pct: ratio * 100, tag };
  }

  function applySeek(seconds: number) {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = clampSeekTime(seconds, effectiveDuration);
    onTimeUpdate();
  }

  function handleProgressPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsScrubbing(true);
    const initial = computeSeekPositionFromClientX(e.clientX);
    if (initial) {
      applySeek(initial.seconds);
      setHoverTime(initial);
    }

    const onMove = (moveEvent: PointerEvent) => {
      const pos = computeSeekPositionFromClientX(moveEvent.clientX);
      if (pos) {
        applySeek(pos.seconds);
        setHoverTime(pos);
      }
    };

    const onUp = () => {
      setIsScrubbing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function handleVolumeChange(val: number) {
    const vid = videoRef.current;
    if (!vid) return;
    const clamped = Math.max(0, Math.min(1, val));
    vid.volume = clamped;
    vid.muted = clamped === 0;
    setVolume(clamped);
    setIsMuted(clamped === 0);
  }

  function handlePlaybackRate(rate: number) {
    const vid = videoRef.current;
    if (vid) {
      vid.playbackRate = rate;
    }
    setPlaybackRate(rate);
    setSpeedMenuOpen(false);
  }

  function updateBuffered() {
    const vid = videoRef.current;
    if (!vid || !Number.isFinite(vid.duration) || vid.duration <= 0) return;
    if (vid.buffered.length > 0) {
      const end = vid.buffered.end(vid.buffered.length - 1);
      setBufferedPct(Math.min(100, (end / vid.duration) * 100));
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (isPlaying && !isScrubbing) {
          setControlsVisible(false);
          setQualityMenuOpen(false);
          setSpeedMenuOpen(false);
        }
      }}
      className={`lux-player-root relative aspect-video bg-black overflow-hidden select-none outline-none focus:outline-none ${
        isFullscreen
          ? 'w-screen h-screen rounded-none border-0'
          : 'rounded-xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.65)]'
      } ${!controlsVisible && isPlaying ? 'cursor-none' : 'cursor-default'}`}
    >
      <video
        ref={videoRef}
        key={variantKey}
        src={src}
        tabIndex={-1}
        autoPlay
        playsInline
        onClick={togglePlayPause}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }}
        onPause={() => {
          setIsPlaying(false);
          onPausePersist();
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onProgress={updateBuffered}
        onTimeUpdate={() => {
          updateBuffered();
          onTimeUpdate();
        }}
        onLoadedMetadata={() => {
          const vid = videoRef.current;
          if (vid) {
            vid.volume = volume;
            vid.muted = isMuted;
            vid.playbackRate = playbackRate;
          }
          updateBuffered();
          onLoadedMetadata();
        }}
        onEnded={() => {
          setIsPlaying(false);
          onEnded();
        }}
        className="w-full h-full object-contain bg-black outline-none focus:outline-none"
      />

      {/* Top Cinema Scrim & Title */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 px-5 pt-4 pb-10 bg-gradient-to-b from-black/80 via-black/35 to-transparent transition-opacity duration-200 flex items-center justify-between gap-4 ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-[#67E8F9] tracking-wide truncate">
            {animeTitle} · Odcinek {episodeNumber}
          </div>
          <div className="text-sm font-display font-semibold text-[#F8F8FA] truncate">
            {episodeTitle}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-[#CFFAFE] bg-[#0B151A]/80 border border-[#67E8F9]/30 px-2.5 py-1 rounded-md shrink-0">
          <span>{QUALITY_LABELS[selectedQuality]}</span>
        </div>
      </div>

      {/* Center Play Overlay (when paused) or Buffering Spinner */}
      {isBuffering ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-[#09090B]/80 border border-[#67E8F9]/40 flex items-center justify-center">
            <Loader2
              className="w-6 h-6 text-[#67E8F9] animate-spin"
              aria-hidden="true"
            />
          </div>
        </div>
      ) : (
        !isPlaying && (
          <button
            type="button"
            tabIndex={-1}
            onClick={togglePlayPause}
            aria-label="Odtwórz odcinek"
            className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-[#09090B]/80 hover:bg-[#67E8F9] text-[#67E8F9] hover:text-[#070B10] border border-[#67E8F9]/70 flex items-center justify-center transition-all duration-200 cursor-pointer shadow-[0_0_32px_rgba(103,232,249,0.2)] outline-none focus:outline-none"
          >
            <Play className="w-7 h-7 fill-current ml-0.5" aria-hidden="true" />
          </button>
        )
      )}

      {/* Brief Keyboard Shortcut Feedback */}
      {hudFlash && (
        <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-lg bg-[#09090B]/85 backdrop-blur-md border border-[#67E8F9]/45 text-xs font-mono font-semibold text-[#CFFAFE]">
          {hudFlash}
        </div>
      )}

      {/* Floating SKIP INTRO / SKIP TO NEXT Overlays (work in fullscreen too) */}
      {(skipState.showSkipIntro || skipState.showSkipToNext) && (
        <div
          className={`absolute right-5 z-20 flex flex-col gap-2 items-end transition-all duration-200 ${
            controlsVisible ? 'bottom-24' : 'bottom-6'
          }`}
        >
          {skipState.showSkipIntro && (
            <button
              type="button"
              tabIndex={-1}
              onClick={onSkipIntro}
              className="px-4 py-2 bg-[#09090B]/90 backdrop-blur-md hover:bg-[#67E8F9] text-[#F8F8FA] hover:text-[#070B10] border border-[#67E8F9] text-xs font-semibold rounded-lg shadow-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <FastForward className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pomiń intro (SKIP INTRO)</span>
            </button>
          )}
          {skipState.showSkipToNext && (
            <button
              type="button"
              tabIndex={-1}
              onClick={onSkipToNext}
              className="px-4 py-2 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-xs font-semibold rounded-lg shadow-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Następny odcinek (SKIP TO NEXT)</span>
            </button>
          )}
        </div>
      )}

      {/* Bottom Cinema Controls HUD */}
      <div
        onMouseEnter={() => setIsHoveringHud(true)}
        onMouseLeave={() => setIsHoveringHud(false)}
        className={`absolute inset-x-0 bottom-0 z-20 pt-10 pb-3 px-4 sm:px-5 bg-gradient-to-t from-black/95 via-black/75 to-transparent transition-opacity duration-200 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Interactive Timeline Scrubber with Opening / Ending Markers */}
        <div
          ref={progressBarRef}
          role="slider"
          aria-label="Oś czasu odcinka"
          aria-valuemin={0}
          aria-valuemax={Math.floor(effectiveDuration)}
          aria-valuenow={Math.floor(currentTime)}
          tabIndex={-1}
          onPointerDown={handleProgressPointerDown}
          onMouseMove={(e) => {
            const pos = computeSeekPositionFromClientX(e.clientX);
            if (pos) setHoverTime(pos);
          }}
          onMouseLeave={() => {
            if (!isScrubbing) setHoverTime(null);
          }}
          className="relative h-5 flex items-center cursor-pointer group/bar"
        >
          {/* Hover Timestamp Tooltip */}
          {hoverTime && (
            <div
              className="pointer-events-none absolute -top-8 -translate-x-1/2 px-2 py-1 rounded bg-[#09090B]/95 border border-white/15 text-[11px] font-mono tabular-nums text-[#F8F8FA] whitespace-nowrap shadow-lg"
              style={{
                left: `${Math.min(96, Math.max(4, hoverTime.pct))}%`,
              }}
            >
              {formatTimecode(hoverTime.seconds)}
              {hoverTime.tag && (
                <span className="ml-1.5 text-[#67E8F9]">{hoverTime.tag}</span>
              )}
            </div>
          )}

          {/* Rail */}
          <div className="relative w-full h-1.5 group-hover/bar:h-2 transition-all rounded-full bg-white/15 overflow-hidden">
            {/* Buffered */}
            <div
              className="absolute inset-y-0 left-0 bg-white/25"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Intro / Outro Markers */}
            {markers.intro && (
              <div
                className="absolute inset-y-0 bg-[#67E8F9]/45"
                style={{
                  left: `${markers.intro.leftPct}%`,
                  width: `${markers.intro.widthPct}%`,
                }}
              />
            )}
            {markers.outro && (
              <div
                className="absolute inset-y-0 bg-[#67E8F9]/45"
                style={{
                  left: `${markers.outro.leftPct}%`,
                  width: `${markers.outro.widthPct}%`,
                }}
              />
            )}
            {/* Played Aqua Progress */}
            <div
              className="absolute inset-y-0 left-0 bg-[#67E8F9]"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Scrubber Thumb */}
          <div
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#67E8F9] shadow-[0_0_12px_rgba(103,232,249,0.85)] opacity-0 group-hover/bar:opacity-100 transition-opacity"
            style={{ left: `${progressPct}%` }}
          />
        </div>

        {/* Control Buttons Row */}
        <div className="mt-1.5 flex items-center justify-between gap-3">
          {/* Left Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <button
              type="button"
              tabIndex={-1}
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pauza' : 'Odtwórz'}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#F8F8FA] hover:text-[#67E8F9] hover:bg-white/10 transition-colors cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
              ) : (
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={() => seekBy(-10)}
              aria-label="Cofnij o 10 sekund"
              className="w-8 h-8 rounded-lg hidden sm:flex items-center justify-center text-[#D4D6DE] hover:text-[#67E8F9] hover:bg-white/10 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={() => seekBy(10)}
              aria-label="Przewiń o 10 sekund"
              className="w-8 h-8 rounded-lg hidden sm:flex items-center justify-center text-[#D4D6DE] hover:text-[#67E8F9] hover:bg-white/10 transition-colors cursor-pointer"
            >
              <RotateCw className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                onClick={toggleMute}
                aria-label={isMuted ? 'Odcisz' : 'Wycisz'}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#D4D6DE] hover:text-[#67E8F9] hover:bg-white/10 transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4" aria-hidden="true" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
              <input
                type="range"
                tabIndex={-1}
                aria-label="Głośność"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="hidden sm:block w-16 md:w-20 h-1 accent-[#67E8F9] cursor-pointer"
              />
            </div>

            {/* Timecode */}
            <div className="pl-1 text-xs font-mono tabular-nums text-[#E4E4EA] whitespace-nowrap">
              <span>{formatTimecode(currentTime)}</span>
              <span className="text-[#737887] mx-1">/</span>
              <span className="text-[#A3A8B4]">
                {formatTimecode(effectiveDuration)}
              </span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-1.5 relative shrink-0">
            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setSpeedMenuOpen((v) => !v);
                  setQualityMenuOpen(false);
                }}
                aria-label="Prędkość odtwarzania"
                className="px-2.5 py-1 rounded-md text-xs font-mono font-medium text-[#E4E4EA] hover:text-[#67E8F9] hover:bg-white/10 transition-colors cursor-pointer"
              >
                {playbackRate}x
              </button>
              {speedMenuOpen && (
                <div className="absolute bottom-10 right-0 w-24 bg-[#111216]/95 backdrop-blur-md border border-white/15 rounded-lg py-1 shadow-xl z-30">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      tabIndex={-1}
                      onClick={() => handlePlaybackRate(rate)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                        playbackRate === rate
                          ? 'text-[#070B10] bg-[#67E8F9] font-semibold'
                          : 'text-[#E4E4EA] hover:bg-white/10'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Inline Quality Menu */}
            {canSwitchQuality && (
              <div className="relative">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setQualityMenuOpen((v) => !v);
                    setSpeedMenuOpen(false);
                  }}
                  aria-label="Jakość obrazu"
                  className="px-2.5 py-1 rounded-md text-xs font-mono font-semibold text-[#67E8F9] bg-[#0B151A]/90 border border-[#67E8F9]/35 hover:border-[#67E8F9] transition-colors cursor-pointer"
                >
                  {selectedQuality.toUpperCase()}
                </button>
                {qualityMenuOpen && (
                  <div className="absolute bottom-10 right-0 w-36 bg-[#111216]/95 backdrop-blur-md border border-white/15 rounded-lg py-1 shadow-xl z-30">
                    {QUALITY_ORDER.filter((q) =>
                      availableQualities.includes(q)
                    ).map((q) => (
                      <button
                        key={q}
                        type="button"
                        tabIndex={-1}
                        onClick={() => {
                          onSwitchQuality(q);
                          setQualityMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                          selectedQuality === q
                            ? 'text-[#070B10] bg-[#67E8F9] font-semibold'
                            : 'text-[#E4E4EA] hover:bg-white/10'
                        }`}
                      >
                        {QUALITY_LABELS[q]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              tabIndex={-1}
              onClick={toggleFullscreen}
              aria-label={
                isFullscreen ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'
              }
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#F8F8FA] hover:text-[#67E8F9] hover:bg-white/10 transition-colors cursor-pointer"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Maximize className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
