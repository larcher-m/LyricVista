import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { SMTCData, LyricLine, AppSettings } from "../types";
import "./LyricsWindow.css";

interface Props {
  media: SMTCData | null;
  lyricLines: LyricLine[];
  plainLyrics: string;
  loading: boolean;
  error: string;
  isPlaying: boolean;
  settings: AppSettings;
  playbackStart: number;
}

export default function LyricsWindow({
  media, lyricLines, plainLyrics, loading, error, isPlaying, settings,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const plainRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [syncFlash, setSyncFlash] = useState(false);
  const startTimeRef = useRef(Date.now());
  const prevKeyRef = useRef("");
  

  const hasTimeline = !!(media && (media.position > 0 || media.timelineEnd > 0));

  // Reset timer on new song
  const lyricKey = lyricLines.length > 0 ? lyricLines[0].text : "";
  useEffect(() => {
    if (lyricKey && lyricKey !== prevKeyRef.current) {
      prevKeyRef.current = lyricKey;
      startTimeRef.current = Date.now();
    }
  }, [lyricKey]);


  // Tick
  useEffect(() => {
    if (hasTimeline || lyricLines.length === 0 || !isPlaying) return;
    const t = setInterval(() => setTick((n) => n + 1), 150);
    return () => clearInterval(t);
  }, [hasTimeline, lyricLines.length, isPlaying]);

  // Current index
  const currentIndex = useMemo(() => {
    if (lyricLines.length === 0) return -1;
    if (hasTimeline && media) {
      for (let i = lyricLines.length - 1; i >= 0; i--) {
        if (media.position >= lyricLines[i].time) return i;
      }
      return 0;
    }
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    for (let i = lyricLines.length - 1; i >= 0; i--) {
      if (elapsed >= lyricLines[i].time) return i;
    }
    return 0;
  }, [tick, lyricLines, hasTimeline, media]);

  // Scroll
  useEffect(() => {
    if (currentIndex < 0 || !listRef.current) return;
    const kids = listRef.current.children;
    if (currentIndex + 1 < kids.length) {
      (kids[currentIndex + 1] as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentIndex]);

  // Click line to sync
  const syncToLine = useCallback((idx: number) => {
    if (idx < 0 || idx >= lyricLines.length) return;
    startTimeRef.current = Date.now() - lyricLines[idx].time * 1000;
    setSyncFlash(true);
    setTimeout(() => setSyncFlash(false), 600);
  }, [lyricLines]);

  // Manual re-sync button (reset from 0)
  const handleResync = useCallback(() => {
    if (lyricLines.length === 0) return;
    startTimeRef.current = Date.now();
    setSyncFlash(true);
    setTimeout(() => setSyncFlash(false), 600);
  }, [lyricLines.length]);

  // Plain lyrics scroll
  useEffect(() => {
    if (!plainRef.current || lyricLines.length > 0 || !isPlaying) return;
    let id = 0, last = performance.now();
    const f = () => {
      const n = performance.now();
      if (plainRef.current) plainRef.current.scrollTop += 12 * (n - last) / 1000;
      last = n;
      if (plainRef.current && plainRef.current.scrollTop + plainRef.current.clientHeight >= plainRef.current.scrollHeight - 20) {
        plainRef.current.scrollTop = 0;
      }
      id = requestAnimationFrame(f);
    };
    id = requestAnimationFrame(f);
    return () => cancelAnimationFrame(id);
  }, [lyricLines.length, isPlaying]);

  if (!media || media.status === "Stopped") {
    return (
      <div className="lyrics-window">
        <div className="lyrics-placeholder">
          <div className="placeholder-icon">🎵</div>
          <div className="placeholder-text">等待音乐播放...</div>
          <div className="placeholder-sub">打开任意音乐 App 开始播放，歌词将自动显示</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="lyrics-window">
        <div className="lyrics-placeholder"><div className="placeholder-text">加载歌词中...</div></div>
        <div className="song-info">
          <span className="song-title">{media.title}</span>
          <span className="song-artist"> — {media.artist}</span>
        </div>
      </div>
    );
  }

  if (error && lyricLines.length === 0 && !plainLyrics) {
    return (
      <div className="lyrics-window">
        <div className="lyrics-placeholder"><div className="placeholder-text">😔 {error}</div></div>
        <div className="song-info no-lyrics">
          <span className="song-title">{media.title}</span>
          <span className="song-artist"> — {media.artist}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="lyrics-window"
      style={{
        "--bg-opacity": settings.bgOpacity,
        "--bg-blur": `${settings.bgBlur}px`,
        "--text-color": settings.textColor,
        "--highlight-color": settings.highlightColor,
        "--font-size": `${settings.fontSize}px`,
      } as React.CSSProperties}
    >
      <div className="song-info">
        <span className="song-title">{media.title}</span>
        <span className="song-artist"> — {media.artist}</span>
        {media.source && <span className="song-source"> · {media.source.split(".").pop()}</span>}
        {!isPlaying && <span className="paused-badge">⏸</span>}
        {syncFlash && <span className="paused-badge" style={{ color: "#5f5" }}>✓ 已同步</span>}
        {!hasTimeline && isPlaying && lyricLines.length > 0 && (
          <span className="paused-badge" style={{ color: "#88ccff", cursor: "pointer", WebkitAppRegion: "no-drag" }} onClick={handleResync}>
            ⟳ 重新同步
          </span>
        )}
      </div>

      {lyricLines.length > 0 ? (
        <div className="lyrics-scroll" ref={listRef} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" }}>
          <div className="lyric-pad" />
          {lyricLines.map((line, i) => (
            <div
              key={i}
              className={`lyric-line ${i === currentIndex ? "active" : ""} ${i < currentIndex ? "past" : ""}`}
              onClick={() => syncToLine(i)}
            >
              {line.text}
            </div>
          ))}
          <div className="lyric-pad" />
        </div>
      ) : (
        <div className="lyrics-plain" ref={plainRef}>
          <div className="lyric-pad" />
          {plainLyrics.split("\n").map((line, i) => (
            <p key={i}>{line || "\u00A0"}</p>
          ))}
          <div className="lyric-pad" />
        </div>
      )}
    </div>
  );
}
