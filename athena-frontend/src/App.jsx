
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:6001";;
const EXAM_DURATION_SECONDS = 60 * 60;
const PROCTORING_INTERVAL_MS = 5000;

// --------------------------------------------------
// Backend helper
// --------------------------------------------------

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
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}

// --------------------------------------------------
// Camera preview
// Uses the shared stream created by App.
// It does NOT request a second camera stream.
// --------------------------------------------------

function CameraPreview({ stream, videoRef, cameraError }) {
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !stream) {
      setCameraReady(false);
      return;
    }

    let active = true;

    video.srcObject = stream;

    const handleLoaded = () => {
      if (active) setCameraReady(true);
    };

    video.addEventListener("loadeddata", handleLoaded);

    video.play().then(
      () => {
        if (active) setCameraReady(true);
      },
      () => {
        if (active) {
          setCameraReady(false);
        }
      }
    );

    return () => {
      active = false;
      video.removeEventListener("loadeddata", handleLoaded);

      if (video.srcObject === stream) {
        video.srcObject = null;
      }
    };
  }, [stream, videoRef]);

  return (
    <div className="camera-card">
      <div className="card-heading">Camera monitoring</div>

      <div className="camera-frame">
        <video ref={videoRef} autoPlay muted playsInline />

        {!cameraReady && (
          <div className="camera-overlay">
            {cameraError ||
              (stream ? "Connecting to camera…" : "Camera permission required")}
          </div>
        )}
      </div>

      <div className="camera-status">
        <span
          className={
            cameraReady && stream
              ? "status-dot active"
              : "status-dot"
          }
        />
        {cameraError
          ? "Camera unavailable"
          : cameraReady && stream
            ? "Camera active"
            : "Camera not ready"}
      </div>
    </div>
  );
}

