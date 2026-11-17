import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';
import { AnimeDetailView } from './components/AnimeDetailView';
import { CatalogView } from './components/CatalogView';
import { HeaderBar } from './components/HeaderBar';
import type { AppView } from './components/HeaderBar';
import { LoginGate } from './components/LoginGate';
import { ManagementView } from './components/ManagementView';
import { PlayerView } from './components/PlayerView';
import { ProfileView } from './components/ProfileView';
import {
  OfflineIndicator,
  PWAInstallBanner,
} from './components/PWAInstallPrompt';
import type {
  AnimeDetail,
  AnimeSummary,
  Genre,
  UserAccount,
  UserProfileStats,
} from './types';
import { canManageContent } from './utils/rbacLogic';

export default function App() {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [activeView, setActiveView] = useState<AppView>('catalog');
  const [animeList, setAnimeList] = useState<AnimeSummary[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [profileStats, setProfileStats] = useState<UserProfileStats>({
    totalWatchSeconds: 0,
    watchedEpisodesCount: 0,
    completedAnimeCount: 0,
    watchedAnimeList: [],
    continueWatching: [],
  });

  const [selectedAnime, setSelectedAnime] = useState<AnimeDetail | null>(null);
  const [playingEpisodeId, setPlayingEpisodeId] = useState<number | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeView, selectedAnime?.id, playingEpisodeId]);

  const refreshLibraryAndStats = useCallback(async () => {
    const [animeRes, genresRes, statsRes] = await Promise.all([
      api.getAnimeList(),
      api.getGenres(),
      api.getProfileStats(),
    ]);
    setAnimeList(animeRes.anime);
    setGenres(genresRes.genres);
    setProfileStats(statsRes.stats);
  }, []);

  useEffect(() => {
    let active = true;
    async function initAuth() {
      try {
        const { user: me } = await api.getMe();
        if (!active) return;
        setUser(me);
        if (me) {
          await refreshLibraryAndStats();
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setAuthChecked(true);
      }
    }
    void initAuth();
    return () => {
      active = false;
    };
  }, [refreshLibraryAndStats]);

  async function handleLoginSuccess(loggedInUser: UserAccount) {
    setUser(loggedInUser);
    setActiveView('catalog');
    await refreshLibraryAndStats();
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
    setSelectedAnime(null);
    setPlayingEpisodeId(null);
    setAnimeList([]);
    setActiveView('catalog');
  }

  async function openAnime(animeId: number, autoPlayEpisodeId?: number) {
    const { anime } = await api.getAnimeDetail(animeId);
    setSelectedAnime(anime);
    if (autoPlayEpisodeId) {
      setPlayingEpisodeId(autoPlayEpisodeId);
      setActiveView('player');
    } else {
      setActiveView('anime');
    }
  }

  async function refreshSelectedAnime() {
    if (!selectedAnime) return;
    const [{ anime }] = await Promise.all([
      api.getAnimeDetail(selectedAnime.id),
      refreshLibraryAndStats(),
    ]);
    setSelectedAnime(anime);
  }

  async function handleToggleSeriesWatched(animeId: number, watched: boolean) {
    await api.toggleAnimeWatched(animeId, watched);
    await refreshSelectedAnime();
  }

  async function handleToggleEpisodeWatched(
    episodeId: number,
    watched: boolean
  ) {
    await api.toggleEpisodeWatched(episodeId, watched);
    await refreshSelectedAnime();
  }

  function handleNavigate(view: AppView) {
    if (view === 'management' && user && !canManageContent(user.role)) {
      return;
    }
    setActiveView(view);
    if (view === 'catalog' || view === 'continue' || view === 'profile') {
      void refreshLibraryAndStats();
    }
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#09090B] text-[#A3A8B4] flex items-center justify-center text-sm">
        Ładowanie prywatnej biblioteki...
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginGate onSuccess={(u) => void handleLoginSuccess(u)} />
        <PWAInstallBanner hasBottomNav={false} />
        <OfflineIndicator />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-[#F8F8FA] flex flex-col">
      <HeaderBar
        user={user}
        activeView={activeView}
        onNavigate={handleNavigate}
        onLogout={() => void handleLogout()}
      />

      <main className="flex-1 pb-20 md:pb-0">
        {(activeView === 'catalog' || activeView === 'continue') && (
          <CatalogView
            animeList={animeList}
            genres={genres}
            continueWatching={profileStats.continueWatching}
            onlyContinueTab={activeView === 'continue'}
            onOpenAnime={(id) => void openAnime(id)}
            onResumeEpisode={(aid, eid) => void openAnime(aid, eid)}
          />
        )}

        {activeView === 'anime' && selectedAnime && (
          <AnimeDetailView
            anime={selectedAnime}
            onBack={() => setActiveView('catalog')}
            onPlayEpisode={(epId) => {
              setPlayingEpisodeId(epId);
              setActiveView('player');
            }}
            onOpenRelatedAnime={(aid) => void openAnime(aid)}
            onToggleSeriesWatched={handleToggleSeriesWatched}
            onToggleEpisodeWatched={handleToggleEpisodeWatched}
          />
        )}

        {activeView === 'player' &&
          selectedAnime &&
          playingEpisodeId !== null && (
            <PlayerView
              anime={selectedAnime}
              episodeId={playingEpisodeId}
              user={user}
              onBackToAnime={() => {
                void refreshSelectedAnime();
                setActiveView('anime');
              }}
              onSelectEpisode={(epId) => setPlayingEpisodeId(epId)}
              onRefreshAnime={refreshSelectedAnime}
            />
          )}

        {activeView === 'profile' && (
          <ProfileView
            user={user}
            stats={profileStats}
            onUserUpdated={(updated) => setUser(updated)}
            onOpenAnime={(id) => void openAnime(id)}
          />
        )}

        {activeView === 'management' && canManageContent(user.role) && (
          <ManagementView
            currentUser={user}
            animeList={animeList}
            genres={genres}
            onRefreshAll={refreshLibraryAndStats}
          />
        )}
      </main>

      <PWAInstallBanner hasBottomNav={true} />
      <OfflineIndicator />
    </div>
  );
}
