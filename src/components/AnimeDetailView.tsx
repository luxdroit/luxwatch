import { ArrowLeft, Check, Play } from 'lucide-react';
import type { AnimeDetail, Episode } from '../types';
import {
  DUB_LABELS,
  formatTimecode,
  SUB_LABELS,
} from '../utils/playerLogic';
import { CoverImage } from './CoverImage';

interface AnimeDetailViewProps {
  anime: AnimeDetail;
  onBack: () => void;
  onPlayEpisode: (episodeId: number) => void;
  onOpenRelatedAnime: (animeId: number) => void;
  onToggleSeriesWatched: (animeId: number, watched: boolean) => Promise<void>;
  onToggleEpisodeWatched: (episodeId: number, watched: boolean) => Promise<void>;
}

export function AnimeDetailView({
  anime,
  onBack,
  onPlayEpisode,
  onOpenRelatedAnime,
  onToggleSeriesWatched,
  onToggleEpisodeWatched,
}: AnimeDetailViewProps) {
  const isCompleted =
    anime.isSeriesWatched ||
    (anime.episodeCount > 0 &&
      anime.watchedEpisodeCount >= anime.episodeCount);

  const firstUnwatched =
    anime.episodes.find((ep) => !ep.watched && ep.variants.length > 0) ||
    anime.episodes.find((ep) => ep.variants.length > 0) ||
    null;

  function summarizeVariants(ep: Episode): string {
    if (ep.variants.length === 0) return 'Brak wgranych plików wideo';
    return ep.variants
      .map(
        (v) =>
          `${v.audioDub.toUpperCase()} (${SUB_LABELS[v.subtitleMode]})`
      )
      .join(' · ');
  }

  return (
    <div className="max-w-7xl mx-auto px-3.5 sm:px-6 py-5 sm:py-8 space-y-8 sm:space-y-12">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 min-h-[40px] text-sm text-[#A3A8B4] hover:text-[#F8F8FA] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Powrót do katalogu</span>
        </button>
      </div>

      {/* Hero Detail Split */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 items-start">
        <div className="md:col-span-4 lg:col-span-3">
          <div className="max-w-[200px] sm:max-w-[240px] md:max-w-none mx-auto md:mx-0 aspect-[3/4] rounded-xl overflow-hidden border border-white/10 bg-[#111216]">
            <CoverImage
              src={anime.coverUrl}
              alt={`Okładka ${anime.title}`}
              title={anime.title}
            />
          </div>
        </div>

        <div className="md:col-span-8 lg:col-span-9 space-y-4 sm:space-y-5">
          <div>
            {anime.originalTitle && (
              <p className="text-xs font-medium text-[#67E8F9] mb-1.5">
                {anime.originalTitle}
              </p>
            )}
            <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-[#F8F8FA] text-balance">
              {anime.title}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#A3A8B4]">
            <span className="tabular-nums">{anime.releaseYear}</span>
            {anime.studio && (
              <>
                <span aria-hidden="true">·</span>
                <span>{anime.studio}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{anime.status}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              Obejrzano {anime.watchedEpisodeCount} / {anime.episodeCount} odc.
            </span>
          </div>

          {anime.genres.length > 0 && (
            <div className="text-sm text-[#67E8F9]">
              {anime.genres.map((g) => g.name).join(' · ')}
            </div>
          )}

          <p className="text-sm sm:text-base text-[#D4D6DE] leading-relaxed max-w-3xl">
            {anime.synopsis || 'Brak opisu dla tej serii.'}
          </p>

          <div className="pt-2 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
            {firstUnwatched && (
              <button
                type="button"
                onClick={() => onPlayEpisode(firstUnwatched.id)}
                className="w-full sm:w-auto min-h-[44px] justify-center px-6 py-2.5 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#09090B] font-semibold text-sm rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>
                  Oglądaj odcinek {firstUnwatched.episodeNumber}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onToggleSeriesWatched(anime.id, !isCompleted)}
              className={`w-full sm:w-auto min-h-[44px] justify-center px-5 py-2.5 text-sm font-medium rounded-lg border inline-flex items-center gap-2 transition-colors cursor-pointer ${
                isCompleted
                  ? 'bg-[#67E8F9]/15 border-[#67E8F9] text-[#67E8F9] hover:bg-[#67E8F9]/25'
                  : 'bg-[#111216] border-white/15 text-[#F8F8FA] hover:border-white/30'
              }`}
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              <span>
                {isCompleted
                  ? 'Seria oznaczona jako obejrzana'
                  : 'Oznacz całą serię jako obejrzaną'}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Related Anime Section */}
      {anime.relations.length > 0 && (
        <section aria-labelledby="relations-heading" className="space-y-4">
          <h2
            id="relations-heading"
            className="font-display text-xl font-semibold text-[#F8F8FA]"
          >
            Powiązane serie
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
            {anime.relations.map((rel) => (
              <button
                key={rel.id}
                type="button"
                onClick={() => onOpenRelatedAnime(rel.targetAnimeId)}
                className="group text-left bg-[#111216] border border-white/10 hover:border-[#67E8F9]/60 rounded-xl p-3.5 flex items-center gap-4 transition-colors cursor-pointer"
              >
                <div className="w-14 aspect-[3/4] rounded-lg overflow-hidden shrink-0 bg-[#181A20]">
                  <CoverImage
                    src={rel.targetCoverUrl}
                    alt={rel.targetTitle}
                    title={rel.targetTitle}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-[#67E8F9]">
                    {rel.relationType}
                  </div>
                  <div className="text-sm font-semibold text-[#F8F8FA] group-hover:text-[#67E8F9] transition-colors truncate mt-0.5">
                    {rel.targetTitle}
                  </div>
                  <div className="text-xs text-[#A3A8B4] tabular-nums mt-0.5">
                    {rel.targetYear}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Episodes List */}
      <section aria-labelledby="episodes-heading" className="space-y-4">
        <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
          <h2
            id="episodes-heading"
            className="font-display text-xl font-semibold text-[#F8F8FA]"
          >
            Odcinki
          </h2>
          <span className="text-xs text-[#A3A8B4] tabular-nums">
            {anime.episodes.length}{' '}
            {anime.episodes.length === 1 ? 'odcinek' : 'odcinki'}
          </span>
        </div>

        {anime.episodes.length === 0 ? (
          <div className="bg-[#111216] border border-white/10 rounded-xl p-8 text-center text-sm text-[#A3A8B4]">
            Administrator nie dodał jeszcze odcinków do tej serii.
          </div>
        ) : (
          <div className="divide-y divide-white/10 bg-[#111216] border border-white/10 rounded-xl overflow-hidden">
            {anime.episodes.map((ep) => (
              <div
                key={ep.id}
                className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-[#67E8F9] tabular-nums shrink-0">
                      #{String(ep.episodeNumber).padStart(2, '0')}
                    </span>
                    <h3 className="font-display text-base font-semibold text-[#F8F8FA] truncate">
                      {ep.title}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#A3A8B4]">
                    <span className="font-mono tabular-nums">
                      {formatTimecode(ep.durationSeconds)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{summarizeVariants(ep)}</span>
                    {ep.introStart !== null && ep.introEnd !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Intro {formatTimecode(ep.introStart)}–
                          {formatTimecode(ep.introEnd)}
                        </span>
                      </>
                    )}
                    {ep.progressSeconds > 0 && !ep.watched && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#67E8F9] font-mono tabular-nums">
                          Zatrzymano na {formatTimecode(ep.progressSeconds)}
                        </span>
                      </>
                    )}
                  </div>

                  {ep.synopsis && (
                    <p className="text-xs text-[#8D92A0] line-clamp-2 pt-0.5">
                      {ep.synopsis}
                    </p>
                  )}

                  {ep.variants.length > 0 && (
                    <p className="text-xs text-[#737887]">
                      Dostępne audio:{' '}
                      {Array.from(
                        new Set(ep.variants.map((v) => DUB_LABELS[v.audioDub]))
                      ).join(', ')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2.5 sm:gap-3 w-full sm:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleEpisodeWatched(ep.id, !ep.watched)}
                    aria-label={
                      ep.watched
                        ? `Odznacz odcinek ${ep.episodeNumber} jako nieobejrzany`
                        : `Oznacz odcinek ${ep.episodeNumber} jako obejrzany`
                    }
                    className={`flex-1 sm:flex-none min-h-[42px] justify-center px-3 py-2 text-xs font-medium rounded-lg border inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                      ep.watched
                        ? 'bg-[#67E8F9]/15 border-[#67E8F9]/60 text-[#67E8F9]'
                        : 'bg-[#09090B] border-white/15 text-[#A3A8B4] hover:text-[#F8F8FA]'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{ep.watched ? 'Obejrzane' : 'Oznacz'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={ep.variants.length === 0}
                    onClick={() => onPlayEpisode(ep.id)}
                    className="flex-1 sm:flex-none min-h-[42px] justify-center px-4 py-2 bg-[#67E8F9] hover:bg-[#A5F3FC] disabled:opacity-40 disabled:cursor-not-allowed text-[#09090B] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    <span>Odtwarzaj</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
