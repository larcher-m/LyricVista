// ── LRC Lyrics Line ──
export interface LyricLine {
  time: number;   // seconds
  text: string;
}

// ── SMTC Data from main process ──
export interface SMTCData {
  title: string;
  artist: string;
  status: string;
  position: number;
  timelineStart: number;
  timelineEnd: number;
  source: string;
}

// ── Lyrics API Response ──
export interface LyricsResponse {
  lyrics: string;
  syncedLyrics: string | null;
  cached: boolean;
}

// ── App Settings ──
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
  bgOpacity: 0.25,
  bgBlur: 8,
};

// ── Electron API exposed via preload ──
declare global {
  interface Window {
    electronAPI: {
      getSongStatus: () => Promise<SMTCData | null>;
      toggleWindow: () => void;
      setWindowOpacity: (opacity: number) => void;
      minimizeToTray: () => void;
      onSMTCUpdate: (cb: (data: SMTCData | null) => void) => () => void;
      getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
    };
  }
}
