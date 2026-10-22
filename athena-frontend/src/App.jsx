
import { useState } from "react";
import "./App.css";

const exam = {
  title: "Application Development",
  subtitle: "End-Semester Assessment",
  duration: "60 minutes",
  questions: "As per exam paper",
  date: "Scheduled Assessment",
  mode: "Online Assessment",
};

const examInstructions = [
  "Read every question carefully before answering.",
  "Do not switch tabs or leave the exam environment during the assessment.",
  "Do not copy or paste unless explicitly permitted.",
  "Ensure your system is ready before you begin.",
  "Follow your institution's examination rules.",
];

function App() {
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");

  const [errors, setErrors] = useState({});
  const [showInstructions, setShowInstructions] = useState(false);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");

  function validateStudent() {
    const nextErrors = {};
    const name = studentName.trim();
    const id = studentId.trim();

    if (!name) {
      nextErrors.studentName = "Please enter your full name.";
    } else if (name.length < 2 || name.length > 80) {
      nextErrors.studentName =
        "Name must be between 2 and 80 characters.";
    } else if (!/^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u.test(name)) {
      nextErrors.studentName =
        "Enter a valid name using letters and spaces.";
    }

    if (!id) {
      nextErrors.studentId = "Please enter your student ID.";
    } else if (!/^[a-zA-Z0-9_-]{3,20}$/.test(id)) {
      nextErrors.studentId =
        "Use 3–20 letters, numbers, hyphens or underscores.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleStartClick() {
    setError("");

    if (!validateStudent()) {
      return;
    }

    setShowInstructions(true);
  }

  async function confirmAndStartExam() {
    if (starting || started) return;

    setStarting(true);
    setError("");

    try {
      const api = window.electronAPI;

      if (!api) {
        throw new Error(
          "Electron API is unavailable. Restart the desktop application."
        );
      }

      if (typeof api.setFullScreen !== "function") {
        throw new Error("The fullscreen API is missing from preload.");
      }

      if (typeof api.startTest !== "function") {
        throw new Error("The exam-start API is missing from preload.");
      }

      // Start the existing Electron exam flow only after confirmation.
      await api.setFullScreen();
      await api.startTest();

      setShowInstructions(false);
      setStarted(true);
    } catch (err) {
      console.error("Unable to start exam:", err);
      setError(
        err?.message || "Unable to start the exam. Please try again."
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="athena-app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">A</div>

          <div className="brand-copy">
            <span className="brand-name">ATHENA</span>
            <span className="brand-caption">ASSESSMENT PORTAL</span>
          </div>
        </div>

        <div className="header-right">
          <span className="secure-indicator">
            <span className="status-dot" />
            Secure Environment
          </span>

          <div className="header-avatar">
            {studentName.trim().charAt(0).toUpperCase() || "S"}
          </div>
        </div>
      </header>

      <main className="dashboard">
        <section className="welcome-section">
          <div>
            <p className="eyebrow">STUDENT DASHBOARD</p>
            <h1>
              Welcome{studentName.trim()
                ? `, ${studentName.trim().split(/\s+/)[0]}`
                : " to Athena"}.
            </h1>

            <p className="welcome-description">
              Enter your student details, review your assessment,
              and make sure you are ready before beginning.
            </p>
          </div>

          <div className="session-badge">
            <span className="session-dot" />
            Exam session
          </div>
        </section>

        {/* Student details */}
        <section className="student-card">
          <div className="student-avatar">
            {studentName.trim().charAt(0).toUpperCase() || "S"}
          </div>

          <div className="student-form">
            <div className="student-form-heading">
              <span className="field-label">STUDENT INFORMATION</span>
              <span className="required-note">* Required fields</span>
            </div>

            <div className="student-fields">
              <div className="form-field">
                <label htmlFor="studentName">
                  Student name <span>*</span>
                </label>

                <input
                  id="studentName"
                  name="studentName"
                  type="text"
                  placeholder="Enter your full name"
                  autoComplete="name"
                  value={studentName}
                  maxLength={80}
                  disabled={started}
                  aria-invalid={Boolean(errors.studentName)}
                  aria-describedby={
                    errors.studentName ? "studentNameError" : undefined
                  }
                  onChange={(event) => {
                    setStudentName(event.target.value);
                    setErrors((previous) => ({
                      ...previous,
                      studentName: "",
                    }));
                  }}
                />

                {errors.studentName && (
                  <p className="field-error" id="studentNameError">
                    {errors.studentName}
                  </p>
                )}
              </div>

              <div className="form-field">
                <label htmlFor="studentId">
                  Student ID <span>*</span>
                </label>

                <input
                  id="studentId"
                  name="studentId"
                  type="text"
                  placeholder="e.g. STU2026001"
                  autoComplete="off"
                  value={studentId}
                  maxLength={20}
                  disabled={started}
                  aria-invalid={Boolean(errors.studentId)}
                  aria-describedby={
                    errors.studentId ? "studentIdError" : undefined
                  }
                  onChange={(event) => {
                    setStudentId(event.target.value);
                    setErrors((previous) => ({
                      ...previous,
                      studentId: "",
                    }));
                  }}
                />

                {errors.studentId && (
                  <p className="field-error" id="studentIdError">
                    {errors.studentId}
                  </p>
                )}
              </div>
            </div>

            <p className="student-help">
              Use the name and ID registered with your institution.
            </p>
          </div>
        </section>

        {/* Exam overview */}
        <section className="exam-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR ASSESSMENT</p>
              <h2>Exam overview</h2>
            </div>

            <span className="upcoming-badge">
              {started ? "In progress" : "Ready to begin"}
            </span>
          </div>

          <article className="exam-card">
            <div className="exam-card-top">
              <div className="exam-icon">ED</div>

              <div className="exam-title-group">
                <span className="exam-category">
                  ACADEMIC ASSESSMENT
                </span>

                <h3>{exam.title}</h3>
                <p>{exam.subtitle}</p>
              </div>
            </div>

            <div className="exam-divider" />

            <div className="exam-details">
              <div className="detail-item">
                <div className="detail-icon">◷</div>
                <div>
                  <span className="field-label">DURATION</span>
                  <strong>{exam.duration}</strong>
                </div>
              </div>

              <div className="detail-item">
                <div className="detail-icon">▤</div>
                <div>
                  <span className="field-label">QUESTIONS</span>
                  <strong>{exam.questions}</strong>
                </div>
              </div>

              <div className="detail-item">
                <div className="detail-icon">▣</div>
                <div>
                  <span className="field-label">EXAM DATE</span>
                  <strong>{exam.date}</strong>
                </div>
              </div>

              <div className="detail-item">
                <div className="detail-icon">⌘</div>
                <div>
                  <span className="field-label">MODE</span>
                  <strong>{exam.mode}</strong>
                </div>
              </div>
            </div>

            <div className="exam-divider" />

            <div className="exam-notice">
              <div className="notice-icon">i</div>
              <div>
                <strong>Before you begin</strong>
                <p>
                  Verify your student details and review the
                  instructions before starting your assessment.
                </p>
              </div>
            </div>

            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}

            <button
              className="start-button"
              type="button"
              onClick={handleStartClick}
              disabled={starting || started}
            >
              <span>
                {started ? "Exam Started" : "Start Exam"}
              </span>

              {!started && (
                <span className="button-arrow">→</span>
              )}
            </button>

            <p className="button-caption">
              <span className="lock-symbol">♢</span>
              {started
                ? `Session: ${studentId.trim()}`
                : "Your exam begins after you confirm the instructions."}
            </p>
          </article>
        </section>

        <footer className="dashboard-footer">
          <span>ATHENA · EXAMINATION SYSTEM</span>
          <span>Designed for focused, secure assessments</span>
        </footer>
      </main>

      {/* Exam instructions modal */}
      {showInstructions && (
        <div
          className="modal-overlay"
          onClick={(event) => {
            if (
              event.target === event.currentTarget &&
              !starting
            ) {
              setShowInstructions(false);
              setError("");
            }
          }}
        >
          <section
            className="instructions-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="instructionsTitle"
          >
            <div className="modal-icon">!</div>

            <p className="eyebrow">PLEASE READ CAREFULLY</p>
            <h2 id="instructionsTitle">Exam Instructions</h2>

            <p className="modal-description">
              Please verify your details and review these rules
              before entering the assessment.
            </p>

            <div className="candidate-summary">
              <div>
                <span className="field-label">STUDENT NAME</span>
                <strong>{studentName.trim()}</strong>
              </div>

              <div>
                <span className="field-label">STUDENT ID</span>
                <strong>{studentId.trim()}</strong>
              </div>
            </div>

            <ol className="instructions-list">
              {examInstructions.map((instruction, index) => (
                <li key={instruction}>
                  <span className="instruction-number">
                    {index + 1}
                  </span>
                  <span>{instruction}</span>
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
                type="button"
                className="cancel-button"
                disabled={starting}
                onClick={() => {
                  setShowInstructions(false);
                  setError("");
                }}
              >
                Go Back
              </button>

              <button
                type="button"
                className="confirm-button"
                disabled={starting}
                onClick={confirmAndStartExam}
              >
                {starting
                  ? "Starting..."
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
    </div>
  );
}

export default App;
