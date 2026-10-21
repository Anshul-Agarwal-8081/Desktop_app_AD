
const { app, BrowserWindow ,ipcMain, dialog } = require("electron");
const path = require("path");

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    title: "Athena Exam",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });



  win.loadURL("http://localhost:5173");
};

ipcMain.handle("show-exam-rules", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  return dialog.showMessageBox(win, {
    type: "info",
    title: "Exam Rules",
    message: "Please read the exam rules carefully.",
    detail:
      "1. Do not switch tabs during the exam.\n" +
      "2. Do not copy or paste.\n" +
      "3. Follow all assessment instructions.",
    buttons: ["I Understand", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
});



app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
