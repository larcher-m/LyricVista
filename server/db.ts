import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

const dbDir = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Roaming"), "LyricVista");

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "lyricvista.db");
const db = new Database(dbPath);

// Enable WAL for performance
db.pragma("journal_mode = WAL");

// ── Initialize tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS lyrics_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    lyrics TEXT NOT NULL,
    synced_lyrics TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(title, artist)
  );

  CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Prepare statements ──
const insertLyrics = db.prepare(`
  INSERT OR REPLACE INTO lyrics_cache (title, artist, lyrics, synced_lyrics)
  VALUES (@title, @artist, @lyrics, @synced_lyrics)
`);

const getLyrics = db.prepare(`
  SELECT lyrics, synced_lyrics FROM lyrics_cache WHERE title = @title AND artist = @artist
`);

const upsertPref = db.prepare(`
  INSERT OR REPLACE INTO preferences (key, value) VALUES (@key, @value)
`);

const getAllPrefs = db.prepare(`
  SELECT key, value FROM preferences
`);

export {
  db,
  insertLyrics,
  getLyrics,
  upsertPref,
  getAllPrefs,
  dbDir,
};
