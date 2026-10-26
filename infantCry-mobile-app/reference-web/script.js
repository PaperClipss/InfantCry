
// ========================================
// CONFIGURATION
// ========================================

// Change this when your FastAPI server runs elsewhere.
const API_BASE_URL = "http://localhost:8000/api";

// Enable placeholders while the backend is not ready.
const USE_PLACEHOLDERS = true;


// ========================================
// ELEMENTS
// ========================================

const loginPage = document.getElementById("loginPage");
const analysisPage = document.getElementById("analysisPage");
const adminPage = document.getElementById("adminPage");

const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const loginError = document.getElementById("loginError");

const loggedInUser = document.getElementById("loggedInUser");
const loggedInAdmin = document.getElementById("loggedInAdmin");
const logoutButton = document.getElementById("logoutButton");
const adminLogoutButton = document.getElementById("adminLogoutButton");

const recordButton = document.getElementById("recordButton");
const recordTime = document.getElementById("recordTime");
const audioFile = document.getElementById("audioFile");
const selectedFile = document.getElementById("selectedFile");
const audioSection = document.getElementById("audioSection");
const audioName = document.getElementById("audioName");
const audioPlayer = document.getElementById("audioPlayer");
const removeAudio = document.getElementById("removeAudio");

const analyzeButton = document.getElementById("analyzeButton");
const analyzeMessage = document.getElementById("analyzeMessage");
const loadingBox = document.getElementById("loadingBox");
const resultBox = document.getElementById("resultBox");
const predictionText = document.getElementById("predictionText");
const predictionDescription =
    document.getElementById("predictionDescription");
const confidenceText = document.getElementById("confidenceText");

const feedbackYes = document.getElementById("feedbackYes");
const feedbackNo = document.getElementById("feedbackNo");
const feedbackYesForm = document.getElementById("feedbackYesForm");
const feedbackNoForm = document.getElementById("feedbackNoForm");
const feedbackYesText = document.getElementById("feedbackYesText");
const feedbackNoText = document.getElementById("feedbackNoText");
const submitYesFeedback = document.getElementById("submitYesFeedback");
const submitNoFeedback = document.getElementById("submitNoFeedback");
const feedbackSuccess = document.getElementById("feedbackSuccess");

// Admin dashboard elements
const totalEntries = document.getElementById("totalEntries");
const modelStatus = document.getElementById("modelStatus");
const recentEntryCount = document.getElementById("recentEntryCount");
const recentEntriesBody = document.getElementById("recentEntriesBody");
const entriesDataNotice = document.getElementById("entriesDataNotice");
const modelName = document.getElementById("modelName");
const modelVersion = document.getElementById("modelVersion");
const modelApiStatus = document.getElementById("modelApiStatus");
const feedbackDataNotice = document.getElementById("feedbackDataNotice");
const adminFeedbackList = document.getElementById("adminFeedbackList");
const adminApiMessage = document.getElementById("adminApiMessage");
const refreshEntriesButton =
    document.getElementById("refreshEntriesButton");


// ========================================
// AUTHENTICATION
// ========================================

let authToken = null;
let currentRole = null;

// The frontend expects the future API to return:
// { "access_token": "...", "token_type": "bearer",
//   "role": "admin" or "user", "username": "..." }

loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password.trim()) {
        loginError.textContent =
            "Please enter your username and password.";
        return;
    }

    loginError.textContent = "Signing in...";

    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            throw new Error(
                response.status === 401
                    ? "Invalid username or password."
                    : `Login failed (${response.status}).`
            );
        }

        const data = await response.json();

        if (!["admin", "user"].includes(data.role)) {
            throw new Error("The server returned an invalid account role.");
        }

        authToken = data.access_token || null;
        currentRole = data.role;

        enterApplication(data.username || username, data.role);

    } catch (error) {
        // Mock login is only for local frontend development.
        // It must be disabled when real authentication is enabled.
        if (USE_PLACEHOLDERS &&
            error instanceof TypeError) {

            authToken = null;

            // DEMO ONLY: use "admin" as the demo admin username.
            // This is not real authentication or authorization.
            const demoRole =
                username.toLowerCase() === "admin"
                    ? "admin"
                    : "user";

            currentRole = demoRole;
            enterApplication(username, demoRole);

            loginError.textContent =
                "Demo mode: API unavailable. No real authentication performed.";
            return;
        }

        loginError.textContent =
            error.message || "Unable to log in.";
    }
});


function enterApplication(username, role) {
    loginPage.classList.add("hidden");
    analysisPage.classList.add("hidden");
    adminPage.classList.add("hidden");

    if (role === "admin") {
        loggedInAdmin.textContent = username;
        adminPage.classList.remove("hidden");
        loadAdminDashboard();
    } else {
        loggedInUser.textContent = username;
        analysisPage.classList.remove("hidden");
    }

    passwordInput.value = "";
}


