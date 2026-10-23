
const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const app = express();
const PORT = 6001;

const QUESTIONS_FILE = path.join(__dirname, "questions.json");
const SESSIONS_FILE = path.join(__dirname, "sessions.json");

app.use(express.json({ limit: "100kb" }));

// Read a JSON file.
async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeJson(filePath, fallback);
      return fallback;
    }

    throw error;
  }
}

// Write JSON safely using a temporary file.
async function writeJson(filePath, data) {
  const tempPath = `${filePath}.tmp`;

  await fs.writeFile(
    tempPath,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );

  await fs.rename(tempPath, filePath);
}

// Initialize data files before accepting requests.
async function initializeFiles() {
  for (const [filePath, fallback] of [
    [QUESTIONS_FILE, []],
    [SESSIONS_FILE, []],
  ]) {
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeJson(filePath, fallback);
    }

    // Validate existing files at startup.
    const data = await readJson(filePath, fallback);

    if (!Array.isArray(data)) {
      throw new Error(`${path.basename(filePath)} must contain a JSON array`);
    }
  }
}

// Health check.
app.get("/health", async (_req, res) => {
  try {
    await Promise.all([
      fs.access(QUESTIONS_FILE),
      fs.access(SESSIONS_FILE),
    ]);

    res.json({
      status: "ok",
      service: "athena-backend",
      port: PORT,
      storage: "json",
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: "error",
      message: "A JSON storage file is unavailable",
    });
  }
});

// Return all questions, without answer keys.
app.get("/api/questions", async (_req, res, next) => {
  try {
    const questions = await readJson(QUESTIONS_FILE, []);
    res.json({ count: questions.length, questions });
  } catch (error) {
    next(error);
  }
});

// Return one question.
app.get("/api/questions/:id", async (req, res, next) => {
  try {
    const questions = await readJson(QUESTIONS_FILE, []);

    const question = questions.find(
      (item) => String(item.id) === req.params.id
    );

    if (!question) {
      return res.status(404).json({
        error: "Question not found",
      });
    }

    res.json(question);
  } catch (error) {
    next(error);
  }
});

// Create a new exam session.
app.post("/api/sessions", async (req, res, next) => {
  try {
    const { studentName, studentId } = req.body || {};

    if (
      typeof studentName !== "string" ||
      studentName.trim().length < 2 ||
      studentName.trim().length > 80
    ) {
      return res.status(400).json({
        error: "Student name must be between 2 and 80 characters",
      });
    }

    if (
      typeof studentId !== "string" ||
      !/^[a-zA-Z0-9_-]{3,20}$/.test(studentId.trim())
    ) {
      return res.status(400).json({
        error: "Student ID must contain 3-20 letters, numbers, hyphens or underscores",
      });
    }

    const sessions = await readJson(SESSIONS_FILE, []);

    // Avoid creating duplicate active sessions for the same student.
    const existing = sessions.find(
      (session) =>
        session.studentId.toLowerCase() ===
          studentId.trim().toLowerCase() &&
        session.status === "in_progress"
    );

    if (existing) {
      return res.status(409).json({
        error: "This student already has an active session",
        sessionId: existing.id,
      });
    }

    const now = new Date().toISOString();

    const session = {
      id: randomUUID(),
      studentName: studentName.trim(),
      studentId: studentId.trim(),
      status: "in_progress",
      answers: {},
      createdAt: now,
      updatedAt: now,
    };

    sessions.push(session);
    await writeJson(SESSIONS_FILE, sessions);

    res.status(201).json({
      message: "Exam session created",
      session,
    });
  } catch (error) {
    next(error);
  }
});

// Get one session.
app.get("/api/sessions/:id", async (req, res, next) => {
  try {
    const sessions = await readJson(SESSIONS_FILE, []);

    const session = sessions.find(
      (item) => item.id === req.params.id
    );

    if (!session) {
      return res.status(404).json({
        error: "Session not found",
      });
    }

    res.json(session);
  } catch (error) {
    next(error);
  }
});

// Update answers and/or session status.
app.patch("/api/sessions/:id", async (req, res, next) => {
  try {
    const { status, answers } = req.body || {};
    const allowedStatuses = ["in_progress", "completed"];

    if (status !== undefined && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Status must be in_progress or completed",
      });
    }

    if (
      answers !== undefined &&
      (
        answers === null ||
        typeof answers !== "object" ||
        Array.isArray(answers)
      )
    ) {
      return res.status(400).json({
        error: "Answers must be a JSON object",
      });
    }

    const sessions = await readJson(SESSIONS_FILE, []);

    const index = sessions.findIndex(
      (item) => item.id === req.params.id
    );

    if (index === -1) {
      return res.status(404).json({
        error: "Session not found",
      });
    }

    const session = sessions[index];

    if (session.status === "completed") {
      return res.status(409).json({
        error: "This session is already completed",
      });
    }

    if (answers !== undefined) {
      session.answers = {
        ...session.answers,
        ...answers,
      };
    }

    if (status !== undefined) {
      session.status = status;
    }

    session.updatedAt = new Date().toISOString();

    await writeJson(SESSIONS_FILE, sessions);

    res.json({
      message: "Session updated",
      session,
    });
  } catch (error) {
    next(error);
  }
});

// Handle malformed JSON and unexpected errors.
app.use((err, _req, res, _next) => {
  console.error(err);

  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      error: "Invalid JSON request body",
    });
  }

  res.status(500).json({
    error: "Internal server error",
  });
});

initializeFiles()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Athena backend running at http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize backend:", error);
    process.exit(1);
  });
