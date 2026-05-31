import { contextBridge, ipcRenderer } from "electron";

export interface SMTCCurrent {
  title: string;
  artist: string;
  status: string;
  position: number;
  timelineStart: number;
  timelineEnd: number;
  source: string;
}

contextBridge.exposeInMainWorld("electronAPI", {
  // Song status: renderer polls main process for SMTC info
  getSongStatus: (): Promise<SMTCCurrent | null> =>
    ipcRenderer.invoke("get-song-status"),

  // Window controls
  toggleWindow: () => ipcRenderer.send("toggle-window"),
  setWindowOpacity: (opacity: number) =>
    ipcRenderer.send("set-window-opacity", opacity),
  minimizeToTray: () => ipcRenderer.send("minimize-to-tray"),

  // Listen for SMTC updates pushed from main process
  onSMTCUpdate: (callback: (data: SMTCCurrent | null) => void) => {
    ipcRenderer.on("smtc-update", (_event, data) => callback(data));
    return () => {
      ipcRenderer.removeAllListeners("smtc-update");
    };
  },

  // Settings
  getWindowBounds: (): Promise<Electron.Rectangle | null> =>
    ipcRenderer.invoke("get-window-bounds"),
});
