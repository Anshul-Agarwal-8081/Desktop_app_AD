
import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:6001";

const INSTRUCTIONS = [
  "Read every question carefully before answering.",
  "Do not switch tabs or leave the exam environment during the assessment.",
  "Do not copy or paste unless explicitly permitted.",
  "Ensure your system is ready before you begin.",
  "Follow your institution's examination rules.",
];

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "The API request failed.");
  }

  return data;
}

function formatTime(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`;
}

export default function App() {
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");

  const [showInstructions, setShowInstructions] = useState(false);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);

  const [error, setError] = useState("");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  const [remainingMs, setRemainingMs] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [finished, setFinished] = useState(false);

  function validateStudent() {
    const name = studentName.trim();
    const id = studentId.trim();

    if (name.length < 2 || name.length > 80) {
      return "Student name must be between 2 and 80 characters.";
    }

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(id)) {
      return "Student ID must contain 3-20 letters, numbers, hyphens or underscores.";
    }

    return "";
  }

  async function openInstructions(event) {
    event?.preventDefault();

    const validationError = validateStudent();

    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setShowInstructions(true);
  }

  async function confirmAndStartExam() {
    if (starting || started) return;

    const validationError = validateStudent();

    if (validationError) {
      setError(validationError);
      return;
    }

    setStarting(true);
    setError("");

    try {
      const api = window.electronAPI;

      if (typeof api?.setFullScreen !== "function") {
        throw new Error("Fullscreen API missing. Check preload.cjs.");
      }

      if (typeof api?.startTest !== "function") {
        throw new Error("Start Exam API missing. Check preload.cjs.");
      }

      // Fetch questions without answer keys.
      setLoadingQuestions(true);

      const questionData = await apiRequest("/api/questions");

      if (!Array.isArray(questionData.questions) ||
          questionData.questions.length === 0) {
        throw new Error("No exam questions are available.");
      }

      // Create the backend session before starting the timer.
      const sessionResult = await apiRequest("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          studentName: studentName.trim(),
          studentId: studentId.trim(),
        }),
      });

      // Start Electron's timer.
      await api.setFullScreen();

      const result = await api.startTest({
        studentName: studentName.trim(),
        studentId: studentId.trim(),
      });

      if (!result?.success) {
        throw new Error("The exam could not be started.");
      }

      setQuestions(questionData.questions);
      setSessionId(sessionResult.session.id);
      setRemainingMs(Math.max(0, result.endTime - Date.now()));
      setAnswers({});
      setFinished(false);
      setShowInstructions(false);
      setStarted(true);
      setError("");
    } catch (err) {
      console.error("Exam startup failed:", err);
      setError(err.message || "Unable to start the exam.");
    } finally {
      setStarting(false);
      setLoadingQuestions(false);
    }
  }

  async function selectAnswer(questionId, option) {
    if (!started || finished) return;

    const updatedAnswers = {
      ...answers,
      [questionId]: option,
    };

    setAnswers(updatedAnswers);

    // Save the answer to the backend session.
    if (sessionId) {
      try {
        await apiRequest(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify({
            answers: { [questionId]: option },
          }),
        });
      } catch (err) {
        console.error("Could not save answer:", err);
        setError("Your answer may not have been saved. Please retry.");
      }
    }
  }

  async function finishExam() {
    if (!started || finished) return;

    setFinished(true);
    setStarted(false);

    try {
      if (sessionId) {
        await apiRequest(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "completed" }),
        });
      }
    } catch (err) {
      console.error("Could not complete session:", err);
      setError("The exam ended, but the session update failed.");
    }
  }

  // Poll the authoritative timer in Electron.
  useEffect(() => {
    if (!started) return;

    let intervalId;
    let cancelled = false;

    async function updateTime() {
      try {
        const result =
          await window.electronAPI.getRemainingTime();

        if (cancelled) return;

        setRemainingMs(result.remainingMs);

        if (!result.started || result.remainingMs <= 0) {
          window.clearInterval(intervalId);
          await finishExam();
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Timer update failed:", err);
          setError("Unable to retrieve the exam timer.");
        }
      }
    }

    updateTime();
    intervalId = window.setInterval(updateTime, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [started]);

  const answeredCount = Object.keys(answers).length;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <h1>ATHENA</h1>
            <p>Examination System</p>
          </div>
        </div>
        <span className="secure-label">
          <span className="status-dot" />
          Assessment Portal
        </span>
      </header>

      <section className="page-content">
        {!started && !finished && (
          <div className="welcome-heading">
            <span className="eyebrow">STUDENT PORTAL</span>
            <h2>Ready to demonstrate your knowledge?</h2>
            <p>
              Verify your details and review the exam instructions
              before entering your assessment.
            </p>
          </div>
        )}

        {!started && !finished && (
          <section className="exam-card">
            <div className="exam-title-row">
              <div className="subject-icon">ED</div>
              <div>
                <span className="eyebrow">ASSESSMENT</span>
                <h2>Application Development</h2>
                <p>End-Semester Assessment</p>
              </div>
            </div>

            <div className="exam-details">
              <div className="detail-item">
                <span className="detail-icon">◷</span>
                <div>
                  <span className="detail-label">DURATION</span>
                  <strong>60 minutes</strong>
                </div>
              </div>
              <div className="detail-item">
                <span className="detail-icon">▤</span>
                <div>
                  <span className="detail-label">QUESTIONS</span>
                  <strong>Available MCQs</strong>
                </div>
              </div>
              <div className="detail-item">
                <span className="detail-icon">▣</span>
                <div>
                  <span className="detail-label">EXAM DATE</span>
                  <strong>Scheduled Assessment</strong>
                </div>
              </div>
              <div className="detail-item">
                <span className="detail-icon">⌘</span>
                <div>
                  <span className="detail-label">MODE</span>
                  <strong>Online Assessment</strong>
                </div>
              </div>
            </div>

            <form
              className="student-form"
              onSubmit={openInstructions}
            >
              <h3>Student details</h3>
              <p>Enter your details to continue.</p>

              <label htmlFor="studentName">Student name</label>
              <input
                id="studentName"
                value={studentName}
                onChange={(event) => setStudentName(event.target.value)}
                placeholder="Enter your full name"
                maxLength={80}
                autoComplete="name"
                required
              />

              <label htmlFor="studentId">Student ID</label>
              <input
                id="studentId"
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                placeholder="Enter your student ID"
                maxLength={20}
                autoComplete="off"
                required
              />

              {error && (
                <div className="error-message" role="alert">
                  {error}
                </div>
              )}

              <div className="notice">
                <span className="notice-icon">i</span>
                <div>
                  <strong>Before you begin</strong>
                  <p>
                    Ensure you are ready to complete your assessment.
                    Read the exam rules carefully before proceeding.
                  </p>
                </div>
              </div>

              <button className="primary-button" type="submit">
                Review Exam Instructions <span>→</span>
              </button>
            </form>
          </section>
        )}

        {started && (
          <section className="exam-card active-exam">
            <div className="active-exam-header">
              <div>
                <span className="eyebrow">ASSESSMENT IN PROGRESS</span>
                <h2>Application Development</h2>
                <p>
                  {studentName} · {studentId}
                </p>
              </div>
              <div className="timer">
                <span>TIME REMAINING</span>
                <strong>{formatTime(remainingMs ?? 0)}</strong>
              </div>
            </div>

            <div className="progress-row">
              <span>{answeredCount} of {questions.length} answered</span>
              <span>{questions.length} questions</span>
            </div>

            {questions.map((question, index) => (
              <article className="question-card" key={question.id}>
                <span className="question-number">
                  QUESTION {index + 1}
                </span>
                <h3>{question.question ?? question.text}</h3>

                <div className="options-list">
                  {question.options.map((option, optionIndex) => (
                    <label
                      className={`option ${
                        answers[question.id] === option
                          ? "option-selected"
                          : ""
                      }`}
                      key={`${question.id}-${optionIndex}`}
                    >
                      <input
                        type="radio"
                        name={question.id}
                        value={option}
                        checked={answers[question.id] === option}
                        onChange={() =>
                          selectAnswer(question.id, option)
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </article>
            ))}

            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}

            <button
              className="primary-button"
              onClick={finishExam}
            >
              Submit Exam
            </button>
          </section>
        )}

        {finished && (
          <section className="exam-card completion-card">
            <div className="completion-icon">✓</div>
            <span className="eyebrow">ASSESSMENT STATUS</span>
            <h2>Exam completed</h2>
            <p>
              Your assessment session has ended.
              {` You answered ${answeredCount} of ${questions.length} questions.`}
            </p>
          </section>
        )}
      </section>

      <footer className="app-footer">
        <span>ATHENA · EXAMINATION SYSTEM</span>
        <span>Designed for focused assessments</span>
      </footer>

      {showInstructions && (
        <div className="modal-backdrop">
          <section
            className="instructions-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="instructions-title"
          >
            <div className="modal-icon">!</div>
            <span className="eyebrow modal-eyebrow">
              PLEASE READ CAREFULLY
            </span>
            <h2 id="instructions-title">Exam Instructions</h2>
            <p className="modal-description">
              Please verify your details and review these rules
              before entering the assessment.
            </p>

            <div className="student-summary">
              <div>
                <span>STUDENT NAME</span>
                <strong>{studentName.trim()}</strong>
              </div>
              <div>
                <span>STUDENT ID</span>
                <strong>{studentId.trim()}</strong>
              </div>
            </div>

            <ol className="instruction-list">
              {INSTRUCTIONS.map((instruction, index) => (
                <li key={instruction}>
                  <span>{index + 1}</span>
                  <p>{instruction}</p>
                </li>
              ))}
            </ol>

            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setShowInstructions(false);
                  setError("");
                }}
                disabled={starting || loadingQuestions}
              >
                Go Back
              </button>

              <button
                className="primary-button"
                onClick={confirmAndStartExam}
                disabled={starting || loadingQuestions}
              >
                {starting || loadingQuestions
                  ? "Starting Exam..."
                  : "I Understand & Start Exam"}
              </button>
            </div>

            <p className="modal-footnote">
              By continuing, you confirm that your details are correct
              and you are ready to begin.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
