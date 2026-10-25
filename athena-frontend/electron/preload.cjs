const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  showExamRules: () => ipcRenderer.invoke("show-exam-rules"),

  setFullScreen: () => ipcRenderer.invoke("set-fullscreen"),

  startTest: (student) => ipcRenderer.invoke("start-test", student),

  getRemainingTime: () => ipcRenderer.invoke("get-remaining-time"),

  cancelTest: () => ipcRenderer.invoke("cancel-test"),

  saveProctoringImage: (sessionId, imageData) =>
    ipcRenderer.invoke("proctoring:save-image", {
      sessionId,
      imageData,
    }),
});