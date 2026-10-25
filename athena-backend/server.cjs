const express = require("express");
const cors = require("cors");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const app = express();
const PORT = Number(process.env.PORT) || 6001;

const DATA_DIR = path.join(__dirname, "data");
const QUESTIONS_FILE = path.join(DATA_DIR, "questions.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

async function readJson(file, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeJson(file, fallback);
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });

  const tempFile = `${file}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempFile, file);
}

function validQuestion(q) {
  return (
    q &&
    q.id !== undefined &&
    typeof (q.question ?? q.text) === "string" &&
    Array.isArray(q.options) &&
    q.options.every((option) => typeof option === "string")
  );
}

function publicQuestion(q) {
  // Never send correctAnswer to the exam UI.
  return {
    id: String(q.id),
    question: q.question ?? q.text,
    options: q.options,
  };
}

function calculateCounts(answers = {}) {
  const attemptedAnswers = Object.values(answers).filter(
    (answer) => answer && typeof answer.selectedAnswer === "string"
  );

  const correct = attemptedAnswers.filter(
    (answer) => answer.isCorrect === true
  ).length;

  return {
    attempted: attemptedAnswers.length,
    correct,
    wrong: attemptedAnswers.length - correct,
  };
}

function buildReview(session, questions) {
  return Object.entries(session.answers || {}).map(
    ([questionId, answer]) => {
      const q = questions.find(
        (item) => String(item.id) === String(questionId)
      );

      return {
        questionId,
        question: q?.question ?? q?.text ?? "Question unavailable",
        options: q?.options ?? [],
        selectedAnswer: answer.selectedAnswer,
        correctAnswer: q?.correctAnswer ?? null,
        isCorrect: answer.isCorrect === true,
      };
    }
  );
}

async function initializeFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  for (const [file, fallback] of [
    [QUESTIONS_FILE, []],
    [SESSIONS_FILE, []],
  ]) {
    try {
      await fs.access(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeJson(file, fallback);
    }

    const data = await readJson(file, fallback);
    if (!Array.isArray(data)) {
      throw new Error(`${path.basename(file)} must contain a JSON array`);
    }
  }
}

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
    res.status(503).json({ status: "error", message: "Storage unavailable" });
  }
});

app.get("/api/questions", async (_req, res, next) => {
  try {
    const questions = await readJson(QUESTIONS_FILE);

    if (!Array.isArray(questions)) {
      return res.status(500).json({ error: "questions.json must be an array" });
    }

    const safeQuestions = questions.filter(validQuestion).map(publicQuestion);

    res.json({
      count: safeQuestions.length,
      questions: safeQuestions,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions", async (req, res, next) => {
  try {
    const { studentName, studentId } = req.body ?? {};

    if (
      typeof studentName !== "string" ||
      studentName.trim().length < 2
    ) {
      return res.status(400).json({ error: "Enter a valid student name" });
    }

    if (
      typeof studentId !== "string" ||
      !/^[a-zA-Z0-9_-]{3,20}$/.test(studentId.trim())
    ) {
      return res.status(400).json({ error: "Enter a valid student ID" });
    }

    const sessions = await readJson(SESSIONS_FILE);
    const normalizedId = studentId.trim().toLowerCase();

    const activeSession = sessions.find(
      (session) =>
        session.studentId.toLowerCase() === normalizedId &&
        session.status === "in_progress"
    );

    if (activeSession) {
      return res.status(409).json({
        error: "This student already has an active exam session",
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
      completedAt: null,
    };

    sessions.push(session);
    await writeJson(SESSIONS_FILE, sessions);

    res.status(201).json({
      success: true,
      sessionId: session.id,
    });
  } catch (error) {
    next(error);
  }
});

app.put(
  "/api/sessions/:sessionId/answers/:questionId",
  async (req, res, next) => {
    try {
      const { sessionId, questionId } = req.params;
      const { selectedAnswer } = req.body ?? {};

      if (typeof selectedAnswer !== "string") {
        return res.status(400).json({
          error: "selectedAnswer must be a string",
        });
      }

      const [sessions, questions] = await Promise.all([
        readJson(SESSIONS_FILE),
        readJson(QUESTIONS_FILE),
      ]);

      const session = sessions.find(
        (item) => String(item.id) === String(sessionId)
      );

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.status !== "in_progress") {
        return res.status(409).json({ error: "The exam has ended" });
      }

      const question = questions.find(
        (item) => String(item.id) === String(questionId)
      );

      if (!validQuestion(question)) {
        return res.status(404).json({ error: "Question not found" });
      }

      if (!question.options.includes(selectedAnswer)) {
        return res.status(400).json({
          error: "Selected answer is not a valid option",
        });
      }

      if (!session.answers || Array.isArray(session.answers)) {
        session.answers = {};
      }

      // Update the existing question's answer instead of adding another.
      // Correctness is stored on the server but not returned to the UI.
      session.answers[String(questionId)] = {
        selectedAnswer,
        isCorrect: selectedAnswer === question.correctAnswer,
        updatedAt: new Date().toISOString(),
      };

      session.updatedAt = new Date().toISOString();

      await writeJson(SESSIONS_FILE, sessions);

      // Do not return isCorrect, correctAnswer, or correct/wrong counts.
      res.json({
        success: true,
        saved: true,
        attempted: Object.keys(session.answers).length,
      });
    } catch (error) {
      next(error);
    }
  }
);

app.patch("/api/sessions/:id", async (req, res, next) => {
  try {
    const { status } = req.body ?? {};
    const sessions = await readJson(SESSIONS_FILE);
    const questions = await readJson(QUESTIONS_FILE);

    const session = sessions.find(
      (item) => String(item.id) === String(req.params.id)
    );

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status === "completed") {
      return res.status(409).json({ error: "Exam already submitted" });
    }

    if (status !== "completed" && status !== "cancelled") {
      return res.status(400).json({
        error: "Status must be completed or cancelled",
      });
    }

    session.status = status;
    session.updatedAt = new Date().toISOString();

    if (status === "completed") {
      session.completedAt = new Date().toISOString();
    }

    await writeJson(SESSIONS_FILE, sessions);

    if (status === "cancelled") {
      return res.json({ success: true, status: session.status });
    }

    // The result is returned only after the session is completed.
    res.json({
      success: true,
      status: session.status,
      studentName: session.studentName,
      studentId: session.studentId,
      counts: calculateCounts(session.answers),
      review: buildReview(session, questions),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions/:id", async (req, res, next) => {
  try {
    const sessions = await readJson(SESSIONS_FILE);
    const session = sessions.find(
      (item) => String(item.id) === String(req.params.id)
    );

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== "completed") {
      // Do not expose internal correctness during an active exam.
      return res.json({
        id: session.id,
        studentName: session.studentName,
        studentId: session.studentId,
        status: session.status,
        answers: Object.fromEntries(
          Object.entries(session.answers || {}).map(([id, answer]) => [
            id,
            { selectedAnswer: answer.selectedAnswer },
          ])
        ),
      });
    }

    const questions = await readJson(QUESTIONS_FILE);

    res.json({
      id: session.id,
      studentName: session.studentName,
      studentId: session.studentId,
      status: session.status,
      counts: calculateCounts(session.answers),
      review: buildReview(session, questions),
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.url}` });
});

app.use((error, _req, res, _next) => {
  console.error("Backend error:", error);

  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  res.status(500).json({ error: error.message || "Internal server error" });
});

initializeFiles()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Athena backend running at http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  })
  .catch((error) => {
    console.error("Backend startup failed:", error);
    process.exit(1);
  });