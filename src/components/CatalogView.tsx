import { useMemo, useState } from 'react';
import { Check, Play, Search } from 'lucide-react';
import type { AnimeSummary, ContinueWatchingItem, Genre } from '../types';
import { formatTimecode } from '../utils/playerLogic';
import { CoverImage } from './CoverImage';

interface CatalogViewProps {
  animeList: AnimeSummary[];
  genres: Genre[];
  continueWatching: ContinueWatchingItem[];
  onlyContinueTab?: boolean;
  onOpenAnime: (animeId: number) => void;
  onResumeEpisode: (animeId: number, episodeId: number) => void;
}

export function CatalogView({
  animeList,
  genres,
  continueWatching,
  onlyContinueTab = false,
  onOpenAnime,
  onResumeEpisode,
}: CatalogViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenreId, setSelectedGenreId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [watchedFilter, setWatchedFilter] = useState<'all' | 'unwatched' | 'watched'>('all');

  const featured =
    animeList.find((a) => a.episodeCount >= 2) || animeList[0] || null;

  const filteredAnime = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return animeList.filter((item) => {
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
  }, [animeList, searchQuery, selectedGenreId, selectedStatus, watchedFilter]);

  if (onlyContinueTab) {
    return (
      <section className="max-w-7xl mx-auto px-3.5 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <div className="border-b border-white/10 pb-4 sm:pb-5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#F8F8FA]">
            Kontynuuj oglądanie
          </h1>
          <p className="text-sm text-[#A3A8B4] mt-1.5">
            Wznów odcinki dokładnie w miejscu, w którym przerwałeś.
          </p>
        </div>

        {continueWatching.length === 0 ? (
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
            {continueWatching.map((item) => {
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
      </section>
    );
  }

  return (
    <div className="pb-10 sm:pb-16">
      {/* Featured Cinema Banner */}
      {featured && (
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
              <div className="pt-2 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => onOpenAnime(featured.id)}
                  className="w-full sm:w-auto min-h-[44px] justify-center px-6 py-2.5 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] font-semibold text-sm rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  <span>Otwórz serię</span>
                </button>
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
          </div>
        </section>
      )}

      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 pt-6 sm:pt-10 space-y-8 sm:space-y-12">
        {/* Continue Watching Shelf */}
        {continueWatching.length > 0 && (
          <section aria-labelledby="continue-heading" className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2
                id="continue-heading"
                className="font-display text-lg sm:text-xl font-semibold text-[#F8F8FA]"
              >
                Kontynuuj oglądanie
              </h2>
              <span className="text-xs text-[#A3A8B4] tabular-nums">
                {continueWatching.length}{' '}
                {continueWatching.length === 1 ? 'pozycja' : 'pozycje'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
              {continueWatching.slice(0, 6).map((item) => {
                const pct = Math.min(
                  100,
                  Math.round(
                    (item.positionSeconds / Math.max(1, item.durationSeconds)) *
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
