import { useRef, useMemo, useEffect } from "react";
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
}

export default function LyricsWindow({
  media,
  lyricLines,
  plainLyrics,
  loading,
  error,
  isPlaying,
  settings,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // ── Calculate current lyric index from playback position ──
  const currentIndex = useMemo(() => {
    if (!media || lyricLines.length === 0) return -1;
    for (let i = lyricLines.length - 1; i >= 0; i--) {
      if (media.position >= lyricLines[i].time) return i;
    }
    return -1;
  }, [media?.position, lyricLines]);

  // ── Auto-scroll to current line ──
  useEffect(() => {
    if (currentIndex < 0 || !listRef.current) return;
    const activeEl = listRef.current.children[currentIndex + 1] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentIndex]);

  // ── No media playing ──
  if (!media || media.status === "Stopped") {
    return (
      <div className="lyrics-window">
        <div className="lyrics-placeholder">
          <div className="placeholder-icon">🎵</div>
          <div className="placeholder-text">等待音乐播放...</div>
          <div className="placeholder-sub">
            打开任意音乐 App 开始播放，歌词将自动显示
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="lyrics-window">
        <div className="lyrics-placeholder">
          <div className="placeholder-text">加载歌词中...</div>
        </div>
        <div className="song-info">
          <span className="song-title">{media.title}</span>
          <span className="song-artist"> — {media.artist}</span>
        </div>
      </div>
    );
  }

  // ── Error / no lyrics ──
  if (error && lyricLines.length === 0 && !plainLyrics) {
    return (
      <div className="lyrics-window">
        <div className="lyrics-placeholder">
          <div className="placeholder-text">{error}</div>
        </div>
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
      style={
        {
          "--bg-opacity": settings.bgOpacity,
          "--bg-blur": `${settings.bgBlur}px`,
          "--text-color": settings.textColor,
          "--highlight-color": settings.highlightColor,
          "--font-size": `${settings.fontSize}px`,
        } as React.CSSProperties
      }
    >
      {/* Song info bar */}
      <div className="song-info">
        <span className="song-title">{media.title}</span>
        <span className="song-artist"> — {media.artist}</span>
        {media.source && (
          <span className="song-source"> · {media.source.split(".").pop()}</span>
        )}
        {!isPlaying && <span className="paused-badge">⏸ 已暂停</span>}
      </div>

      {/* Synced lyrics */}
      {lyricLines.length > 0 ? (
        <div className="lyrics-scroll" ref={listRef}>
          {/* Padding before first line */}
          <div className="lyric-pad" />
          {lyricLines.map((line, i) => (
            <div
              key={i}
              className={`lyric-line ${i === currentIndex ? "active" : ""} ${i < currentIndex ? "past" : ""}`}
            >
              {line.text}
            </div>
          ))}
          {/* Padding after last line */}
          <div className="lyric-pad" />
        </div>
      ) : (
        /* Plain text lyrics fallback */
        <div className="lyrics-plain">
          {plainLyrics.split("\n").map((line, i) => (
            <p key={i}>{line || "\u00A0"}</p>
          ))}
        </div>
      )}
    </div>
  );
}
