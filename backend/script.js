// ========================================
// CONFIGURATION
// ========================================

const API_BASE_URL = "http://localhost:8000/api";
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
const predictionDescription = document.getElementById("predictionDescription");
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
const feedbackChartNotice = document.getElementById("feedbackChartNotice");
const predictionChartNotice = document.getElementById("predictionChartNotice");
const feedbackChartCanvas = document.getElementById("feedbackChart");
const predictionClassChartCanvas = document.getElementById("predictionClassChart");
const adminApiMessage = document.getElementById("adminApiMessage");
const refreshEntriesButton = document.getElementById("refreshEntriesButton");

let authToken = null;
let currentRole = null;
let currentAnalysisId = null;
let feedbackChartInstance = null;
let predictionClassChartInstance = null;
let latestFeedbackData = [];
let latestEntriesData = [];
let latestDashboardData = {};
let sessionHistory = [];

// ========================================
// SAFE HELPERS
// ========================================

function setText(element, value) {
    if (element) element.textContent = value;
}

function show(element) {
    if (element) element.classList.remove("hidden");
}

function hide(element) {
    if (element) element.classList.add("hidden");
}

async function apiGet(path) {
    const headers = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

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
// LOGIN
// ========================================

if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password.trim()) {
            setText(loginError, "Please enter your username and password.");
            return;
        }

        setText(loginError, "Signing in...");

        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            if (!response.ok) {
                if (USE_PLACEHOLDERS && response.status === 501) {
                    enterDemoMode(username);
                    return;
                }

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
            if (USE_PLACEHOLDERS && error instanceof TypeError) {
                enterDemoMode(username);
                return;
            }

            setText(loginError, error.message || "Unable to log in.");
        }
    });
}

function enterDemoMode(username) {
    authToken = null;
    currentRole = username.toLowerCase() === "admin" ? "admin" : "user";

    enterApplication(username, currentRole);

    setText(
        loginError,
        "Demo mode: temporary access only. Authentication is not active."
    );
}

function enterApplication(username, role) {
    hide(loginPage);
    hide(analysisPage);
    hide(adminPage);

    if (role === "admin") {
        setText(loggedInAdmin, username);
        show(adminPage);
        loadAdminDashboard();
    } else {
        setText(loggedInUser, username);
        show(analysisPage);
        showAppView("home");
    }

    if (passwordInput) passwordInput.value = "";
}

if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", function () {
        const showing = passwordInput.type === "text";
        passwordInput.type = showing ? "password" : "text";
        togglePassword.textContent = showing ? "Show" : "Hide";
    });
}

// ========================================
// LOGOUT
// ========================================

if (logoutButton) logoutButton.addEventListener("click", logout);
if (adminLogoutButton) adminLogoutButton.addEventListener("click", logout);

async function logout() {
    if (isRecording) stopRecording();
    clearAudio();

    if (authToken) {
        try {
            await fetch(`${API_BASE_URL}/auth/logout`, {
                method: "POST",
                headers: { Authorization: `Bearer ${authToken}` }
            });
        } catch (error) {
            console.warn("Logout endpoint unavailable.", error);
        }
    }

    authToken = null;
    currentRole = null;

    if (usernameInput) usernameInput.value = "";
    if (passwordInput) passwordInput.value = "";
    setText(loginError, "");

    hide(analysisPage);
    hide(adminPage);
    show(loginPage);
}

// ========================================
// ADMIN DASHBOARD
// ========================================

