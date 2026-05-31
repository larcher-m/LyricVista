import { useState, useEffect, useCallback, useRef } from "react";
import LyricsWindow from "./components/LyricsWindow";
import SettingsPanel from "./components/SettingsPanel";
import { SMTCData, LyricLine, AppSettings, DEFAULT_SETTINGS, LyricsResponse } from "./types";

const BACKEND_URL = "http://localhost:3456";

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const regex = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(lrc)) !== null) {
    const mins = parseInt(match[1], 10);
    const secs = parseFloat(match[2]);
    const text = match[3].trim();
    if (text) {
      lines.push({ time: mins * 60 + secs, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [media, setMedia] = useState<SMTCData | null>(null);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentSongRef = useRef("");

  // ── Load settings from backend on mount ──
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/preferences`)
      .then((r) => r.json())
      .then((prefs: Record<string, string>) => {
        if (Object.keys(prefs).length > 0) {
          setSettings((prev) => ({
            ...prev,
            fontSize: prefs.fontSize ? Number(prefs.fontSize) : prev.fontSize,
            fontFamily: prefs.fontFamily || prev.fontFamily,
            textColor: prefs.textColor || prev.textColor,
            highlightColor: prefs.highlightColor || prev.highlightColor,
            bgOpacity: prefs.bgOpacity ? Number(prefs.bgOpacity) : prev.bgOpacity,
            bgBlur: prefs.bgBlur ? Number(prefs.bgBlur) : prev.bgBlur,
          }));
        }
      })
      .catch(() => {});

    // Sync window opacity
    window.electronAPI?.setWindowOpacity(DEFAULT_SETTINGS.bgOpacity + 0.5);
  }, []);

  // ── Fetch lyrics ──
  const fetchLyrics = useCallback(async (title: string, artist: string) => {
    const key = `${title}|${artist}`;
    if (currentSongRef.current === key) return;
    currentSongRef.current = key;
    setLoading(true);
    setError("");

    try {
      const resp = await fetch(
        `${BACKEND_URL}/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`
      );
      if (!resp.ok) {
        setLyricLines([]);
        setPlainLyrics("");
        setError("歌词未找到");
        return;
      }
      const data: LyricsResponse = await resp.json();
      if (data.syncedLyrics) {
        setLyricLines(parseLRC(data.syncedLyrics));
        setPlainLyrics("");
      } else if (data.lyrics) {
        setPlainLyrics(data.lyrics);
        setLyricLines([]);
      } else {
        setLyricLines([]);
        setPlainLyrics("");
        setError("歌词未找到");
      }
    } catch {
      setLyricLines([]);
      setPlainLyrics("");
      setError("歌词服务连接失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── SMTC polling ──
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const data = await window.electronAPI?.getSongStatus();
        if (!data) {
          setMedia(null);
          return;
        }
        setMedia(data);
        if (data.title) {
          fetchLyrics(data.title, data.artist);
        }
      } catch {
        // ignore polling errors
      }
    }, 1000);

    return () => clearInterval(poll);
  }, [fetchLyrics]);

  // ── Save settings ──
  const saveSettings = useCallback(async (newSettings: AppSettings) => {
    setSettings(newSettings);
    window.electronAPI?.setWindowOpacity(newSettings.bgOpacity + 0.5);

    try {
      await fetch(`${BACKEND_URL}/api/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fontSize: String(newSettings.fontSize),
          fontFamily: newSettings.fontFamily,
          textColor: newSettings.textColor,
          highlightColor: newSettings.highlightColor,
          bgOpacity: String(newSettings.bgOpacity),
          bgBlur: String(newSettings.bgBlur),
        }),
      });
    } catch {}
  }, []);

  // ── Detect if song is playing ──
  const isPlaying = media?.status === "Playing";

  return (
    <div
      className="app-container"
      style={{ fontFamily: settings.fontFamily }}
    >
      {showSettings ? (
        <SettingsPanel
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      ) : (
        <LyricsWindow
          media={media}
          lyricLines={lyricLines}
          plainLyrics={plainLyrics}
          loading={loading}
          error={error}
          isPlaying={isPlaying}
          settings={settings}
        />
      )}

      {/* Mini controls */}
      <div className="mini-controls">
        <button
          className="ctrl-btn"
          onClick={() => setShowSettings((v) => !v)}
          title="设置"
        >
          ⚙
        </button>
        <button
          className="ctrl-btn"
          onClick={() => window.electronAPI?.minimizeToTray()}
          title="最小化到托盘"
        >
          ─
        </button>
        <button
          className="ctrl-btn ctrl-close"
          onClick={() => window.electronAPI?.minimizeToTray()}
          title="隐藏"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
