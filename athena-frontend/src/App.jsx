
import { useState } from "react";
import "./App.css";

const exam = {
  title: "Application Development",
  subtitle: "End-Semester Assessment",
  date: "Scheduled Assessment",
  duration: "60 minutes",
  questions: "As per exam paper",
  mode: "Online Assessment",
};

function App() {
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");

  async function handleStartExam() {
    if (starting || started) return;

    setStarting(true);
    setError("");

    try {
      const api = window.electronAPI;

      if (!api) {
        throw new Error("Athena's Electron bridge is unavailable.");
      }

      // Show the existing exam rules dialog.
      const rulesResult = await api.showExamRules();

      // If the dialog has a Cancel/Back option, do not start.
      if (
        rulesResult &&
        typeof rulesResult.response === "number" &&
        rulesResult.response !== 0
      ) {
        return;
      }

      // Use the existing Electron methods.
      await api.setFullScreen();
      await api.startTest();

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

          <div className="header-avatar">S</div>
        </div>
      </header>

      <main className="dashboard">
        <section className="welcome-section">
          <div>
            <p className="eyebrow">STUDENT DASHBOARD</p>
            <h1>Welcome back, Student.</h1>
            <p className="welcome-description">
              Everything is ready for your assessment. Review the details
              below before you begin.
            </p>
          </div>

          <div className="session-badge">
            <span className="session-dot" />
            Exam session
          </div>
        </section>

        <section className="student-card">
          <div className="student-avatar">S</div>

          <div className="student-info">
            <span className="field-label">CANDIDATE</span>
            <h2>Student Name</h2>
            <p>Student ID: Not provided</p>
          </div>

          <div className="student-divider" />

          <div className="student-meta">
            <span className="field-label">PLATFORM</span>
            <strong>Athena Examination System</strong>
            <span className="meta-secondary">
              Electron Desktop Application
            </span>
          </div>
        </section>

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
                  Ensure you are ready to complete your assessment.
                  Read the exam rules carefully before proceeding.
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
              onClick={handleStartExam}
              disabled={starting || started}
            >
              <span>
                {starting
                  ? "Preparing your exam..."
                  : started
                    ? "Exam started"
                    : "Start Exam"}
              </span>

              {!starting && !started && (
                <span className="button-arrow">→</span>
              )}
            </button>

            <p className="button-caption">
              <span className="lock-symbol">♢</span>
              {started
                ? "Your exam session has started."
                : "Your assessment will begin after you review the rules."}
            </p>
          </article>
        </section>

        <footer className="dashboard-footer">
          <span>ATHENA · EXAMINATION SYSTEM</span>
          <span>Designed for focused, secure assessments</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
