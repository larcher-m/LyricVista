import express from "express";
import cors from "cors";
import { Converter } from "opencc-js";
import { getLyrics, insertLyrics, upsertPref, getAllPrefs } from "./db";

const app = express();
const PORT = 3456;
const CACHE_VERSION = "v2";

app.use(cors());
app.use(express.json());

let converter: ReturnType<typeof Converter> | null = null;
function getConverter(): ReturnType<typeof Converter> {
  if (!converter) converter = Converter({ from: "tw", to: "cn" });
  return converter;
}

function toSimplified(text: string): string {
  if (!text) return text;
  try {
    return getConverter()(text)
      .replace(/怎幺/g, "怎么")
      .replace(/什幺/g, "什么")
      .replace(/那幺/g, "那么")
      .replace(/这幺/g, "这么")
      .replace(/多幺/g, "多么");
  } catch { return text; }
}

// Safe query param extraction: handle array values
function getQueryParam(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value ?? "");
}

// Validate: non-empty after trim
function isValidParam(s: string): boolean {
  return s.trim().length > 0;
}

type LyricsFetchResult = {
  lyrics: string;
  synced: string | null;
  source: string;
};

function normalizeForMatch(text: string): string {
  return toSimplified(text)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s\-–—_|·~.,，。:："'“”‘’《》<>]/g, "");
}

function isTitleMatch(candidate: string, expected: string): boolean {
  const c = normalizeForMatch(candidate);
  const e = normalizeForMatch(expected);
  return !!c && !!e && (c === e || c.includes(e) || e.includes(c));
}

function isArtistMatch(candidate: string, expected: string): boolean {
  const e = normalizeForMatch(expected);
  if (!e) return true;
  const c = normalizeForMatch(candidate);
  return !!c && (c === e || c.includes(e) || e.includes(c));
}

// ── Fetch from LRCLIB ──
async function fetchLRCLIB(title: string, artist: string, signal?: AbortSignal): Promise<LyricsFetchResult | null> {
  const exactUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
  const exactResp = await fetch(exactUrl, {
    signal,
    headers: { "User-Agent": "LyricVista/1.0" },
  });

  if (exactResp.ok) {
    const data = (await exactResp.json()) as { plainLyrics?: string; syncedLyrics?: string };
    if (data.plainLyrics || data.syncedLyrics) {
      return { lyrics: data.plainLyrics || data.syncedLyrics || "", synced: data.syncedLyrics || null, source: "lrclib" };
    }
  }

  const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  const searchResp = await fetch(searchUrl, {
    signal,
    headers: { "User-Agent": "LyricVista/1.0" },
  });
  if (!searchResp.ok) return null;

  const results = (await searchResp.json()) as Array<{
    trackName?: string;
    name?: string;
    artistName?: string;
    plainLyrics?: string;
    syncedLyrics?: string;
  }>;

  const best = results.find((item) =>
    (item.plainLyrics || item.syncedLyrics) &&
    isTitleMatch(item.trackName || item.name || "", title) &&
    isArtistMatch(item.artistName || "", artist)
  );

  if (!best) return null;
  return {
    lyrics: best.plainLyrics || best.syncedLyrics || "",
    synced: best.syncedLyrics || null,
    source: "lrclib",
  };
}

// ── Fetch from QQ Music ──
async function fetchQQMusic(title: string, artist: string, signal?: AbortSignal): Promise<LyricsFetchResult | null> {
  try {
    const keyword = [title, artist].filter(Boolean).join(" ");
    const searchUrl = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(keyword)}&format=json&inCharset=utf8&outCharset=utf-8`;
    const searchResp = await fetch(searchUrl, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://y.qq.com/" },
    });
    if (!searchResp.ok) return null;

    const searchData = (await searchResp.json()) as {
      data?: { song?: { itemlist?: Array<{ mid?: string; name?: string; singer?: string }> } };
    };
    const candidates = searchData.data?.song?.itemlist || [];
    const best = candidates.find((item) =>
      item.mid &&
      isTitleMatch(item.name || "", title) &&
      isArtistMatch(item.singer || "", artist)
    );
    if (!best?.mid) return null;

    const lyricUrl =
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(best.mid)}` +
      "&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0";
    const lyricResp = await fetch(lyricUrl, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://y.qq.com/" },
    });
    if (!lyricResp.ok) return null;

    const lyricData = (await lyricResp.json()) as { lyric?: string };
    if (!lyricData.lyric) return null;

    const lyric = Buffer.from(lyricData.lyric, "base64").toString("utf8");
    if (!lyric.trim()) return null;
    return { lyrics: lyric, synced: lyric, source: "qqmusic" };
  } catch {
    return null;
  }
}

