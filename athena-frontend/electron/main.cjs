
const { app, BrowserWindow ,ipcMain, dialog } = require("electron");
const path = require("path");



const EXAM_DURATION_MS = 60 * 60 * 1000; // 60 minutes

let examState = {
  started: false,
  studentName: null,
  studentId: null,
  startTime: null,
  endTime: null,
};

// Start the exam.
ipcMain.handle("start-test", async (event, student = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (!win || win.isDestroyed()) {
    throw new Error("Exam window is unavailable.");
  }

  if (examState.started) {
    return {
      success: true,
      alreadyStarted: true,
      startTime: examState.startTime,
      endTime: examState.endTime,
    };
  }

  const studentName =
    typeof student.studentName === "string"
      ? student.studentName.trim()
      : "";

  const studentId =
    typeof student.studentId === "string"
      ? student.studentId.trim()
      : "";

  if (studentName.length < 2 || !/^[a-zA-Z0-9_-]{3,20}$/.test(studentId)) {
    throw new Error("Valid student name and ID are required.");
  }

  const startTime = Date.now();

  examState = {
    started: true,
    studentName,
    studentId,
    startTime,
    endTime: startTime + EXAM_DURATION_MS,
  };

  return {
    success: true,
    studentName: examState.studentName,
    studentId: examState.studentId,
    startTime: examState.startTime,
    endTime: examState.endTime,
    durationMs: EXAM_DURATION_MS,
  };
});

// Get the remaining exam time.
ipcMain.handle("get-remaining-time", () => {
  if (!examState.started) {
    return { started: false, remainingMs: 0 };
  }

  const remainingMs = Math.max(0, examState.endTime - Date.now());

  if (remainingMs === 0) {
    examState.started = false;
  }

  return {
    started: remainingMs > 0,
    remainingMs,
    endTime: examState.endTime,
  };
});

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

  ipcMain.handle("set-fullscreen", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (!win || win.isDestroyed()) {
    throw new Error("Exam window is unavailable.");
  }

  win.setFullScreen(true);

  return { success: true };
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
