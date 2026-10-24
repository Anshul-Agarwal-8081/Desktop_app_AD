const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const EXAM_DURATION_MS = 60 * 60 * 1000;

let mainWindow = null;

let examState = {
  started: false,
  studentName: "",
  studentId: "",
  startTime: null,
  endTime: null,
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: "Athena Examination System",

    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "../dist/index.html")
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("set-fullscreen", (event) => {
  const win = BrowserWindow.fromWebContents(
    event.sender
  );

  if (!win || win.isDestroyed()) {
    throw new Error("Exam window is unavailable.");
  }

  win.setFullScreen(true);

  return { success: true };
});

ipcMain.handle(
  "start-test",
  (event, student = {}) => {
    const win = BrowserWindow.fromWebContents(
      event.sender
    );

    if (!win || win.isDestroyed()) {
      throw new Error("Exam window is unavailable.");
    }

    const studentName =
      typeof student.studentName === "string"
        ? student.studentName.trim()
        : "";

    const studentId =
      typeof student.studentId === "string"
        ? student.studentId.trim()
        : "";

    if (
      studentName.length < 2 ||
      studentName.length > 80
    ) {
      throw new Error(
        "Student name must be between 2 and 80 characters."
      );
    }

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(studentId)) {
      throw new Error(
        "Student ID must contain 3-20 letters, numbers, hyphens or underscores."
      );
    }

    if (
      examState.started &&
      Date.now() < examState.endTime
    ) {
      if (
        examState.studentId.toLowerCase() !==
        studentId.toLowerCase()
      ) {
        throw new Error(
          "An exam is already active for another student."
        );
      }

      return {
        success: true,
        alreadyStarted: true,
        ...examState,
        durationMs: EXAM_DURATION_MS,
      };
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
      ...examState,
      durationMs: EXAM_DURATION_MS,
    };
  }
);

ipcMain.handle(
  "get-remaining-time",
  (event) => {
    const win = BrowserWindow.fromWebContents(
      event.sender
    );

    if (!win || win.isDestroyed()) {
      throw new Error("Exam window is unavailable.");
    }

    const remainingMs = examState.started
      ? Math.max(0, examState.endTime - Date.now())
      : 0;

    if (
      examState.started &&
      remainingMs === 0
    ) {
      examState.started = false;
    }

    return {
      started: examState.started,
      remainingMs,
      endTime: examState.endTime,
    };
  }
);

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