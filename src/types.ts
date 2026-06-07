export interface LyricLine {
  time: number;
  text: string;
}

export interface SMTCData {
  title: string;
  artist: string;
  status: string;
  position: number;
  timelineStart: number;
  timelineEnd: number;
  source: string;
  method: string;
  positionSource?: string;
  kugouPositionMs?: number;
  kugouPositionUpdatedAt?: string;
}

export interface LyricsResponse {
  lyrics: string;
  syncedLyrics: string | null;
  cached: boolean;
  source?: string;
}

export interface AppSettings {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  highlightColor: string;
  bgOpacity: number;
  bgBlur: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 22,
  fontFamily: "Microsoft YaHei, sans-serif",
  textColor: "#ffffff",
  highlightColor: "#ffdd57",
  bgOpacity: 0.7,
  bgBlur: 8,
};

declare global {
  interface Window {
    electronAPI: {
      getSongStatus: () => Promise<SMTCData | null>;
      onSongStatus: (cb: (data: SMTCData | null) => void) => () => void;
      minimizeToTray: () => void;
      quitApp: () => void;
    };
  }
}