async function loadAdminDashboard() {
    setText(adminApiMessage, "Loading dashboard data...");

    if (USE_PLACEHOLDERS && !authToken) {
        showAdminPlaceholders();
        return;
    }

    try {
        const [dashboard, entries, config, feedback] = await Promise.all([
            apiGet("/admin/dashboard"),
            apiGet("/admin/entries"),
            apiGet("/admin/model-config"),
            apiGet("/admin/feedback")
        ]);

        const entryList = Array.isArray(entries)
            ? entries
            : entries.entries || [];

        const feedbackList = Array.isArray(feedback)
            ? feedback
            : feedback.feedback || [];

        latestEntriesData = entryList;
        latestDashboardData = dashboard || {};
        latestFeedbackData = feedbackList;

        setText(totalEntries, dashboard.total_entries ?? "—");
        setText(modelStatus, dashboard.model_status ?? "Unknown");
        setText(modelName, config.model_name ?? "Not configured");
        setText(modelVersion, config.model_version ?? "—");
        setText(modelApiStatus, config.api_status ?? "Unknown");

        renderEntries(entryList);
        renderFeedback(feedbackList);
        renderFeedbackChart(feedbackList);
        renderPredictionClassChart(entryList, dashboard);

        setText(entriesDataNotice, "Live data from the backend.");
        setText(feedbackDataNotice, "Live data from the backend.");
        setText(adminApiMessage, "Dashboard data loaded from the backend.");

    } catch (error) {
        console.error("Admin dashboard error:", error);
        showAdminPlaceholders();

        setText(
            adminApiMessage,
            "Unable to load live dashboard data. Check the backend connection."
        );
        setText(
            entriesDataNotice,
            "Unable to load entries because the backend request failed."
        );
        setText(
            feedbackDataNotice,
            "Unable to load feedback because the backend request failed."
        );
    }
}

function showAdminPlaceholders() {
    latestFeedbackData = [];
    latestEntriesData = [];
    latestDashboardData = {};

    setText(totalEntries, "—");
    setText(modelStatus, "Not connected");
    setText(recentEntryCount, "—");
    setText(modelName, "Not configured");
    setText(modelVersion, "—");
    setText(modelApiStatus, "Not connected");

    if (recentEntriesBody) {
        recentEntriesBody.replaceChildren();
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.textContent = "No backend data available.";
        row.appendChild(cell);
        recentEntriesBody.appendChild(row);
    }

    setText(adminFeedbackList, "No backend feedback available.");
    setText(entriesDataNotice, "Waiting for backend connection.");
    setText(feedbackDataNotice, "Waiting for backend connection.");
    setText(adminApiMessage, "Dashboard is not connected to the backend.");

    renderFeedbackChart([]);
    renderPredictionClassChart([], {});
}

function renderEntries(entries) {
    if (!recentEntriesBody) return;

    recentEntriesBody.replaceChildren();
    const safeEntries = Array.isArray(entries) ? entries : [];
    setText(recentEntryCount, safeEntries.length);

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
    if (!adminFeedbackList) return;

    adminFeedbackList.replaceChildren();
    const safeFeedback = Array.isArray(feedback) ? feedback : [];

    if (!safeFeedback.length) {
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

// ========================================
// ADMIN CHARTS
// ========================================

function normalizeYesNo(value) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === 0) return value === 1;
    if (value === null || value === undefined) return null;

    const normalized = String(value).trim().toLowerCase();

    if (["yes", "y", "true", "1", "helpful", "positive"].includes(normalized)) {
        return true;
    }

    if (["no", "n", "false", "0", "not helpful", "negative"].includes(normalized)) {
        return false;
    }

    return null;
}

function getFeedbackChoice(item) {
    if (!item || typeof item !== "object") return null;

    for (const value of [
        item.helpful,
        item.is_helpful,
        item.isHelpful,
        item.answer,
        item.vote,
        item.response
    ]) {
        const choice = normalizeYesNo(value);
        if (choice !== null) return choice;
    }

    return null;
}

function setChartNotice(element, message) {
    if (element) element.textContent = message;
}

