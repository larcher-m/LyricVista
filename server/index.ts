import express from "express";
import cors from "cors";
import { Converter } from "opencc-js";
import { getLyrics, insertLyrics, upsertPref, getAllPrefs } from "./db";

const app = express();
const PORT = 3456;

app.use(cors());
app.use(express.json());

let converter: ReturnType<typeof Converter> | null = null;
function getConverter(): ReturnType<typeof Converter> {
  if (!converter) converter = Converter({ from: "tw", to: "cn" });
  return converter;
}

function toSimplified(text: string): string {
  if (!text) return text;
  try { return getConverter()(text); } catch { return text; }
}

// ── Fetch from LRCLIB ──
async function fetchLRCLIB(title: string, artist: string): Promise<{ lyrics: string; synced: string | null } | null> {
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = (await resp.json()) as { plainLyrics?: string; syncedLyrics?: string };
  if (!data.plainLyrics && !data.syncedLyrics) return null;
  return { lyrics: data.plainLyrics || "", synced: data.syncedLyrics || null };
}

// ── Fetch from NetEase Cloud Music ──
async function fetchNetEase(title: string, artist: string): Promise<{ lyrics: string; synced: string | null } | null> {
  try {
    // Step 1: Search for the song
    const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(title + " " + artist)}&type=1&limit=5`;
    const searchResp = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
    });
    if (!searchResp.ok) return null;
    const searchData = (await searchResp.json()) as {
      result?: { songs?: Array<{ id: number; name: string; artists: Array<{ name: string }> }> };
    };

    const songs = searchData.result?.songs;
    if (!songs || songs.length === 0) return null;

    // Find best match (case-insensitive artist match)
    let songId = songs[0].id;
    const lowerArtist = artist.toLowerCase();
    for (const s of songs) {
      const songArtists = (s.artists || []).map((a) => a.name.toLowerCase()).join(",");
      if (songArtists.includes(lowerArtist)) {
        songId = s.id;
        break;
      }
    }

    // Step 2: Get lyrics
    const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1`;
    const lyricResp = await fetch(lyricUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com" },
    });
    if (!lyricResp.ok) return null;
    const lyricData = (await lyricResp.json()) as { lrc?: { lyric?: string }; tlyric?: { lyric?: string } };

    const lrc = lyricData.lrc?.lyric || "";
    const tlyric = lyricData.tlyric?.lyric || ""; // translation (optional)

    if (!lrc) return null;

    return { lyrics: lrc, synced: lrc }; // NetEase returns LRC format directly
  } catch {
    return null;
  }
}

// ── Lyrics API ──
app.get("/api/lyrics", async (req, res) => {
  try {
    const { title, artist } = req.query;
    if (!title || !artist) {
      res.status(400).json({ error: "title and artist are required" });
      return;
    }

    const t = toSimplified((title as string).trim());
    const a = toSimplified((artist as string).trim());

    // 1. Check cache
    const cached = getLyrics.get({ title: t, artist: a }) as { lyrics: string; synced_lyrics: string | null } | undefined;
    if (cached) {
      res.json({
        lyrics: cached.lyrics,
        syncedLyrics: cached.synced_lyrics || null,
        cached: true,
      });
      return;
    }

    // 2. Fetch: LRCLIB → NetEase (fallback)
    let result: { lyrics: string; synced: string | null } | null = null;
    let source = "";

    // Try LRCLIB
    result = await fetchLRCLIB(t, a);
    if (result) source = "lrclib";

    // Try NetEase as fallback
    if (!result) {
      result = await fetchLRCLIB(title as string, artist as string); // try original text
      if (result) source = "lrclib";
    }
    if (!result) {
      result = await fetchNetEase(t, a);
      if (result) source = "netease";
    }
    if (!result) {
      result = await fetchNetEase(title as string, artist as string);
      if (result) source = "netease";
    }

    if (!result || (!result.lyrics && !result.synced)) {
      res.status(404).json({ error: "歌词未找到" });
      return;
    }

    // Convert to simplified
    const lyrics = toSimplified(result.lyrics);
    const synced = result.synced ? toSimplified(result.synced) : null;

    // Cache
    insertLyrics.run({ title: t, artist: a, lyrics, synced_lyrics: synced });

    res.json({
      lyrics,
      syncedLyrics: synced || null,
      cached: false,
      source,
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
  } catch (err) {
    res.status(500).json({ error: "internal server error" });
  }
});

app.put("/api/preferences", (req, res) => {
  try {
    const updates = req.body as Record<string, string>;
    if (!updates || typeof updates !== "object") {
      res.status(400).json({ error: "body must be a key-value object" });
      return;
    }
    for (const [key, value] of Object.entries(updates)) upsertPref.run({ key, value: String(value) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "internal server error" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`LyricVista backend running on http://localhost:${PORT}`);
});
