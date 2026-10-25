import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:6001";
const EXAM_DURATION_SECONDS = 60 * 60;

async function apiRequest(endpoint, options = {}) {
  let response;

  try {
    response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error(
      "Cannot connect to the backend at localhost:6001. Start athena-backend and try again."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}

function CameraPreview() {
  const videoRef = useRef(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    let stream;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setCameraReady(true);
        }
      } catch {
        setCameraError("Camera permission is unavailable.");
      }
    }

    startCamera();

    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="camera-card">
      <div className="card-heading">Camera monitoring</div>

      <div className="camera-frame">
        <video ref={videoRef} autoPlay muted playsInline />

        {!cameraReady && (
          <div className="camera-overlay">
            {cameraError || "Starting camera…"}
          </div>
        )}
      </div>

      <div className="camera-status">
        <span className={cameraReady ? "status-dot active" : "status-dot"} />
        {cameraReady ? "Camera active" : "Camera not ready"}
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");

  const [questions, setQuestions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [answers, setAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);

  const [remainingSeconds, setRemainingSeconds] = useState(
    EXAM_DURATION_SECONDS
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submittedResult, setSubmittedResult] = useState(null);

  const answerQueue = useRef(Promise.resolve());
  const answersRef = useRef({});
  const sessionIdRef = useRef("");
  const submittedRef = useRef(false);

  const saveErrors = useRef({});

  useEffect(() => {
    if (screen !== "exam") return;

    const timer = setInterval(() => {
      setRemainingSeconds((previous) => {
        if (previous <= 1) {
          clearInterval(timer);
          return 0;
        }

        return previous - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    if (screen === "exam" && remainingSeconds === 0) {
      finishExam();
    }
    // finishExam is intentionally invoked when the timer reaches zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSeconds, screen]);

  async function beginExam() {
    setError("");

    if (studentName.trim().length < 2) {
      setError("Enter your name to continue.");
      return;
    }

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(studentId.trim())) {
      setError("Student ID must be 3–20 letters, numbers, hyphens or underscores.");
      return;
    }

    setLoading(true);

    try {
      const questionResponse = await apiRequest("/api/questions");
      const loadedQuestions = questionResponse.questions || [];

      if (loadedQuestions.length === 0) {
        throw new Error("No valid questions were found in questions.json.");
      }

      // Validate IDs so answers are saved against the actual question IDs.
      if (loadedQuestions.some((question) => !question.id)) {
        throw new Error("Every question needs a unique id in questions.json.");
      }

      const session = await apiRequest("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          studentName: studentName.trim(),
          studentId: studentId.trim(),
        }),
      });

      setQuestions(loadedQuestions);
      setSessionId(session.sessionId);
      sessionIdRef.current = session.sessionId;

      setAnswers({});
      answersRef.current = {};
      submittedRef.current = false;
      setCurrentIndex(0);
      setRemainingSeconds(EXAM_DURATION_SECONDS);
      setSubmittedResult(null);

      if (window.electronAPI?.startTest) {
        await window.electronAPI.startTest({
          studentName: studentName.trim(),
          studentId: studentId.trim(),
        });
      }

      if (window.electronAPI?.setFullScreen) {
        await window.electronAPI.setFullScreen();
      }

      setScreen("exam");
    } catch (err) {
      setError(err.message || "Could not start the exam.");
    } finally {
      setLoading(false);
    }
  }

  function chooseAnswer(question, selectedAnswer) {
    if (submittedRef.current || !sessionIdRef.current) return;

    const questionId = String(question.id);

    // Update the UI with a neutral selection; no correctness is shown.
    const nextAnswers = {
      ...answersRef.current,
      [questionId]: selectedAnswer,
    };

    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    setError("");

    // Queue writes so rapid answer changes cannot overwrite each other
    // out of order.
  answerQueue.current = answerQueue.current
  .then(async () => {
    // Do not skip pending saves when the student clicks Submit.
    await apiRequest(
      `/api/sessions/${sessionIdRef.current}/answers/${encodeURIComponent(
        questionId
      )}`,
      {
        method: "PUT",
        body: JSON.stringify({ selectedAnswer }),
      }
    );

    delete saveErrors.current[questionId];
  })
  .catch((err) => {
    saveErrors.current[questionId] = err.message;
    setError(`Answer could not be saved: ${err.message}`);
  });
}

  async function finishExam() {
    if (submittedRef.current || !sessionIdRef.current) return;

    submittedRef.current = true;
    setLoading(true);
    setError("");

    try {
      // Wait for all answer saves before asking the backend to grade.
      await answerQueue.current;

      if (Object.keys(saveErrors.current).length > 0) {
  throw new Error(
    "Some answers could not be saved. Please select those answers again before submitting."
  );
}

      const result = await apiRequest(
        `/api/sessions/${sessionIdRef.current}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "completed" }),
        }
      );

      setSubmittedResult(result);
      setScreen("result");

      if (window.electronAPI?.cancelTest) {
        await window.electronAPI.cancelTest();
      }
    } catch (err) {
      // Permit retry if submission failed, for example because the
      // backend was temporarily unavailable.
      submittedRef.current = false;
      setError(`Could not submit the exam: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function exitExam() {
    if (!sessionIdRef.current) {
      setScreen("welcome");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to exit? Your exam will be cancelled."
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      await answerQueue.current.catch(() => {});

      await apiRequest(`/api/sessions/${sessionIdRef.current}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      });

      submittedRef.current = true;

      if (window.electronAPI?.cancelTest) {
        await window.electronAPI.cancelTest();
      }

      setSessionId("");
      sessionIdRef.current = "";
      setScreen("welcome");
    } catch (err) {
      setError(`Could not cancel the exam: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function resetApp() {
    setSessionId("");
    sessionIdRef.current = "";
    setQuestions([]);
    setAnswers({});
    answersRef.current = {};
    setSubmittedResult(null);
    setCurrentIndex(0);
    setRemainingSeconds(EXAM_DURATION_SECONDS);
    setError("");
    submittedRef.current = false;
    setScreen("welcome");
  }

  const attemptedCount = Object.keys(answers).length;
  const currentQuestion = questions[currentIndex];

  if (screen === "welcome") {
    return (
      <main className="page">
        <header className="header">
          <div className="brand">
            <div className="logo">A</div>
            <div>
              <h1>Athena</h1>
              <p className="subtitle">Secure Examination System</p>
            </div>
          </div>
        </header>

        <div className="pre-exam-layout">
          <section className="welcome-card">
            <span className="eyebrow">EXAM PORTAL</span>
            <h2>Ready to begin?</h2>
            <p className="muted">
              Enter your details before starting your examination.
            </p>

            <label htmlFor="studentName">Student name</label>
            <input
              id="studentName"
              value={studentName}
              onChange={(event) => setStudentName(event.target.value)}
              placeholder="Enter your full name"
              autoComplete="name"
            />

            <label htmlFor="studentId">Student ID</label>
            <input
              id="studentId"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="Enter your student ID"
            />

            <div className="exam-info">
              <div>
                <span>Duration</span>
                <strong>60 minutes</strong>
              </div>
              <div>
                <span>Questions</span>
                <strong>Loaded from backend</strong>
              </div>
              <div>
                <span>Results</span>
                <strong>Shown after submission</strong>
              </div>
            </div>

            {error && <div className="error">{error}</div>}

            <button
              className="primary-button"
              onClick={beginExam}
              disabled={loading}
            >
              {loading ? "Starting…" : "Start examination"}
            </button>
          </section>

          <CameraPreview />
        </div>
      </main>
    );
  }

  if (screen === "result" && submittedResult) {
    const counts = submittedResult.counts || {
      attempted: 0,
      correct: 0,
      wrong: 0,
    };

    return (
      <main className="page result-page">
        <header className="header">
          <div className="brand">
            <div className="logo">A</div>
            <div>
              <h1>Exam results</h1>
              <p className="subtitle">Your examination has been submitted</p>
            </div>
          </div>
        </header>

        <section className="result-card">
          <span className="eyebrow">FINAL REPORT</span>
          <h2>Exam completed</h2>
          <p className="muted">
            {submittedResult.studentName
              ? `Well done, ${submittedResult.studentName}.`
              : "Your final result is ready."}
          </p>

          <div className="result-stats">
            <div className="stat">
              <span>Attempted</span>
              <strong>{counts.attempted}</strong>
            </div>
            <div className="stat correct-stat">
              <span>Correct</span>
              <strong>{counts.correct}</strong>
            </div>
            <div className="stat wrong-stat">
              <span>Wrong</span>
              <strong>{counts.wrong}</strong>
            </div>
          </div>

          <h3>Answer review</h3>

          {submittedResult.review?.length ? (
            <div className="review-list">
              {submittedResult.review.map((item, index) => (
                <article
                  className={`review-item ${
                    item.isCorrect ? "review-correct" : "review-wrong"
                  }`}
                  key={item.questionId}
                >
                  <div className="review-title">
                    <strong>
                      Question {index + 1}: {item.question}
                    </strong>
                    <span className={item.isCorrect ? "result-label correct-label" : "result-label wrong-label"}>
                      {item.isCorrect ? "Correct" : "Wrong"}
                    </span>
                  </div>

                  <p>
                    <strong>Your answer:</strong>{" "}
                    {item.selectedAnswer || "Not answered"}
                  </p>
                  <p>
                    <strong>Correct answer:</strong>{" "}
                    {item.correctAnswer ?? "Not available"}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">No answers were submitted.</p>
          )}

          <button className="primary-button" onClick={resetApp}>
            Back to home
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page exam-page">
      <header className="header exam-header">
        <div className="brand">
          <div className="logo">A</div>
          <div>
            <h1>Athena Examination</h1>
            <p className="subtitle">{studentName}</p>
          </div>
        </div>

        <div className="timer">
          <span>Time remaining</span>
          <strong>{formatTime(remainingSeconds)}</strong>
        </div>
      </header>

      {error && <div className="error exam-error">{error}</div>}

      <div className="exam-layout">
        <section className="exam-main">
          <div className="question-topline">
            <span>
              Question {currentIndex + 1} of {questions.length}
            </span>
            <span className="neutral-status">Answer review after submission</span>
          </div>

          {currentQuestion && (
            <article className="question-card">
              <h2>{currentQuestion.question}</h2>
              <div className="options-list">
                {currentQuestion.options.map((option, optionIndex) => {
                  const selected =
                    answers[String(currentQuestion.id)] === option;

                  return (
                    <button
                      key={`${currentQuestion.id}-${optionIndex}`}
                      type="button"
                      className={`option ${selected ? "option-selected" : ""}`}
                      onClick={() => chooseAnswer(currentQuestion, option)}
                      disabled={loading || submittedRef.current}
                    >
                      <span className="option-letter">
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span>{option}</span>
                      {selected && (
                        <span className="selected-label">Selected</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </article>
          )}

          <div className="question-navigation">
            <button
              className="secondary-button"
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
              disabled={currentIndex === 0 || loading}
            >
              Previous
            </button>

            <button
              className="secondary-button"
              onClick={() =>
                setCurrentIndex((index) =>
                  Math.min(questions.length - 1, index + 1)
                )
              }
              disabled={currentIndex >= questions.length - 1 || loading}
            >
              Next
            </button>
          </div>
        </section>

        <aside className="exam-sidebar">
          <CameraPreview />

          <section className="sidebar-card">
            <h3>Exam progress</h3>
            <div className="progress-number">
              {attemptedCount}
              <span> / {questions.length} attempted</span>
            </div>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${
                    questions.length
                      ? (attemptedCount / questions.length) * 100
                      : 0
                  }%`,
                }}
              />
            </div>

            <p className="muted small">
              Correct and wrong answers are hidden until the exam is submitted.
            </p>
          </section>

          <section className="sidebar-card">
            <h3>Questions</h3>
            <div className="question-grid">
              {questions.map((question, index) => {
                const attempted =
                  answers[String(question.id)] !== undefined;

                return (
                  <button
                    key={question.id}
                    className={[
                      "question-number",
                      index === currentIndex ? "current" : "",
                      attempted ? "attempted" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setCurrentIndex(index)}
                    title={attempted ? "Answered" : "Not answered"}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </section>

          <button
            className="submit-button"
            onClick={finishExam}
            disabled={loading}
          >
            {loading ? "Submitting…" : "Submit exam"}
          </button>

          <button
            className="text-button"
            onClick={exitExam}
            disabled={loading}
          >
            Cancel exam
          </button>
        </aside>
      </div>
    </main>
  );
}