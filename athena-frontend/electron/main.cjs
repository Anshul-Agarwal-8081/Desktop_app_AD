
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
} = require("electron");

const path = require("node:path");

const PORT = 5173;
const EXAM_DURATION_MS = 60 * 60 * 1000;

let mainWindow = null;
let endTime = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Show the instructions dialog using the existing IPC API.
ipcMain.handle("show-exam-rules", async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;

  return dialog.showMessageBox(win ?? undefined, {
    type: "info",
    title: "Exam Rules",
    message: "Please read the exam instructions carefully.",
    detail:
      "Keep the exam window open and follow your institution's exam rules.",
    buttons: ["Continue"],
    defaultId: 0,
    noLink: true,
  });
});

// Enter fullscreen.
ipcMain.handle("set-fullscreen", async () => {
  const win = mainWindow;

  if (!win || win.isDestroyed()) {
    throw new Error("Exam window is unavailable.");
  }

  win.setFullScreen(true);

  return { success: true };
});

// Start the one-hour exam timer.
ipcMain.handle("start-test", async (_event, student) => {
  if (
    !student ||
    typeof student.studentName !== "string" ||
    typeof student.studentId !== "string"
  ) {
    throw new Error("Valid student details are required.");
  }

  endTime = Date.now() + EXAM_DURATION_MS;

  return {
    success: true,
    endTime,
  };
});

// Read remaining time.
ipcMain.handle("get-remaining-time", async () => {
  if (endTime === null) {
    return {
      started: false,
      endTime: null,
      remainingMs: 0,
    };
  }

  return {
    started: true,
    endTime,
    remainingMs: Math.max(0, endTime - Date.now()),
  };
});

// Reset the timer if startup fails.
ipcMain.handle("cancel-test", async () => {
  endTime = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(false);
  }

  return { success: true };
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

app.on("before-quit", () => {
  endTime = null;
});
