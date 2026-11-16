export type UserRole = 'owner' | 'admin' | 'normal';

export type AudioDub = 'jp' | 'en';

export type SubtitleMode = 'pl' | 'en' | 'none';

export type QualityTier = '2k' | '1080p' | '720p' | '480p';

export type PreferredQuality = 'max' | QualityTier;

export interface UserPreferences {
  preferredDub: AudioDub;
  preferredSub: SubtitleMode;
  preferredQuality: PreferredQuality;
}

export interface UserAccount {
  id: number;
  username: string;
  role: UserRole;
  preferredDub: AudioDub;
  preferredSub: SubtitleMode;
  preferredQuality: PreferredQuality;
  createdAt: string;
}

export interface Genre {
  id: number;
  name: string;
}

export type VideoSourceType = 'upload' | 'external';

export type ExternalProvider = 'gdrive_preview' | 'gdrive_direct' | 'direct' | '';

export interface EpisodeVariant {
  id: number;
  episodeId: number;
  audioDub: AudioDub;
  subtitleMode: SubtitleMode;
  sourceType: VideoSourceType;
  externalUrl: string;
  externalProvider: ExternalProvider;
  fileSizeBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  durationSeconds: number;
  availableQualities: QualityTier[];
  readyQualities: QualityTier[];
  transcodeStatus: 'ready' | 'processing' | 'failed';
}

export interface Episode {
  id: number;
  animeId: number;
  episodeNumber: number;
  title: string;
  synopsis: string;
  durationSeconds: number;
  introStart: number | null;
  introEnd: number | null;
  outroStart: number | null;
  outroEnd: number | null;
  variants: EpisodeVariant[];
  watched: boolean;
  progressSeconds: number;
}

export interface AnimeRelation {
  id: number;
  sourceAnimeId: number;
  targetAnimeId: number;
  targetTitle: string;
  targetCoverUrl: string;
  targetYear: number;
  relationType: string;
}

export interface AnimeSummary {
  id: number;
  title: string;
  originalTitle: string;
  synopsis: string;
  releaseYear: number;
  studio: string;
  status: 'Zakończone' | 'Emitowane' | 'Planowane';
  coverUrl: string;
  genres: Genre[];
  episodeCount: number;
  watchedEpisodeCount: number;
  isSeriesWatched: boolean;
  createdAt: string;
}

export interface AnimeDetail extends AnimeSummary {
  episodes: Episode[];
  relations: AnimeRelation[];
}

export interface ContinueWatchingItem {
  animeId: number;
  animeTitle: string;
  coverUrl: string;
  episodeId: number;
  episodeNumber: number;
  episodeTitle: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}

export interface UserProfileStats {
  totalWatchSeconds: number;
  watchedEpisodesCount: number;
  completedAnimeCount: number;
  watchedAnimeList: AnimeSummary[];
  continueWatching: ContinueWatchingItem[];
}