function renderFeedbackChart(feedback) {
    const safeFeedback = Array.isArray(feedback) ? feedback : [];
    let yesCount = 0;
    let noCount = 0;

    safeFeedback.forEach(item => {
        const choice = getFeedbackChoice(item);
        if (choice === true) yesCount++;
        if (choice === false) noCount++;
    });

    if (!feedbackChartCanvas || typeof Chart === "undefined") {
        setChartNotice(feedbackChartNotice, "Chart.js is unavailable.");
        return;
    }

    if (feedbackChartInstance) feedbackChartInstance.destroy();

    const darkTheme = document.documentElement.dataset.theme === "dark";

    feedbackChartInstance = new Chart(feedbackChartCanvas, {
        type: "pie",
        data: {
            labels: ["Yes", "No"],
            datasets: [{
                data: [yesCount, noCount],
                backgroundColor: ["#4b91ff", "#f16f91"],
                borderColor: darkTheme ? "#111c30" : "#ffffff",
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color: darkTheme ? "#d4deed" : "#52637a"
                    }
                }
            }
        }
    });

    const total = yesCount + noCount;
    setChartNotice(
        feedbackChartNotice,
        total
            ? `${yesCount} Yes and ${noCount} No responses.`
            : "No Yes/No feedback data is available."
    );
}

function getClassLabel(entry) {
    if (!entry || typeof entry !== "object") return null;

    const nested = [entry.prediction, entry.result, entry.analysis];

    for (const value of nested) {
        if (value && typeof value === "object") {
            const label =
                value.prediction ??
                value.predicted_class ??
                value.class_label ??
                value.label;

            if (label !== undefined && label !== null && String(label).trim()) {
                return String(label).trim();
            }
        }
    }

    const values = [
        entry.predicted_class,
        entry.class_label,
        entry.predicted_label,
        entry.prediction_label,
        entry.cry_type,
        entry.predicted_cry_type,
        typeof entry.prediction === "string" ? entry.prediction : null,
        entry.label
    ];

    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }

    return null;
}

function renderPredictionClassChart(entries, dashboard = {}) {
    const counts = {};
    const summary =
        dashboard.predictions_by_class ??
        dashboard.prediction_counts ??
        dashboard.class_counts ??
        dashboard.class_distribution;

    if (summary && typeof summary === "object" && !Array.isArray(summary)) {
        Object.entries(summary).forEach(([label, value]) => {
            const count = Number(
                value && typeof value === "object"
                    ? value.count ?? value.total ?? value.value
                    : value
            );

            if (Number.isFinite(count)) counts[label] = count;
        });
    } else if (Array.isArray(summary)) {
        summary.forEach(item => {
            if (!item || typeof item !== "object") return;

            const label =
                item.class_name ??
                item.class_label ??
                item.predicted_class ??
                item.label;

            const count = Number(item.count ?? item.total ?? item.value);

            if (label && Number.isFinite(count)) {
                counts[label] = (counts[label] || 0) + count;
            }
        });
    } else {
        (Array.isArray(entries) ? entries : []).forEach(entry => {
            const label = getClassLabel(entry);
            if (label) counts[label] = (counts[label] || 0) + 1;
        });
    }

    if (!predictionClassChartCanvas || typeof Chart === "undefined") {
        setChartNotice(predictionChartNotice, "Chart.js is unavailable.");
        return;
    }

    if (predictionClassChartInstance) predictionClassChartInstance.destroy();

    const labels = Object.keys(counts);
    const values = labels.map(label => counts[label]);
    const darkTheme = document.documentElement.dataset.theme === "dark";

    predictionClassChartInstance = new Chart(predictionClassChartCanvas, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Predictions",
                data: values,
                backgroundColor: "#4b91ff",
                borderRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: darkTheme ? "#bdc9d9" : "#607087" },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        color: darkTheme ? "#bdc9d9" : "#607087"
                    }
                }
            }
        }
    });

    setChartNotice(
        predictionChartNotice,
        labels.length
            ? `Showing prediction counts for ${labels.length} classes.`
            : "No prediction class data is available from the backend."
    );
}

if (refreshEntriesButton) {
    refreshEntriesButton.addEventListener("click", loadAdminDashboard);
}

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
let isAnalyzing = false;
let analysisRequestController = null;

