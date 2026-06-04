const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  getInitialState: () => ipcRenderer.invoke("pet:get-initial-state"),
  listPets: () => ipcRenderer.invoke("pet:list-pets"),
  getHookStatus: () => ipcRenderer.invoke("pet:get-hook-status"),
  installHooks: (payload) => ipcRenderer.invoke("pet:install-hooks", payload),
  selectHookAgent: (payload) => ipcRenderer.invoke("pet:select-hook-agent", payload),
  selectPet: (payload) => ipcRenderer.invoke("pet:select-pet", payload),
  selectPetStorage: (payload) => ipcRenderer.invoke("pet:select-storage", payload),
  chooseCustomPetStorage: () => ipcRenderer.invoke("pet:choose-custom-storage"),
  openPetFolder: (payload) => ipcRenderer.invoke("pet:open-folder", payload),
  setState: (payload) => ipcRenderer.invoke("pet:set-state", payload),
  getWindowBounds: () => ipcRenderer.invoke("pet:get-window-bounds"),
  getWindowPlacement: () => ipcRenderer.invoke("pet:get-window-placement"),
  moveWindow: (point) => ipcRenderer.invoke("pet:move-window", point),
  resizeWindow: (payload) => ipcRenderer.invoke("pet:resize-window", payload),
  resizeBubble: (payload) => ipcRenderer.invoke("pet:resize-bubble", payload),
  measureBubble: (payload) => ipcRenderer.invoke("bubble:measure", payload),
  finishDrag: () => ipcRenderer.invoke("pet:finish-drag"),
  setDragDirection: (state) => ipcRenderer.send("pet:drag-direction", state),
  openSettings: () => ipcRenderer.send("pet:open-settings"),
  onStateChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:set-state", listener);
    return () => ipcRenderer.removeListener("pet:set-state", listener);
  },
  onPetChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:set-pet", listener);
    return () => ipcRenderer.removeListener("pet:set-pet", listener);
  },
  onZoomChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:set-zoom", listener);
    return () => ipcRenderer.removeListener("pet:set-zoom", listener);
  },
  onBubbleScaleChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:set-bubble-scale", listener);
    return () => ipcRenderer.removeListener("pet:set-bubble-scale", listener);
  },
  onBubbleMessage: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("bubble:set-message", listener);
    return () => ipcRenderer.removeListener("bubble:set-message", listener);
  }
});