// --------------------------------------------------
// Main application
// --------------------------------------------------

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

  // Camera state
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState("");

  // Exam/proctoring state
  const [started, setStarted] = useState(false);
  const [proctoringStatus, setProctoringStatus] = useState("idle");

  // Refs used by answer saving and camera capture
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const sessionIdRef = useRef("");
  const answersRef = useRef({});
  const answerQueue = useRef(Promise.resolve());
  const submittedRef = useRef(false);
  const saveErrors = useRef({});
  const finishingRef = useRef(false);

  // --------------------------------------------------
  // Stop camera tracks and release camera resources
  // --------------------------------------------------

  const stopCamera = useCallback(() => {
    const stream = cameraStreamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    cameraStreamRef.current = null;
    setCameraStream(null);
    setCameraError("");
  }, []);

  useEffect(() => {
    return () => {
      cameraStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());
    };
  }, []);

  // --------------------------------------------------
  // Exam timer
  // --------------------------------------------------

  useEffect(() => {
    if (screen !== "exam" || !started) return;

    const timer = setInterval(() => {
      setRemainingSeconds((previous) => Math.max(0, previous - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [screen, started]);

  // --------------------------------------------------
  // Finish automatically when time runs out
  // --------------------------------------------------

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
      // Wait for pending answer saves before submitting.
      await answerQueue.current;

      if (Object.keys(saveErrors.current).length > 0) {
        throw new Error(
          "Some answers could not be saved. Please retry those answers before submitting."
        );
      }

      const result = await apiRequest(
        `/api/sessions/${encodeURIComponent(sessionIdRef.current)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
          }),
        }
      );

      setSubmittedResult(result);
      setScreen("result");
      setStarted(false);

      try {
        await window.electronAPI?.cancelTest?.();
      } catch (electronError) {
        console.error("Could not exit fullscreen:", electronError);
      }

      stopCamera();
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

  // --------------------------------------------------
  // Start exam
  //
  // 1. Validate student details
  // 2. Request camera access
  // 3. Show exam rules and require acceptance
  // 4. Load questions and create backend session
  // 5. Enable fullscreen
  // 6. Start Electron's exam timer
  // --------------------------------------------------

  async function beginExam() {
    if (loading) return;

    setError("");
    setCameraError("");

    if (studentName.trim().length < 2) {
      setError("Enter your name to continue.");
      return;
    }

    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(studentId.trim())) {
      setError(
        "Student ID must be 3–20 letters, numbers, hyphens or underscores."
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this environment.");
      setError("Camera access is unavailable. Check your Electron settings.");
      return;
    }

    setLoading(true);

    let newStream = null;
    let createdSessionId = "";
    let electronTimerStarted = false;

    try {
      // Step 1: Request camera permission.
      // The browser/Electron OS permission prompt may appear here.
      newStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      cameraStreamRef.current = newStream;
      setCameraStream(newStream);
      setCameraError("");

      // Step 2: Require the student to accept the rules.
      if (typeof window.electronAPI?.showExamRules !== "function") {
        throw new Error(
          "Exam rules dialog is unavailable. Check electron/preload.cjs."
        );
      }

      const rulesAccepted = await window.electronAPI.showExamRules();

      if (!rulesAccepted) {
        throw new Error(
          "Exam rules were not accepted. The exam has not started."
        );
      }

      // Step 3: Verify required Electron APIs.
      if (
        typeof window.electronAPI?.setFullScreen !== "function" ||
        typeof window.electronAPI?.startTest !== "function"
      ) {
        throw new Error(
          "Electron exam APIs are unavailable. Check preload.cjs and restart the app."
        );
      }

      // Step 4: Load questions from the existing backend.
      const questionResponse = await apiRequest("/api/questions");
      const loadedQuestions = Array.isArray(questionResponse)
        ? questionResponse
        : questionResponse.questions;

      if (!Array.isArray(loadedQuestions) || loadedQuestions.length === 0) {
        throw new Error(
          "No valid questions were found. Check questions.json."
        );
      }

      if (loadedQuestions.some((question) => question.id == null)) {
        throw new Error(
          "Every question must have an id in questions.json."
        );
      }

      // Step 5: Create the backend session.
      const session = await apiRequest("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          studentName: studentName.trim(),
          studentId: studentId.trim(),
        }),
      });

      createdSessionId = String(session.sessionId ?? session.id ?? "");

      if (!createdSessionId || createdSessionId === "undefined") {
        throw new Error(
          "The backend did not return a session ID. Check POST /api/sessions."
        );
      }

      // Step 6: Enter fullscreen before starting the exam timer.
      const fullscreenResult = await window.electronAPI.setFullScreen();

      if (fullscreenResult === false) {
        throw new Error("Could not enable fullscreen mode.");
      }

      // Step 7: Start the Electron timer.
      const startResult = await window.electronAPI.startTest({
        studentName: studentName.trim(),
        studentId: studentId.trim(),
      });

      if (!startResult?.success) {
        throw new Error("The exam timer could not be started.");
      }

      electronTimerStarted = true;

      // Initialize exam state only after the startup steps succeed.
      setQuestions(loadedQuestions);

      setSessionId(createdSessionId);
      sessionIdRef.current = createdSessionId;

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
      console.error("Could not start exam:", err);

      // If a session was created but startup failed, try to cancel it.
      if (createdSessionId) {
        try {
          await apiRequest(
            `/api/sessions/${encodeURIComponent(createdSessionId)}`,
            {
              method: "PATCH",
              body: JSON.stringify({ status: "cancelled" }),
            }
          );
        } catch (cancelError) {
          console.error(
            "Could not cancel the incomplete backend session:",
            cancelError
          );
        }
      }

      if (electronTimerStarted) {
        try {
          await window.electronAPI?.cancelTest?.();
        } catch (cancelError) {
          console.error("Could not reset the exam timer:", cancelError);
        }
      }

      stopCamera();
      setStarted(false);
      setScreen("welcome");
      setCameraError(
        err.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access and try again."
          : err.name === "NotFoundError"
            ? "No camera was found. Connect or enable a camera and try again."
            : ""
      );

      setError(err.message || "Could not start the exam.");
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------
  // Save a selected answer
  // --------------------------------------------------

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

    // Queue requests to preserve the order of rapid answer changes.
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

  // --------------------------------------------------
  // Cancel exam
  // --------------------------------------------------

  async function exitExam() {
    if (loading) return;

    if (!sessionIdRef.current) {
      stopCamera();
      setScreen("welcome");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to exit? Your exam will be cancelled."
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
      } catch (electronError) {
        console.error("Could not cancel Electron exam:", electronError);
      }

      stopCamera();

      setSessionId("");
      sessionIdRef.current = "";
      setQuestions([]);
      setAnswers({});
      answersRef.current = {};
      saveErrors.current = {};
      setCurrentIndex(0);
      setRemainingSeconds(EXAM_DURATION_SECONDS);
      setProctoringStatus("idle");

      setScreen("welcome");
    } catch (err) {
      setError(`Could not cancel the exam: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------
  // Proctoring: save a JPEG every five seconds
  // --------------------------------------------------

  useEffect(() => {
    if (!started || screen !== "exam" || !sessionId) return;

    let busy = false;
    let active = true;

    async function captureAndSave() {
      if (busy || !active) return;

      const video = videoRef.current;

      if (
        !video ||
        video.readyState < 2 ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return;
      }

      if (
        typeof window.electronAPI?.saveProctoringImage !== "function"
      ) {
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
          throw new Error("Could not create canvas context.");
        }

        context.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        );

        const imageData = canvas.toDataURL("image/jpeg", 0.75);

        const result = await window.electronAPI.saveProctoringImage(
          sessionId,
          imageData
        );

        if (!result?.success) {
          throw new Error("The camera image was not saved.");
        }

        if (active) setProctoringStatus("saved");
      } catch (captureError) {
        console.error("Proctoring image save failed:", captureError);

        if (active) setProctoringStatus("error");
      } finally {
        busy = false;
      }
    }

    // Capture once, then repeat at five-second intervals.
    captureAndSave();

    const intervalId = setInterval(
      captureAndSave,
      PROCTORING_INTERVAL_MS
    );

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [started, screen, sessionId]);

  // --------------------------------------------------
  // Reset to home
  // --------------------------------------------------

  function resetApp() {
    stopCamera();

    setSessionId("");
    sessionIdRef.current = "";

    setQuestions([]);
    setAnswers({});
    answersRef.current = {};

    answerQueue.current = Promise.resolve();
    saveErrors.current = {};

    setSubmittedResult(null);
    setCurrentIndex(0);
    setRemainingSeconds(EXAM_DURATION_SECONDS);

    setError("");
    setCameraError("");
    setProctoringStatus("idle");
    setStarted(false);

    submittedRef.current = false;
    finishingRef.current = false;

    setScreen("welcome");
  }

  // --------------------------------------------------
  // Derived values
  // --------------------------------------------------

  const attemptedCount = Object.keys(answers).length;
  const currentQuestion = questions[currentIndex];

  // --------------------------------------------------
  // Welcome screen
  // --------------------------------------------------

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
              Camera access and acceptance of the exam rules are required.
            </p>

            <label htmlFor="studentName">Student name</label>
            <input
              id="studentName"
              value={studentName}
              onChange={(event) => setStudentName(event.target.value)}
              placeholder="Enter your full name"
              autoComplete="name"
              disabled={loading}
            />

            <label htmlFor="studentId">Student ID</label>
            <input
              id="studentId"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="Enter your student ID"
              disabled={loading}
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
              {loading ? "Preparing exam…" : "Allow camera & start"}
            </button>
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

  // --------------------------------------------------
  // Results screen
  // --------------------------------------------------

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
              <p className="subtitle">
                Your examination has been submitted
              </p>
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
                  key={item.questionId ?? index}
                >
                  <div className="review-title">
                    <strong>
                      Question {index + 1}: {item.question}
                    </strong>

                    <span
                      className={
                        item.isCorrect
                          ? "result-label correct-label"
                          : "result-label wrong-label"
                      }
                    >
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

  // --------------------------------------------------
  // Exam screen
  // --------------------------------------------------

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

      {error && (
        <div className="error exam-error" role="alert">
          {error}
        </div>
      )}

      <div className="exam-layout">
        <section className="exam-main">
          <div className="question-topline">
            <span>
              Question {currentIndex + 1} of {questions.length}
            </span>

            <span className="neutral-status">
              Answer review after submission
            </span>
          </div>

          <p className={`proctoring-status ${proctoringStatus}`}>
            <span className="proctoring-dot" />

            Camera Evidence:{" "}
            {proctoringStatus === "saved"
              ? "Images saved successfully"
              : proctoringStatus === "error"
                ? "Image saving failed"
                : started
                  ? "Waiting for camera…"
                  : "Not recording"}
          </p>

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
                      className={`option ${
                        selected ? "option-selected" : ""
                      }`}
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
              onClick={() =>
                setCurrentIndex((index) => Math.max(0, index - 1))
              }
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
          <CameraPreview
            stream={cameraStream}
            videoRef={videoRef}
            cameraError={cameraError}
          />

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
                    disabled={loading}
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
