import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { SMTCData, LyricLine } from "../types";
import "./LyricsWindow.css";

interface Props {
  media: SMTCData | null;
  lyricLines: LyricLine[];
  plainLyrics: string;
  loading: boolean;
  error: string;
  isPlaying: boolean;
}

const LEAD_TIME = 0.5;
const KUGOU_LEAD_TIME = 1.4;
const TICK_MS = 100;
const FLASH_MS = 600;

export default function LyricsWindow({
  media, lyricLines, plainLyrics, loading, error, isPlaying,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const plainRef = useRef<HTMLDivElement>(null);
  const [syncFlash, setSyncFlash] = useState(false);
  const [smoothTime, setSmoothTime] = useState(0);

  const smtcBaseRef = useRef({ position: 0, timestamp: Date.now() });
  const fallbackElapsedMsRef = useRef(0);
  const fallbackStartedAtRef = useRef(Date.now());
  const detectedPlayingAtRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const prevMediaKeyRef = useRef("");
  const prevLyricsKeyRef = useRef("");
  const prevTimelineBaseRef = useRef({
    mediaKey: "",
    position: Number.NaN,
    isPlaying: false,
  });
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mediaKey = media ? `${media.title}|${media.artist}` : "";
  const lyricsKey = lyricLines.length > 0 ? `${mediaKey}|${lyricLines.length}` : "";
  const hasTimeline = !!(media && (media.position > 0 || media.timelineEnd > 0));
  const leadTime = media?.positionSource === "kugou_ini" ? KUGOU_LEAD_TIME : LEAD_TIME;

  const flash = useCallback(() => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setSyncFlash(true);
    flashTimerRef.current = setTimeout(() => setSyncFlash(false), FLASH_MS);
  }, []);

  const currentFallbackSeconds = useCallback(() => {
    const elapsed = fallbackElapsedMsRef.current +
      (isPlaying ? Date.now() - fallbackStartedAtRef.current : 0);
    return Math.max(0, elapsed / 1000);
  }, [isPlaying]);

  const currentTimelineSeconds = useCallback(() => {
    const base = smtcBaseRef.current;
    const elapsed = isPlaying ? (Date.now() - base.timestamp) / 1000 : 0;
    const value = base.position + elapsed;
    const end = media?.timelineEnd ?? 0;
    return end > 0 ? Math.min(value, end) : value;
  }, [isPlaying, media?.timelineEnd]);

  const readCurrentSeconds = useCallback(() => {
    return hasTimeline ? currentTimelineSeconds() : currentFallbackSeconds();
  }, [currentFallbackSeconds, currentTimelineSeconds, hasTimeline]);

  useEffect(() => {
    if (!mediaKey) return;
    if (mediaKey !== prevMediaKeyRef.current) {
      const now = Date.now();
      prevMediaKeyRef.current = mediaKey;
      detectedPlayingAtRef.current = isPlaying ? now : 0;
      fallbackElapsedMsRef.current = Math.max(0, (media?.position ?? 0) * 1000);
      fallbackStartedAtRef.current = now;
      smtcBaseRef.current = { position: media?.position ?? 0, timestamp: now };
      setSmoothTime(media?.position ?? 0);
    }
  }, [mediaKey, isPlaying, media?.position]);

  useEffect(() => {
    if (!mediaKey) {
      detectedPlayingAtRef.current = 0;
      return;
    }
    if (isPlaying && !detectedPlayingAtRef.current) {
      detectedPlayingAtRef.current = Date.now();
    }
  }, [isPlaying, mediaKey]);

  useEffect(() => {
    if (!lyricsKey || lyricsKey === prevLyricsKeyRef.current) return;
    const now = Date.now();
    prevLyricsKeyRef.current = lyricsKey;

    if (hasTimeline) {
      smtcBaseRef.current = { position: media?.position ?? 0, timestamp: now };
      setSmoothTime(media?.position ?? 0);
      return;
    }

    fallbackElapsedMsRef.current = isPlaying && detectedPlayingAtRef.current
      ? now - detectedPlayingAtRef.current
      : 0;
    fallbackStartedAtRef.current = now;
    setSmoothTime(fallbackElapsedMsRef.current / 1000);
  }, [lyricsKey, hasTimeline, isPlaying, media?.position]);

  useEffect(() => {
    if (!media || !hasTimeline) return;
    const now = Date.now();
    const position = Math.max(0, media.position);
    const previous = prevTimelineBaseRef.current;
    const songChanged = previous.mediaKey !== mediaKey;
    const positionChanged = Number.isNaN(previous.position) || Math.abs(position - previous.position) >= 0.2;
    const playStateChanged = previous.isPlaying !== isPlaying;

    if (songChanged || positionChanged || playStateChanged || !isPlaying) {
      smtcBaseRef.current = { position, timestamp: now };
      if (!isPlaying) setSmoothTime(position);
    }

    prevTimelineBaseRef.current = { mediaKey, position, isPlaying };
  }, [mediaKey, media?.position, hasTimeline, isPlaying]);

  useEffect(() => {
    if (hasTimeline) {
      wasPlayingRef.current = isPlaying;
      return;
    }

    const now = Date.now();
    if (isPlaying && !wasPlayingRef.current) {
      fallbackStartedAtRef.current = now;
    }
    if (!isPlaying && wasPlayingRef.current) {
      fallbackElapsedMsRef.current += now - fallbackStartedAtRef.current;
      setSmoothTime(fallbackElapsedMsRef.current / 1000);
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, hasTimeline]);

  useEffect(() => {
    if (lyricLines.length === 0) {
      setSmoothTime(0);
      return;
    }

    setSmoothTime(readCurrentSeconds());
    if (!isPlaying) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setSmoothTime(readCurrentSeconds());
      const drift = Date.now() % TICK_MS;
      timer = setTimeout(tick, Math.max(30, TICK_MS - drift));
    };
    timer = setTimeout(tick, TICK_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isPlaying, lyricLines.length, readCurrentSeconds]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const currentIndex = useMemo(() => {
    if (lyricLines.length === 0 || smoothTime <= 0) return -1;
    const adjusted = smoothTime + leadTime;
    for (let i = lyricLines.length - 1; i >= 0; i--) {
      if (adjusted >= lyricLines[i].time) return i;
    }
    return 0;
  }, [smoothTime, lyricLines, leadTime]);

  useEffect(() => {
    if (currentIndex < 0 || !listRef.current) return;
    const children = listRef.current.children;
    if (currentIndex + 1 < children.length) {
      (children[currentIndex + 1] as HTMLElement).scrollIntoView({ behavior: "auto", block: "center" });
    }
  }, [currentIndex]);

  const syncToLine = useCallback((idx: number) => {
    if (idx < 0 || idx >= lyricLines.length) return;
    const lineTime = lyricLines[idx].time;
    const now = Date.now();

    if (hasTimeline) {
      smtcBaseRef.current = { position: lineTime, timestamp: now };
    } else {
      fallbackElapsedMsRef.current = lineTime * 1000;
      fallbackStartedAtRef.current = now;
    }
    setSmoothTime(lineTime);
    flash();
  }, [flash, hasTimeline, lyricLines]);

  const handleResync = useCallback(() => {
    const now = Date.now();
    fallbackElapsedMsRef.current = 0;
    fallbackStartedAtRef.current = now;
    smtcBaseRef.current = { position: 0, timestamp: now };
    setSmoothTime(0);
    flash();
  }, [flash]);

  useEffect(() => {
    if (!plainRef.current || lyricLines.length > 0 || !isPlaying) return;
    let id = 0;
    let last = performance.now();
    const scroll = () => {
      const now = performance.now();
      if (plainRef.current) {
        plainRef.current.scrollTop += 12 * (now - last) / 1000;
      }
      last = now;
      if (plainRef.current &&
          plainRef.current.scrollTop + plainRef.current.clientHeight >=
          plainRef.current.scrollHeight - 20) {
        plainRef.current.scrollTop = 0;
      }
      id = requestAnimationFrame(scroll);
    };
    id = requestAnimationFrame(scroll);
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
    <div className="lyrics-window">
      <div className="song-info">
        <span className="song-title">{media.title}</span>
        <span className="song-artist"> — {media.artist}</span>
        {media.source && <span className="song-source"> · {media.source.split(".").pop()}</span>}
        {!isPlaying && <span className="paused-badge">⏸</span>}
        {syncFlash && <span className="paused-badge" style={{ color: "#5f5" }}>✓</span>}
        {!hasTimeline && isPlaying && lyricLines.length > 0 && (
          <span
            className="paused-badge"
            style={{ color: "#88ccff", cursor: "pointer", WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={handleResync}
          >
            ⟳ 从头同步
          </span>
        )}
      </div>

      {lyricLines.length > 0 ? (
        <div className="lyrics-scroll" ref={listRef} style={{ WebkitAppRegion: "no-drag", cursor: "pointer" } as React.CSSProperties}>
          <div className="lyric-pad" />
          {lyricLines.map((line, i) => (
            <div
              key={`${line.time}-${line.text}`}
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
            <p key={`${i}-${line}`}>{line || " "}</p>
          ))}
          <div className="lyric-pad" />
        </div>
      )}
    </div>
  );
}
