import { useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Clock, Film, User } from 'lucide-react';
import { api } from '../api/client';
import type {
  AudioDub,
  PreferredQuality,
  SubtitleMode,
  UserAccount,
  UserProfileStats,
} from '../types';
import { formatDurationHuman } from '../utils/playerLogic';
import { CoverImage } from './CoverImage';

interface ProfileViewProps {
  user: UserAccount;
  stats: UserProfileStats;
  onUserUpdated: (user: UserAccount) => void;
  onOpenAnime: (animeId: number) => void;
}

const ROLE_LABELS: Record<UserAccount['role'], string> = {
  owner: 'Właściciel (Owner)',
  admin: 'Administrator',
  normal: 'Użytkownik',
};

export function ProfileView({
  user,
  stats,
  onUserUpdated,
  onOpenAnime,
}: ProfileViewProps) {
  const [preferredDub, setPreferredDub] = useState<AudioDub>(
    user.preferredDub
  );
  const [preferredSub, setPreferredSub] = useState<SubtitleMode>(
    user.preferredSub
  );
  const [preferredQuality, setPreferredQuality] = useState<PreferredQuality>(
    user.preferredQuality
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSavePreferences(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      const { user: updated } = await api.updatePreferences({
        preferredDub,
        preferredSub,
        preferredQuality,
      });
      onUserUpdated(updated);
      setSavedMsg('Preferencje odtwarzania zostały zapisane.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Nie udało się zapisać ustawień.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-3.5 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-10">
      {/* Header & Watch Time Summary */}
      <section className="bg-[#111216] border border-white/10 rounded-xl p-4 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-5 sm:gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-[#67E8F9]/15 border border-[#67E8F9]/40 flex items-center justify-center shrink-0">
            <User className="w-6 h-6 sm:w-7 sm:h-7 text-[#67E8F9]" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-xl sm:text-3xl font-bold text-[#F8F8FA]">
              {user.username}
            </h1>
            <p className="text-xs sm:text-sm text-[#67E8F9] mt-0.5">
              {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-10 border-t lg:border-t-0 lg:border-l border-white/10 pt-4 sm:pt-5 lg:pt-0 lg:pl-10">
          <div>
            <div className="text-[11px] sm:text-xs text-[#A3A8B4] flex items-center gap-1 sm:gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#67E8F9] shrink-0" aria-hidden="true" />
              <span className="truncate">Czas</span>
            </div>
            <div className="font-display text-lg sm:text-2xl font-bold text-[#F8F8FA] mt-1 tabular-nums">
              {formatDurationHuman(stats.totalWatchSeconds)}
            </div>
          </div>

          <div>
            <div className="text-[11px] sm:text-xs text-[#A3A8B4] flex items-center gap-1 sm:gap-1.5">
              <Film className="w-3.5 h-3.5 text-[#67E8F9] shrink-0" aria-hidden="true" />
              <span className="truncate">Odcinki</span>
            </div>
            <div className="font-display text-lg sm:text-2xl font-bold text-[#F8F8FA] mt-1 tabular-nums">
              {stats.watchedEpisodesCount}
            </div>
          </div>

          <div>
            <div className="text-[11px] sm:text-xs text-[#A3A8B4] flex items-center gap-1 sm:gap-1.5">
              <Check className="w-3.5 h-3.5 text-[#67E8F9] shrink-0" aria-hidden="true" />
              <span className="truncate">Serie</span>
            </div>
            <div className="font-display text-lg sm:text-2xl font-bold text-[#F8F8FA] mt-1 tabular-nums">
              {stats.completedAnimeCount}
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Default Playback Preferences */}
        <section className="lg:col-span-5 bg-[#111216] border border-white/10 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#F8F8FA]">
              Domyślne preferencje
            </h2>
            <p className="text-xs text-[#A3A8B4] mt-1 leading-relaxed">
              Odtwarzacz automatycznie wybiera preferowaną wersję. Jeśli dany
              odcinek jej nie posiada, otrzymasz komunikat i zostanie wybrana
              dostępna alternatywa.
            </p>
          </div>

          <form onSubmit={handleSavePreferences} className="space-y-4">
            <div>
              <label
                htmlFor="pref-dub"
                className="block text-sm font-medium text-[#E4E4EA] mb-1.5"
              >
                Preferowany dubbing
              </label>
              <select
                id="pref-dub"
                value={preferredDub}
                onChange={(e) => setPreferredDub(e.target.value as AudioDub)}
                className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
              >
                <option value="jp">Japoński dubbing</option>
                <option value="en">Angielski dubbing</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="pref-sub"
                className="block text-sm font-medium text-[#E4E4EA] mb-1.5"
              >
                Preferowane napisy
              </label>
              <select
                id="pref-sub"
                value={preferredSub}
                onChange={(e) =>
                  setPreferredSub(e.target.value as SubtitleMode)
                }
                className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
              >
                <option value="pl">Polskie napisy</option>
                <option value="en">Angielskie napisy</option>
                <option value="none">Bez napisów</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="pref-quality"
                className="block text-sm font-medium text-[#E4E4EA] mb-1.5"
              >
                Domyślna jakość obrazu
              </label>
              <select
                id="pref-quality"
                value={preferredQuality}
                onChange={(e) =>
                  setPreferredQuality(e.target.value as PreferredQuality)
                }
                className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/15 rounded-lg text-sm text-[#F8F8FA] focus:outline-none focus:border-[#67E8F9]"
              >
                <option value="max">Najwyższa dostępna dla pliku</option>
                <option value="2k">2K (1440p)</option>
                <option value="1080p">1080p Full HD</option>
                <option value="720p">720p HD</option>
                <option value="480p">480p SD</option>
              </select>
            </div>

            {savedMsg && (
              <div
                role="status"
                className="p-3 rounded-lg bg-[#67E8F9]/15 border border-[#67E8F9]/40 text-xs text-[#CFFAFE]"
              >
                {savedMsg}
              </div>
            )}
            {errorMsg && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-950/50 border border-red-500/40 text-xs text-red-200"
              >
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 px-4 bg-[#67E8F9] hover:bg-[#A5F3FC] disabled:opacity-60 text-[#09090B] text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {saving ? 'Zapisywanie...' : 'Zapisz preferencje'}
            </button>
          </form>
        </section>

        {/* Watched Anime History */}
        <section className="lg:col-span-7 bg-[#111216] border border-white/10 rounded-xl p-6 space-y-5">
          <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
            <h2 className="font-display text-xl font-semibold text-[#F8F8FA]">
              Obejrzane serie
            </h2>
            <span className="text-xs text-[#A3A8B4] tabular-nums">
              {stats.watchedAnimeList.length} ukończonych
            </span>
          </div>

          {stats.watchedAnimeList.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#A3A8B4]">
              Nie oznaczono jeszcze żadnej serii jako obejrzanej. Obejrzane
              odcinki automatycznie zwiększają Twój łączny czas oglądania.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {stats.watchedAnimeList.map((anime) => (
                <button
                  key={anime.id}
                  type="button"
                  onClick={() => onOpenAnime(anime.id)}
                  className="text-left bg-[#09090B] border border-white/10 hover:border-[#67E8F9]/60 rounded-xl p-3 flex items-center gap-3.5 transition-colors cursor-pointer"
                >
                  <div className="w-14 aspect-[3/4] rounded-lg overflow-hidden shrink-0 bg-[#181A20]">
                    <CoverImage
                      src={anime.coverUrl}
                      alt={anime.title}
                      title={anime.title}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-sm font-semibold text-[#F8F8FA] truncate">
                      {anime.title}
                    </h3>
                    <p className="text-xs text-[#A3A8B4] mt-1 tabular-nums">
                      {anime.releaseYear} · {anime.episodeCount} odc.
                    </p>
                    <p className="text-xs text-[#67E8F9] mt-1 inline-flex items-center gap-1">
                      <Check className="w-3 h-3" aria-hidden="true" />
                      <span>Obejrzane</span>
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
