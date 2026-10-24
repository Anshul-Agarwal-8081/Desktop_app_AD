
const express = require("express");
const cors = require("cors");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const app = express();
const PORT = 6001;

const DATA_DIR = path.join(__dirname, "data");
const QUESTIONS_FILE = path.join(DATA_DIR, "questions.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "100kb" }));

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeJson(filePath, fallback);
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  const tempPath = `${filePath}.tmp`;

  await fs.writeFile(
    tempPath,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );

  await fs.rename(tempPath, filePath);
}

function isValidQuestion(item) {
  return (
    item &&
    item.id !== undefined &&
    typeof (item.question ?? item.text) === "string" &&
    Array.isArray(item.options) &&
    item.options.every((option) => typeof option === "string")
  );
}

function toPublicQuestion(item) {
  return {
    id: String(item.id),
    question: item.question ?? item.text,
    options: item.options,
  };
}

async function initializeFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });

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

    const data = await readJson(filePath, fallback);

    if (!Array.isArray(data)) {
      throw new Error(
        `${path.basename(filePath)} must contain a JSON array`
      );
    }
  }
}

// Health check
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
    });
  } catch {
    res.status(503).json({
      status: "error",
      message: "A JSON storage file is unavailable",
    });
  }
});

// Get all public questions; never send correctAnswer to the renderer.
app.get("/api/questions", async (_req, res, next) => {
  try {
    const questions = await readJson(QUESTIONS_FILE, []);

    if (!Array.isArray(questions)) {
      return res.status(500).json({
        error: "Questions file must contain a JSON array",
      });
    }

    const publicQuestions = questions
      .filter(isValidQuestion)
      .map(toPublicQuestion);

    res.json({
      count: publicQuestions.length,
      questions: publicQuestions,
    });
  } catch (error) {
    next(error);
  }
});

// Get one public question.
app.get("/api/questions/:id", async (req, res, next) => {
  try {
    const questions = await readJson(QUESTIONS_FILE, []);
    const item = questions.find(
      (question) =>
        question && String(question.id) === req.params.id
    );

    if (!isValidQuestion(item)) {
      return res.status(404).json({
        error: "Question not found",
      });
    }

    res.json(toPublicQuestion(item));
  } catch (error) {
    next(error);
  }
});

// Create and persist an exam session.
app.post("/api/sessions", async (req, res, next) => {
  try {
    const { studentName, studentId } = req.body ?? {};

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
        error:
          "Student ID must contain 3-20 letters, numbers, hyphens or underscores",
      });
    }

    const sessions = await readJson(SESSIONS_FILE, []);

    if (!Array.isArray(sessions)) {
      throw new Error("sessions.json must contain a JSON array");
    }

    const normalizedId = studentId.trim().toLowerCase();

    const existing = sessions.find(
      (session) =>
        typeof session.studentId === "string" &&
        session.studentId.toLowerCase() === normalizedId &&
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

    return res.status(201).json({
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

// Save answers and/or finish a session.
app.patch("/api/sessions/:id", async (req, res, next) => {
  try {
    const { status, answers } = req.body ?? {};

    if (
      status !== undefined &&
      !["in_progress", "completed"].includes(status)
    ) {
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

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((error, _req, res, _next) => {
  console.error("Backend error:", error);

  if (error instanceof SyntaxError && "body" in error) {
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
      console.log(`Athena backend: http://localhost:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
      console.log(`Session storage: ${SESSIONS_FILE}`);
    });
  })
  .catch((error) => {
    console.error("Backend startup failed:", error);
    process.exit(1);
  });