// ========================================
// WAV FILE VALIDATION
// ========================================

if (audioFile) {
    audioFile.addEventListener("change", async function () {
        if (isRecording || startingRecording || currentAudio || isAnalyzing) {
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

        try {
            if (!(await validateWavFile(file))) {
                alert("This does not appear to be a valid WAV file.");
                audioFile.value = "";
                return;
            }

            setAudio(file, file.name);
        } catch (error) {
            console.error("WAV validation failed:", error);
            alert("Could not check the file. Please choose a valid WAV file.");
            audioFile.value = "";
        }
    });
}

async function validateWavFile(file) {
    if (!file || file.size < 44) return false;

    const buffer = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
    const view = new DataView(buffer);

    const fourCC = offset => String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
    );

    if (fourCC(0) !== "RIFF" || fourCC(8) !== "WAVE") return false;

    let offset = 12;
    let hasFormat = false;
    let hasData = false;

    while (offset + 8 <= view.byteLength) {
        const name = fourCC(offset);
        const size = view.getUint32(offset + 4, true);
        const start = offset + 8;

        if (name === "fmt ") hasFormat = true;
        if (name === "data") hasData = true;
        if (hasFormat && hasData) return true;
        if (size > view.byteLength - start) break;

        offset = start + size + (size % 2);
    }

    return hasFormat && hasData;
}

// ========================================
// SET / CLEAR AUDIO
// ========================================

function setAudio(audioSource, fileName) {
    if (isAnalyzing) cancelAnalysis();

    if (currentAudioURL) URL.revokeObjectURL(currentAudioURL);

    currentAudio = audioSource;
    currentAnalysisId = null;
    currentAudioURL = URL.createObjectURL(audioSource);

    setText(audioName, fileName);
    setText(selectedFile, fileName);

    if (audioPlayer) audioPlayer.src = currentAudioURL;

    show(audioSection);
    if (analyzeButton) analyzeButton.disabled = false;
    setText(analyzeMessage, "");

    hide(loadingBox);
    hide(resultBox);
    resetFeedback();
}

if (removeAudio) removeAudio.addEventListener("click", clearAudio);

function clearAudio() {
    if (isRecording) stopRecording();
    if (isAnalyzing) cancelAnalysis();

    if (currentAudioURL) URL.revokeObjectURL(currentAudioURL);

    currentAudio = null;
    currentAnalysisId = null;
    currentAudioURL = null;

    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.removeAttribute("src");
        audioPlayer.load();
    }

    setText(audioName, "");
    setText(selectedFile, "No file selected");
    if (audioFile) audioFile.value = "";

    hide(audioSection);
    if (analyzeButton) analyzeButton.disabled = true;

    setText(analyzeMessage, "Record or upload a WAV file to continue.");
    hide(loadingBox);
    hide(resultBox);
    resetFeedback();
}

// ========================================
// RECORD AUDIO AS WAV
// ========================================

if (recordButton) {
    recordButton.addEventListener("click", function () {
        if (startingRecording) return;

        if (isRecording) {
            stopRecording();
            return;
        }

        if (currentAudio || isAnalyzing) return;
        startRecording();
    });
}

async function startRecording() {
    if (currentAudio || startingRecording || isAnalyzing) return;

    startingRecording = true;
    if (recordButton) recordButton.disabled = true;

    try {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Microphone recording requires HTTPS or localhost.");
        }

        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
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

        isRecording = true;
        setText(recordButton, "Stop Recording");
        recordButton.classList.add("recording");
        startRecordingTimer();

    } catch (error) {
        console.error("Microphone error:", error);
        alert(error.message || "Could not access the microphone.");

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        if (processor) {
            processor.disconnect();
            processor.onaudioprocess = null;
            processor = null;
        }

        if (sourceNode) {
            sourceNode.disconnect();
            sourceNode = null;
        }

        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        setText(recordButton, "Start Recording");
        recordButton.classList.remove("recording");

    } finally {
        startingRecording = false;
        if (recordButton) recordButton.disabled = false;
    }
}

