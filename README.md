# Athena — Online Examination & Proctoring System

**Athena** is a desktop-based online examination platform built using **Electron, React, Node.js, and Express.js**. It provides a structured environment for students to take multiple-choice examinations, manage exam time, navigate questions, and submit their answers.

Athena combines a React-based user interface with Electron desktop capabilities and a backend API for handling examination questions and student sessions. It also supports webcam access and local storage of proctoring snapshots through Electron's secure preload bridge.

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Technology Stack](#️-technology-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [How to Run the Project](#-how-to-run-the-project)
- [API Endpoints](#-api-endpoints)
- [Camera and Proctoring](#-camera-and-proctoring)
- [Troubleshooting](#-troubleshooting)
- [Future Improvements](#-future-improvements)

---

## 🎯 Overview

Athena aims to make computer-based examinations easier to conduct and manage through a dedicated desktop application.

Students can enter their details, review examination rules, grant camera access, answer MCQs, navigate between questions, and submit their attempts.

The application consists of three main parts:

1. **Frontend:** React and Vite provide the examination interface.
2. **Desktop application:** Electron manages the application window, fullscreen mode, examination timer, and local proctoring image storage.
3. **Backend:** Node.js and Express provide APIs for examination questions and session management.

### Project Goals

- Provide a clean and user-friendly examination interface.
- Simplify question navigation and answer selection.
- Support a 60-minute examination timer.
- Integrate webcam access for basic proctoring.
- Manage examination sessions and answers through backend APIs.
- Provide a structured workflow for examination instructions, starting, and submission.

---

## ✨ Features

### 1. Student Registration and Validation

- Student name and ID fields.
- Input validation before starting the examination.
- Clear error messages for invalid details.
- Examination overview and instructions.

### 2. Examination Rules

- Displays examination rules before starting.
- Allows students to accept or cancel the rules dialog.
- Explains camera usage and examination requirements.

### 3. Camera Permission and Preview

- Requests webcam access through the browser MediaDevices API.
- Supports live camera preview when permission is granted.
- Displays camera status and error messages.
- Uses Electron's permission handling to manage media access requests.

### 4. Fullscreen Examination Mode

- Uses Electron's native fullscreen functionality.
- Communicates between React and Electron through IPC.
- Checks fullscreen state before starting the exam timer.

### 5. Countdown Timer

- Configured examination duration of **60 minutes**.
- Starts when the Electron `start-test` handler succeeds.
- Calculates the remaining time from the stored exam end time.
- Supports resetting the timer when the examination is cancelled.

### 6. Webcam Snapshot Storage

- Supports saving JPEG snapshots during an active examination.
- Validates session IDs and image data.
- Rejects invalid or oversized JPEG images.
- Stores snapshots locally in session-specific directories.
- Maintains a manifest containing image filenames, timestamps, and file sizes.

### 7. Backend Integration

- Retrieves examination questions through an API.
- Supports creating examination sessions.
- Supports saving student answers.
- Supports updating and retrieving examination sessions, where implemented by the backend.

### 8. Examination Interface

The React frontend is responsible for the examination experience, including question display, answer selection, navigation, and progress indicators where implemented.

### 9. Results and Submission

The application is designed to support examination submission and result review. Final scoring, automatic submission, and answer review depend on the frontend and backend implementation.

---

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| React | Interactive frontend interface |
| Vite | Frontend development server and build tool |
| Electron | Desktop application |
| Node.js | JavaScript runtime |
| Express.js | Backend API |
| JavaScript | Application logic |
| HTML and CSS | UI structure and styling |
| JSON | Question and session storage, where configured |
| Electron IPC | Communication between React and Electron |
| MediaDevices API | Webcam access and preview |

---

## 📁 Project Structure

```text
athena-exam/
├── athena-backend/
│   ├── server.cjs
│   ├── package.json
│   └── data/
│       ├── questions.json
│       └── sessions.json
│
└── athena-frontend/
    ├── electron/
    │   ├── main.cjs
    │   └── preload.cjs
    ├── src/
    │   ├── App.jsx
    │   ├── App.css
    │   └── ...
    ├── index.html
    ├── package.json
    └── vite.config.js
```

### Important Files

- `server.cjs` — Runs the backend API.
- `questions.json` — Contains examination questions, if used by the backend.
- `sessions.json` — Stores session data when file-based storage is configured.
- `App.jsx` — Contains the React frontend and examination workflow.
- `App.css` — Defines the frontend styling.
- `main.cjs` — Manages the Electron window, permissions, fullscreen, timer, and snapshot storage.
- `preload.cjs` — Exposes approved Electron functionality to the frontend.
- `vite.config.js` — Configures Vite.

---

## ⚙️ Prerequisites

Before running Athena, install:

- [Node.js](https://nodejs.org/) — preferably an LTS version.
- npm — included with Node.js.
- A webcam for testing camera functionality.
- Git, if cloning the repository.

Verify your installation:

```bash
node --version
npm --version
```

---

## 🚀 Installation

### Step 1: Open the project directory

If the project is already on your computer:

```bash
cd ~/Documents/athena_project/athena-exam
```

If cloning from GitHub, use your actual repository URL:

```bash
git clone YOUR_REPOSITORY_URL
cd athena-exam
```

### Step 2: Install backend dependencies

```bash
cd athena-backend
npm install
```

### Step 3: Install frontend dependencies

Open a separate terminal:

```bash
cd ~/Documents/athena_project/athena-exam/athena-frontend
npm install
```

Ensure the frontend `package.json` contains the scripts required to run Vite and Electron.

---

## ▶️ How to Run the Project

Athena requires the backend and frontend to run together during development. Use three separate terminal windows.

### Terminal 1 — Start the Backend

```bash
cd ~/Documents/athena_project/athena-exam/athena-backend
node server.cjs
```

The backend is expected to run on port `6001`.

Check whether it is working:

```bash
curl http://127.0.0.1:6001/health
```

A successful response should report a healthy backend status.

Keep this terminal open.

### Terminal 2 — Start the Frontend

```bash
cd ~/Documents/athena_project/athena-exam/athena-frontend
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Vite should serve the React interface at:

**http://127.0.0.1:5180/**

Keep this terminal open.

> The port configured in `vite.config.js` must match the URL used by Electron. If your Vite configuration uses a different port, update the command and Electron development URL accordingly.

### Terminal 3 — Launch the Electron Desktop App

```bash
cd ~/Documents/athena_project/athena-exam/athena-frontend
npm run electron
```

This command assumes `athena-frontend/package.json` defines an `electron` script.

The Electron window should load the React interface from the running Vite development server.

**Important:** Keep both the backend and frontend terminals running while using the application.

### Build the Frontend

To check for frontend compilation errors:

```bash
cd ~/Documents/athena_project/athena-exam/athena-frontend
npm run build
```

Fix any build errors before testing the application further.

---

## 🔌 API Endpoints

The backend is intended to support the following examination operations. Confirm the exact route implementations in `server.cjs`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Checks backend availability |
| `GET` | `/api/questions` | Retrieves examination questions |
| `POST` | `/api/sessions` | Creates an examination session |
| `PUT` | `/api/sessions/:id/answers/:questionId` | Saves an answer |
| `PATCH` | `/api/sessions/:id` | Updates examination session data |
| `GET` | `/api/sessions/:id` | Retrieves session information, if implemented |

---

## 📷 Camera and Proctoring

Athena uses the browser MediaDevices API to request webcam access.

Example:

```javascript
navigator.mediaDevices.getUserMedia({
  video: true,
  audio: false
});
```

The Electron main process includes a `proctoring:save-image` handler that accepts JPEG image data and stores it locally during an active examination.

### Snapshot Storage

Images are stored under Electron's user-data directory:

```text
AthenaProctoring/
└── sessions/
    └── <session-id>/
        ├── images/
        └── manifest.json
```

The exact path depends on the operating system and Electron's configured user-data directory.

### Privacy

Camera access should be requested transparently, and students should be informed about when snapshots are captured and how they are stored. Snapshot storage alone does not verify student identity or guarantee examination integrity.

---

## 🧪 Troubleshooting

### Backend connection error

Check whether port `6001` is in use:

```bash
lsof -nP -iTCP:6001 -sTCP:LISTEN
```

Then test the health endpoint:

```bash
curl -i http://127.0.0.1:6001/health
```

Ensure the API URL in `App.jsx` matches the backend address and port.

### Electron opens a white screen

- Check that Vite is running.
- Verify the development URL in `main.cjs`.
- Check the frontend terminal for compilation errors.
- Run `npm run build`.

### Camera is not working

- Check macOS **System Settings → Privacy & Security → Camera**.
- Ensure camera access is permitted.
- Check the error returned by `getUserMedia()`.
- Verify that the camera stream is attached to the correct video element.

### Fullscreen does not activate

- Verify that `set-fullscreen` is exposed in `preload.cjs`.
- Ensure the frontend invokes the correct IPC method.
- Allow the fullscreen transition to complete before starting the exam.

### Port is already in use

Check the frontend port:

```bash
lsof -nP -iTCP:5180 -sTCP:LISTEN
```

Check the backend port:

```bash
lsof -nP -iTCP:6001 -sTCP:LISTEN
```

Stop only the conflicting process you have identified, or configure the application to use another available port consistently.

---

## 🔮 Future Improvements

- Randomized question and option order.
- Configurable examination durations.
- Administrative dashboard for exams and students.
- Improved session recovery and answer synchronization.
- Exportable results and performance analytics.
- Configurable snapshot intervals and retention policies.
- Automated tests for frontend, backend, and Electron IPC.
- Packaged application releases for macOS, Windows, and Linux.

---

## 🔐 Security

- Keep `contextIsolation` enabled and `nodeIntegration` disabled.
- Expose only necessary Electron functions through the preload bridge.
- Validate backend inputs and uploaded image data.
- Protect student information and locally stored proctoring images.
- Apply appropriate access controls and retention/deletion policies.

---

## 👨‍💻 Development Status

Athena is an actively developed desktop examination project. Feature availability depends on the current frontend, backend, and Electron implementation.

---

**Built with React, Electron, Node.js, and Express.js.**