// ========================================
// PASSWORD VISIBILITY
// ========================================

togglePassword.addEventListener("click", function () {
    const showing = passwordInput.type === "text";

    passwordInput.type = showing ? "password" : "text";
    togglePassword.textContent = showing ? "Show" : "Hide";
});


// ========================================
// LOGOUT
// ========================================

logoutButton.addEventListener("click", logout);
adminLogoutButton.addEventListener("click", logout);

async function logout() {
    if (isRecording) {
        stopRecording();
    }

    clearAudio();

    // Best-effort logout request. The backend should invalidate
    // the session/token when this endpoint is implemented.
    if (authToken) {
        try {
            await fetch(`${API_BASE_URL}/auth/logout`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${authToken}`
                }
            });
        } catch (error) {
            console.warn("Logout endpoint unavailable.", error);
        }
    }

    authToken = null;
    currentRole = null;

    usernameInput.value = "";
    passwordInput.value = "";
    loginError.textContent = "";

    analysisPage.classList.add("hidden");
    adminPage.classList.add("hidden");
    loginPage.classList.remove("hidden");
}


// ========================================
// API HELPER
// ========================================

async function apiGet(path) {
    const headers = {};

    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "GET",
        headers
    });

    if (!response.ok) {
        throw new Error(`Request failed (${response.status}).`);
    }

    return response.json();
}


// ========================================
// ADMIN DASHBOARD
// ========================================

async function loadAdminDashboard() {
    adminApiMessage.textContent = "Loading dashboard data...";

    if (USE_PLACEHOLDERS && !authToken) {
        showAdminPlaceholders();
        return;
    }

    try {
        const [dashboard, entries, config, feedback] =
            await Promise.all([
                apiGet("/admin/dashboard"),
                apiGet("/admin/entries"),
                apiGet("/admin/model-config"),
                apiGet("/admin/feedback")
            ]);

        totalEntries.textContent = dashboard.total_entries ?? "—";
        modelStatus.textContent = dashboard.model_status ?? "Unknown";

        renderEntries(entries.entries || entries);
        modelName.textContent = config.model_name ?? "Not configured";
        modelVersion.textContent = config.model_version ?? "—";
        modelApiStatus.textContent = config.api_status ?? "Unknown";

        renderFeedback(feedback.feedback || feedback);

        entriesDataNotice.textContent = "Live data from the backend.";
        feedbackDataNotice.textContent = "Live data from the backend.";
        adminApiMessage.textContent = "Dashboard data loaded from FastAPI.";

    } catch (error) {
        console.error("Admin dashboard error:", error);

        if (USE_PLACEHOLDERS) {
            showAdminPlaceholders();
            adminApiMessage.textContent =
                "API unavailable or returned an error. Showing labelled placeholder data.";
        } else {
            adminApiMessage.textContent =
                "Unable to load dashboard data. Please try refreshing.";
        }
    }
}


function showAdminPlaceholders() {
    totalEntries.textContent = "—";
    modelStatus.textContent = "Not connected";
    recentEntryCount.textContent = "—";

    modelName.textContent = "Not configured";
    modelVersion.textContent = "—";
    modelApiStatus.textContent = "Not connected";

    recentEntriesBody.replaceChildren();

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 4;
    cell.textContent = "No backend data available.";

    row.appendChild(cell);
    recentEntriesBody.appendChild(row);

    adminFeedbackList.textContent = "No backend feedback available.";

    entriesDataNotice.textContent =
        "Placeholder data — waiting for backend connection.";

    feedbackDataNotice.textContent =
        "Placeholder data — waiting for backend connection.";

    adminApiMessage.textContent =
        "Admin data is currently using placeholders.";
}


function renderEntries(entries) {
    recentEntriesBody.replaceChildren();

    const safeEntries = Array.isArray(entries) ? entries : [];

    recentEntryCount.textContent = safeEntries.length;

    if (safeEntries.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 4;
        cell.textContent = "No entries found.";

        row.appendChild(cell);
        recentEntriesBody.appendChild(row);
        return;
    }

    safeEntries.forEach(entry => {
        const row = document.createElement("tr");

        [
            entry.id ?? "—",
            entry.username ?? "—",
            entry.created_at ?? "—",
            entry.status ?? "—"
        ].forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
        });

        recentEntriesBody.appendChild(row);
    });
}


function renderFeedback(feedback) {
    adminFeedbackList.replaceChildren();

    const safeFeedback = Array.isArray(feedback) ? feedback : [];

    if (safeFeedback.length === 0) {
        adminFeedbackList.textContent = "No feedback submitted yet.";
        return;
    }

    safeFeedback.forEach(item => {
        const article = document.createElement("article");
        article.className = "admin-feedback-item";

        const heading = document.createElement("h4");
        heading.textContent = `Entry ${item.entry_id ?? "—"}`;

        const message = document.createElement("p");
        message.textContent = item.comment || "No written comment.";

        const sentiment = document.createElement("p");
        sentiment.textContent = `Helpful: ${item.helpful ?? "Not specified"}`;

        article.append(heading, message, sentiment);
        adminFeedbackList.appendChild(article);
    });
}


refreshEntriesButton.addEventListener("click", loadAdminDashboard);


// ========================================
// AUDIO STATE
// ========================================

let currentAudio = null;
let currentAudioURL = null;

let isRecording = false;
let startingRecording = false;

let mediaStream = null;
let audioContext = null;
let sourceNode = null;
let processor = null;

let recordedChunks = [];
let recordingTimer = null;
let recordingStartTime = null;


// ========================================
// UPLOAD WAV
// ========================================

audioFile.addEventListener("change", function () {
    if (isRecording || startingRecording || currentAudio) {
        audioFile.value = "";
        return;
    }

    const file = audioFile.files[0];

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".wav")) {
        alert("Please select a WAV file only.");
        audioFile.value = "";
        return;
    }

    setAudio(file, file.name);
});


// ========================================
// SET AUDIO
// ========================================

function setAudio(audioSource, fileName) {
    if (currentAudioURL) {
        URL.revokeObjectURL(currentAudioURL);
    }

    currentAudio = audioSource;
    currentAudioURL = URL.createObjectURL(audioSource);

    audioName.textContent = fileName;
    selectedFile.textContent = fileName;
    audioPlayer.src = currentAudioURL;

    audioSection.classList.remove("hidden");
    analyzeButton.disabled = false;
    analyzeMessage.textContent = "";

    loadingBox.classList.add("hidden");
    resultBox.classList.add("hidden");

    resetFeedback();
}


// ========================================
// REMOVE AUDIO
// ========================================

removeAudio.addEventListener("click", clearAudio);

function clearAudio() {
    if (isRecording) stopRecording();

    if (currentAudioURL) {
        URL.revokeObjectURL(currentAudioURL);
    }

    currentAudio = null;
    currentAudioURL = null;

    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();

    audioName.textContent = "";
    selectedFile.textContent = "No file selected";
    audioFile.value = "";

    audioSection.classList.add("hidden");
    analyzeButton.disabled = true;
    analyzeMessage.textContent =
        "Record or upload a WAV file to continue.";

    loadingBox.classList.add("hidden");
    resultBox.classList.add("hidden");

    resetFeedback();
}


// ========================================
// RECORDING
// ========================================

recordButton.addEventListener("click", function () {
    if (startingRecording) return;

    if (isRecording) {
        stopRecording();
        return;
    }

    if (currentAudio) return;

    startRecording();
});


async function startRecording() {
    if (currentAudio || startingRecording) return;

    startingRecording = true;
    recordButton.disabled = true;

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        if (currentAudio) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
            return;
        }

        audioContext = new (
            window.AudioContext || window.webkitAudioContext
        )();

        await audioContext.resume();

        sourceNode = audioContext.createMediaStreamSource(mediaStream);

        processor = audioContext.createScriptProcessor(4096, 1, 1);
        recordedChunks = [];

        processor.onaudioprocess = function (event) {
            if (!isRecording) return;

            recordedChunks.push(
                new Float32Array(event.inputBuffer.getChannelData(0))
            );
        };

        sourceNode.connect(processor);
        processor.connect(audioContext.destination);

        // Start recording and turn the button RED
        isRecording = true;
        recordButton.textContent = "Stop Recording";
        recordButton.classList.add("recording");

        startRecordingTimer();

    } catch (error) {
        console.error("Microphone error:", error);

        alert(
            "Could not access the microphone. Check your microphone permission."
        );

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

    } finally {
        startingRecording = false;
        recordButton.disabled = false;
    }
}


function stopRecording() {
    if (!isRecording) return;

    isRecording = false;
    stopRecordingTimer();

    if (processor) {
        processor.disconnect();
        processor.onaudioprocess = null;
    }

    if (sourceNode) sourceNode.disconnect();

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }

    const sampleRate = audioContext
        ? audioContext.sampleRate
        : 44100;

    if (audioContext) audioContext.close();

    audioContext = null;
    processor = null;
    sourceNode = null;
    mediaStream = null;

    recordButton.textContent = "Start Recording";
    recordTime.textContent = "00:00";

    const wavBlob = createWavFile(recordedChunks, sampleRate);
    recordedChunks = [];

    if (wavBlob && wavBlob.size > 44) {
        setAudio(wavBlob, "recorded_infant_cry.wav");
    } else {
        analyzeMessage.textContent = "No audio was recorded. Please try again.";
    }
}


// ========================================
// RECORDING TIMER
// ========================================

function startRecordingTimer() {
    recordingStartTime = Date.now();
    recordTime.textContent = "00:00";

    recordingTimer = setInterval(function () {
        const elapsed = Math.floor(
            (Date.now() - recordingStartTime) / 1000
        );

        const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
        const seconds = String(elapsed % 60).padStart(2, "0");

        recordTime.textContent = `${minutes}:${seconds}`;
    }, 1000);
}


function stopRecordingTimer() {
    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
}


// ========================================
// WAV ENCODING: MONO PCM 16-BIT
// ========================================

function createWavFile(chunks, sampleRate) {
    if (!chunks || chunks.length === 0) return null;

    let totalLength = 0;
    chunks.forEach(chunk => totalLength += chunk.length);

    if (totalLength === 0) return null;

    const samples = new Float32Array(totalLength);
    let offset = 0;

    chunks.forEach(chunk => {
        samples.set(chunk, offset);
        offset += chunk.length;
    });

    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, "WAVE");

    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);

    writeString(view, 36, "data");
    view.setUint32(40, samples.length * 2, true);

    let index = 44;

    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;

        view.setInt16(index, pcm, true);
        index += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
}


function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}


// ========================================
// ANALYZE
// Placeholder until model API is connected
// ========================================

analyzeButton.addEventListener("click", async function () {
    if (!currentAudio || analyzeButton.disabled) return;

    analyzeButton.disabled = true;
    analyzeMessage.textContent = "Analyzing audio...";

    resultBox.classList.add("hidden");
    loadingBox.classList.remove("hidden");

    // This is still a UI placeholder, not a model prediction.
    setTimeout(function () {
        loadingBox.classList.add("hidden");

        predictionText.textContent = "Prediction will appear here";
        confidenceText.textContent = "Percentage will appear here";

        predictionDescription.textContent =
            "The model prediction will be displayed here once the model is connected.";

        resultBox.classList.remove("hidden");
        analyzeMessage.textContent = "";
        analyzeButton.disabled = false;
    }, 1800);
});


// ========================================
// FEEDBACK
// ========================================

feedbackYes.addEventListener("click", function () {
    feedbackYes.classList.add("selected", "selected-yes");
    feedbackNo.classList.remove("selected", "selected-no");

    feedbackYesForm.classList.remove("hidden");
    feedbackNoForm.classList.add("hidden");
    feedbackSuccess.classList.add("hidden");
});

feedbackNo.addEventListener("click", function () {
    feedbackNo.classList.add("selected", "selected-no");
    feedbackYes.classList.remove("selected", "selected-yes");

    feedbackNoForm.classList.remove("hidden");
    feedbackYesForm.classList.add("hidden");
    feedbackSuccess.classList.add("hidden");
});


async function submitFeedback(helpful, comment) {
    // Once FastAPI is available, submit feedback to /api/feedback.
    if (authToken) {
        try {
            const response = await fetch(`${API_BASE_URL}/feedback`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    helpful,
                    comment
                })
            });

            if (!response.ok) {
                throw new Error("Feedback could not be saved.");
            }
        } catch (error) {
            console.error(error);
            feedbackSuccess.textContent =
                "Feedback could not be saved. Please try again.";
            feedbackSuccess.classList.remove("hidden");
            return;
        }
    } else {
        console.log("Demo feedback:", { helpful, comment });
    }

    feedbackYesForm.classList.add("hidden");
    feedbackNoForm.classList.add("hidden");

    feedbackSuccess.textContent = "Thank you for your feedback.";
    feedbackSuccess.classList.remove("hidden");
}


submitYesFeedback.addEventListener("click", function () {
    submitFeedback(true, feedbackYesText.value.trim());
});

submitNoFeedback.addEventListener("click", function () {
    submitFeedback(false, feedbackNoText.value.trim());
});


function resetFeedback() {
    feedbackYesForm.classList.add("hidden");
    feedbackNoForm.classList.add("hidden");
    feedbackSuccess.classList.add("hidden");

    feedbackYesText.value = "";
    feedbackNoText.value = "";
}


// ========================================
// INITIAL STATE
// ========================================

loginPage.classList.remove("hidden");
analysisPage.classList.add("hidden");
adminPage.classList.add("hidden");

audioSection.classList.add("hidden");
loadingBox.classList.add("hidden");
resultBox.classList.add("hidden");

analyzeButton.disabled = true;
