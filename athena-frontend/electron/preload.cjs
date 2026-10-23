const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  setFullScreen: () => ipcRenderer.invoke("set-fullscreen"),
  getRemainingTime: () => ipcRenderer.invoke("get-remaining-time"),
  startTest: () => ipcRenderer.invoke("start-test"),
  showExamRules: () => ipcRenderer.invoke("show-exam-rules"),
});