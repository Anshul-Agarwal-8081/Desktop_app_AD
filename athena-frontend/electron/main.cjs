const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");


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
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const devUrl =
    process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5174";

  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl);

    // Open DevTools to help identify blank-screen errors.
    // mainWindow.webContents.openDevTools({ mode: "detach" });

    mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
      console.error("Failed to load UI:", code, description);
    });
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


const PROCTORING_INTERVAL_MS = 5000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Only allow simple session IDs; reject path traversal.
function validateSessionId(sessionId) {
  if (
    typeof sessionId !== "string" ||
    sessionId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(sessionId)
  ) {
    throw new Error("Invalid session ID");
  }

  return sessionId;
}

function getProctoringSessionDirectory(sessionId) {
  const safeSessionId = validateSessionId(sessionId);

  return path.join(
    app.getPath("userData"),
    "AthenaProctoring",
    "sessions",
    safeSessionId
  );
}

ipcMain.handle(
  "proctoring:save-image",
  async (_event, { sessionId, imageData }) => {
    if (typeof imageData !== "string") {
      throw new Error("Invalid image data");
    }

    // Accept JPEG data URLs only.
    const match = imageData.match(
      /^data:image\/jpeg;base64,([A-Za-z0-9+/]*={0,2})$/
    );

    if (!match) {
      throw new Error("Expected a JPEG data URL");
    }

    const imageBuffer = Buffer.from(match[1], "base64");

    if (
      imageBuffer.length === 0 ||
      imageBuffer.length > MAX_IMAGE_BYTES ||
      imageBuffer.toString("hex", 0, 3) !== "ffd8ff"
    ) {
      throw new Error("Invalid or oversized JPEG image");
    }

    const sessionDirectory =
      getProctoringSessionDirectory(sessionId);

    const imagesDirectory = path.join(
      sessionDirectory,
      "images"
    );

    await fs.mkdir(imagesDirectory, { recursive: true });

    const timestamp = new Date().toISOString();
    const filename =
      timestamp.replace(/[:.]/g, "-") + ".jpg";

    const imagePath = path.join(imagesDirectory, filename);

    // Prevent accidental overwrite.
    await fs.writeFile(imagePath, imageBuffer, {
      flag: "wx",
    });

    const manifestPath = path.join(
      sessionDirectory,
      "manifest.json"
    );

    let manifest = {
      sessionId,
      createdAt: timestamp,
      images: [],
    };

    try {
      const existing = await fs.readFile(
        manifestPath,
        "utf8"
      );
      manifest = JSON.parse(existing);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    manifest.images.push({
      filename,
      capturedAt: timestamp,
      sizeBytes: imageBuffer.length,
    });

    await fs.writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
      "utf8"
    );

    return {
      success: true,
      filename,
      capturedAt: timestamp,
    };
  }
);


app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});