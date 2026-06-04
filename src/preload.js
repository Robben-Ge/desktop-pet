const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  getInitialState: () => ipcRenderer.invoke("pet:get-initial-state"),
  listPets: () => ipcRenderer.invoke("pet:list-pets"),
  selectPet: (payload) => ipcRenderer.invoke("pet:select-pet", payload),
  setState: (payload) => ipcRenderer.invoke("pet:set-state", payload),
  getWindowBounds: () => ipcRenderer.invoke("pet:get-window-bounds"),
  moveWindow: (point) => ipcRenderer.invoke("pet:move-window", point),
  resizeWindow: (payload) => ipcRenderer.invoke("pet:resize-window", payload),
  resizeBubble: (payload) => ipcRenderer.invoke("pet:resize-bubble", payload),
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
  }
});
