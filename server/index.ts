import express from "express";
import cors from "cors";
import { getLyrics, insertLyrics, upsertPref, getAllPrefs } from "./db";

const app = express();
const PORT = 3456;

app.use(cors());
app.use(express.json());

// ── Lyrics API ──
// GET /api/lyrics?title=xxx&artist=xxx
app.get("/api/lyrics", async (req, res) => {
  try {
    const { title, artist } = req.query;
    if (!title || !artist) {
      res.status(400).json({ error: "title and artist are required" });
      return;
    }

    const t = (title as string).trim();
    const a = (artist as string).trim();

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

    // 2. Fetch from LRCLIB
    try {
      const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(a)}&track_name=${encodeURIComponent(t)}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        res.status(404).json({ error: "lyrics not found" });
        return;
      }

      const data = (await resp.json()) as {
        plainLyrics?: string;
        syncedLyrics?: string;
      };

      const lyrics = data.plainLyrics || "";
      const synced = data.syncedLyrics || null;

      if (!lyrics && !synced) {
        res.status(404).json({ error: "lyrics not found" });
        return;
      }

      // 3. Cache
      insertLyrics.run({ title: t, artist: a, lyrics, synced_lyrics: synced });

      res.json({
        lyrics,
        syncedLyrics: synced || null,
        cached: false,
      });
    } catch (err) {
      console.error("Upstream fetch error:", err);
      res.status(502).json({ error: "failed to fetch lyrics from upstream" });
    }
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
    for (const row of rows) {
      prefs[row.key] = row.value;
    }
    res.json(prefs);
  } catch (err) {
    console.error("Preferences GET error:", err);
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
    for (const [key, value] of Object.entries(updates)) {
      upsertPref.run({ key, value: String(value) });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Preferences PUT error:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// ── Health ──
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`LyricVista backend running on http://localhost:${PORT}`);
});
