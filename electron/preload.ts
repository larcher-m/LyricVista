import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getSongStatus: () => ipcRenderer.invoke("get-song-status"),
  onSongStatus: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("song-status", handler);
    return () => ipcRenderer.removeListener("song-status", handler);
  },
  minimizeToTray: () => ipcRenderer.send("minimize-to-tray"),
  quitApp: () => ipcRenderer.send("quit-app"),
});
