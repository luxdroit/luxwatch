import { useMemo, useState } from 'react';
import { Check, Eye, Play, Search, Star } from 'lucide-react';
import type {
  AnimeSummary,
  ContinueWatchingItem,
  Genre,
  UserRole,
  WatchingAnimeItem,
} from '../types';
import {
  CONTINUE_WATCHING_LIMIT,
  formatTimecode,
  limitContinueWatching,
  sortAnimeAlphabetically,
} from '../utils/playerLogic';
import { CoverImage } from './CoverImage';

interface CatalogViewProps {
  animeList: AnimeSummary[];
  genres: Genre[];
  userRole: UserRole;
  featuredAnimeId: number | null;
  continueWatching: ContinueWatchingItem[];
  watchingAnimeList: WatchingAnimeItem[];
  onlyContinueTab?: boolean;
  onOpenAnime: (animeId: number) => void;
  onResumeEpisode: (animeId: number, episodeId: number) => void;
  onSetFeaturedAnime: (animeId: number | null) => Promise<void>;
}

export function CatalogView({
  animeList,
  genres,
  userRole,
  featuredAnimeId,
  continueWatching,
  watchingAnimeList,
  onlyContinueTab = false,
  onOpenAnime,
  onResumeEpisode,
  onSetFeaturedAnime,
}: CatalogViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenreId, setSelectedGenreId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [watchedFilter, setWatchedFilter] = useState<'all' | 'unwatched' | 'watched'>('all');

  const [featuredPickerOpen, setFeaturedPickerOpen] = useState(false);
  const [selectedFeaturedInput, setSelectedFeaturedInput] = useState<string>('');
  const [savingFeatured, setSavingFeatured] = useState(false);
  const [featuredError, setFeaturedError] = useState<string | null>(null);

  const sortedAnime = useMemo(
    () => sortAnimeAlphabetically(animeList),
    [animeList]
  );

  const featured = useMemo(
    () =>
      featuredAnimeId
        ? sortedAnime.find((a) => a.id === featuredAnimeId) ?? null
        : null,
    [sortedAnime, featuredAnimeId]
  );

  const filteredAnime = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedAnime.filter((item) => {
      if (q) {
        const matchesText =
          item.title.toLowerCase().includes(q) ||
          item.originalTitle.toLowerCase().includes(q) ||
          item.studio.toLowerCase().includes(q);
        if (!matchesText) return false;
      }
      if (selectedGenreId) {
        const gid = Number(selectedGenreId);
        if (!item.genres.some((g) => g.id === gid)) return false;
      }
      if (selectedStatus && item.status !== selectedStatus) {
        return false;
      }
      const isCompleted =
        item.isSeriesWatched ||
        (item.episodeCount > 0 && item.watchedEpisodeCount >= item.episodeCount);
      if (watchedFilter === 'watched' && !isCompleted) return false;
      if (watchedFilter === 'unwatched' && isCompleted) return false;
      return true;
    });
  }, [sortedAnime, searchQuery, selectedGenreId, selectedStatus, watchedFilter]);

  const limitedContinue = useMemo(
    () => limitContinueWatching(continueWatching, CONTINUE_WATCHING_LIMIT),
    [continueWatching]
  );

  const limitedWatching = useMemo(
    () => limitContinueWatching(watchingAnimeList, CONTINUE_WATCHING_LIMIT),
    [watchingAnimeList]
  );

  function openFeaturedPicker() {
    setFeaturedError(null);
    setSelectedFeaturedInput(
      featuredAnimeId ? String(featuredAnimeId) : sortedAnime[0] ? String(sortedAnime[0].id) : ''
    );
    setFeaturedPickerOpen(true);
  }

  async function handleSaveFeatured(targetId: number | null) {
    setSavingFeatured(true);
    setFeaturedError(null);
    try {
      await onSetFeaturedAnime(targetId);
      setFeaturedPickerOpen(false);
    } catch (err) {
      setFeaturedError(
        err instanceof Error
          ? err.message
          : 'Nie udało się zapisać polecanej serii.'
      );
    } finally {
      setSavingFeatured(false);
    }
  }

  if (onlyContinueTab) {
    return (
      <section className="max-w-7xl mx-auto px-3.5 sm:px-6 py-6 sm:py-10 space-y-8 sm:space-y-10">
        <div className="border-b border-white/10 pb-4 sm:pb-5 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#F8F8FA]">
              Kontynuuj oglądanie
            </h1>
            <p className="text-sm text-[#A3A8B4] mt-1.5">
              Wznów odcinki dokładnie w miejscu, w którym przerwałeś (limit {CONTINUE_WATCHING_LIMIT} pozycji).
            </p>
          </div>
          <span className="text-xs font-mono text-[#67E8F9] tabular-nums shrink-0 whitespace-nowrap">
            {limitedContinue.length} / {CONTINUE_WATCHING_LIMIT}
          </span>
        </div>

        {limitedContinue.length === 0 ? (
          <div className="bg-[#111216] border border-white/10 rounded-xl p-8 sm:p-10 text-center">
            <p className="text-[#E4E4EA] font-medium mb-2">
              Brak rozpoczętych odcinków
            </p>
            <p className="text-sm text-[#A3A8B4]">
              Rozpocznij dowolną serię z katalogu, a pojawi się tutaj wraz z postępem.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {limitedContinue.map((item) => {
              const pct = Math.min(
                100,
                Math.round(
                  (item.positionSeconds / Math.max(1, item.durationSeconds)) * 100
                )
              );
              return (
                <article
                  key={item.episodeId}
                  className="bg-[#111216] border border-white/10 rounded-xl overflow-hidden flex flex-col justify-between hover:border-[#67E8F9]/50 transition-colors"
                >
                  <div className="flex gap-4 p-4">
                    <div className="w-20 aspect-[3/4] shrink-0 rounded-lg overflow-hidden bg-[#181A20]">
                      <CoverImage
                        src={item.coverUrl}
                        alt={`Okładka ${item.animeTitle}`}
                        title={item.animeTitle}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-base font-semibold text-[#F8F8FA] truncate">
                        {item.animeTitle}
                      </h2>
                      <p className="text-xs text-[#67E8F9] mt-1 tabular-nums">
                        Odcinek {item.episodeNumber} · {item.episodeTitle}
                      </p>
                      <p className="text-xs text-[#A3A8B4] mt-2 font-mono tabular-nums">
                        {formatTimecode(item.positionSeconds)} /{' '}
                        {formatTimecode(item.durationSeconds)}
                      </p>
                    </div>
                  </div>
                  <div className="px-4 pb-4 space-y-3">
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#67E8F9]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onResumeEpisode(item.animeId, item.episodeId)
                      }
                      className="w-full min-h-[44px] py-2 px-4 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                      <span>Wznów odtwarzanie</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Currently Watching Series Subsection (under episodes) */}
        <section aria-labelledby="watching-series-tab-heading" className="space-y-4 pt-2 border-t border-white/10">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <h2
                id="watching-series-tab-heading"
                className="font-display text-xl font-semibold text-[#F8F8FA]"
              >
                Aktualnie oglądane serie
              </h2>
              <p className="text-xs sm:text-sm text-[#A3A8B4] mt-1">
                Serie oznaczone jako oglądane wraz z ostatnim oglądanym odcinkiem.
              </p>
            </div>
            <span className="text-xs font-mono text-[#67E8F9] tabular-nums shrink-0 whitespace-nowrap">
              {limitedWatching.length} / {CONTINUE_WATCHING_LIMIT}
            </span>
          </div>

          {limitedWatching.length === 0 ? (
            <div className="bg-[#111216] border border-white/10 rounded-xl p-6 text-center text-sm text-[#A3A8B4]">
              Nie oznaczono jeszcze żadnej serii jako oglądanej. Wejdź w dowolne anime i użyj przycisku „Oznacz serię jako oglądaną”.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {limitedWatching.map((item) => (
                <article
                  key={item.animeId}
                  className="bg-[#111216] border border-white/10 rounded-xl overflow-hidden flex flex-col justify-between hover:border-[#67E8F9]/50 transition-colors"
                >
                  <div className="flex gap-4 p-4">
                    <div className="w-20 aspect-[3/4] shrink-0 rounded-lg overflow-hidden bg-[#181A20]">
                      <CoverImage
                        src={item.coverUrl}
                        alt={`Okładka ${item.animeTitle}`}
                        title={item.animeTitle}
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#67E8F9]">
                        <Eye className="w-3 h-3" aria-hidden="true" />
                        <span>Aktualnie oglądana</span>
                      </span>
                      <h3 className="font-display text-base font-semibold text-[#F8F8FA] truncate">
                        {item.animeTitle}
                      </h3>
                      <p className="text-xs text-[#A3A8B4] tabular-nums">
                        Postęp: {item.watchedEpisodeCount} / {item.episodeCount} odc.
                      </p>
                      <p className="text-xs text-[#E4E4EA] line-clamp-2">
                        {item.lastWatchedEpisodeNumber !== null
                          ? `Ostatnio oglądany: Odc. ${item.lastWatchedEpisodeNumber}${
                              item.lastWatchedEpisodeTitle
                                ? ` · ${item.lastWatchedEpisodeTitle}`
                                : ''
                            }`
                          : 'Brak obejrzanych lub rozpoczętych odcinków'}
                      </p>
                    </div>
                  </div>
                  <div className="px-4 pb-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenAnime(item.animeId)}
                      className="flex-1 min-h-[42px] py-2 px-3 bg-white/10 hover:bg-white/15 text-[#F8F8FA] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      Otwórz serię
                    </button>
                    {item.lastWatchedEpisodeId !== null && (
                      <button
                        type="button"
                        onClick={() =>
                          onResumeEpisode(
                            item.animeId,
                            item.lastWatchedEpisodeId!
                          )
                        }
                        className="min-h-[42px] py-2 px-3.5 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                        <span>Odc. {item.lastWatchedEpisodeNumber}</span>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    );
  }

  return (
    <div className="pb-10 sm:pb-16">
      {/* Featured Cinema Banner (Manual Owner Selection Only) */}
      {(featured || userRole === 'owner') && (
        <section className="relative border-b border-white/10 overflow-hidden">
          <div className="absolute inset-0">
            <img
              src="/src/assets/images/hero_cinema_backdrop_1794843749537.jpg"
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover opacity-35"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#070B10] via-[#070B10]/75 to-[#070B10]/40" />
          </div>

          <div className="relative max-w-7xl mx-auto px-3.5 sm:px-6 py-8 sm:py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-center">
            {featured ? (
              <>
                <div className="lg:col-span-8 space-y-3 sm:space-y-4">
                  <p className="text-xs font-medium tracking-wide text-[#67E8F9]">
                    Polecane w prywatnej bibliotece
                  </p>
                  <h1 className="font-display text-2xl sm:text-5xl font-bold tracking-tight text-[#F8F8FA] text-balance">
                    {featured.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#A3A8B4]">
                    <span className="tabular-nums">{featured.releaseYear}</span>
                    {featured.studio && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{featured.studio}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {featured.episodeCount}{' '}
                      {featured.episodeCount === 1 ? 'odcinek' : 'odcinki'}
                    </span>
                    {featured.genres.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {featured.genres.map((g) => g.name).join(' / ')}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-sm sm:text-base text-[#D4D6DE] max-w-2xl leading-relaxed line-clamp-3">
                    {featured.synopsis ||
                      'Prywatna seria anime gotowa do odtworzenia w jakości do 2K.'}
                  </p>
                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenAnime(featured.id)}
                      className="w-full sm:w-auto min-h-[44px] justify-center px-6 py-2.5 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] font-semibold text-sm rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                      <span>Otwórz serię</span>
                    </button>

                    {userRole === 'owner' && (
                      <button
                        type="button"
                        onClick={() =>
                          featuredPickerOpen
                            ? setFeaturedPickerOpen(false)
                            : openFeaturedPicker()
                        }
                        className="w-full sm:w-auto min-h-[44px] justify-center px-4 py-2.5 bg-[#111216]/90 hover:bg-[#181A20] border border-white/20 hover:border-[#67E8F9]/60 text-[#F8F8FA] font-medium text-sm rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
                      >
                        <Star className="w-4 h-4 text-[#67E8F9]" aria-hidden="true" />
                        <span>Zmień polecaną serię</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="hidden lg:block lg:col-span-4 justify-self-end">
                  <div className="w-56 aspect-[3/4] rounded-xl overflow-hidden border border-[#67E8F9]/30 shadow-2xl">
                    <CoverImage
                      src={featured.coverUrl}
                      alt={`Okładka ${featured.title}`}
                      title={featured.title}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="lg:col-span-12 space-y-3">
                <p className="text-xs font-medium tracking-wide text-[#67E8F9]">
                  Polecane w prywatnej bibliotece
                </p>
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#F8F8FA]">
                  Nie wybrano jeszcze polecanej serii
                </h1>
                <p className="text-sm text-[#A3A8B4] max-w-2xl">
                  Polecana seria nie wybiera się automatycznie. Jako Owner możesz
                  wskazać serię, która będzie wyświetlać się wszystkim
                  użytkownikom na stronie głównej.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={sortedAnime.length === 0}
                    onClick={() =>
                      featuredPickerOpen
                        ? setFeaturedPickerOpen(false)
                        : openFeaturedPicker()
                    }
                    className="min-h-[44px] px-5 py-2.5 bg-[#67E8F9] hover:bg-[#A5F3FC] disabled:opacity-50 text-[#070B10] font-semibold text-sm rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Star className="w-4 h-4" aria-hidden="true" />
                    <span>Wybierz polecaną serię</span>
                  </button>
                </div>
              </div>
            )}

            {userRole === 'owner' && featuredPickerOpen && (
              <div className="lg:col-span-12 bg-[#111216]/95 border border-[#67E8F9]/40 rounded-xl p-4 sm:p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor="featured-anime-select"
                      className="block text-xs font-semibold text-[#67E8F9] mb-1.5"
                    >
                      Wybierz serię polecaną na stronie głównej
                    </label>
                    <select
                      id="featured-anime-select"
                      value={selectedFeaturedInput}
                      onChange={(e) => setSelectedFeaturedInput(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                    >
                      {sortedAnime.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title} ({a.releaseYear})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={savingFeatured || !selectedFeaturedInput}
                      onClick={() =>
                        void handleSaveFeatured(Number(selectedFeaturedInput))
                      }
                      className="min-h-[44px] px-4 py-2 bg-[#67E8F9] hover:bg-[#A5F3FC] disabled:opacity-50 text-[#070B10] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      {savingFeatured ? 'Zapisywanie...' : 'Ustaw jako polecaną'}
                    </button>
                    {featured && (
                      <button
                        type="button"
                        disabled={savingFeatured}
                        onClick={() => void handleSaveFeatured(null)}
                        className="min-h-[44px] px-3.5 py-2 bg-red-950/60 hover:bg-red-950 border border-red-500/35 text-red-200 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                      >
                        Usuń polecenie
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFeaturedPickerOpen(false)}
                      className="min-h-[44px] px-3.5 py-2 bg-white/10 hover:bg-white/15 text-[#F8F8FA] text-xs font-medium rounded-lg transition-colors cursor-pointer"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
                {featuredError && (
                  <p role="alert" className="text-xs text-red-300">
                    {featuredError}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 pt-6 sm:pt-10 space-y-8 sm:space-y-12">
        {/* Continue Watching Shelf + Currently Watching Series Under Episodes */}
        {(limitedContinue.length > 0 || limitedWatching.length > 0) && (
          <section aria-labelledby="continue-heading" className="space-y-6">
            {limitedContinue.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2
                    id="continue-heading"
                    className="font-display text-lg sm:text-xl font-semibold text-[#F8F8FA]"
                  >
                    Kontynuuj oglądanie
                  </h2>
                  <span className="text-xs text-[#A3A8B4] tabular-nums">
                    {limitedContinue.length} / {CONTINUE_WATCHING_LIMIT}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                  {limitedContinue.map((item) => {
                    const pct = Math.min(
                      100,
                      Math.round(
                        (item.positionSeconds /
                          Math.max(1, item.durationSeconds)) *
                          100
                      )
                    );
                    return (
                      <button
                        key={item.episodeId}
                        type="button"
                        onClick={() =>
                          onResumeEpisode(item.animeId, item.episodeId)
                        }
                        className="group text-left bg-[#111216] border border-white/10 hover:border-[#67E8F9]/60 rounded-xl p-3.5 flex items-center gap-4 transition-colors cursor-pointer"
                      >
                        <div className="w-14 aspect-[3/4] rounded-lg overflow-hidden shrink-0 bg-[#181A20]">
                          <CoverImage
                            src={item.coverUrl}
                            alt={item.animeTitle}
                            title={item.animeTitle}
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="text-sm font-semibold text-[#F8F8FA] truncate group-hover:text-[#67E8F9] transition-colors">
                            {item.animeTitle}
                          </div>
                          <div className="text-xs text-[#A3A8B4] truncate tabular-nums">
                            Odc. {item.episodeNumber} ·{' '}
                            {formatTimecode(item.positionSeconds)} /{' '}
                            {formatTimecode(item.durationSeconds)}
                          </div>
                          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#67E8F9]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {limitedWatching.length > 0 && (
              <div className="space-y-3.5">
                <div className="flex items-baseline justify-between">
                  <h3
                    id={limitedContinue.length === 0 ? 'continue-heading' : 'watching-series-heading'}
                    className="font-display text-base sm:text-lg font-semibold text-[#F8F8FA]"
                  >
                    Aktualnie oglądane serie
                  </h3>
                  <span className="text-xs text-[#A3A8B4] tabular-nums shrink-0 whitespace-nowrap">
                    {limitedWatching.length} / {CONTINUE_WATCHING_LIMIT}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                  {limitedWatching.map((item) => (
                    <button
                      key={item.animeId}
                      type="button"
                      onClick={() => onOpenAnime(item.animeId)}
                      className="group text-left bg-[#111216] border border-white/10 hover:border-[#67E8F9]/60 rounded-xl p-3.5 flex items-center gap-4 transition-colors cursor-pointer"
                    >
                      <div className="w-14 aspect-[3/4] rounded-lg overflow-hidden shrink-0 bg-[#181A20]">
                        <CoverImage
                          src={item.coverUrl}
                          alt={item.animeTitle}
                          title={item.animeTitle}
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-sm font-semibold text-[#F8F8FA] truncate group-hover:text-[#67E8F9] transition-colors">
                          {item.animeTitle}
                        </div>
                        <div className="text-xs text-[#67E8F9] truncate">
                          {item.lastWatchedEpisodeNumber !== null
                            ? `Ostatnio oglądany: Odc. ${item.lastWatchedEpisodeNumber}${
                                item.lastWatchedEpisodeTitle
                                  ? ` · ${item.lastWatchedEpisodeTitle}`
                                  : ''
                              }`
                            : 'Brak rozpoczętych odcinków'}
                        </div>
                        <div className="text-[11px] text-[#A3A8B4] tabular-nums">
                          Obejrzano {item.watchedEpisodeCount} / {item.episodeCount} odc.
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Search & Filters Toolbar */}
        <section aria-labelledby="catalog-heading" className="space-y-5 sm:space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-white/10 pb-4 sm:pb-5">
            <div>
              <h2
                id="catalog-heading"
                className="font-display text-xl sm:text-2xl font-semibold text-[#F8F8FA]"
              >
                Biblioteka Anime
              </h2>
              <p className="text-sm text-[#A3A8B4] mt-1 tabular-nums">
                Wyświetlono {filteredAnime.length} z {animeList.length} serii
              </p>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 sm:gap-3 w-full lg:w-auto">
              <div className="relative col-span-2 sm:min-w-[230px] sm:flex-none">
                <Search
                  className="w-4 h-4 text-[#A3A8B4] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <label htmlFor="catalog-search" className="sr-only">
                  Szukaj anime
                </label>
                <input
                  id="catalog-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Szukaj tytułu lub studia..."
                  className="w-full min-h-[44px] pl-9 pr-3.5 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA] placeholder-[#6E7382] focus:outline-none focus:border-[#67E8F9]"
                />
              </div>

              <div className="col-span-1">
                <label htmlFor="genre-filter" className="sr-only">
                  Filtruj po gatunku
                </label>
                <select
                  id="genre-filter"
                  value={selectedGenreId}
                  onChange={(e) => setSelectedGenreId(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                >
                  <option value="">Wszystkie gatunki</option>
                  {genres.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-1">
                <label htmlFor="status-filter" className="sr-only">
                  Filtruj po statusie
                </label>
                <select
                  id="status-filter"
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                >
                  <option value="">Wszystkie statusy</option>
                  <option value="Zakończone">Zakończone</option>
                  <option value="Emitowane">Emitowane</option>
                  <option value="Planowane">Planowane</option>
                </select>
              </div>

              <div
                className="col-span-2 flex items-center bg-[#111216] border border-white/15 rounded-lg p-1"
                role="group"
                aria-label="Filtr obejrzanych"
              >
                {(
                  [
                    { id: 'all', label: 'Wszystkie' },
                    { id: 'unwatched', label: 'Do obejrzenia' },
                    { id: 'watched', label: 'Obejrzane' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setWatchedFilter(tab.id)}
                    className={`flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      watchedFilter === tab.id
                        ? 'bg-[#67E8F9] text-[#070B10]'
                        : 'text-[#A3A8B4] hover:text-[#F8F8FA]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredAnime.length === 0 ? (
            <div className="bg-[#111216] border border-white/10 rounded-xl p-10 sm:p-12 text-center space-y-3">
              <p className="text-base font-medium text-[#F8F8FA]">
                Brak serii spełniających kryteria wyszukiwania
              </p>
              <p className="text-sm text-[#A3A8B4]">
                Zmień frazę wyszukiwania lub wyczyść aktywne filtry gatunków.
              </p>
              {(searchQuery || selectedGenreId || selectedStatus || watchedFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedGenreId('');
                    setSelectedStatus('');
                    setWatchedFilter('all');
                  }}
                  className="mt-2 min-h-[40px] px-4 py-2 text-xs font-semibold bg-white/10 hover:bg-white/15 text-[#F8F8FA] rounded-lg transition-colors cursor-pointer"
                >
                  Wyczyść filtry
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-6">
              {filteredAnime.map((anime) => {
                const isCompleted =
                  anime.isSeriesWatched ||
                  (anime.episodeCount > 0 &&
                    anime.watchedEpisodeCount >= anime.episodeCount);
                return (
                  <button
                    key={anime.id}
                    type="button"
                    onClick={() => onOpenAnime(anime.id)}
                    className="group text-left flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67E8F9] rounded-xl cursor-pointer"
                  >
                    <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden bg-[#111216] border border-white/10 group-hover:border-[#67E8F9]/70 transition-colors">
                      <CoverImage
                        src={anime.coverUrl}
                        alt={`Okładka ${anime.title}`}
                        title={anime.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    </div>
                    <div className="pt-3 space-y-1">
                      <h3 className="font-display text-sm sm:text-base font-semibold text-[#F8F8FA] group-hover:text-[#67E8F9] transition-colors line-clamp-2">
                        {anime.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#A3A8B4]">
                        <span className="tabular-nums">{anime.releaseYear}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {anime.episodeCount} odc.
                        </span>
                        {isCompleted && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#67E8F9] inline-flex items-center gap-1 font-medium">
                              <Check className="w-3 h-3" aria-hidden="true" />
                              Obejrzane
                            </span>
                          </>
                        )}
                      </div>
                      {anime.genres.length > 0 && (
                        <p className="text-xs text-[#737887] truncate">
                          {anime.genres.map((g) => g.name).join(' · ')}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
