import { useState, useEffect, useCallback, useRef } from "react";
import LyricsWindow from "./components/LyricsWindow";
import SettingsPanel from "./components/SettingsPanel";
import { SMTCData, LyricLine, AppSettings, DEFAULT_SETTINGS, LyricsResponse } from "./types";

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const regex = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/g;
  let match: RegExpExecArray | null;
  const skipPatterns = /^(作词|作曲|编曲|混音|制作|和声|吉他|贝斯|键盘|鼓|录音|母带|混缩|监制|出品|发行|OP|SP|演唱|词|曲|编|制作人|原唱|翻唱|专辑|出品人)/;
  while ((match = regex.exec(lrc)) !== null) {
    const mins = parseInt(match[1], 10);
    const secs = parseFloat(match[2]);
    const text = match[3].trim();
    if (text && !skipPatterns.test(text)) {
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
  const lyricsRequestIdRef = useRef(0);
  const lastMediaRef = useRef<SMTCData | null>(null);
  const vanishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKugouPositionRef = useRef<{ key: string; position: number } | null>(null);
  const kugouAutoAdvanceUntilRef = useRef(0);

  useEffect(() => {
    fetch("/api/preferences")
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
  }, []);

  const fetchLyrics = useCallback(async (title: string, artist: string) => {
    const key = `${title}|${artist}`;
    if (currentSongRef.current === key) return;
    currentSongRef.current = key;
    const requestId = ++lyricsRequestIdRef.current;
    setLoading(true);
    setError("");

    const isCurrentRequest = () =>
      lyricsRequestIdRef.current === requestId && currentSongRef.current === key;

    try {
      const url = `/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt === 1) {
          setError("重试中...");
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (!isCurrentRequest()) return;
        }

        try {
          const resp = await fetch(url);
          if (!isCurrentRequest()) return;

          if (!resp.ok) {
            if (attempt === 0) continue;
            setLyricLines([]); setPlainLyrics(""); setError("歌词未找到");
            return;
          }

          const data: LyricsResponse = await resp.json();
          if (!isCurrentRequest()) return;

          if (data.syncedLyrics) {
            setLyricLines(parseLRC(data.syncedLyrics));
            setPlainLyrics("");
            setError("");
            return;
          }

          if (data.lyrics) {
            setPlainLyrics(data.lyrics);
            setLyricLines([]);
            setError("");
            return;
          }
        } catch {
          if (attempt === 0) continue;
          if (!isCurrentRequest()) return;
        }
      }

      setLyricLines([]); setPlainLyrics(""); setError("歌词未找到");
    } catch {
      if (isCurrentRequest()) {
        setLyricLines([]); setPlainLyrics(""); setError("歌词服务连接失败");
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, []);

  const handleSongStatus = useCallback((data: SMTCData | null) => {
    if (!data) {
      if (lastMediaRef.current && !vanishTimerRef.current) {
        vanishTimerRef.current = setTimeout(() => {
          setMedia(null); setLyricLines([]); setPlainLyrics("");
          setError(""); currentSongRef.current = "";
          lyricsRequestIdRef.current++;
          lastKugouPositionRef.current = null;
          kugouAutoAdvanceUntilRef.current = 0;
          lastMediaRef.current = null; vanishTimerRef.current = null;
        }, 3000);
      }
      return;
    }

    if (vanishTimerRef.current) { clearTimeout(vanishTimerRef.current); vanishTimerRef.current = null; }

    if (data.positionSource === "kugou_ini") {
      const key = `${data.title}|${data.artist}`;
      const last = lastKugouPositionRef.current;
      const sameSong = last?.key === key;
      const positionChanged = !sameSong || Math.abs(data.position - (last?.position ?? 0)) >= 0.5;
      if (positionChanged || data.status === "Playing") {
        kugouAutoAdvanceUntilRef.current = Date.now() + 5000;
      }
      lastKugouPositionRef.current = { key, position: data.position };
    } else {
      lastKugouPositionRef.current = null;
      kugouAutoAdvanceUntilRef.current = 0;
    }

    lastMediaRef.current = data;
    setMedia(data);
    if (data.title) fetchLyrics(data.title, data.artist);
  }, [fetchLyrics]);

  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanup = window.electronAPI.onSongStatus(handleSongStatus);
    window.electronAPI.getSongStatus().then(handleSongStatus).catch(() => {});
    return () => {
      cleanup();
      if (vanishTimerRef.current) clearTimeout(vanishTimerRef.current);
    };
  }, [handleSongStatus]);

  const saveSettings = useCallback(async (newSettings: AppSettings) => {
    setSettings(newSettings);
    try {
      await fetch("/api/preferences", {
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

  const isKugouPositionMode = media?.positionSource === "kugou_ini";
  const isKugouAutoAdvancing = !!(isKugouPositionMode && Date.now() < kugouAutoAdvanceUntilRef.current);
  const isPlaying = media?.status === "Playing" || isKugouAutoAdvancing;

  return (
    <div
      className="app-container"
      style={{
        fontFamily: settings.fontFamily,
        // Bug fix #8: CSS custom properties on parent so children inherit them
        "--bg-opacity": settings.bgOpacity,
        "--bg-blur": `${settings.bgBlur}px`,
        "--text-color": settings.textColor,
        "--highlight-color": settings.highlightColor,
        "--font-size": `${settings.fontSize}px`,
      } as React.CSSProperties}
    >
      {showSettings ? (
        <SettingsPanel settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} />
      ) : (
        <LyricsWindow
          media={media} lyricLines={lyricLines} plainLyrics={plainLyrics}
          loading={loading} error={error} isPlaying={isPlaying}
        />
      )}

      <div className="mini-controls">
        <button className="ctrl-btn" onClick={() => setShowSettings((v) => !v)} title="设置">⚙</button>
        <button className="ctrl-btn" onClick={() => window.electronAPI?.minimizeToTray()} title="最小化到托盘">─</button>
        <button className="ctrl-btn ctrl-close" onClick={() => window.electronAPI?.quitApp()} title="退出">✕</button>
      </div>
    </div>
  );
}
