import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:6001";
const EXAM_DURATION_SECONDS = 60 * 60;
const PROCTORING_INTERVAL_MS = 5000;

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
  const safe = Math.max(0, seconds);

  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    safe % 60
  ).padStart(2, "0")}`;
}

function Brand({ subtitle = "Secure Examination System" }) {
  return (
    <div className="brand">
      <div className="logo">A</div>
      <div>
        <h1>Athena</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
    </div>
  );
}

function CameraPreview({ stream, videoRef, cameraError }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !stream) {
      setReady(false);
      return undefined;
    }

    let active = true;
    video.srcObject = stream;

    const onLoaded = () => {
      if (active) setReady(true);
    };

    video.addEventListener("loadeddata", onLoaded);

    video.play().then(
      () => {
        if (active) setReady(true);
      },
      () => {
        if (active) setReady(false);
      }
    );

    return () => {
      active = false;
      video.removeEventListener("loadeddata", onLoaded);

      if (video.srcObject === stream) {
        video.srcObject = null;
      }
    };
  }, [stream, videoRef]);

  return (
    <section className="camera-card">
      <div className="camera-card-heading">
        <div>
          <span className="eyebrow">PROCTORING</span>
          <h3>Camera monitoring</h3>
        </div>

        <span className={`camera-live ${ready && stream ? "is-live" : ""}`}>
          <span className="status-dot" />
          {ready && stream ? "Live" : "Standby"}
        </span>
      </div>

      <div className="camera-frame">
        <video ref={videoRef} autoPlay muted playsInline />

        {(!ready || !stream) && (
          <div className="camera-overlay">
            {cameraError ||
              (stream ? "Connecting to camera…" : "Camera permission required")}
          </div>
        )}
      </div>

      <div className="camera-status">
        <span
          className={`status-dot ${ready && stream ? "active" : ""}`}
        />
        {cameraError
          ? "Camera unavailable"
          : ready && stream
            ? "Camera active"
            : "Camera not ready"}
      </div>

      <p className="camera-note">
        Your camera preview appears here. During the exam, periodic JPEG
        snapshots are saved locally for exam review.
      </p>
    </section>
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
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [started, setStarted] = useState(false);
  const [proctoringStatus, setProctoringStatus] = useState("idle");
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);

  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const sessionIdRef = useRef("");
  const answersRef = useRef({});
  const answerQueue = useRef(Promise.resolve());
  const submittedRef = useRef(false);
  const saveErrors = useRef({});
  const finishingRef = useRef(false);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    setCameraError("");
  }, []);

  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (screen !== "exam" || !started) return undefined;

    const timer = setInterval(() => {
      setRemainingSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [screen, started]);

  const finishExam = useCallback(async () => {
    if (
      finishingRef.current ||
      submittedRef.current ||
      !sessionIdRef.current
    ) {
      return;
    }

    finishingRef.current = true;
    submittedRef.current = true;
    setLoading(true);
    setError("");

    try {
      await answerQueue.current;

      if (Object.keys(saveErrors.current).length > 0) {
        throw new Error(
          "Some answers could not be saved. Check your connection and try again."
        );
      }

      const result = await apiRequest(
        `/api/sessions/${encodeURIComponent(sessionIdRef.current)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "completed" }),
        }
      );

      setSubmittedResult(result);
      setScreen("result");
      setStarted(false);

      try {
        await window.electronAPI?.cancelTest?.();
      } catch (cancelError) {
        console.error("Could not exit exam fullscreen:", cancelError);
      }

      stopCamera();
      setShowSubmitDialog(false);
    } catch (err) {
      submittedRef.current = false;
      finishingRef.current = false;
      setError(`Could not submit the exam: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    if (screen === "exam" && started && remainingSeconds === 0) {
      finishExam();
    }
  }, [screen, started, remainingSeconds, finishExam]);

  async function beginExam() {
    if (loading) return;

    setError("");
    setCameraError("");

    if (studentName.trim().length < 2) {
      setError("Enter your name using at least 2 characters.");
      return;
    }

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(studentId.trim())) {
      setError(
        "Student ID must contain 3–20 letters, numbers, hyphens or underscores."
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this environment.");
      setError(
        "Camera access is unavailable. Check your Electron camera permissions."
      );
      return;
    }

    setLoading(true);

    let stream = null;
    let newSessionId = "";

    try {
      // 1. Camera permission must be granted first.
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      cameraStreamRef.current = stream;
      setCameraStream(stream);

      // 2. Require acceptance of the exam rules.
      if (typeof window.electronAPI?.showExamRules !== "function") {
        throw new Error(
          "Exam rules dialog is unavailable. Check electron/preload.cjs."
        );
      }

      const accepted = await window.electronAPI.showExamRules();

      if (!accepted) {
        throw new Error(
          "Exam rules were not accepted. The exam has not started."
        );
      }

      // 3. Load questions from the existing backend.
      const questionResponse = await apiRequest("/api/questions");
      const loadedQuestions = questionResponse.questions;

      if (!Array.isArray(loadedQuestions) || loadedQuestions.length === 0) {
        throw new Error(
          "No questions were found. Check athena-backend/data/questions.json."
        );
      }

      if (
        loadedQuestions.some(
          (question) =>
            question.id == null || !Array.isArray(question.options)
        )
      ) {
        throw new Error("The backend returned questions in an invalid format.");
      }

      // 4. Create the backend session.
      const session = await apiRequest("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          studentName: studentName.trim(),
          studentId: studentId.trim(),
        }),
      });

      newSessionId = String(session.sessionId || "");

      if (!newSessionId) {
        throw new Error("The backend did not return a session ID.");
      }

      // 5. Enable fullscreen and start the Electron timer.
      if (
        typeof window.electronAPI?.setFullScreen !== "function" ||
        typeof window.electronAPI?.startTest !== "function"
      ) {
        throw new Error(
          "Electron exam APIs are unavailable. Check electron/preload.cjs."
        );
      }

      const fullscreen = await window.electronAPI.setFullScreen();

      if (fullscreen === false) {
        throw new Error("Could not enable fullscreen mode.");
      }

      const startResponse = await window.electronAPI.startTest({
        studentName: studentName.trim(),
        studentId: studentId.trim(),
      });

      if (!startResponse?.success) {
        throw new Error("Could not start the exam timer.");
      }

      // 6. Initialize the exam UI.
      setQuestions(loadedQuestions);
      setSessionId(newSessionId);
      sessionIdRef.current = newSessionId;

      setAnswers({});
      answersRef.current = {};
      saveErrors.current = {};
      answerQueue.current = Promise.resolve();

      submittedRef.current = false;
      finishingRef.current = false;

      setCurrentIndex(0);
      setRemainingSeconds(EXAM_DURATION_SECONDS);
      setSubmittedResult(null);
      setProctoringStatus("idle");
      setStarted(true);
      setScreen("exam");
    } catch (err) {
      console.error("Exam startup failed:", err);

      // Avoid leaving a backend session active if startup failed.
      if (newSessionId) {
        try {
          await apiRequest(
            `/api/sessions/${encodeURIComponent(newSessionId)}`,
            {
              method: "PATCH",
              body: JSON.stringify({ status: "cancelled" }),
            }
          );
        } catch (cancelError) {
          console.error("Could not cancel incomplete session:", cancelError);
        }
      }

      try {
        await window.electronAPI?.cancelTest?.();
      } catch (cancelError) {
        console.error("Could not reset Electron exam state:", cancelError);
      }

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setCameraError(
          "Camera permission was denied. Allow camera access in macOS System Settings and try again."
        );
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setCameraError(
          "No camera was found. Connect or enable a camera and try again."
        );
      } else if (err.name === "NotReadableError") {
        setCameraError(
          "The camera may be in use by another app. Close other camera apps and try again."
        );
      }

      stopCamera();
      setStarted(false);
      setScreen("welcome");
      setError(err.message || "Could not start the exam.");
    } finally {
      setLoading(false);
    }
  }

  function chooseAnswer(question, selectedAnswer) {
    if (
      submittedRef.current ||
      finishingRef.current ||
      !sessionIdRef.current
    ) {
      return;
    }

    const questionId = String(question.id);
    const nextAnswers = {
      ...answersRef.current,
      [questionId]: selectedAnswer,
    };

    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    setError("");

    // Queue answer saves so rapid clicks don't cause out-of-order writes.
    answerQueue.current = answerQueue.current
      .then(async () => {
        await apiRequest(
          `/api/sessions/${encodeURIComponent(
            sessionIdRef.current
          )}/answers/${encodeURIComponent(questionId)}`,
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

  async function exitExam() {
    if (loading) return;

    if (!sessionIdRef.current) {
      stopCamera();
      setScreen("welcome");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to cancel this exam? Your session will be marked cancelled."
    );

    if (!confirmed) return;

    setLoading(true);
    setError("");

    try {
      await answerQueue.current;

      await apiRequest(
        `/api/sessions/${encodeURIComponent(sessionIdRef.current)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "cancelled" }),
        }
      );

      submittedRef.current = true;
      finishingRef.current = true;
      setStarted(false);

      try {
        await window.electronAPI?.cancelTest?.();
      } catch (cancelError) {
        console.error("Could not exit fullscreen:", cancelError);
      }

      stopCamera();
      clearExamState();
      setScreen("welcome");
    } catch (err) {
      setError(`Could not cancel the exam: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function clearExamState() {
    setSessionId("");
    sessionIdRef.current = "";

    setQuestions([]);
    setAnswers({});
    answersRef.current = {};

    answerQueue.current = Promise.resolve();
    saveErrors.current = {};

    setCurrentIndex(0);
    setRemainingSeconds(EXAM_DURATION_SECONDS);
    setProctoringStatus("idle");
    setSubmittedResult(null);
    setShowSubmitDialog(false);

    submittedRef.current = false;
    finishingRef.current = false;
  }

  function resetApp() {
    stopCamera();
    clearExamState();
    setError("");
    setCameraError("");
    setStarted(false);
    setScreen("welcome");
  }

  // Capture a JPEG snapshot every five seconds while an exam is active.
  useEffect(() => {
    if (!started || screen !== "exam" || !sessionId) {
      return undefined;
    }

    let busy = false;
    let active = true;

    async function captureAndSave() {
      if (busy || !active) return;

      const video = videoRef.current;

      if (
        !video ||
        video.readyState < 2 ||
        !video.videoWidth ||
        !video.videoHeight
      ) {
        return;
      }

      if (typeof window.electronAPI?.saveProctoringImage !== "function") {
        setProctoringStatus("error");
        return;
      }

      busy = true;

      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Could not create camera capture canvas.");
        }

        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = canvas.toDataURL("image/jpeg", 0.75);
        const saved = await window.electronAPI.saveProctoringImage(
          sessionId,
          imageData
        );

        if (!saved?.success) {
          throw new Error("Camera image was not saved.");
        }

        if (active) setProctoringStatus("saved");
      } catch (err) {
        console.error("Camera evidence save failed:", err);
        if (active) setProctoringStatus("error");
      } finally {
        busy = false;
      }
    }

    captureAndSave();

    const interval = setInterval(captureAndSave, PROCTORING_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [started, screen, sessionId]);

  const attemptedCount = Object.keys(answers).length;
  const unansweredCount = Math.max(0, questions.length - attemptedCount);
  const currentQuestion = questions[currentIndex];

  const answeredPercent = questions.length
    ? Math.round((attemptedCount / questions.length) * 100)
    : 0;

  const timerClass =
    remainingSeconds <= 60
      ? "critical"
      : remainingSeconds <= 300
        ? "warning"
        : "";

  if (screen === "welcome") {
    return (
      <main className="page">
        <header className="header">
          <Brand />
        </header>

        <div className="pre-exam-layout">
          <section className="welcome-card">
            <span className="eyebrow">EXAM PORTAL · SECURE SESSION</span>
            <h2>Ready to begin?</h2>

            <p className="muted intro-copy">
              Enter your student details. You’ll check your camera and accept
              the exam rules before the timer starts.
            </p>

            <div className="form-field">
              <label htmlFor="studentName">Student name</label>
              <input
                id="studentName"
                value={studentName}
                onChange={(event) => setStudentName(event.target.value)}
                placeholder="Enter your full name"
                autoComplete="name"
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label htmlFor="studentId">Student ID</label>
              <input
                id="studentId"
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                placeholder="3–20 characters"
                disabled={loading}
              />
              <small>
                Letters, numbers, hyphens and underscores are allowed.
              </small>
            </div>

            <div className="instructions-panel">
              <h3>Before you start</h3>
              <ul className="instructions-list">
                <li>Allow camera access when prompted.</li>
                <li>Read and accept the exam rules.</li>
                <li>Your 60-minute timer begins when the exam starts.</li>
                <li>Answers are saved as you select them.</li>
              </ul>
            </div>

            <div className="exam-info">
              <div>
                <span>Duration</span>
                <strong>60 minutes</strong>
              </div>
              <div>
                <span>Questions</span>
                <strong>{questions.length || "Loaded from backend"}</strong>
              </div>
              <div>
                <span>Results</span>
                <strong>After submission</strong>
              </div>
            </div>

            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}

            <button
              className="primary-button"
              onClick={beginExam}
              disabled={loading}
            >
              {loading ? (
                <span className="loading-inline">
                  <span className="spinner" />
                  Preparing your exam…
                </span>
              ) : (
                "Check camera & start exam"
              )}
            </button>

            <p className="form-footnote">
              Camera snapshots are saved locally during the active exam. Make
              sure you understand your institution’s camera and data policies.
            </p>
          </section>

          <CameraPreview
            stream={cameraStream}
            videoRef={videoRef}
            cameraError={cameraError}
          />
        </div>
      </main>
    );
  }

  if (screen === "result" && submittedResult) {
    const counts = submittedResult.counts || {
      attempted: attemptedCount,
      correct: 0,
      wrong: 0,
    };

    const review = Array.isArray(submittedResult.review)
      ? submittedResult.review
      : [];

    return (
      <main className="page result-page">
        <header className="header">
          <Brand subtitle="Examination report" />
        </header>

        <section className="result-card">
          <span className="eyebrow">FINAL REPORT</span>

          <div className="result-hero">
            <div className="result-check">✓</div>
            <div>
              <h2>Exam submitted</h2>
              <p className="muted">
                {submittedResult.studentName
                  ? `Thank you, ${submittedResult.studentName}.`
                  : "Your final report is ready."}
              </p>
            </div>
          </div>

          <div className="result-stats">
            <div className="stat">
              <span>Attempted</span>
              <strong>{counts.attempted ?? 0}</strong>
            </div>
            <div className="stat correct-stat">
              <span>Correct answers</span>
              <strong>{counts.correct ?? 0}</strong>
            </div>
            <div className="stat wrong-stat">
              <span>Incorrect answers</span>
              <strong>{counts.wrong ?? 0}</strong>
            </div>
          </div>

          <div className="review-heading">
            <div>
              <h3>Answer review</h3>
              <p className="muted">
                Review the answers saved for this session.
              </p>
            </div>
            <span className="question-count-label">
              {review.length} reviewed
            </span>
          </div>

          {review.length ? (
            <div className="review-list">
              {review.map((item, index) => (
                <article
                  className={`review-item ${
                    item.isCorrect ? "review-correct" : "review-wrong"
                  }`}
                  key={item.questionId ?? index}
                >
                  <div className="review-title">
                    <strong>
                      Q{index + 1}. {item.question}
                    </strong>
                    <span
                      className={`result-label ${
                        item.isCorrect ? "correct-label" : "wrong-label"
                      }`}
                    >
                      {item.isCorrect ? "Correct" : "Incorrect"}
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
            <div className="empty-state">
              No saved answers were returned for review.
            </div>
          )}

          <button className="primary-button" onClick={resetApp}>
            Return to home
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page exam-page">
      <header className="header exam-header">
        <Brand subtitle={`Candidate: ${studentName}`} />

        <div className={`timer ${timerClass}`} aria-live="polite">
          <span>TIME REMAINING</span>
          <strong>{formatTime(remainingSeconds)}</strong>
          {remainingSeconds <= 300 && (
            <small>
              {remainingSeconds <= 60
                ? "Less than a minute"
                : "Five minutes or less"}
            </small>
          )}
        </div>
      </header>

      {error && (
        <div className="error exam-error" role="alert">
          <strong>Attention:</strong> {error}
        </div>
      )}

      <div className="exam-layout">
        <section className="exam-main">
          <div className="exam-overview">
            <div>
              <span className="eyebrow">WEB DEVELOPMENT ASSESSMENT</span>
              <h2>Examination</h2>
            </div>
            <span className="question-count-label">
              Question {currentIndex + 1} of {questions.length}
            </span>
          </div>

          <div
            className="exam-progress"
            aria-label={`${answeredPercent}% answered`}
          >
            <div className="exam-progress-label">
              <span>Overall progress</span>
              <strong>
                {attemptedCount}/{questions.length} answered
              </strong>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${answeredPercent}%` }}
              />
            </div>
          </div>

          <p className={`proctoring-status ${proctoringStatus}`}>
            <span className="proctoring-dot" />
            Camera evidence:{" "}
            {proctoringStatus === "saved"
              ? "Latest image saved"
              : proctoringStatus === "error"
                ? "Could not save image"
                : started
                  ? "Waiting for first capture…"
                  : "Not recording"}
          </p>

          {currentQuestion ? (
            <article className="question-card">
              <div className="question-card-top">
                <span className="question-pill">
                  QUESTION {currentIndex + 1}
                </span>
                <span className="question-count-label">Single choice</span>
              </div>

              <h2>{currentQuestion.question}</h2>

              <div className="options-list">
                {currentQuestion.options.map((option, index) => {
                  const selected =
                    answers[String(currentQuestion.id)] === option;

                  return (
                    <button
                      type="button"
                      key={`${currentQuestion.id}-${index}`}
                      className={`option ${
                        selected ? "option-selected" : ""
                      }`}
                      onClick={() => chooseAnswer(currentQuestion, option)}
                      disabled={loading || submittedRef.current}
                      aria-pressed={selected}
                    >
                      <span className="option-letter">
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span className="option-text">{option}</span>
                      {selected && (
                        <span className="selected-label">Selected ✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </article>
          ) : (
            <div className="question-card">
              <div className="empty-state">
                No question is available at this position.
              </div>
            </div>
          )}

          <div className="question-navigation">
            <button
              className="secondary-button"
              onClick={() =>
                setCurrentIndex((index) => Math.max(0, index - 1))
              }
              disabled={currentIndex === 0 || loading}
            >
              ← Previous
            </button>

            <span className="navigation-counter">
              {currentIndex + 1} / {questions.length}
            </span>

            <button
              className="secondary-button next-button"
              onClick={() =>
                setCurrentIndex((index) =>
                  Math.min(questions.length - 1, index + 1)
                )
              }
              disabled={currentIndex >= questions.length - 1 || loading}
            >
              Next →
            </button>
          </div>
        </section>

        <aside className="exam-sidebar">
          <CameraPreview
            stream={cameraStream}
            videoRef={videoRef}
            cameraError={cameraError}
          />

          <section className="sidebar-card">
            <div className="sidebar-heading">
              <h3>Exam progress</h3>
              <span className="question-count-label">{answeredPercent}%</span>
            </div>

            <div className="progress-number">
              {attemptedCount}
              <span> / {questions.length} answered</span>
            </div>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${answeredPercent}%` }}
              />
            </div>

            <div className="legend">
              <span>
                <i className="legend-dot answered" />
                Answered
              </span>
              <span>
                <i className="legend-dot current-legend" />
                Current
              </span>
              <span>
                <i className="legend-dot unanswered" />
                Unanswered
              </span>
            </div>
          </section>

          <section className="sidebar-card">
            <div className="sidebar-heading">
              <h3>Question navigator</h3>
              <span className="question-count-label">
                {questions.length} total
              </span>
            </div>

            <div className="question-grid">
              {questions.map((question, index) => {
                const answered =
                  answers[String(question.id)] !== undefined;

                return (
                  <button
                    key={question.id}
                    className={`question-number ${
                      index === currentIndex ? "current" : ""
                    } ${answered ? "attempted" : ""}`}
                    onClick={() => setCurrentIndex(index)}
                    disabled={loading}
                    aria-label={`Go to question ${index + 1}, ${
                      answered ? "answered" : "unanswered"
                    }`}
                    aria-current={
                      index === currentIndex ? "step" : undefined
                    }
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="submission-summary">
            <strong>{unansweredCount}</strong>
            <span>
              unanswered question{unansweredCount === 1 ? "" : "s"}
            </span>
          </div>

          <button
            className="submit-button"
            onClick={() => setShowSubmitDialog(true)}
            disabled={loading}
          >
            {loading ? (
              <span className="loading-inline">
                <span className="spinner" />
                Saving…
              </span>
            ) : (
              "Review & submit exam"
            )}
          </button>

          <button className="text-button" onClick={exitExam} disabled={loading}>
            Cancel exam
          </button>
        </aside>
      </div>

      {showSubmitDialog && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) {
              setShowSubmitDialog(false);
            }
          }}
        >
          <section
            className="submit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-title"
          >
            <div className="modal-icon">✓</div>
            <h2 id="submit-title">Submit your exam?</h2>
            <p className="muted">
              You’re about to submit your answers. You cannot change them after
              submission.
            </p>

            <div className="modal-summary">
              <div>
                <span>Answered</span>
                <strong>
                  {attemptedCount} / {questions.length}
                </strong>
              </div>
              <div>
                <span>Unanswered</span>
                <strong>{unansweredCount}</strong>
              </div>
              <div>
                <span>Time left</span>
                <strong>{formatTime(remainingSeconds)}</strong>
              </div>
            </div>

            {unansweredCount > 0 && (
              <div className="warning-note">
                You still have {unansweredCount} unanswered question
                {unansweredCount === 1 ? "" : "s"}. You can return to the exam
                or submit anyway.
              </div>
            )}

            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setShowSubmitDialog(false)}
                disabled={loading}
              >
                Continue exam
              </button>

              <button
                className="submit-button modal-submit"
                onClick={finishExam}
                disabled={loading}
              >
                {loading ? "Submitting…" : "Confirm submission"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}