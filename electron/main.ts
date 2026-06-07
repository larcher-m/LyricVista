import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } from "electron";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let detectorProcess: ChildProcessWithoutNullStreams | null = null;
let detectorBuffer = "";
let detectorInFlight: Promise<Record<string, unknown> | null> | null = null;
let detectorPollingTimer: ReturnType<typeof setInterval> | null = null;
let activeDetectorRequest: {
  marker: string;
  output: string[];
  resolve: (data: Record<string, unknown> | null) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
} | null = null;
let detectorRequestId = 0;
const DETECTOR_POLL_INTERVAL_MS = 1000;

// ── Detector script path ──
function getDetectorPath(): string {
  const candidates = [
    path.join(__dirname, "..", "electron", "detector.ps1"),
    path.join(process.resourcesPath || "", "detector.ps1"),
    path.join(app.getAppPath(), "electron", "detector.ps1"),
  ];
  for (const p of candidates) { if (fs.existsSync(p)) return p; }
  return candidates[0];
}

let _detectorPath = "";
function detectorPath(): string {
  if (!_detectorPath) _detectorPath = getDetectorPath();
  return _detectorPath;
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function parseDetectorOutput(lines: string[]): Record<string, unknown> | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}

function rejectActiveDetectorRequest(err: Error) {
  if (!activeDetectorRequest) return;
  clearTimeout(activeDetectorRequest.timeout);
  activeDetectorRequest.reject(err);
  activeDetectorRequest = null;
}

function stopDetectorProcess() {
  rejectActiveDetectorRequest(new Error("detector stopped"));
  detectorBuffer = "";
  if (detectorProcess) {
    detectorProcess.removeAllListeners();
    try { detectorProcess.kill(); } catch {}
    detectorProcess = null;
  }
}

function handleDetectorStdout(chunk: Buffer) {
  detectorBuffer += chunk.toString("utf8");
  const lines = detectorBuffer.split(/\r?\n/);
  detectorBuffer = lines.pop() ?? "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (activeDetectorRequest && line === activeDetectorRequest.marker) {
      const request = activeDetectorRequest;
      clearTimeout(request.timeout);
      activeDetectorRequest = null;
      request.resolve(parseDetectorOutput(request.output));
      continue;
    }

    activeDetectorRequest?.output.push(line);
  }
}

function ensureDetectorProcess(): ChildProcessWithoutNullStreams {
  if (detectorProcess && !detectorProcess.killed) return detectorProcess;

  detectorBuffer = "";
  detectorProcess = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", "-",
  ], {
    windowsHide: true,
    stdio: "pipe",
  });

  detectorProcess.stdout.setEncoding("utf8");
  detectorProcess.stdout.on("data", handleDetectorStdout);
  detectorProcess.stderr.on("data", () => {});
  detectorProcess.on("error", () => stopDetectorProcess());
  detectorProcess.on("close", () => {
    rejectActiveDetectorRequest(new Error("detector closed"));
    detectorProcess = null;
    detectorBuffer = "";
  });

  detectorProcess.stdin.write("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n");
  detectorProcess.stdin.write("$OutputEncoding = [System.Text.Encoding]::UTF8\n");
  return detectorProcess;
}

// ── Run detector, return raw data ──
async function runDetector(): Promise<Record<string, unknown> | null> {
  if (detectorInFlight) return detectorInFlight;
  detectorInFlight = runDetectorOnce().finally(() => {
    detectorInFlight = null;
  });
  return detectorInFlight;
}

async function runDetectorOnce(): Promise<Record<string, unknown> | null> {
  try {
    const process = ensureDetectorProcess();
    const marker = `__LYRICVISTA_DONE_${++detectorRequestId}__`;

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        activeDetectorRequest = null;
        stopDetectorProcess();
        resolve(null);
      }, 2500);

      activeDetectorRequest = { marker, output: [], resolve, reject, timeout };
      const scriptPath = escapePowerShellSingleQuoted(detectorPath());
      process.stdin.write(`& '${scriptPath}'\n`);
      process.stdin.write(`Write-Output '${marker}'\n`);
    });
  } catch {
    stopDetectorProcess();
    return null;
  }
}

function normalizeSongStatus(info: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!info || info.status === "Stopped") return null;
  return info;
}

async function pollAndEmitSongStatus() {
  const status = normalizeSongStatus(await runDetector());
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("song-status", status);
}

function startDetectorPolling() {
  if (detectorPollingTimer) return;
  void pollAndEmitSongStatus();
  detectorPollingTimer = setInterval(() => {
    void pollAndEmitSongStatus();
  }, DETECTOR_POLL_INTERVAL_MS);
}

function stopDetectorPolling() {
  if (detectorPollingTimer) {
    clearInterval(detectorPollingTimer);
    detectorPollingTimer = null;
  }
}

// ── IPC ──
function setupIPC() {
  ipcMain.handle("get-song-status", async () => {
    return normalizeSongStatus(await runDetector());
  });

  ipcMain.on("minimize-to-tray", () => mainWindow?.hide());

  ipcMain.on("quit-app", () => {
    isQuitting = true;
    app.quit();
  });
}

// ── Window ──
function createMainWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 460, height: 320,
    x: screenW - 480, y: 60,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
    if (process.env.LYRICVISTA_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.once("did-finish-load", () => startDetectorPolling());

  mainWindow.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide(); }
  });
}

// ── Tray ──
function createTray() {
  const iconPaths = [
    path.join(__dirname, "..", "resources", "icon.png"),
    path.join(process.resourcesPath || "", "icon.png"),
    path.join(app.getAppPath(), "resources", "icon.png"),
  ];

  let trayIcon: Electron.NativeImage | null = null;
  for (const p of iconPaths) {
    try { if (fs.existsSync(p)) { trayIcon = nativeImage.createFromPath(p); break; } } catch {}
  }
  if (!trayIcon) trayIcon = nativeImage.createEmpty();

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip("LyricVista");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示/隐藏歌词", click: () => { mainWindow?.isVisible() ? mainWindow?.hide() : mainWindow?.show(); } },
    { type: "separator" },
    { label: "退出 LyricVista", click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => { mainWindow?.isVisible() ? mainWindow?.hide() : mainWindow?.show(); });
}

// ── Startup ──
app.whenReady().then(() => {
  setupIPC();
  createMainWindow();
  createTray();
});

app.on("window-all-closed", () => {});
app.on("before-quit", () => { isQuitting = true; stopDetectorPolling(); stopDetectorProcess(); });
app.on("activate", () => { if (!mainWindow?.isDestroyed()) mainWindow?.show(); });
