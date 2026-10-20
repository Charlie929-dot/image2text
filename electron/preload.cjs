const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("luowenDesktop", {
  pasteResult: (text) => ipcRenderer.invoke("luowen:paste-result", text),
  cloudVision: (input) => ipcRenderer.invoke("luowen:cloud-vision", input),
  getCloudSettings: () => ipcRenderer.invoke("luowen:cloud-settings"),
  setCloudSettings: (settings) => ipcRenderer.invoke("luowen:set-cloud-settings", settings),
  onHotkeyOcr: (callback) => {
    const listener = (_event, imageDataUrl) => callback(imageDataUrl);
    ipcRenderer.on("luowen:hotkey-ocr", listener);
    return () => ipcRenderer.removeListener("luowen:hotkey-ocr", listener);
  },
  onHotkeyStatus: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("luowen:hotkey-status", listener);
    return () => ipcRenderer.removeListener("luowen:hotkey-status", listener);
  },
});
