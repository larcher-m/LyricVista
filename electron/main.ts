import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } from "electron";
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { promisify } from "util";

const execFileP = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let smtcTimer: ReturnType<typeof setInterval> | null = null;
let currentSong: { title: string; artist: string } | null = null;
let isQuitting = false;

// Resolve SMTC script path: try multiple locations
function getSmtcScriptPath(): string {
  const candidates = [
    path.join(__dirname, "..", "electron", "smtc.ps1"),
    path.join(__dirname, "smtc.ps1"),
    path.join(process.resourcesPath || "", "smtc.ps1"),
    path.join(app.getAppPath(), "electron", "smtc.ps1"),
    path.join(app.getAppPath(), "resources", "smtc.ps1"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // fallback to first
}

let _smtcPath = "";

function smtcScriptPath(): string {
  if (!_smtcPath) _smtcPath = getSmtcScriptPath();
  return _smtcPath;
}

interface SMTCCurrent {
  title: string;
  artist: string;
  status: string;
  position: number;
  timelineStart: number;
  timelineEnd: number;
  source: string;
}

async function querySMTC(): Promise<SMTCCurrent | null> {
  try {
    const { stdout } = await execFileP("powershell", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; . '" + smtcScriptPath() + "'",
    ], { encoding: "utf8", timeout: 3000, windowsHide: true });
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed) as SMTCCurrent;
  } catch {
    return null;
  }
}

function setupIPC() {
  ipcMain.handle("get-song-status", async () => {
    const info = await querySMTC();
    if (!info || info.status === "Stopped") return null;
    if (currentSong?.title !== info.title || currentSong?.artist !== info.artist) {
      currentSong = { title: info.title, artist: info.artist };
      return { type: "song_change", ...info };
    }
    return { type: "position_update", ...info };
  });

  ipcMain.on("toggle-window", () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });

  ipcMain.on("set-window-opacity", (_event, opacity: number) => {
    mainWindow?.setOpacity(opacity);
  });

  ipcMain.on("minimize-to-tray", () => {
    mainWindow?.hide();
  });

  ipcMain.handle("get-window-bounds", () => {
    return mainWindow?.getBounds() ?? null;
  });
}

function createMainWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 460,
    height: 320,
    x: screenW - 480,
    y: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const iconPaths = [
    path.join(__dirname, "../resources/icon.png"),
    path.join(process.resourcesPath || "", "resources", "icon.png"),
    path.join(app.getAppPath(), "resources", "icon.png"),
  ];

  let trayIcon: Electron.NativeImage | null = null;
  for (const p of iconPaths) {
    try {
      if (fs.existsSync(p)) {
        trayIcon = nativeImage.createFromPath(p);
        break;
      }
    } catch {}
  }

  if (!trayIcon) trayIcon = nativeImage.createEmpty();

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: "显示/隐藏歌词", click: () => { mainWindow?.isVisible() ? mainWindow?.hide() : mainWindow?.show(); } },
    { type: "separator" },
    { label: "退出 LyricVista", click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip("LyricVista");
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => { mainWindow?.isVisible() ? mainWindow?.hide() : mainWindow?.show(); });
}

function startSMTCPolling() {
  smtcTimer = setInterval(async () => {
    const status = await querySMTC();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("smtc-update", status);
    }
  }, 1000);
}

app.whenReady().then(() => {
  setupIPC();
  createMainWindow();
  createTray();
  startSMTCPolling();
});

app.on("window-all-closed", () => {});
app.on("before-quit", () => { isQuitting = true; if (smtcTimer) clearInterval(smtcTimer); });
app.on("activate", () => { if (!mainWindow?.isDestroyed()) mainWindow?.show(); });