function stopRecording() {
    if (!isRecording) return;

    isRecording = false;
    stopRecordingTimer();

    if (processor) {
        processor.disconnect();
        processor.onaudioprocess = null;
        processor = null;
    }

    if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    const sampleRate = audioContext ? audioContext.sampleRate : 44100;
    const samples = mergeAudioChunks(recordedChunks);
    recordedChunks = [];

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    setText(recordButton, "Start Recording");
    if (recordButton) recordButton.classList.remove("recording");

    if (!samples.length) {
        alert("No audio was captured. Please try recording again.");
        return;
    }

    const wavBlob = encodeWav(samples, sampleRate);
    const wavFile = new File([wavBlob], "infant-cry-recording.wav", {
        type: "audio/wav"
    });

    setAudio(wavFile, wavFile.name);
}

function mergeAudioChunks(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;

    chunks.forEach(chunk => {
        result.set(chunk, offset);
        offset += chunk.length;
    });

    return result;
}

function encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(offset, value) {
        for (let i = 0; i < value.length; i++) {
            view.setUint8(offset + i, value.charCodeAt(i));
        }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;

    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(
            offset,
            sample < 0 ? sample * 0x8000 : sample * 0x7fff,
            true
        );
        offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
}

function startRecordingTimer() {
    recordingStartTime = Date.now();
    updateRecordingTime();

    recordingTimer = setInterval(updateRecordingTime, 250);
}

