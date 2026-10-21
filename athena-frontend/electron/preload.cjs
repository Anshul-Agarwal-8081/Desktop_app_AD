
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppName: () => "Athena Exam",
});
