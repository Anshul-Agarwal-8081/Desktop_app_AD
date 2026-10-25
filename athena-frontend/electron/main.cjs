const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
} = require("electron");
const path = require("node:path");

const EXAM_DURATION_MS = 60 * 60 * 1000;

let mainWindow = null;
let examEndTime = null;
let examStarted = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

if (process.env.VITE_DEV_SERVER_URL) {
  mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
} else {
  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
}

}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media");
    }
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === "media"
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.handle("show-exam-rules", async () => {
  if (!mainWindow) return false;

  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Exam Rules",
    message: "Please read the exam rules",
    detail:
      "1. Do not switch away from the exam during the test.\n" +
      "2. Do not copy or paste answers.\n" +
      "3. Keep your camera enabled.\n" +
      "4. Your results will be displayed after submission.",
    buttons: ["Continue"],
    defaultId: 0,
    noLink: true,
  });

  return result.response === 0;
});

ipcMain.handle("set-fullscreen", async () => {
  if (!mainWindow) return false;

  mainWindow.setFullScreen(true);
  return true;
});

ipcMain.handle("start-test", async (_event, student) => {
  if (!student?.studentName || !student?.studentId) {
    throw new Error("Student name and ID are required.");
  }

  examStarted = true;
  examEndTime = Date.now() + EXAM_DURATION_MS;

  return {
    success: true,
    endTime: examEndTime,
  };
});

ipcMain.handle("get-remaining-time", async () => {
  if (!examStarted || !examEndTime) return EXAM_DURATION_MS;

  return Math.max(0, examEndTime - Date.now());
});

ipcMain.handle("cancel-test", async () => {
  examStarted = false;
  examEndTime = null;

  if (mainWindow) {
    mainWindow.setFullScreen(false);
  }

  return true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});