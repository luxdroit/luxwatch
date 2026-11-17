import type {
  AnimeDetail,
  AnimeSummary,
  AudioDub,
  Genre,
  PreferredQuality,
  QualityTier,
  SubtitleMode,
  UserAccount,
  UserProfileStats,
  UserRole,
} from '../types';

const TOKEN_STORAGE_KEY = 'lw_session_token';

let memoryToken: string | null = null;

export function getAuthToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      memoryToken = stored;
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function setAuthToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function appendMediaAuth(url: string): string {
  if (!url || !url.startsWith('/api/')) return url;
  const token = getAuthToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}st=${encodeURIComponent(token)}`;
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const isBinary =
    options.body instanceof ArrayBuffer || options.body instanceof Uint8Array;

  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body && !isBinary ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let errMsg =
      res.status === 404
        ? `Błąd serwera (404): brak endpointu API (${url}) na działającym backendzie — zrestartuj proces serwera po aktualizacji kodu.`
        : `Błąd serwera (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) errMsg = data.error;
    } catch {
      // ignore non-json error
    }
    throw new Error(errMsg);
  }

  return (await res.json()) as T;
}

export const api = {
  getMe: async () => {
    const res = await apiRequest<{
      user: UserAccount | null;
      token?: string | null;
    }>('/api/auth/me');
    if (res.user && res.token) {
      setAuthToken(res.token);
    } else if (!res.user) {
      setAuthToken(null);
    }
    return { user: res.user };
  },

  login: async (username: string, password: string) => {
    const res = await apiRequest<{ user: UserAccount; token: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }
    );
    if (res.token) {
      setAuthToken(res.token);
    }
    return { user: res.user };
  },

  logout: async () => {
    try {
      await apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
    }
  },

  updatePreferences: (prefs: {
    preferredDub: AudioDub;
    preferredSub: SubtitleMode;
    preferredQuality: PreferredQuality;
  }) =>
    apiRequest<{ user: UserAccount }>('/api/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    }),

  getUsers: () => apiRequest<{ users: UserAccount[] }>('/api/users'),

  createUser: (data: { username: string; password: string; role: UserRole }) =>
    apiRequest<{ user: UserAccount }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteUser: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  getGenres: () => apiRequest<{ genres: Genre[] }>('/api/genres'),

  createGenre: (name: string) =>
    apiRequest<{ genre: Genre }>('/api/genres', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  deleteGenre: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/genres/${id}`, { method: 'DELETE' }),

  getAnimeList: (params?: { q?: string; genre?: number | ''; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.genre) sp.set('genre', String(params.genre));
    if (params?.status) sp.set('status', params.status);
    const qs = sp.toString();
    return apiRequest<{ anime: AnimeSummary[]; featuredAnimeId?: number | null }>(
      `/api/anime${qs ? `?${qs}` : ''}`
    );
  },

  setFeaturedAnime: (animeId: number | null) =>
    apiRequest<{ ok: boolean; featuredAnimeId: number | null }>('/api/featured', {
      method: 'PUT',
      body: JSON.stringify({ animeId }),
    }),

  getAnimeDetail: (id: number) =>
    apiRequest<{ anime: AnimeDetail }>(`/api/anime/${id}`),

  previewDriveFolder: (folderUrl: string) =>
    apiRequest<{
      folderId: string;
      episodes: Array<{
        fileId: string;
        filename: string;
        episodeNumber: number;
        title: string;
        luxSourceUrl: string;
      }>;
    }>('/api/drive-folder/preview', {
      method: 'POST',
      body: JSON.stringify({ folderUrl }),
    }),

  createAnime: (data: {
    title: string;
    originalTitle: string;
    synopsis: string;
    releaseYear: number;
    studio: string;
    status: string;
    coverPath: string;
    genreIds: number[];
    driveFolderUrl?: string;
    folderAudioDub?: AudioDub;
    folderSubtitleMode?: SubtitleMode;
    folderMaxQuality?: QualityTier;
    folderIntroStart?: number | null;
    folderIntroEnd?: number | null;
    folderOutroStart?: number | null;
    folderOutroEnd?: number | null;
  }) =>
    apiRequest<{
      id: number;
      importedEpisodesCount?: number;
      importedEpisodes?: Array<{
        episodeId: number;
        variantId: number;
        episodeNumber: number;
        title: string;
        externalUrl: string;
      }>;
    }>('/api/anime', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAnime: (
    id: number,
    data: {
      title: string;
      originalTitle: string;
      synopsis: string;
      releaseYear: number;
      studio: string;
      status: string;
      coverPath?: string;
      genreIds: number[];
    }
  ) =>
    apiRequest<{ ok: boolean }>(`/api/anime/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteAnime: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/anime/${id}`, { method: 'DELETE' }),

  addRelation: (
    sourceAnimeId: number,
    targetAnimeId: number,
    relationType: string
  ) =>
    apiRequest<{ id: number }>(`/api/anime/${sourceAnimeId}/relations`, {
      method: 'POST',
      body: JSON.stringify({ targetAnimeId, relationType }),
    }),

  deleteRelation: (relationId: number) =>
    apiRequest<{ ok: boolean }>(`/api/relations/${relationId}`, {
      method: 'DELETE',
    }),

  createEpisode: (
    animeId: number,
    data: {
      episodeNumber: number;
      title: string;
      synopsis: string;
      introStart: number | null;
      introEnd: number | null;
      outroStart: number | null;
      outroEnd: number | null;
    }
  ) =>
    apiRequest<{ id: number }>(`/api/anime/${animeId}/episodes`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateEpisode: (
    episodeId: number,
    data: {
      title: string;
      synopsis: string;
      introStart: number | null;
      introEnd: number | null;
      outroStart: number | null;
      outroEnd: number | null;
    }
  ) =>
    apiRequest<{ ok: boolean }>(`/api/episodes/${episodeId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteEpisode: (episodeId: number) =>
    apiRequest<{ ok: boolean }>(`/api/episodes/${episodeId}`, {
      method: 'DELETE',
    }),

  deleteVariant: (variantId: number) =>
    apiRequest<{ ok: boolean }>(`/api/variants/${variantId}`, {
      method: 'DELETE',
    }),

  reportVariantDuration: (variantId: number, durationSeconds: number) =>
    apiRequest<{
      ok: boolean;
      variantDurationSeconds: number;
      episodeDurationSeconds: number;
    }>(`/api/variants/${variantId}/duration`, {
      method: 'POST',
      body: JSON.stringify({ durationSeconds }),
    }),

  addExternalVariant: (
    episodeId: number,
    data: {
      audioDub: AudioDub;
      subtitleMode: SubtitleMode;
      externalUrl: string;
      externalPlatform: 'gdrive' | 'other';
      gdriveMode: 'preview' | 'direct';
      maxQuality: QualityTier;
      durationSeconds: number;
    }
  ) =>
    apiRequest<{
      variantId: number;
      provider: string;
      externalUrl: string;
      availableQualities: QualityTier[];
      episodeDurationSeconds?: number;
    }>(`/api/episodes/${episodeId}/external-variant`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  uploadCover: async (
    file: File
  ): Promise<{ coverPath: string; coverUrl: string }> => {
    const buffer = await file.arrayBuffer();
    const token = getAuthToken();
    const res = await fetch('/api/media/covers', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': file.type || 'image/jpeg',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: buffer,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || 'Błąd przesyłania okładki.');
    }
    return (await res.json()) as { coverPath: string; coverUrl: string };
  },

  uploadVideoVariantChunked: async (
    params: {
      episodeId: number;
      audioDub: AudioDub;
      subtitleMode: SubtitleMode;
      file: File;
    },
    onProgress: (
      percent: number,
      uploadedBytes: number,
      totalBytes: number
    ) => void
  ): Promise<{
    variantId: number;
    availableQualities: QualityTier[];
    durationSeconds: number;
  }> => {
    const { uploadId } = await apiRequest<{ uploadId: string }>(
      '/api/uploads/init',
      {
        method: 'POST',
        body: JSON.stringify({
          episodeId: params.episodeId,
          audioDub: params.audioDub,
          subtitleMode: params.subtitleMode,
          fileName: params.file.name,
          totalSize: params.file.size,
        }),
      }
    );

    const CHUNK_SIZE = 5 * 1024 * 1024;
    let offset = 0;

    while (offset < params.file.size) {
      const end = Math.min(offset + CHUNK_SIZE, params.file.size);
      const slice = params.file.slice(offset, end);
      const buffer = await slice.arrayBuffer();
      const token = getAuthToken();

      const res = await fetch(
        `/api/uploads/${encodeURIComponent(uploadId)}/chunk`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-offset': String(offset),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: buffer,
        }
      );

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          err.error || 'Błąd podczas wysyłania fragmentu wideo.'
        );
      }

      offset = end;
      const pct = Math.round((offset / params.file.size) * 100);
      onProgress(pct, offset, params.file.size);
    }

    return apiRequest<{
      variantId: number;
      availableQualities: QualityTier[];
      durationSeconds: number;
    }>(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST',
    });
  },

  saveProgress: (data: {
    episodeId: number;
    positionSeconds: number;
    durationSeconds: number;
    completed?: boolean;
  }) =>
    apiRequest<{ ok: boolean; completed: boolean }>('/api/progress', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  toggleEpisodeWatched: (episodeId: number, watched: boolean) =>
    apiRequest<{ ok: boolean; watched: boolean }>(
      `/api/episodes/${episodeId}/watched`,
      {
        method: 'POST',
        body: JSON.stringify({ watched }),
      }
    ),

  toggleAnimeWatched: (animeId: number, watched: boolean) =>
    apiRequest<{ ok: boolean; watched: boolean }>(
      `/api/anime/${animeId}/watched`,
      {
        method: 'POST',
        body: JSON.stringify({ watched }),
      }
    ),

  toggleAnimeWatching: (animeId: number, watching: boolean) =>
    apiRequest<{ ok: boolean; watching: boolean }>(
      `/api/anime/${animeId}/watching`,
      {
        method: 'POST',
        body: JSON.stringify({ watching }),
      }
    ),

  getProfileStats: () =>
    apiRequest<{ stats: UserProfileStats }>('/api/profile/stats'),
};