// ── Fetch from NetEase ──
async function fetchNetEase(title: string, artist: string, signal?: AbortSignal): Promise<LyricsFetchResult | null> {
  try {
    const keyword = [title, artist].filter(Boolean).join(" ");
    const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&limit=10`;
    const searchResp = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
      signal,
    });
    if (!searchResp.ok) return null;
    const searchData = (await searchResp.json()) as {
      result?: { songs?: Array<{ id: number; name: string; artists: Array<{ name: string }> }> };
    };

    const songs = searchData.result?.songs;
    if (!songs || songs.length === 0) return null;

    const bestSong = songs.find((song) =>
      isTitleMatch(song.name, title) &&
      isArtistMatch((song.artists || []).map((a) => a.name).join(" "), artist)
    );
    if (!bestSong) return null;

    const lyricUrl = `https://music.163.com/api/song/lyric?id=${bestSong.id}&lv=1`;
    const lyricResp = await fetch(lyricUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
      signal,
    });
    if (!lyricResp.ok) return null;
    const lyricData = (await lyricResp.json()) as { lrc?: { lyric?: string } };

    const lrc = lyricData.lrc?.lyric || "";
    if (!lrc) return null;

    return { lyrics: lrc, synced: lrc, source: "netease" };
  } catch {
    return null;
  }
}

// ── Lyrics API ──
app.get("/api/lyrics", async (req, res) => {
  try {
    const rawTitle = getQueryParam(req.query.title);
    const rawArtist = getQueryParam(req.query.artist);

    // Bug fix #2: handle array query params
    // Bug fix #3: validate after trim
    if (!isValidParam(rawTitle)) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const originalTitle = rawTitle.trim();
    const originalArtist = rawArtist.trim();
    const t = toSimplified(originalTitle);
    const a = toSimplified(originalArtist);
    const cacheTitle = `${CACHE_VERSION}:${t}`;

    // 1. Check cache
    const cached = getLyrics.get({ title: cacheTitle, artist: a }) as { lyrics: string; synced_lyrics: string | null } | undefined;
    if (cached) {
      res.json({
        lyrics: cached.lyrics,
        syncedLyrics: cached.synced_lyrics || null,
        cached: true,
        source: "cache",
      });
      return;
    }

    // 2. Fetch with timeout (Bug fix #21: AbortSignal.timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const safeFetch = (promise: Promise<LyricsFetchResult | null>) =>
      promise.catch(() => null);

    const [qqmusic, lrclib, netease] = await Promise.all([
      safeFetch(fetchQQMusic(t, a, controller.signal)),
      safeFetch(fetchLRCLIB(t, a, controller.signal)),
      safeFetch(fetchNetEase(t, a, controller.signal)),
    ]);

    clearTimeout(timeout);

    const result = qqmusic || lrclib || netease || null;

    if (!result || (!result.lyrics && !result.synced)) {
      res.status(404).json({ error: "歌词未找到" });
      return;
    }

    // Convert to simplified
    const lyrics = toSimplified(result.lyrics);
    const synced = result.synced ? toSimplified(result.synced) : null;

    // Cache
    insertLyrics.run({ title: cacheTitle, artist: a, lyrics, synced_lyrics: synced });

    // Bug fix #14: include source in response
    res.json({
      lyrics,
      syncedLyrics: synced || null,
      cached: false,
      source: result.source || "unknown",
    });
  } catch (err) {
    console.error("Lyrics route error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// ── Preferences API ──
app.get("/api/preferences", (_req, res) => {
  try {
    const rows = getAllPrefs.all() as { key: string; value: string }[];
    const prefs: Record<string, string> = {};
    for (const row of rows) prefs[row.key] = row.value;
    res.json(prefs);
  } catch {
    res.status(500).json({ error: "internal server error" });
  }
});

// Bug fix #1: null body check
app.put("/api/preferences", (req, res) => {
  try {
    const updates = req.body;
    if (!updates || updates === null || typeof updates !== "object" || Array.isArray(updates)) {
      res.status(400).json({ error: "body must be a non-null key-value object" });
      return;
    }
    for (const [key, value] of Object.entries(updates)) {
      upsertPref.run({ key, value: String(value) });
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "internal server error" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`LyricVista backend running on http://localhost:${PORT}`);
});
