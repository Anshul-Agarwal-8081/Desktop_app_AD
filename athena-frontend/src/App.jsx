
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:6001";

async function apiRequest(endpoint, options = {}) {
  let response;

  try {
    response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      `Cannot connect to the backend at ${API_URL}. Start your backend with node server.cjs.`
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed with status ${response.status}`
    );
  }

  return data;
}

export default function App() {
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");

  const [showInstructions, setShowInstructions] = useState(false);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [sessionId, setSessionId] = useState(null);

  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const finishLock = useRef(false);

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  function validateStudent() {
    if (
      typeof studentName !== "string" ||
      studentName.trim().length < 2 ||
      studentName.trim().length > 80
    ) {
      return "Student name must be between 2 and 80 characters.";
    }

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(studentId.trim())) {
      return "Student ID must contain 3-20 letters, numbers, hyphens or underscores.";
    }

    return "";
  }

  function reviewInstructions() {
    setError("");
    setMessage("");

    const validationError = validateStudent();

    if (validationError) {
      setError(validationError);
      return;
    }

    setShowInstructions(true);
  }

  async function confirmAndStartExam() {
    if (starting || started) return;

    const validationError = validateStudent();

    if (validationError) {
      setError(validationError);
      return;
    }

    const electron = window.electronAPI;

    if (
      !electron ||
      typeof electron.startTest !== "function" ||
      typeof electron.setFullScreen !== "function" ||
      typeof electron.cancelTest !== "function"
    ) {
      setError(
        "Electron API is unavailable. Check electron/main.cjs and electron/preload.cjs."
      );
      return;
    }

    setStarting(true);
    setError("");
    setMessage("");

    let newSessionId = null;
    let timerStarted = false;
    let fullscreenEnabled = false;

    try {
      // 1. Fetch the questions.
      const questionData = await apiRequest("/api/questions");

      if (
        !Array.isArray(questionData.questions) ||
        questionData.questions.length === 0
      ) {
        throw new Error(
          "No valid exam questions were found in data/questions.json."
        );
      }

      // 2. Create the session. The backend saves it to sessions.json.
      const sessionData = await apiRequest("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          studentName: studentName.trim(),
          studentId: studentId.trim(),
        }),
      });

      newSessionId = sessionData?.session?.id;

      if (!newSessionId) {
        throw new Error("The backend did not return a session ID.");
      }

      // 3. Start the Electron timer.
      const timer = await electron.startTest({
        studentName: studentName.trim(),
        studentId: studentId.trim(),
      });

      if (!timer?.success || !Number.isFinite(timer.endTime)) {
        throw new Error("Electron could not start the exam timer.");
      }

      timerStarted = true;

      // 4. Enable fullscreen.
      const fullscreenResult = await electron.setFullScreen();

      if (fullscreenResult?.success !== true) {
        throw new Error("Electron could not enter fullscreen.");
      }

      fullscreenEnabled = true;

      // 5. Display the exam.
      setQuestions(questionData.questions);
      setAnswers({});
      setSessionId(newSessionId);
      setRemainingMs(Math.max(0, timer.endTime - Date.now()));

      finishLock.current = false;

      setShowInstructions(false);
      setFinished(false);
      setStarted(true);
      setError("");
    } catch (err) {
      console.error("Exam startup failed:", err);

      // Close an unused session if exam startup failed.
      if (newSessionId) {
        try {
          await apiRequest(`/api/sessions/${newSessionId}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "completed" }),
          });
        } catch (cleanupError) {
          console.error("Session cleanup failed:", cleanupError);
        }
      }

      if (timerStarted) {
        try {
          await electron.cancelTest();
        } catch (cancelError) {
          console.error("Timer cleanup failed:", cancelError);
        }
      } else if (fullscreenEnabled) {
        try {
          await electron.setFullScreen();
        } catch (fullscreenError) {
          console.error(fullscreenError);
        }
      }

      setError(err.message || "Unable to start the exam.");
    } finally {
      setStarting(false);
    }
  }

  const finishExam = useCallback(async () => {
    if (!sessionId || finishLock.current) return;

    finishLock.current = true;
    setError("");
    setMessage("Saving your exam...");

    try {
      await apiRequest(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          answers,
          status: "completed",
        }),
      });

      setStarted(false);
      setFinished(true);
      setShowInstructions(false);
      setMessage("Exam submitted successfully.");

      try {
        await window.electronAPI.cancelTest();
      } catch (err) {
        console.error("Could not reset Electron timer:", err);
      }
    } catch (err) {
      finishLock.current = false;
      setError(
        `Could not submit your exam: ${err.message}. Please try again.`
      );
      setMessage("");
    }
  }, [sessionId, answers]);

  // Read the timer from Electron's main process.
  useEffect(() => {
    if (!started) return undefined;

    let active = true;
    let busy = false;

    async function updateTimer() {
      if (busy) return;

      busy = true;

      try {
        const timer =
          await window.electronAPI.getRemainingTime();

        if (!active || !timer?.started) return;

        const remaining = Math.max(
          0,
          timer.endTime - Date.now()
        );

        setRemainingMs(remaining);

        if (remaining <= 0) {
          await finishExam();
        }
      } catch (err) {
        console.error("Could not read exam timer:", err);
      } finally {
        busy = false;
      }
    }

    updateTimer();

    const intervalId = setInterval(updateTimer, 1000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [started, finishExam]);

  function chooseAnswer(questionId, option) {
    setAnswers((current) => ({
      ...current,
      [questionId]: option,
    }));
  }

  return (
    <main className="page">
      <header className="header">
        <div className="brand">
          <h1 className="logo">ATHENA</h1>
          <p className="subtitle">Online Examination Platform</p>
        </div>

        {started && (
          <div className="timer" aria-live="off">
            <span className="timer-label">Time remaining</span>
            <span className="timer-value">
              {String(minutes).padStart(2, "0")}:
              {String(seconds).padStart(2, "0")}
            </span>
          </div>
        )}
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className="message" role="status">
          {message}
        </div>
      )}

      {!started && !finished && (
        <section className="card welcome-card">
          <div className="card-icon" aria-hidden="true">
            <span> A </span>
          </div>

          <p className="eyebrow">STUDENT PORTAL</p>
          <h2>Welcome to your examination</h2>
          <p className="card-description">
            Enter your student details below to review the
            instructions and begin your exam.
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              reviewInstructions();
            }}
          >
            <label className="label" htmlFor="studentName">
              Student name
            </label>
            <input
              id="studentName"
              className="input"
              type="text"
              value={studentName}
              onChange={(event) =>
                setStudentName(event.target.value)
              }
              placeholder="Enter your full name"
              autoComplete="name"
              maxLength={80}
              disabled={starting}
              required
            />

            <label className="label" htmlFor="studentId">
              Student ID
            </label>
            <input
              id="studentId"
              className="input"
              type="text"
              value={studentId}
              onChange={(event) =>
                setStudentId(event.target.value)
              }
              placeholder="Example: STU001"
              maxLength={20}
              disabled={starting}
              required
            />

            <button
              className="primaryButton fullWidth"
              type="submit"
              disabled={starting}
            >
              Review Exam Instructions
              <span aria-hidden="true"> → </span>
            </button>
          </form>

          <p className="security-note">
            Please verify your details before starting the exam.
          </p>
        </section>
      )}

      {showInstructions && !started && !finished && (
        <div
          className="overlay"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              !starting
            ) {
              setShowInstructions(false);
            }
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="instructions-title"
          >
            <div className="modal-heading">
              <div className="modal-icon" aria-hidden="true">
                !
              </div>

              <div>
                <p className="eyebrow">BEFORE YOU BEGIN</p>
                <h2 id="instructions-title">
                  Exam Instructions
                </h2>
              </div>
            </div>

            <div className="student-summary">
              <div>
                <span className="summary-label">Student name</span>
                <strong>{studentName.trim()}</strong>
              </div>

              <div>
                <span className="summary-label">Student ID</span>
                <strong>{studentId.trim()}</strong>
              </div>
            </div>

            <h3 className="instructions-subtitle">
              Please read carefully
            </h3>

            <ul className="instructions-list">
              <li>Read every question before choosing an answer.</li>
              <li>Select the option that best answers each question.</li>
              <li>Your selected answers are saved when you submit.</li>
              <li>The examination timer starts after confirmation.</li>
              <li>Do not close the application during your exam.</li>
            </ul>

            <p className="modal-note">
              Confirm only when you are ready to start. Your exam
              session will be created when you continue.
            </p>

            <div className="buttonRow">
              <button
                className="secondaryButton"
                type="button"
                onClick={() => setShowInstructions(false)}
                disabled={starting}
              >
                Go Back
              </button>

              <button
                className="primaryButton"
                type="button"
                onClick={confirmAndStartExam}
                disabled={starting}
              >
                {starting
                  ? "Starting Exam..."
                  : "I Understand & Start Exam"}
              </button>
            </div>
          </section>
        </div>
      )}

      {started && (
        <section className="card exam-card">
          <div className="exam-heading">
            <div>
              <p className="eyebrow">EXAM IN PROGRESS</p>
              <h2>Examination Questions</h2>
              <p className="card-description">
                Choose one answer for each question.
              </p>
            </div>

            <div className="question-count">
              {Object.keys(answers).length} / {questions.length}
              <span> answered</span>
            </div>
          </div>

          <div className="student-strip">
            <span>
              <strong>Student:</strong> {studentName}
            </span>
            <span>
              <strong>ID:</strong> {studentId}
            </span>
          </div>

          {questions.map((question, index) => (
            <article
              key={question.id}
              className="question"
            >
              <div className="question-topline">
                <span className="question-number">
                  Question {index + 1}
                </span>

                <span className="question-status">
                  {answers[question.id] ? "Answered" : "Not answered"}
                </span>
              </div>

              <h3>{question.question}</h3>

              <div className="options-list">
                {question.options.map((option, optionIndex) => (
                  <label
                    key={`${question.id}-${option}`}
                    className="option"
                  >
                    <input
                      type="radio"
                      name={`question-${question.id}`}
                      value={option}
                      checked={answers[question.id] === option}
                      onChange={() =>
                        chooseAnswer(question.id, option)
                      }
                    />

                    <span className="option-letter">
                      {String.fromCharCode(65 + optionIndex)}
                    </span>

                    <span className="option-text">{option}</span>
                  </label>
                ))}
              </div>
            </article>
          ))}

          <div className="submit-row">
            <p className="submit-hint">
              Review your answers before submitting.
            </p>

            <button
              className="primaryButton"
              type="button"
              onClick={finishExam}
              disabled={finishLock.current}
            >
              Submit Exam
            </button>
          </div>
        </section>
      )}

      {finished && (
        <section className="card completion-card">
          <div className="completion-icon" aria-hidden="true">
            ✓
          </div>

          <p className="eyebrow">SUBMISSION COMPLETE</p>
          <h2>Exam completed</h2>
          <p className="card-description">
            Your exam submission has been saved successfully.
          </p>

          <div className="session-details">
            <span>Student</span>
            <strong>{studentName}</strong>

            <span>Student ID</span>
            <strong>{studentId}</strong>

            <span>Session ID</span>
            <strong className="session-id">{sessionId}</strong>
          </div>
        </section>
      )}

      <footer className="footer">
        <span>ATHENA</span>
        <span>Online Examination Platform</span>
      </footer>
    </main>
  );
}
