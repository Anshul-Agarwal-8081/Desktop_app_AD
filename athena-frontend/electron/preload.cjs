const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  setFullScreen: () =>
    ipcRenderer.invoke("set-fullscreen"),

  startTest: (student) =>
    ipcRenderer.invoke("start-test", student),

  getRemainingTime: () =>
    ipcRenderer.invoke("get-remaining-time"),
});