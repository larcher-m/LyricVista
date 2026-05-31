import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } from "electron";
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { promisify } from "util";

const execFileP = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let smtcTimer: ReturnType<typeof setInterval> | null = null;
let currentSong: { title: string; artist: string } | null = null;
let isQuitting = false;

// ── SMTC PowerShell Script (embedded to avoid path issues) ──
const SMTC_SCRIPT = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]

function Await($asyncOp, $resultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
    $task = $asTask.Invoke($null, @($asyncOp))
    $task.GetAwaiter().GetResult()
}

try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $session = $manager.GetCurrentSession()
    if (-not $session) { exit 0 }

    $mediaProps = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $playbackInfo = $session.GetPlaybackInfo()
    $timeline = $session.GetTimelineProperties()

    $status = switch ($playbackInfo.PlaybackStatus) {
        Playing { "Playing" }
        Paused  { "Paused" }
        Stopped { "Stopped" }
        Closed  { "Stopped" }
        default { "Unknown" }
    }

    $pos = 0; $tStart = 0; $tEnd = 0
    try { $tStart = if ($timeline.StartTime) { $timeline.StartTime.TotalSeconds } else { 0 } } catch {}
    try { $tEnd = if ($timeline.EndTime) { $timeline.EndTime.TotalSeconds } else { 0 } } catch {}
    try { $pos = if ($timeline.Position) { $timeline.Position.TotalSeconds } else { 0 } } catch {}

    $source = ""
    try { $source = $session.SourceAppUserModelId } catch {}

    $result = [PSCustomObject]@{
        title         = if ($mediaProps.Title) { $mediaProps.Title } else { "" }
        artist        = if ($mediaProps.Artist) { $mediaProps.Artist } else { "" }
        status        = $status
        position      = [math]::Round($pos, 1)
        timelineStart = [math]::Round($tStart, 1)
        timelineEnd   = [math]::Round($tEnd, 1)
        source        = $source
    }
    Write-Output ($result | ConvertTo-Json -Compress)
} catch { exit 0 }
`;

let smtcScriptPath = "";

function ensureSmtcScript(): string {
  if (smtcScriptPath && fs.existsSync(smtcScriptPath)) return smtcScriptPath;

  // Write the embedded script to a temp file
  const tmpDir = path.join(os.tmpdir(), "LyricVista");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  smtcScriptPath = path.join(tmpDir, "smtc.ps1");
  fs.writeFileSync(smtcScriptPath, SMTC_SCRIPT, "utf-8");
  return smtcScriptPath;
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
    const script = ensureSmtcScript();
    const { stdout } = await execFileP("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
    ], { timeout: 3000 });
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed) as SMTCCurrent;
  } catch {
    return null;
  }
}

// ── IPC Handlers ──
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

// ── Window ──
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

// ── Tray ──
function createTray() {
  // Try loading icon from resources, fallback to empty image
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

  if (!trayIcon) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示/隐藏歌词",
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow?.show();
        }
      },
    },
    { type: "separator" },
    {
      label: "退出 LyricVista",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("LyricVista");
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
}

// ── SMTC Polling ──
function startSMTCPolling() {
  // Ensure script is ready before first poll
  ensureSmtcScript();

  smtcTimer = setInterval(async () => {
    const status = await querySMTC();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("smtc-update", status);
    }
  }, 1000);
}

// ── App Lifecycle ──
app.whenReady().then(() => {
  setupIPC();
  createMainWindow();
  createTray();
  startSMTCPolling();
});

app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  isQuitting = true;
  if (smtcTimer) clearInterval(smtcTimer);
});

app.on("activate", () => {
  if (!mainWindow?.isDestroyed()) {
    mainWindow?.show();
  }
});