function updateRecordingTime() {
    if (!recordingStartTime) return;

    const seconds = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    setText(
        recordTime,
        `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    );
}

function stopRecordingTimer() {
    if (recordingTimer) clearInterval(recordingTimer);
    recordingTimer = null;
    recordingStartTime = null;
    setText(recordTime, "00:00");
}

// ========================================
// ANALYZE AUDIO
// ========================================

if (analyzeButton) {
    analyzeButton.addEventListener("click", analyzeAudio);
}

async function analyzeAudio() {
    if (!currentAudio || isAnalyzing) return;

    isAnalyzing = true;
    analyzeButton.disabled = true;
    hide(resultBox);
    show(loadingBox);
    setText(analyzeMessage, "Analyzing audio...");

    analysisRequestController = new AbortController();

    try {
        const formData = new FormData();
        formData.append("audio", currentAudio, currentAudio.name || "recording.wav");

        const headers = {};
        if (authToken) headers.Authorization = `Bearer ${authToken}`;

        const response = await fetch(`${API_BASE_URL}/analysis`, {
            method: "POST",
            headers,
            body: formData,
            signal: analysisRequestController.signal
        });

        if (!response.ok) {
            throw new Error(`Analysis failed (${response.status}).`);
        }

        const data = await response.json();
        displayAnalysisResult(data);

    } catch (error) {
        if (error.name !== "AbortError") {
            console.error("Analysis error:", error);
            setText(
                analyzeMessage,
                "Could not analyze this recording. Check the backend connection and try again."
            );
        }
    } finally {
        isAnalyzing = false;
        analysisRequestController = null;
        hide(loadingBox);
        if (analyzeButton) analyzeButton.disabled = !currentAudio;
    }
}

function displayAnalysisResult(data) {
    currentAnalysisId =
        data.analysis_id ??
        data.id ??
        data.entry_id ??
        null;

    const prediction =
        data.predicted_class ??
        data.prediction ??
        data.cry_type ??
        data.label ??
        "Prediction unavailable";

    const confidence =
        data.confidence ??
        data.confidence_score ??
        data.probability ??
        null;

    setText(predictionText, String(prediction));

    if (confidence === null || confidence === undefined) {
        setText(confidenceText, "Not provided");
    } else {
        const numericConfidence = Number(confidence);
        const percentage = numericConfidence <= 1
            ? numericConfidence * 100
            : numericConfidence;

        setText(
            confidenceText,
            Number.isFinite(percentage) ? `${percentage.toFixed(1)}%` : String(confidence)
        );
    }

    setText(
        predictionDescription,
        data.description ??
        "This is an exploratory audio prediction, not a medical diagnosis."
    );

    show(resultBox);
    setText(analyzeMessage, "Analysis complete.");

    sessionHistory.unshift({
        id: currentAnalysisId,
        prediction: String(prediction),
        confidence: confidence,
        created_at: new Date().toLocaleString()
    });

    renderSessionHistory();
    resetFeedback();
}

function cancelAnalysis() {
    if (analysisRequestController) {
        analysisRequestController.abort();
    }

    isAnalyzing = false;
    analysisRequestController = null;
    hide(loadingBox);

    if (analyzeButton) analyzeButton.disabled = !currentAudio;
}

// ========================================
// FEEDBACK
// ========================================

function resetFeedback() {
    hide(feedbackYesForm);
    hide(feedbackNoForm);
    hide(feedbackSuccess);

    if (feedbackYesText) feedbackYesText.value = "";
    if (feedbackNoText) feedbackNoText.value = "";

    if (feedbackYes) feedbackYes.classList.remove("selected");
    if (feedbackNo) feedbackNo.classList.remove("selected");
}

if (feedbackYes) {
    feedbackYes.addEventListener("click", () => {
        show(feedbackYesForm);
        hide(feedbackNoForm);
        hide(feedbackSuccess);
        feedbackYes.classList.add("selected");
        if (feedbackNo) feedbackNo.classList.remove("selected");
    });
}

if (feedbackNo) {
    feedbackNo.addEventListener("click", () => {
        show(feedbackNoForm);
        hide(feedbackYesForm);
        hide(feedbackSuccess);
        feedbackNo.classList.add("selected");
        if (feedbackYes) feedbackYes.classList.remove("selected");
    });
}

if (submitYesFeedback) {
    submitYesFeedback.addEventListener("click", () => submitFeedback(true));
}

if (submitNoFeedback) {
    submitNoFeedback.addEventListener("click", () => submitFeedback(false));
}

async function submitFeedback(helpful) {
    const comment = helpful
        ? (feedbackYesText?.value || "").trim()
        : (feedbackNoText?.value || "").trim();

    try {
        const headers = { "Content-Type": "application/json" };
        if (authToken) headers.Authorization = `Bearer ${authToken}`;

        const response = await fetch(`${API_BASE_URL}/feedback`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                analysis_id: currentAnalysisId,
                helpful,
                comment
            })
        });

        if (!response.ok) {
            throw new Error(`Feedback submission failed (${response.status}).`);
        }

        show(feedbackSuccess);
        hide(feedbackYesForm);
        hide(feedbackNoForm);
        setText(feedbackSuccess, "Thank you for your feedback.");

    } catch (error) {
        console.error("Feedback error:", error);
        alert("Could not submit feedback. Check the backend connection and try again.");
    }
}

// ========================================
// SESSION HISTORY
// ========================================

function renderSessionHistory() {
    const historyContainer = document.getElementById("sessionHistory");
    if (!historyContainer) return;

    historyContainer.replaceChildren();

    if (!sessionHistory.length) {
        const empty = document.createElement("article");
        empty.className = "empty-state";

        const title = document.createElement("h3");
        title.textContent = "No analyses yet";

        const message = document.createElement("p");
        message.textContent =
            "Once you analyze a recording, your recent result will be listed here.";

        empty.append(title, message);
        historyContainer.appendChild(empty);
        return;
    }

    sessionHistory.forEach(item => {
        const article = document.createElement("article");
        article.className = "history-item";

        const title = document.createElement("h3");
        title.textContent = item.prediction;

        const date = document.createElement("p");
        date.textContent = item.created_at;

        const confidence = document.createElement("p");
        confidence.textContent = item.confidence == null
            ? "Confidence not provided"
            : `Confidence: ${item.confidence}`;

        article.append(title, date, confidence);
        historyContainer.appendChild(article);
    });
}

// ========================================
// APP NAVIGATION
// ========================================

function showAppView(viewName) {
    document.querySelectorAll("[data-page-section]").forEach(section => {
        section.classList.toggle(
            "hidden",
            section.dataset.pageSection !== viewName
        );
    });

    document.querySelectorAll("[data-view-link]").forEach(link => {
        link.classList.toggle(
            "is-active",
            link.dataset.viewLink === viewName
        );
    });

    const themeLabel = document.getElementById("profileTheme");
    if (themeLabel) {
        themeLabel.textContent =
            document.documentElement.dataset.theme === "dark"
                ? "Dark mode"
                : "Light mode";
    }
}

document.querySelectorAll("[data-view-link]").forEach(link => {
    link.addEventListener("click", function (event) {
        event.preventDefault();
        showAppView(link.dataset.viewLink);
    });
});

const jumpToAudio = document.getElementById("jumpToAudio");
if (jumpToAudio) {
    jumpToAudio.addEventListener("click", () => showAppView("analyze"));
}

const getStartedButton = document.getElementById("getStartedButton");
const navLoginButton = document.getElementById("navLoginButton");
const backToHome = document.getElementById("backToHome");
const landingBrandLink = document.getElementById("landingBrandLink");

function showLoginPanel() {
    if (loginPage) loginPage.classList.add("show-login");
    const panel = document.getElementById("loginPanel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

if (getStartedButton) getStartedButton.addEventListener("click", showLoginPanel);
if (navLoginButton) navLoginButton.addEventListener("click", showLoginPanel);

if (backToHome) {
    backToHome.addEventListener("click", () => {
        if (loginPage) loginPage.classList.remove("show-login");
        if (document.getElementById("landingHome")) {
            document.getElementById("landingHome").scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    });
}

if (landingBrandLink) {
    landingBrandLink.addEventListener("click", function (event) {
        event.preventDefault();
        if (loginPage) loginPage.classList.remove("show-login");
        window.scrollTo({ top: 0, behavior: "smooth" });
    });
}

// ========================================
// THEME: LIGHT AND DARK
// ========================================

function applyTheme(theme) {
    const normalized = theme === "dark" ? "dark" : "light";

    document.documentElement.dataset.theme = normalized;

    try {
        localStorage.setItem("infantcry-theme", normalized);
    } catch (_) {}

    document.querySelectorAll("[data-theme-toggle]").forEach(button => {
        const icon = button.querySelector(".theme-icon");
        const label = button.querySelector(".theme-label");

        const nextTheme = normalized === "dark" ? "light" : "dark";

        if (icon) icon.textContent = normalized === "dark" ? "☀" : "☾";
        if (label) label.textContent = normalized === "dark" ? "Light mode" : "Dark mode";

        button.setAttribute(
            "aria-label",
            `Switch to ${nextTheme} mode`
        );
    });

    const themeLabel = document.getElementById("profileTheme");
    if (themeLabel) {
        themeLabel.textContent = normalized === "dark" ? "Dark mode" : "Light mode";
    }

    if (latestFeedbackData.length || latestEntriesData.length) {
        renderFeedbackChart(latestFeedbackData);
        renderPredictionClassChart(latestEntriesData, latestDashboardData);
    } else if (feedbackChartCanvas || predictionClassChartCanvas) {
        renderFeedbackChart([]);
        renderPredictionClassChart([], {});
    }
}

document.querySelectorAll("[data-theme-toggle]").forEach(button => {
    button.addEventListener("click", () => {
        const current = document.documentElement.dataset.theme;
        applyTheme(current === "dark" ? "light" : "dark");
    });
});

let savedTheme = "dark";

try {
    savedTheme = localStorage.getItem("infantcry-theme") || "dark";
} catch (_) {}

applyTheme(savedTheme);