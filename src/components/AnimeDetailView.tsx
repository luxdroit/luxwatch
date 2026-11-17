import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, Check, Edit3, Eye, Play, Plus, X } from 'lucide-react';
import { api } from '../api/client';
import type { AnimeDetail, Episode, Genre } from '../types';
import {
  DUB_LABELS,
  formatTimecode,
  SUB_LABELS,
} from '../utils/playerLogic';
import { CoverImage } from './CoverImage';

interface AnimeDetailViewProps {
  anime: AnimeDetail;
  genres: Genre[];
  canEdit: boolean;
  onBack: () => void;
  onPlayEpisode: (episodeId: number) => void;
  onOpenRelatedAnime: (animeId: number) => void;
  onToggleSeriesWatched: (animeId: number, watched: boolean) => Promise<void>;
  onToggleSeriesWatching: (animeId: number, watching: boolean) => Promise<void>;
  onToggleEpisodeWatched: (episodeId: number, watched: boolean) => Promise<void>;
  onRefreshAnime: () => Promise<void>;
}

export function AnimeDetailView({
  anime,
  genres,
  canEdit,
  onBack,
  onPlayEpisode,
  onOpenRelatedAnime,
  onToggleSeriesWatched,
  onToggleSeriesWatching,
  onToggleEpisodeWatched,
  onRefreshAnime,
}: AnimeDetailViewProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(anime.title);
  const [editOriginalTitle, setEditOriginalTitle] = useState(
    anime.originalTitle
  );
  const [editStudio, setEditStudio] = useState(anime.studio);
  const [editReleaseYear, setEditReleaseYear] = useState(
    String(anime.releaseYear)
  );
  const [editStatus, setEditStatus] = useState<AnimeDetail['status']>(
    anime.status
  );
  const [editSynopsis, setEditSynopsis] = useState(anime.synopsis);
  const [editGenreIds, setEditGenreIds] = useState<number[]>(
    anime.genres.map((g) => g.id)
  );
  const [editCoverPath, setEditCoverPath] = useState('');
  const [editCoverPreviewUrl, setEditCoverPreviewUrl] = useState('');
  const [editCoverName, setEditCoverName] = useState('');
  const [uploadingCover, setUploadingCover] = useState(false);

  const [newGenreName, setNewGenreName] = useState('');
  const [addingGenre, setAddingGenre] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setEditError(null);
    setEditSuccess(null);
  }, [anime.id]);

  function openEditForm() {
    setEditTitle(anime.title);
    setEditOriginalTitle(anime.originalTitle);
    setEditStudio(anime.studio);
    setEditReleaseYear(String(anime.releaseYear));
    setEditStatus(anime.status);
    setEditSynopsis(anime.synopsis);
    setEditGenreIds(anime.genres.map((g) => g.id));
    setEditCoverPath('');
    setEditCoverPreviewUrl('');
    setEditCoverName('');
    setNewGenreName('');
    setEditError(null);
    setEditSuccess(null);
    setEditing(true);
  }

  async function handleCoverUpload(file: File) {
    setEditError(null);
    setUploadingCover(true);
    try {
      const res = await api.uploadCover(file);
      setEditCoverPath(res.coverPath);
      setEditCoverPreviewUrl(res.coverUrl);
      setEditCoverName(file.name);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Błąd przesyłania okładki.'
      );
    } finally {
      setUploadingCover(false);
    }
  }

  async function handleAddNewGenre() {
    const trimmed = newGenreName.trim();
    if (trimmed.length < 2) {
      setEditError('Nazwa gatunku musi mieć minimum 2 znaki.');
      return;
    }
    setEditError(null);
    setAddingGenre(true);
    try {
      const { genre } = await api.createGenre(trimmed);
      setEditGenreIds((prev) =>
        prev.includes(genre.id) ? prev : [...prev, genre.id]
      );
      setNewGenreName('');
      await onRefreshAnime();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Nie udało się dodać gatunku.'
      );
    } finally {
      setAddingGenre(false);
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    setEditError(null);
    if (!editTitle.trim()) {
      setEditError('Tytuł anime nie może być pusty.');
      return;
    }
    setSavingEdit(true);
    try {
      await api.updateAnime(anime.id, {
        title: editTitle.trim(),
        originalTitle: editOriginalTitle.trim(),
        synopsis: editSynopsis.trim(),
        releaseYear: Number(editReleaseYear) || anime.releaseYear,
        studio: editStudio.trim(),
        status: editStatus,
        coverPath: editCoverPath || undefined,
        genreIds: editGenreIds,
      });
      await onRefreshAnime();
      setEditing(false);
      setEditSuccess('Zapisano zmiany w danych serii anime.');
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : 'Nie udało się zapisać zmian serii.'
      );
    } finally {
      setSavingEdit(false);
    }
  }

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

            <button
              type="button"
              onClick={() =>
                onToggleSeriesWatching(anime.id, !anime.isSeriesWatching)
              }
              aria-pressed={anime.isSeriesWatching}
              className={`w-full sm:w-auto min-h-[44px] justify-center px-5 py-2.5 text-sm font-medium rounded-lg border inline-flex items-center gap-2 transition-colors cursor-pointer ${
                anime.isSeriesWatching
                  ? 'bg-[#67E8F9]/15 border-[#67E8F9] text-[#67E8F9] hover:bg-[#67E8F9]/25'
                  : 'bg-[#111216] border-white/15 text-[#F8F8FA] hover:border-white/30'
              }`}
            >
              <Eye className="w-4 h-4" aria-hidden="true" />
              <span>
                {anime.isSeriesWatching
                  ? 'Aktualnie oglądana'
                  : 'Oznacz serię jako oglądaną'}
              </span>
            </button>

            {canEdit && (
              <button
                type="button"
                onClick={() => (editing ? setEditing(false) : openEditForm())}
                aria-expanded={editing}
                className={`w-full sm:w-auto min-h-[44px] justify-center px-5 py-2.5 text-sm font-medium rounded-lg border inline-flex items-center gap-2 transition-colors cursor-pointer ${
                  editing
                    ? 'bg-[#67E8F9]/15 border-[#67E8F9] text-[#67E8F9]'
                    : 'bg-[#111216] border-white/15 text-[#F8F8FA] hover:border-[#67E8F9]/70 hover:text-[#67E8F9]'
                }`}
              >
                <Edit3 className="w-4 h-4" aria-hidden="true" />
                <span>Edytuj</span>
              </button>
            )}
          </div>

          {editSuccess && !editing && (
            <div
              role="status"
              className="p-3 rounded-lg bg-[#67E8F9]/15 border border-[#67E8F9]/40 text-xs text-[#CFFAFE] max-w-3xl"
            >
              {editSuccess}
            </div>
          )}
        </div>
      </section>

      {/* Owner & Admin Inline Anime Edit Form */}
      {canEdit && editing && (
        <section
          aria-labelledby="edit-anime-heading"
          className="bg-[#111216] border border-[#67E8F9]/40 rounded-xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3.5">
            <div>
              <h2
                id="edit-anime-heading"
                className="font-display text-lg sm:text-xl font-semibold text-[#F8F8FA]"
              >
                Edytuj dane serii
              </h2>
              <p className="text-xs text-[#A3A8B4] mt-0.5">
                Zmieniaj nazwę, opis, okładkę, gatunki oraz pozostałe informacje o serii.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="Zamknij formularz edycji"
              className="p-2 text-[#A3A8B4] hover:text-[#F8F8FA] rounded-lg hover:bg-white/5 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {editError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-950/50 border border-red-500/40 text-xs text-red-200"
            >
              {editError}
            </div>
          )}

          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="edit-anime-title"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Tytuł główny
                </label>
                <input
                  id="edit-anime-title"
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-anime-original"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Tytuł oryginalny
                </label>
                <input
                  id="edit-anime-original"
                  type="text"
                  value={editOriginalTitle}
                  onChange={(e) => setEditOriginalTitle(e.target.value)}
                  placeholder="Japoński / angielski"
                  className="w-full min-h-[42px] px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="edit-anime-studio"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Studio
                </label>
                <input
                  id="edit-anime-studio"
                  type="text"
                  value={editStudio}
                  onChange={(e) => setEditStudio(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-anime-year"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Rok premiery
                </label>
                <input
                  id="edit-anime-year"
                  type="number"
                  min="1960"
                  max="2040"
                  value={editReleaseYear}
                  onChange={(e) => setEditReleaseYear(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm font-mono tabular-nums text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-anime-status"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Status
                </label>
                <select
                  id="edit-anime-status"
                  value={editStatus}
                  onChange={(e) =>
                    setEditStatus(e.target.value as AnimeDetail['status'])
                  }
                  className="w-full min-h-[42px] px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                >
                  <option value="Emitowane">Emitowane</option>
                  <option value="Zakończone">Zakończone</option>
                  <option value="Planowane">Planowane</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="edit-anime-synopsis"
                className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
              >
                Opis fabuły
              </label>
              <textarea
                id="edit-anime-synopsis"
                rows={4}
                value={editSynopsis}
                onChange={(e) => setEditSynopsis(e.target.value)}
                className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
              />
            </div>

            <div className="space-y-2.5">
              <span className="block text-xs font-medium text-[#E4E4EA]">
                Gatunki (kliknij, aby dodać lub usunąć z tej serii)
              </span>
              <div className="flex flex-wrap gap-2">
                {genres.map((g) => {
                  const selected = editGenreIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setEditGenreIds((prev) =>
                          selected
                            ? prev.filter((id) => id !== g.id)
                            : [...prev, g.id]
                        )
                      }
                      className={`px-3 py-1.5 text-xs rounded-lg border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#67E8F9] border-[#67E8F9] text-[#070B10] font-semibold'
                          : 'bg-[#09090B] border-white/15 text-[#A3A8B4] hover:text-[#F8F8FA]'
                      }`}
                    >
                      <span>{g.name}</span>
                      {selected ? (
                        <X className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <Plus className="w-3 h-3" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-1 max-w-md">
                <label htmlFor="edit-new-genre" className="sr-only">
                  Dodaj nowy gatunek
                </label>
                <input
                  id="edit-new-genre"
                  type="text"
                  value={newGenreName}
                  onChange={(e) => setNewGenreName(e.target.value)}
                  placeholder="Nowy gatunek (np. Mecha)"
                  className="flex-1 min-h-[38px] px-3 py-1.5 bg-[#09090B] border border-white/15 rounded-lg text-xs text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                />
                <button
                  type="button"
                  disabled={addingGenre || !newGenreName.trim()}
                  onClick={() => void handleAddNewGenre()}
                  className="min-h-[38px] px-3.5 py-1.5 bg-white/10 hover:bg-white/15 disabled:opacity-45 text-[#F8F8FA] text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{addingGenre ? 'Dodawanie...' : 'Dodaj gatunek'}</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="edit-anime-cover"
                className="block text-xs font-medium text-[#E4E4EA]"
              >
                Zmień okładkę (JPG / PNG / WebP)
              </label>
              <div className="flex flex-wrap items-center gap-4">
                {(editCoverPreviewUrl || anime.coverUrl) && (
                  <div className="w-16 aspect-[3/4] rounded-lg overflow-hidden border border-white/15 bg-[#09090B] shrink-0">
                    <CoverImage
                      src={editCoverPreviewUrl || anime.coverUrl}
                      alt={`Podgląd okładki ${editTitle || anime.title}`}
                      title={editTitle || anime.title}
                    />
                  </div>
                )}
                <div className="flex-1 min-w-[200px] space-y-1">
                  <input
                    id="edit-anime-cover"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploadingCover}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleCoverUpload(file);
                    }}
                    className="block w-full text-xs text-[#A3A8B4] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-white/15 file:bg-[#09090B] file:text-[#F8F8FA] hover:file:border-[#67E8F9]"
                  />
                  {uploadingCover && (
                    <p className="text-xs text-[#67E8F9]">
                      Wgrywanie nowej okładki...
                    </p>
                  )}
                  {editCoverName && !uploadingCover && (
                    <p className="text-xs text-[#67E8F9]">
                      Wybrano nową okładkę: {editCoverName}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={savingEdit || uploadingCover}
                className="min-h-[42px] px-5 py-2 bg-[#67E8F9] hover:bg-[#A5F3FC] disabled:opacity-55 text-[#070B10] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>{savingEdit ? 'Zapisywanie...' : 'Zapisz zmiany'}</span>
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="min-h-[42px] px-4 py-2 bg-white/10 hover:bg-white/15 text-[#F8F8FA] text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Anuluj
              </button>
            </div>
          </form>
        </section>
      )}

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
