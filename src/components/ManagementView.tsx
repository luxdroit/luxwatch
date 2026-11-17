import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link2, Plus, Trash2, Upload, UserPlus } from 'lucide-react';
import { api } from '../api/client';
import type {
  AnimeDetail,
  AnimeSummary,
  AudioDub,
  Genre,
  QualityTier,
  SubtitleMode,
  UserAccount,
  UserRole,
} from '../types';
import {
  buildLuxSourceDriveUrl,
  DUB_LABELS,
  extractGoogleDriveFileId,
  formatBytes,
  formatTimecode,
  parseTimecodeToSeconds,
  SUB_LABELS,
} from '../utils/playerLogic';
import { canDeleteUser } from '../utils/rbacLogic';

interface ManagementViewProps {
  currentUser: UserAccount;
  animeList: AnimeSummary[];
  genres: Genre[];
  onRefreshAll: () => Promise<void>;
}

type StudioTab = 'content' | 'relations' | 'users';
type UploadMode = 'file' | 'external';

export function ManagementView({
  currentUser,
  animeList,
  genres,
  onRefreshAll,
}: ManagementViewProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>('content');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [selectedAnimeId, setSelectedAnimeId] = useState<number | null>(
    animeList[0]?.id ?? null
  );
  const [selectedAnimeDetail, setSelectedAnimeDetail] =
    useState<AnimeDetail | null>(null);

  // Create Anime Form
  const [newTitle, setNewTitle] = useState('');
  const [newOriginalTitle, setNewOriginalTitle] = useState('');
  const [newSynopsis, setNewSynopsis] = useState('');
  const [newYear, setNewYear] = useState('2026');
  const [newStudio, setNewStudio] = useState('');
  const [newStatus, setNewStatus] = useState('Emitowane');
  const [newGenreIds, setNewGenreIds] = useState<number[]>([]);
  const [newCoverPath, setNewCoverPath] = useState('');
  const [coverPreviewName, setCoverPreviewName] = useState('');

  // Episode Form
  const [epNumber, setEpNumber] = useState('1');
  const [epTitle, setEpTitle] = useState('');
  const [epSynopsis, setEpSynopsis] = useState('');
  const [epIntroStart, setEpIntroStart] = useState('00:00');
  const [epIntroEnd, setEpIntroEnd] = useState('01:30');
  const [epOutroStart, setEpOutroStart] = useState('22:00');
  const [epOutroEnd, setEpOutroEnd] = useState('23:30');

  // Video Variant Upload / External Source State
  const [uploadMode, setUploadMode] = useState<UploadMode>('file');
  const [uploadEpId, setUploadEpId] = useState<string>('');
  const [uploadDub, setUploadDub] = useState<AudioDub>('jp');
  const [uploadSub, setUploadSub] = useState<SubtitleMode>('pl');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    pct: number;
    uploaded: number;
    total: number;
  } | null>(null);

  // External Source Fields (Google Drive LuxSource / Other Platform URL)
  const [externalUrl, setExternalUrl] = useState('');
  const [externalPlatform, setExternalPlatform] = useState<'gdrive' | 'other'>(
    'gdrive'
  );
  const [gdriveMode, setGdriveMode] = useState<'preview' | 'direct'>('preview');
  const [externalMaxQuality, setExternalMaxQuality] =
    useState<QualityTier>('1080p');
  const [externalDurationInput, setExternalDurationInput] = useState('24:00');

  // Relations & Genres State
  const [relSourceId, setRelSourceId] = useState<string>(
    animeList[0] ? String(animeList[0].id) : ''
  );
  const [relTargetId, setRelTargetId] = useState<string>(
    animeList[1] ? String(animeList[1].id) : ''
  );
  const [relPreset, setRelPreset] = useState('Sequel');
  const [relCustom, setRelCustom] = useState('');
  const [newGenreName, setNewGenreName] = useState('');

  // Users Management State
  const [usersList, setUsersList] = useState<UserAccount[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('normal');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(
    null
  );
  const [confirmDeleteAnimeId, setConfirmDeleteAnimeId] = useState<
    number | null
  >(null);

  async function loadSelectedDetail(id: number) {
    try {
      const { anime } = await api.getAnimeDetail(id);
      setSelectedAnimeDetail(anime);
      if (anime.episodes.length > 0 && !uploadEpId) {
        setUploadEpId(String(anime.episodes[0].id));
      }
      const nextNum =
        anime.episodes.reduce(
          (max, e) => Math.max(max, e.episodeNumber),
          0
        ) + 1;
      setEpNumber(String(nextNum));
    } catch {
      setSelectedAnimeDetail(null);
    }
  }

  async function loadUsers() {
    try {
      const { users } = await api.getUsers();
      setUsersList(users);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd pobierania kont.'
      );
    }
  }

  useEffect(() => {
    if (selectedAnimeId) {
      void loadSelectedDetail(selectedAnimeId);
    } else if (animeList[0]) {
      setSelectedAnimeId(animeList[0].id);
    }
  }, [selectedAnimeId, animeList.length]);

  useEffect(() => {
    if (activeTab === 'users') {
      void loadUsers();
    }
  }, [activeTab]);

  function clearFeedback() {
    setStatusMessage(null);
    setErrorMessage(null);
  }

  async function handleCoverUpload(file: File) {
    clearFeedback();
    try {
      const res = await api.uploadCover(file);
      setNewCoverPath(res.coverPath);
      setCoverPreviewName(file.name);
      setStatusMessage('Okładka została wgrana.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd przesyłania okładki.'
      );
    }
  }

  async function handleCreateAnime(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!newTitle.trim()) {
      setErrorMessage('Podaj tytuł anime.');
      return;
    }
    try {
      const { id } = await api.createAnime({
        title: newTitle.trim(),
        originalTitle: newOriginalTitle.trim(),
        synopsis: newSynopsis.trim(),
        releaseYear: Number(newYear) || 2026,
        studio: newStudio.trim(),
        status: newStatus,
        coverPath: newCoverPath,
        genreIds: newGenreIds,
      });
      setNewTitle('');
      setNewOriginalTitle('');
      setNewSynopsis('');
      setNewStudio('');
      setNewCoverPath('');
      setCoverPreviewName('');
      setNewGenreIds([]);
      await onRefreshAll();
      setSelectedAnimeId(id);
      setStatusMessage('Nowa seria anime została dodana.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Nie udało się dodać anime.'
      );
    }
  }

  async function handleDeleteAnime(id: number) {
    clearFeedback();
    try {
      await api.deleteAnime(id);
      setConfirmDeleteAnimeId(null);
      if (selectedAnimeId === id) {
        setSelectedAnimeId(null);
        setSelectedAnimeDetail(null);
      }
      await onRefreshAll();
      setStatusMessage('Seria anime została usunięta wraz z plikami.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd usuwania serii.'
      );
    }
  }

  async function handleCreateEpisode(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!selectedAnimeId) return;
    const num = Number(epNumber);
    if (!Number.isInteger(num) || num <= 0 || !epTitle.trim()) {
      setErrorMessage('Podaj prawidłowy numer oraz tytuł odcinka.');
      return;
    }

    try {
      const { id } = await api.createEpisode(selectedAnimeId, {
        episodeNumber: num,
        title: epTitle.trim(),
        synopsis: epSynopsis.trim(),
        introStart: parseTimecodeToSeconds(epIntroStart),
        introEnd: parseTimecodeToSeconds(epIntroEnd),
        outroStart: parseTimecodeToSeconds(epOutroStart),
        outroEnd: parseTimecodeToSeconds(epOutroEnd),
      });
      setEpTitle('');
      setEpSynopsis('');
      setUploadEpId(String(id));
      await loadSelectedDetail(selectedAnimeId);
      await onRefreshAll();
      setStatusMessage(
        `Dodano odcinek #${num}. Możesz teraz wgrać plik wideo lub podpiąć link z Google Drive.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd tworzenia odcinka.'
      );
    }
  }

  async function handleSubmitVariant(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    const targetEpId = Number(uploadEpId);
    if (!targetEpId) {
      setErrorMessage('Wybierz odcinek docelowy.');
      return;
    }

    if (uploadMode === 'external') {
      if (!externalUrl.trim()) {
        setErrorMessage(
          'Wklej link do pliku Google Drive lub bezpośredni adres URL wideo.'
        );
        return;
      }
      setUploading(true);
      try {
        const parsedDur =
          parseTimecodeToSeconds(externalDurationInput) ?? 0;
        const res = await api.addExternalVariant(targetEpId, {
          audioDub: uploadDub,
          subtitleMode: uploadSub,
          externalUrl: externalUrl.trim(),
          externalPlatform,
          gdriveMode,
          maxQuality: externalMaxQuality,
          durationSeconds: parsedDur,
        });
        setExternalUrl('');
        if (selectedAnimeId) {
          await loadSelectedDetail(selectedAnimeId);
        }
        await onRefreshAll();
        setStatusMessage(
          `Podpięto zewnętrzne źródło (${
            externalPlatform === 'gdrive'
              ? 'Google Drive — LuxWatch Player'
              : res.provider === 'gdrive_preview'
                ? 'Odtwarzacz Google Drive'
                : res.provider === 'gdrive_direct'
                  ? 'Google Drive strumień'
                  : 'Bezpośredni link wideo'
          }).`
        );
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Nie udało się podpiąć zewnętrznego źródła.'
        );
      } finally {
        setUploading(false);
      }
      return;
    }

    if (!uploadFile) {
      setErrorMessage('Wybierz plik wideo (.mp4, .mkv, .webm).');
      return;
    }

    setUploading(true);
    setUploadProgress({ pct: 0, uploaded: 0, total: uploadFile.size });
    try {
      const res = await api.uploadVideoVariantChunked(
        {
          episodeId: targetEpId,
          audioDub: uploadDub,
          subtitleMode: uploadSub,
          file: uploadFile,
        },
        (pct, uploaded, total) => {
          setUploadProgress({ pct, uploaded, total });
        }
      );
      setUploadFile(null);
      setUploadProgress(null);
      if (selectedAnimeId) {
        await loadSelectedDetail(selectedAnimeId);
      }
      await onRefreshAll();
      setStatusMessage(
        `Plik wideo został wgrany. Wykryte dostępne jakości: ${res.availableQualities.join(', ')}.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd przesyłania wideo.'
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteVariant(variantId: number) {
    clearFeedback();
    try {
      await api.deleteVariant(variantId);
      if (selectedAnimeId) await loadSelectedDetail(selectedAnimeId);
      setStatusMessage('Wersja wideo została usunięta.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd usuwania wersji wideo.'
      );
    }
  }

  async function handleDeleteEpisode(episodeId: number) {
    clearFeedback();
    try {
      await api.deleteEpisode(episodeId);
      if (selectedAnimeId) await loadSelectedDetail(selectedAnimeId);
      await onRefreshAll();
      setStatusMessage('Odcinek został usunięty.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd usuwania odcinka.'
      );
    }
  }

  async function handleAddRelation(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    const src = Number(relSourceId);
    const dst = Number(relTargetId);
    const relType =
      relPreset === '__custom__' ? relCustom.trim() : relPreset.trim();
    if (!src || !dst || !relType) {
      setErrorMessage('Wybierz obie serie oraz określ typ relacji.');
      return;
    }
    try {
      await api.addRelation(src, dst, relType);
      setRelCustom('');
      if (selectedAnimeId === src) {
        await loadSelectedDetail(src);
      }
      setStatusMessage(`Dodano powiązanie "${relType}".`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Nie udało się dodać relacji.'
      );
    }
  }

  async function handleAddGenre(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!newGenreName.trim()) return;
    try {
      await api.createGenre(newGenreName.trim());
      setNewGenreName('');
      await onRefreshAll();
      setStatusMessage('Gatunek został dodany.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd dodawania gatunku.'
      );
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    clearFeedback();
    try {
      await api.createUser({
        username: newUsername.trim(),
        password: newUserPassword,
        role: currentUser.role === 'owner' ? newUserRole : 'normal',
      });
      setNewUsername('');
      setNewUserPassword('');
      setNewUserRole('normal');
      await loadUsers();
      setStatusMessage('Nowe konto zostało utworzone.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd tworzenia konta.'
      );
    }
  }

  async function handleDeleteUser(id: number) {
    clearFeedback();
    try {
      await api.deleteUser(id);
      setConfirmDeleteUserId(null);
      await loadUsers();
      setStatusMessage('Konto zostało usunięte.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Błąd usuwania konta.'
      );
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#F8F8FA]">
            Panel zarządzania
          </h1>
          <p className="text-sm text-[#A3A8B4] mt-1">
            Dodawaj serie anime, odcinki (z pliku lub linku zewnętrznego),
            relacje oraz zarządzaj kontami.
          </p>
        </div>

        <div
          className="grid grid-cols-3 sm:flex items-center bg-[#111216] border border-white/15 rounded-xl p-1 gap-1"
          role="tablist"
          aria-label="Sekcje panelu zarządzania"
        >
          {(
            [
              { id: 'content', label: 'Anime', desktopLabel: 'Anime i Odcinki' },
              {
                id: 'relations',
                label: 'Relacje',
                desktopLabel: 'Relacje i Gatunki',
              },
              {
                id: 'users',
                label: 'Konta',
                desktopLabel: 'Konta użytkowników',
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => {
                clearFeedback();
                setActiveTab(tab.id);
              }}
              className={`min-h-[40px] sm:min-h-0 px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[#67E8F9] text-[#070B10]'
                  : 'text-[#A3A8B4] hover:text-[#F8F8FA]'
              }`}
            >
              <span className="sm:hidden">{tab.label}</span>
              <span className="hidden sm:inline">{tab.desktopLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-[#67E8F9]/15 border border-[#67E8F9]/50 text-sm text-[#CFFAFE]"
        >
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/40 text-sm text-red-200"
        >
          {errorMessage}
        </div>
      )}

      {/* TAB 1: ANIME & EPISODES */}
      {activeTab === 'content' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Add New Anime Column */}
          <section className="lg:col-span-5 bg-[#111216] border border-white/10 rounded-xl p-6 space-y-5">
            <h2 className="font-display text-xl font-semibold text-[#F8F8FA]">
              Dodaj nową serię anime
            </h2>
            <form onSubmit={handleCreateAnime} className="space-y-4">
              <div>
                <label
                  htmlFor="anime-title"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Tytuł główny
                </label>
                <input
                  id="anime-title"
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="np. Kroniki Zimy"
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="anime-orig"
                    className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                  >
                    Tytuł oryginalny
                  </label>
                  <input
                    id="anime-orig"
                    type="text"
                    value={newOriginalTitle}
                    onChange={(e) => setNewOriginalTitle(e.target.value)}
                    placeholder="Japoński / angielski"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="anime-studio"
                    className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                  >
                    Studio
                  </label>
                  <input
                    id="anime-studio"
                    type="text"
                    value={newStudio}
                    onChange={(e) => setNewStudio(e.target.value)}
                    placeholder="np. Madhouse"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="anime-year"
                    className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                  >
                    Rok premiery
                  </label>
                  <input
                    id="anime-year"
                    type="number"
                    min="1960"
                    max="2040"
                    value={newYear}
                    onChange={(e) => setNewYear(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] font-mono tabular-nums focus:outline-none focus:border-[#67E8F9]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="anime-status"
                    className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                  >
                    Status
                  </label>
                  <select
                    id="anime-status"
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                  >
                    <option value="Emitowane">Emitowane</option>
                    <option value="Zakończone">Zakończone</option>
                    <option value="Planowane">Planowane</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="anime-synopsis"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Opis fabuły
                </label>
                <textarea
                  id="anime-synopsis"
                  rows={3}
                  value={newSynopsis}
                  onChange={(e) => setNewSynopsis(e.target.value)}
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-[#E4E4EA] mb-2">
                  Przypisz gatunki
                </span>
                <div className="flex flex-wrap gap-2">
                  {genres.map((g) => {
                    const checked = newGenreIds.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          setNewGenreIds((prev) =>
                            checked
                              ? prev.filter((x) => x !== g.id)
                              : [...prev, g.id]
                          )
                        }
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer ${
                          checked
                            ? 'bg-[#67E8F9] border-[#67E8F9] text-[#070B10] font-semibold'
                            : 'bg-[#09090B] border-white/15 text-[#A3A8B4] hover:text-[#F8F8FA]'
                        }`}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="anime-cover"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Okładka serii (JPG / PNG / WebP)
                </label>
                <input
                  id="anime-cover"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleCoverUpload(file);
                  }}
                  className="block w-full text-xs text-[#A3A8B4] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-white/15 file:bg-[#09090B] file:text-[#F8F8FA] hover:file:border-[#67E8F9]"
                />
                {coverPreviewName && (
                  <p className="text-xs text-[#67E8F9] mt-1">
                    Wgrano okładkę: {coverPreviewName}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Dodaj anime do biblioteki</span>
              </button>
            </form>
          </section>

          {/* Manage Episodes & Video Sources Column */}
          <section className="lg:col-span-7 space-y-6">
            <div className="bg-[#111216] border border-white/10 rounded-xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold text-[#F8F8FA]">
                    Zarządzaj odcinkami i źródłami wideo
                  </h2>
                  <p className="text-xs text-[#A3A8B4] mt-0.5">
                    Wgraj własny plik wideo albo podepnij zewnętrzny link (np.
                    Google Drive) dla każdego dubbingu i napisów.
                  </p>
                </div>

                {selectedAnimeDetail && (
                  <div className="shrink-0">
                    {confirmDeleteAnimeId === selectedAnimeDetail.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteAnime(selectedAnimeDetail.id)
                          }
                          className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg cursor-pointer"
                        >
                          Potwierdź usunięcie
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAnimeId(null)}
                          className="px-3 py-1.5 text-xs bg-white/10 text-[#F8F8FA] rounded-lg cursor-pointer"
                        >
                          Anuluj
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDeleteAnimeId(selectedAnimeDetail.id)
                        }
                        className="px-3 py-1.5 text-xs text-red-300 border border-red-500/30 hover:bg-red-950/40 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Usuń serię</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="manage-anime-select"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Wybrana seria anime
                </label>
                <select
                  id="manage-anime-select"
                  value={selectedAnimeId ?? ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setSelectedAnimeId(id);
                    setUploadEpId('');
                  }}
                  className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                >
                  {animeList.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} ({a.releaseYear})
                    </option>
                  ))}
                </select>
              </div>

              {/* Add Episode Form */}
              {selectedAnimeDetail && (
                <form
                  onSubmit={handleCreateEpisode}
                  className="p-4 bg-[#09090B] border border-white/10 rounded-xl space-y-4"
                >
                  <h3 className="text-sm font-semibold text-[#67E8F9]">
                    Dodaj nowy odcinek do: {selectedAnimeDetail.title}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label
                        htmlFor="ep-num"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Nr odcinka
                      </label>
                      <input
                        id="ep-num"
                        type="number"
                        min="1"
                        required
                        value={epNumber}
                        onChange={(e) => setEpNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm font-mono tabular-nums text-[#F8F8FA]"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label
                        htmlFor="ep-title"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Tytuł odcinka
                      </label>
                      <input
                        id="ep-title"
                        type="text"
                        required
                        value={epTitle}
                        onChange={(e) => setEpTitle(e.target.value)}
                        placeholder="np. Przebudzenie"
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label
                        htmlFor="ep-intro-start"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Opening od (MM:SS)
                      </label>
                      <input
                        id="ep-intro-start"
                        type="text"
                        value={epIntroStart}
                        onChange={(e) => setEpIntroStart(e.target.value)}
                        placeholder="01:10"
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm font-mono tabular-nums text-[#F8F8FA]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="ep-intro-end"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Opening do (MM:SS)
                      </label>
                      <input
                        id="ep-intro-end"
                        type="text"
                        value={epIntroEnd}
                        onChange={(e) => setEpIntroEnd(e.target.value)}
                        placeholder="02:40"
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm font-mono tabular-nums text-[#F8F8FA]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="ep-outro-start"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Ending od (MM:SS)
                      </label>
                      <input
                        id="ep-outro-start"
                        type="text"
                        value={epOutroStart}
                        onChange={(e) => setEpOutroStart(e.target.value)}
                        placeholder="22:00"
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm font-mono tabular-nums text-[#F8F8FA]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="ep-outro-end"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Ending do (MM:SS)
                      </label>
                      <input
                        id="ep-outro-end"
                        type="text"
                        value={epOutroEnd}
                        onChange={(e) => setEpOutroEnd(e.target.value)}
                        placeholder="23:30"
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm font-mono tabular-nums text-[#F8F8FA]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="px-4 py-2 bg-white/10 hover:bg-white/15 text-[#F8F8FA] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Utwórz odcinek
                  </button>
                </form>
              )}

              {/* Video Variant Form: File Upload OR External Source (Google Drive / URL) */}
              {selectedAnimeDetail && selectedAnimeDetail.episodes.length > 0 && (
                <form
                  onSubmit={handleSubmitVariant}
                  className="p-4 bg-[#09090B] border border-[#67E8F9]/30 rounded-xl space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#67E8F9]">
                        Dodaj źródło wideo do odcinka
                      </h3>
                      <p className="text-xs text-[#A3A8B4] mt-0.5">
                        Wybierz przesłanie pliku na serwer lub podpięcie
                        zewnętrznego linku (Google Drive / bezpośredni adres).
                      </p>
                    </div>

                    <div
                      className="flex items-center bg-[#111216] border border-white/15 rounded-lg p-0.5 shrink-0"
                      role="group"
                      aria-label="Źródło wideo"
                    >
                      <button
                        type="button"
                        onClick={() => setUploadMode('file')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          uploadMode === 'file'
                            ? 'bg-[#67E8F9] text-[#070B10]'
                            : 'text-[#A3A8B4] hover:text-[#F8F8FA]'
                        }`}
                      >
                        Plik na serwer
                      </button>
                      <button
                        type="button"
                        onClick={() => setUploadMode('external')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          uploadMode === 'external'
                            ? 'bg-[#67E8F9] text-[#070B10]'
                            : 'text-[#A3A8B4] hover:text-[#F8F8FA]'
                        }`}
                      >
                        Google Drive / Link
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label
                        htmlFor="upload-ep"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Odcinek
                      </label>
                      <select
                        id="upload-ep"
                        value={uploadEpId}
                        onChange={(e) => setUploadEpId(e.target.value)}
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                      >
                        {selectedAnimeDetail.episodes.map((ep) => (
                          <option key={ep.id} value={ep.id}>
                            #{ep.episodeNumber} — {ep.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="upload-dub"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Ścieżka dubbingu
                      </label>
                      <select
                        id="upload-dub"
                        value={uploadDub}
                        onChange={(e) =>
                          setUploadDub(e.target.value as AudioDub)
                        }
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                      >
                        <option value="jp">Japoński dubbing</option>
                        <option value="en">Angielski dubbing</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="upload-sub"
                        className="block text-xs text-[#A3A8B4] mb-1"
                      >
                        Wersja napisów
                      </label>
                      <select
                        id="upload-sub"
                        value={uploadSub}
                        onChange={(e) =>
                          setUploadSub(e.target.value as SubtitleMode)
                        }
                        className="w-full px-3 py-2 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                      >
                        <option value="pl">Polskie napisy</option>
                        <option value="en">Angielskie napisy</option>
                        <option value="none">Bez napisów</option>
                      </select>
                    </div>
                  </div>

                  {uploadMode === 'file' ? (
                    <div key="upload-mode-file" className="space-y-4">
                      <div>
                        <label
                          htmlFor="upload-video-file"
                          className="block text-xs text-[#A3A8B4] mb-1.5"
                        >
                          Plik wideo (.mp4, .mkv, .webm) — upload w paczkach 5 MB
                        </label>
                        <input
                          id="upload-video-file"
                          type="file"
                          accept=".mp4,.mkv,.webm,video/mp4,video/webm,video/x-matroska"
                          onChange={(e) =>
                            setUploadFile(e.target.files?.[0] || null)
                          }
                          className="block w-full text-xs text-[#A3A8B4] file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-white/15 file:bg-[#111216] file:text-[#F8F8FA] hover:file:border-[#67E8F9]"
                        />
                      </div>

                      {uploadProgress && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs font-mono tabular-nums text-[#67E8F9]">
                            <span>Przesyłanie: {uploadProgress.pct}%</span>
                            <span>
                              {formatBytes(uploadProgress.uploaded)} /{' '}
                              {formatBytes(uploadProgress.total)}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#67E8F9] transition-all"
                              style={{ width: `${uploadProgress.pct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={uploading || !uploadFile}
                        className="px-5 py-2.5 bg-[#67E8F9] hover:bg-[#A5F3FC] disabled:opacity-50 text-[#070B10] text-xs font-semibold rounded-lg inline-flex items-center gap-2 cursor-pointer"
                      >
                        <Upload className="w-4 h-4" aria-hidden="true" />
                        <span>
                          {uploading
                            ? 'Przesyłanie pliku...'
                            : 'Prześlij plik wideo'}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div key="upload-mode-external" className="space-y-4">
                      <div>
                        <label
                          htmlFor="external-video-url"
                          className="block text-xs text-[#A3A8B4] mb-1.5"
                        >
                          {externalPlatform === 'gdrive'
                            ? 'Link Google Drive (https://drive.google.com/file/d/[ID]/view?usp=sharing) lub samo ID'
                            : 'Bezpośredni adres URL wideo (.mp4 / .webm) lub link z innej platformy'}
                        </label>
                        <input
                          id="external-video-url"
                          type="text"
                          required
                          value={externalUrl}
                          onChange={(e) => setExternalUrl(e.target.value)}
                          placeholder={
                            externalPlatform === 'gdrive'
                              ? 'https://drive.google.com/file/d/[ID]/view?usp=sharing'
                              : 'https://cdn.twojadomena.pl/odcinek1.mp4'
                          }
                          className="w-full px-3 py-2.5 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
                        />
                      </div>

                      {/* Platform Switch: Google Drive (default) vs Inna platforma */}
                      <div className="space-y-2">
                        <span className="block text-xs text-[#A3A8B4]">
                          Platforma źródła zewnętrznego
                        </span>
                        <div
                          className="grid grid-cols-2 sm:inline-flex items-center bg-[#111216] border border-white/15 rounded-lg p-0.5 gap-1"
                          role="group"
                          aria-label="Platforma źródła zewnętrznego"
                        >
                          <button
                            type="button"
                            onClick={() => setExternalPlatform('gdrive')}
                            className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                              externalPlatform === 'gdrive'
                                ? 'bg-[#67E8F9] text-[#070B10]'
                                : 'text-[#A3A8B4] hover:text-[#F8F8FA]'
                            }`}
                          >
                            Google Drive
                          </button>
                          <button
                            type="button"
                            onClick={() => setExternalPlatform('other')}
                            className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                              externalPlatform === 'other'
                                ? 'bg-[#67E8F9] text-[#070B10]'
                                : 'text-[#A3A8B4] hover:text-[#F8F8FA]'
                            }`}
                          >
                            Inna platforma
                          </button>
                        </div>

                        {externalPlatform === 'gdrive' && (() => {
                          const detectedId = extractGoogleDriveFileId(externalUrl);
                          if (!externalUrl.trim()) {
                            return (
                              <p className="text-[11px] text-[#8D92A0]">
                                Wyciąga samo ID z linku Google Drive i odtwarza je w naszym playerze przez{' '}
                                <span className="font-mono text-[#67E8F9]">
                                  luxsource.luxdroit.workers.dev
                                </span>
                                .
                              </p>
                            );
                          }
                          if (!detectedId) {
                            return (
                              <p className="text-[11px] text-amber-300">
                                Nie rozpoznano jeszcze poprawnego ID pliku Google Drive w tym linku.
                              </p>
                            );
                          }
                          return (
                            <p className="text-[11px] text-[#CFFAFE] bg-[#0B151A] border border-[#67E8F9]/30 rounded-lg px-3 py-2 break-all font-mono">
                              Strumień: {buildLuxSourceDriveUrl(detectedId)}
                            </p>
                          );
                        })()}
                      </div>

                      <div
                        className={`grid grid-cols-1 gap-3 ${
                          externalPlatform === 'other'
                            ? 'sm:grid-cols-3'
                            : 'sm:grid-cols-2'
                        }`}
                      >
                        {externalPlatform === 'other' && (
                          <div>
                            <label
                              htmlFor="gdrive-mode"
                              className="block text-xs text-[#A3A8B4] mb-1"
                            >
                              Tryb zewnętrzny
                            </label>
                            <select
                              id="gdrive-mode"
                              value={gdriveMode}
                              onChange={(e) =>
                                setGdriveMode(
                                  e.target.value as 'preview' | 'direct'
                                )
                              }
                              className="w-full px-3 py-2.5 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                            >
                              <option value="preview">
                                Osadzony odtwarzacz (Drive / iframe)
                              </option>
                              <option value="direct">
                                Strumień bezpośredni (MP4 / WebM)
                              </option>
                            </select>
                          </div>
                        )}

                        <div>
                          <label
                            htmlFor="external-quality"
                            className="block text-xs text-[#A3A8B4] mb-1"
                          >
                            Maksymalna jakość źródła
                          </label>
                          <select
                            id="external-quality"
                            value={externalMaxQuality}
                            onChange={(e) =>
                              setExternalMaxQuality(
                                e.target.value as QualityTier
                              )
                            }
                            className="w-full px-3 py-2.5 bg-[#111216] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                          >
                            <option value="2k">2K (1440p)</option>
                            <option value="1080p">1080p Full HD</option>
                            <option value="720p">720p HD</option>
                            <option value="480p">480p SD</option>
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="external-duration"
                            className="block text-xs text-[#A3A8B4] mb-1"
                          >
                            Długość odcinka (MM:SS)
                          </label>
                          <input
                            id="external-duration"
                            type="text"
                            value={externalDurationInput}
                            onChange={(e) =>
                              setExternalDurationInput(e.target.value)
                            }
                            placeholder="24:00"
                            className="w-full px-3 py-2.5 bg-[#111216] border border-white/15 rounded-lg text-sm font-mono tabular-nums text-[#F8F8FA]"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={uploading || !externalUrl.trim()}
                        className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-5 py-2.5 bg-[#67E8F9] hover:bg-[#A5F3FC] disabled:opacity-50 text-[#070B10] text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Link2 className="w-4 h-4" aria-hidden="true" />
                        <span>
                          {uploading
                            ? 'Zapisywanie źródła...'
                            : 'Podepnij zewnętrzne źródło'}
                        </span>
                      </button>
                    </div>
                  )}
                </form>
              )}

              {/* Existing Episodes & Variants List */}
              {selectedAnimeDetail && selectedAnimeDetail.episodes.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h3 className="text-sm font-semibold text-[#F8F8FA]">
                    Wgrane odcinki i warianty
                  </h3>
                  <div className="space-y-3">
                    {selectedAnimeDetail.episodes.map((ep) => (
                      <div
                        key={ep.id}
                        className="p-4 bg-[#09090B] border border-white/10 rounded-xl space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-[#F8F8FA]">
                            <span className="font-mono text-[#67E8F9] mr-2">
                              #{ep.episodeNumber}
                            </span>
                            {ep.title}
                            <span className="ml-3 text-xs font-mono text-[#A3A8B4] tabular-nums">
                              OP:{' '}
                              {ep.introStart !== null
                                ? formatTimecode(ep.introStart)
                                : '—'}
                              –
                              {ep.introEnd !== null
                                ? formatTimecode(ep.introEnd)
                                : '—'}{' '}
                              · ED:{' '}
                              {ep.outroStart !== null
                                ? formatTimecode(ep.outroStart)
                                : '—'}
                              –
                              {ep.outroEnd !== null
                                ? formatTimecode(ep.outroEnd)
                                : '—'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDeleteEpisode(ep.id)}
                            aria-label={`Usuń odcinek ${ep.episodeNumber}`}
                            className="text-xs text-red-300 hover:text-red-200 cursor-pointer"
                          >
                            Usuń odcinek
                          </button>
                        </div>

                        {ep.variants.length === 0 ? (
                          <p className="text-xs text-[#737887]">
                            Brak wgranych plików lub linków dla tego odcinka.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {ep.variants.map((v) => (
                              <div
                                key={v.id}
                                className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#D4D6DE] bg-[#111216] px-3 py-2 rounded-lg border border-white/5"
                              >
                                <span>
                                  {DUB_LABELS[v.audioDub]} ·{' '}
                                  {SUB_LABELS[v.subtitleMode]} ·{' '}
                                  <span className="font-mono text-[#A3A8B4]">
                                    {v.sourceType === 'external'
                                      ? v.externalUrl.includes(
                                          'luxsource.luxdroit.workers.dev'
                                        )
                                        ? 'Google Drive (LuxSource)'
                                        : v.externalProvider.startsWith('gdrive')
                                          ? 'Google Drive'
                                          : 'Link zewnętrzny'
                                      : `${v.sourceWidth}×${v.sourceHeight} (${v.availableQualities.join('/')}) · ${formatBytes(v.fileSizeBytes)}`}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteVariant(v.id)}
                                  className="text-red-300 hover:text-red-200 cursor-pointer"
                                >
                                  Usuń źródło
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: RELATIONS & GENRES */}
      {activeTab === 'relations' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <section className="lg:col-span-7 bg-[#111216] border border-white/10 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="font-display text-xl font-semibold text-[#F8F8FA]">
                Powiązania między seriami
              </h2>
              <p className="text-xs text-[#A3A8B4] mt-1">
                Ustalaj relacje (Sequel, Prequel, Spin-off lub własne etykiety)
                pomiędzy seriami w bibliotece.
              </p>
            </div>

            <form onSubmit={handleAddRelation} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="rel-source"
                    className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                  >
                    Seria źródłowa
                  </label>
                  <select
                    id="rel-source"
                    value={relSourceId}
                    onChange={(e) => {
                      setRelSourceId(e.target.value);
                      setSelectedAnimeId(Number(e.target.value));
                    }}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                  >
                    {animeList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="rel-target"
                    className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                  >
                    Powiązana seria docelowa
                  </label>
                  <select
                    id="rel-target"
                    value={relTargetId}
                    onChange={(e) => setRelTargetId(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                  >
                    {animeList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="rel-type"
                    className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                  >
                    Typ relacji
                  </label>
                  <select
                    id="rel-type"
                    value={relPreset}
                    onChange={(e) => setRelPreset(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                  >
                    <option value="Sequel">Sequel</option>
                    <option value="Prequel">Prequel</option>
                    <option value="Spin-off">Spin-off</option>
                    <option value="Historia poboczna">Historia poboczna</option>
                    <option value="Wersja alternatywna">
                      Wersja alternatywna
                    </option>
                    <option value="Film kinowy">Film kinowy</option>
                    <option value="__custom__">Własna relacja...</option>
                  </select>
                </div>

                {relPreset === '__custom__' && (
                  <div>
                    <label
                      htmlFor="rel-custom"
                      className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                    >
                      Własna nazwa relacji
                    </label>
                    <input
                      id="rel-custom"
                      type="text"
                      required
                      value={relCustom}
                      onChange={(e) => setRelCustom(e.target.value)}
                      placeholder="np. Odcinek specjalny OVA"
                      className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                    />
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="px-5 py-2.5 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-xs font-semibold rounded-lg inline-flex items-center gap-2 cursor-pointer"
              >
                <Link2 className="w-4 h-4" aria-hidden="true" />
                <span>Powiąż serie</span>
              </button>
            </form>

            {selectedAnimeDetail && (
              <div className="pt-4 border-t border-white/10 space-y-3">
                <h3 className="text-sm font-semibold text-[#F8F8FA]">
                  Aktywne powiązania dla: {selectedAnimeDetail.title}
                </h3>
                {selectedAnimeDetail.relations.length === 0 ? (
                  <p className="text-xs text-[#737887]">
                    Brak powiązań dla wybranej serii.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedAnimeDetail.relations.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between bg-[#09090B] border border-white/10 px-4 py-2.5 rounded-lg text-sm"
                      >
                        <span>
                          <span className="text-[#67E8F9] font-medium mr-2">
                            {r.relationType}:
                          </span>
                          <span className="text-[#F8F8FA]">
                            {r.targetTitle}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.deleteRelation(r.id);
                            await loadSelectedDetail(selectedAnimeDetail.id);
                          }}
                          className="text-xs text-red-300 hover:text-red-200 cursor-pointer"
                        >
                          Usuń
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="lg:col-span-5 bg-[#111216] border border-white/10 rounded-xl p-6 space-y-5">
            <h2 className="font-display text-xl font-semibold text-[#F8F8FA]">
              Gatunki anime
            </h2>

            <form onSubmit={handleAddGenre} className="flex gap-2">
              <label htmlFor="new-genre" className="sr-only">
                Nazwa nowego gatunku
              </label>
              <input
                id="new-genre"
                type="text"
                required
                value={newGenreName}
                onChange={(e) => setNewGenreName(e.target.value)}
                placeholder="Nowy gatunek (np. Mecha)"
                className="flex-1 px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-xs font-semibold rounded-lg cursor-pointer"
              >
                Dodaj
              </button>
            </form>

            <div className="divide-y divide-white/10 border border-white/10 rounded-xl overflow-hidden">
              {genres.map((g) => (
                <div
                  key={g.id}
                  className="px-4 py-2.5 bg-[#09090B] flex items-center justify-between text-sm"
                >
                  <span className="text-[#F8F8FA]">{g.name}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.deleteGenre(g.id);
                      await onRefreshAll();
                    }}
                    className="text-xs text-red-300 hover:text-red-200 cursor-pointer"
                  >
                    Usuń
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: USER ACCOUNTS (STRICT RBAC) */}
      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <section className="lg:col-span-5 bg-[#111216] border border-white/10 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="font-display text-xl font-semibold text-[#F8F8FA]">
                Utwórz nowe konto
              </h2>
              <p className="text-xs text-[#A3A8B4] mt-1">
                {currentUser.role === 'owner'
                  ? 'Jako Owner możesz tworzyć konta Administratorów (admin) oraz Użytkowników (normal).'
                  : 'Jako Administrator możesz tworzyć i usuwać wyłącznie konta Użytkowników (normal).'}
              </p>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label
                  htmlFor="new-user-nick"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Nick użytkownika
                </label>
                <input
                  id="new-user-nick"
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="3–32 znaki (litery, cyfry, _ . -)"
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                />
              </div>

              <div>
                <label
                  htmlFor="new-user-pass"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Hasło
                </label>
                <input
                  id="new-user-pass"
                  type="password"
                  required
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  placeholder="Minimum 6 znaków"
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA]"
                />
              </div>

              <div>
                <label
                  htmlFor="new-user-role"
                  className="block text-xs font-medium text-[#E4E4EA] mb-1.5"
                >
                  Typ konta
                </label>
                <select
                  id="new-user-role"
                  value={currentUser.role === 'owner' ? newUserRole : 'normal'}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                  disabled={currentUser.role !== 'owner'}
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] disabled:opacity-70"
                >
                  <option value="normal">Normal (tylko oglądanie)</option>
                  {currentUser.role === 'owner' && (
                    <option value="admin">
                      Admin (zarządzanie anime i kontami normal)
                    </option>
                  )}
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                <span>Utwórz konto</span>
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 bg-[#111216] border border-white/10 rounded-xl p-6 space-y-4">
            <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
              <h2 className="font-display text-xl font-semibold text-[#F8F8FA]">
                Konta w systemie
              </h2>
              <span className="text-xs text-[#A3A8B4] tabular-nums">
                {usersList.length} kont
              </span>
            </div>

            <div className="divide-y divide-white/10 border border-white/10 rounded-xl overflow-hidden">
              {usersList.map((u) => {
                const deletable = canDeleteUser(
                  currentUser.role,
                  currentUser.id,
                  u.role,
                  u.id
                );
                return (
                  <div
                    key={u.id}
                    className="px-4 py-3 bg-[#09090B] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-[#F8F8FA]">
                        {u.username}
                      </div>
                      <div className="text-xs text-[#A3A8B4]">
                        Rola:{' '}
                        <span className="text-[#67E8F9] font-medium">
                          {u.role}
                        </span>{' '}
                        · Utworzono {u.createdAt.slice(0, 10)}
                      </div>
                    </div>

                    {deletable && (
                      <div>
                        {confirmDeleteUserId === u.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleDeleteUser(u.id)}
                              className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg cursor-pointer"
                            >
                              Potwierdź usunięcie
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteUserId(null)}
                              className="px-3 py-1.5 text-xs bg-white/10 text-[#F8F8FA] rounded-lg cursor-pointer"
                            >
                              Anuluj
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUserId(u.id)}
                            aria-label={`Usuń konto ${u.username}`}
                            className="px-3 py-1.5 text-xs text-red-300 border border-red-500/30 hover:bg-red-950/40 rounded-lg cursor-pointer"
                          >
                            Usuń konto
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
