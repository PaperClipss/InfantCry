
const express = require("express");
const cors = require("cors");
const multer = require("multer");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Store uploaded audio in memory for the mock endpoint.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, callback) => {
        if (file.originalname.toLowerCase().endsWith(".wav")) {
            callback(null, true);
        } else {
            callback(new Error("Only .wav files are accepted."));
        }
    }
});

// Sample data only — no database is connected.
const mockEntries = [
    {
        id: 101,
        username: "demo_user",
        created_at: "2026-10-27T10:30:00Z",
        status: "Completed"
    },
    {
        id: 102,
        username: "sample_user",
        created_at: "2026-10-27T11:00:00Z",
        status: "Completed"
    }
];

const mockFeedback = [
    {
        entry_id: 101,
        comment: "The prediction was helpful.",
        helpful: true
    }
];

// Health check
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "InfantCry Express API is running"
    });
});

// 1. Signup — mock response
app.post("/api/auth/signup", (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: "Username and password are required."
        });
    }

    res.status(201).json({
        success: true,
        message: "Mock signup successful. No account was saved.",
        username
    });
});

// 2. Login — mock response
app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: "Username and password are required."
        });
    }

    const role = username.toLowerCase() === "admin" ? "admin" : "user";

    res.json({
        success: true,
        message: "Mock login successful. Credentials were not verified.",
        access_token: "mock-token-for-development-only",
        token_type: "bearer",
        username,
        role
    });
});

// 3. Logout — mock response
app.post("/api/auth/logout", (req, res) => {
    res.json({
        success: true,
        message: "Mock logout successful."
    });
});

// 4. Audio analysis — sample prediction only
app.post("/api/analysis", upload.single("audio"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: "Please upload a WAV audio file using the 'audio' field."
        });
    }

    res.json({
        success: true,
        analysis_id: 104,
        prediction: "Hunger",
        confidence: 0.92,
        description: "Sample prediction returned by the mock API.",
        message: "Audio received. The ML model was not called."
    });
});

// 5. Feedback — mock response, not saved
app.post("/api/feedback", (req, res) => {
    const { analysis_id, helpful, comment } = req.body || {};

    if (analysis_id == null || typeof helpful !== "boolean") {
        return res.status(400).json({
            success: false,
            message: "analysis_id and a boolean helpful value are required."
        });
    }

    res.status(201).json({
        success: true,
        message: "Mock feedback received. It was not saved.",
        feedback: {
            analysis_id,
            helpful,
            comment: comment || ""
        }
    });
});

// 6. Admin dashboard
app.get("/api/admin/dashboard", (req, res) => {
    res.json({
        success: true,
        total_entries: 128,
        model_status: "Mock — not connected",
        recent_entry_count: mockEntries.length
    });
});

// 7. Recent analysis entries
app.get("/api/admin/entries", (req, res) => {
    res.json({
        success: true,
        entries: mockEntries
    });
});

// 8. Model configuration
app.get("/api/admin/model-config", (req, res) => {
    res.json({
        success: true,
        model_name: "InfantCry Demo Model",
        model_version: "Mock v1.0",
        input_format: "WAV; 16 kHz mono is the intended target, not validated here",
        api_status: "Mock — model not connected"
    });
});

// 9. Admin feedback overview
app.get("/api/admin/feedback", (req, res) => {
    res.json({
        success: true,
        feedback: mockFeedback
    });
});

// Unknown routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Endpoint not found."
    });
});

// Error handler
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: err.code === "LIMIT_FILE_SIZE"
                ? "Audio file must be 10 MB or smaller."
                : err.message
        });
    }

    if (err.type === "entity.parse.failed") {
        return res.status(400).json({
            success: false,
            message: "Invalid JSON request body."
        });
    }

    if (err.message === "Only .wav files are accepted.") {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    console.error(err);
    res.status(500).json({
        success: false,
        message: "Internal server error."
    });
});

app.listen(PORT, () => {
    console.log(`InfantCry backend running at http://localhost:${PORT}`);
});
// ==================================================
// PART 2: AUDIO, RECORDING, ANALYSIS, FEEDBACK & NAVIGATION
// Paste this below Part 1
// ==================================================


// ==================================================
// AUDIO ELEMENTS
// ==================================================

const p2AudioFile = document.getElementById("audioFile");
const p2SelectedFile = document.getElementById("selectedFile");
const p2AudioSection = document.getElementById("audioSection");
const p2AudioName = document.getElementById("audioName");
const p2AudioPlayer = document.getElementById("audioPlayer");
const p2RemoveAudio = document.getElementById("removeAudio");

const p2RecordButton = document.getElementById("recordButton");
const p2RecordTime = document.getElementById("recordTime");

const p2AnalyzeButton = document.getElementById("analyzeButton");
const p2AnalyzeMessage = document.getElementById("analyzeMessage");
const p2LoadingBox = document.getElementById("loadingBox");
const p2ResultBox = document.getElementById("resultBox");
const p2PredictionText = document.getElementById("predictionText");


// ==================================================
// FEEDBACK ELEMENTS
// ==================================================

const p2FeedbackYes = document.getElementById("feedbackYes");
const p2FeedbackNo = document.getElementById("feedbackNo");

const p2FeedbackYesForm = document.getElementById("feedbackYesForm");
const p2FeedbackNoForm = document.getElementById("feedbackNoForm");

const p2FeedbackYesText = document.getElementById("feedbackYesText");
const p2FeedbackNoText = document.getElementById("feedbackNoText");

const p2SubmitYes = document.getElementById("submitYesFeedback");
const p2SubmitNo = document.getElementById("submitNoFeedback");

const p2FeedbackSuccess = document.getElementById("feedbackSuccess");


// ==================================================
// AUDIO STATE
// ==================================================

let p2CurrentAudio = null;
let p2CurrentAudioURL = null;

let p2IsRecording = false;
let p2MediaStream = null;
let p2AudioContext = null;
let p2SourceNode = null;
let p2Processor = null;

let p2RecordedChunks = [];

let p2RecordingStartTime = null;
let p2RecordingTimer = null;

let p2IsAnalyzing = false;
let p2AnalysisController = null;

let p2CurrentFeedbackChoice = null;
let p2SessionHistory = [];


// ==================================================
// HELPER FUNCTIONS
// ==================================================

function p2Show(element) {
    if (element) {
        element.classList.remove("hidden");
    }
}

function p2Hide(element) {
    if (element) {
        element.classList.add("hidden");
    }
}

function p2SetMessage(element, message) {
    if (element) {
        element.textContent = message;
    }
}


// ==================================================
// WAV FILE VALIDATION
// ==================================================

async function p2ValidateWav(file) {

    if (!file || file.size < 44) {
        return false;
    }

    // Backend upload limit is 10 MB.
    if (file.size > 10 * 1024 * 1024) {
        throw new Error("File size must be less than 10 MB.");
    }

    const buffer = await file.slice(0, 1024 * 1024).arrayBuffer();

    const view = new DataView(buffer);

    function readFourCC(offset) {
        return String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3)
        );
    }

    if (
        readFourCC(0) !== "RIFF" ||
        readFourCC(8) !== "WAVE"
    ) {
        return false;
    }

    let offset = 12;
    let hasFormat = false;
    let hasData = false;

    while (offset + 8 <= view.byteLength) {

        const chunkName = readFourCC(offset);
        const chunkSize = view.getUint32(offset + 4, true);

        const chunkStart = offset + 8;

        if (chunkName === "fmt ") {
            hasFormat = true;
        }

        if (chunkName === "data") {
            hasData = true;
        }

        if (hasFormat && hasData) {
            return true;
        }

        if (chunkSize > view.byteLength - chunkStart) {
            break;
        }

        offset = chunkStart + chunkSize + (chunkSize % 2);
    }

    return hasFormat && hasData;
}


// ==================================================
// UPLOAD AUDIO
// ==================================================

if (p2AudioFile) {

    p2AudioFile.addEventListener("change", async function () {

        const file = p2AudioFile.files[0];

        if (!file) {
            return;
        }

        if (p2IsRecording || p2IsAnalyzing) {
            p2AudioFile.value = "";
            return;
        }

        try {

            if (!file.name.toLowerCase().endsWith(".wav")) {
                throw new Error("Please select a WAV file only.");
            }

            const valid = await p2ValidateWav(file);

            if (!valid) {
                throw new Error("The selected file is not a valid WAV file.");
            }

            p2SetAudio(file);

        } catch (error) {

            alert(error.message);

            p2AudioFile.value = "";
        }

    });

}


// ==================================================
// SET AUDIO
// ==================================================

function p2SetAudio(file) {

    if (p2CurrentAudioURL) {
        URL.revokeObjectURL(p2CurrentAudioURL);
    }

    p2CurrentAudio = file;

    p2CurrentAudioURL = URL.createObjectURL(file);

    if (p2AudioPlayer) {
        p2AudioPlayer.src = p2CurrentAudioURL;
    }

    p2SetMessage(p2AudioName, file.name);
    p2SetMessage(p2SelectedFile, file.name);

    p2Show(p2AudioSection);

    if (p2AnalyzeButton) {
        p2AnalyzeButton.disabled = false;
    }

    p2SetMessage(
        p2AnalyzeMessage,
        "Your audio is ready for analysis."
    );

    p2Hide(p2LoadingBox);
    p2Hide(p2ResultBox);

    p2ResetFeedback();
}


// ==================================================
// REMOVE AUDIO
// ==================================================

function p2ClearAudio() {

    if (p2IsRecording) {
        p2StopRecording();
    }

    if (p2AnalysisController) {
        p2AnalysisController.abort();
        p2AnalysisController = null;
    }

    p2IsAnalyzing = false;

    if (p2CurrentAudioURL) {
        URL.revokeObjectURL(p2CurrentAudioURL);
    }

    p2CurrentAudio = null;
    p2CurrentAudioURL = null;

    if (p2AudioPlayer) {
        p2AudioPlayer.pause();
        p2AudioPlayer.removeAttribute("src");
        p2AudioPlayer.load();
    }

    if (p2AudioFile) {
        p2AudioFile.value = "";
    }

    p2SetMessage(p2AudioName, "");
    p2SetMessage(p2SelectedFile, "No file selected");

    p2Hide(p2AudioSection);
    p2Hide(p2LoadingBox);
    p2Hide(p2ResultBox);

    if (p2AnalyzeButton) {
        p2AnalyzeButton.disabled = true;
    }

    p2SetMessage(
        p2AnalyzeMessage,
        "Record or upload a WAV file to continue."
    );

    p2ResetFeedback();
}


if (p2RemoveAudio) {
    p2RemoveAudio.addEventListener("click", p2ClearAudio);
}


// ==================================================
// RECORDING TIMER
// ==================================================

function p2StartTimer() {

    p2RecordingStartTime = Date.now();

    p2RecordingTimer = setInterval(function () {

        const elapsed = Math.floor(
            (Date.now() - p2RecordingStartTime) / 1000
        );

        const minutes = String(
            Math.floor(elapsed / 60)
        ).padStart(2, "0");

        const seconds = String(
            elapsed % 60
        ).padStart(2, "0");

        p2SetMessage(
            p2RecordTime,
            `${minutes}:${seconds}`
        );

    }, 1000);

}


function p2StopTimer() {

    clearInterval(p2RecordingTimer);

    p2RecordingTimer = null;
}


// ==================================================
// START RECORDING
// ==================================================

async function p2StartRecording() {

    if (p2IsRecording || p2IsAnalyzing) {
        return;
    }

    try {

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Microphone access requires HTTPS or localhost."
            );
        }

        p2MediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        p2AudioContext = new (
            window.AudioContext ||
            window.webkitAudioContext
        )();

        await p2AudioContext.resume();

        p2SourceNode =
            p2AudioContext.createMediaStreamSource(p2MediaStream);

        p2Processor =
            p2AudioContext.createScriptProcessor(4096, 1, 1);

        p2RecordedChunks = [];

        p2Processor.onaudioprocess = function (event) {

            if (!p2IsRecording) {
                return;
            }

            const audioData =
                event.inputBuffer.getChannelData(0);

            p2RecordedChunks.push(
                new Float32Array(audioData)
            );

        };

        p2SourceNode.connect(p2Processor);

        p2Processor.connect(p2AudioContext.destination);

        p2IsRecording = true;

        p2SetMessage(p2RecordButton, "Stop Recording");

        p2RecordButton.classList.add("recording");

        p2StartTimer();

    } catch (error) {

        console.error("Recording error:", error);

        alert(error.message || "Unable to start recording.");

        p2StopRecording();
    }

}


// ==================================================
// STOP RECORDING
// ==================================================

function p2StopRecording() {

    if (!p2IsRecording && !p2MediaStream) {
        return;
    }

    p2IsRecording = false;

    p2StopTimer();

    if (p2Processor) {
        p2Processor.disconnect();
        p2Processor.onaudioprocess = null;
        p2Processor = null;
    }

    if (p2SourceNode) {
        p2SourceNode.disconnect();
        p2SourceNode = null;
    }

    if (p2MediaStream) {

        p2MediaStream.getTracks().forEach(track => {
            track.stop();
        });

        p2MediaStream = null;
    }

    const sampleRate = p2AudioContext
        ? p2AudioContext.sampleRate
        : 44100;

    const totalLength = p2RecordedChunks.reduce(
        (total, chunk) => total + chunk.length,
        0
    );

    const samples = new Float32Array(totalLength);

    let offset = 0;

    p2RecordedChunks.forEach(chunk => {

        samples.set(chunk, offset);

        offset += chunk.length;

    });

    p2RecordedChunks = [];

    if (p2AudioContext) {
        p2AudioContext.close();
        p2AudioContext = null;
    }

    p2SetMessage(p2RecordButton, "Start Recording");

    if (p2RecordButton) {
        p2RecordButton.classList.remove("recording");
    }

    if (samples.length === 0) {
        alert("No audio was recorded.");
        return;
    }

    const wavBlob = p2EncodeWav(samples, sampleRate);

    const wavFile = new File(
        [wavBlob],
        "infant-cry-recording.wav",
        { type: "audio/wav" }
    );

    p2SetAudio(wavFile);
}


// ==================================================
// ENCODE AUDIO INTO WAV
// ==================================================

function p2EncodeWav(samples, sampleRate) {

    const buffer = new ArrayBuffer(44 + samples.length * 2);

    const view = new DataView(buffer);

    function writeString(offset, text) {

        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }

    }

    writeString(0, "RIFF");

    view.setUint32(4, 36 + samples.length * 2, true);

    writeString(8, "WAVE");

    writeString(12, "fmt ");

    view.setUint32(16, 16, true);

    view.setUint16(20, 1, true);

    view.setUint16(22, 1, true);

    view.setUint32(24, sampleRate, true);

    view.setUint32(28, sampleRate * 2, true);

    view.setUint16(32, 2, true);

    view.setUint16(34, 16, true);

    writeString(36, "data");

    view.setUint32(40, samples.length * 2, true);

    let offset = 44;

    for (let i = 0; i < samples.length; i++) {

        let sample = Math.max(-1, Math.min(1, samples[i]));

        const value = sample < 0
            ? sample * 32768
            : sample * 32767;

        view.setInt16(offset, value, true);

        offset += 2;
    }

    return new Blob(
        [buffer],
        { type: "audio/wav" }
    );

}


// ==================================================
// RECORD BUTTON EVENT
// ==================================================

if (p2RecordButton) {

    p2RecordButton.addEventListener("click", function () {

        if (p2IsRecording) {
            p2StopRecording();
        } else {
            p2StartRecording();
        }

    });

}


// ==================================================
// ANALYZE AUDIO
// ==================================================

if (p2AnalyzeButton) {

    p2AnalyzeButton.addEventListener("click", p2AnalyzeAudio);

}


async function p2AnalyzeAudio() {

    if (!p2CurrentAudio) {
        alert("Please record or upload an audio file first.");
        return;
    }

    if (p2IsAnalyzing) {
        return;
    }

    p2IsAnalyzing = true;

    p2AnalysisController = new AbortController();

    p2AnalyzeButton.disabled = true;

    p2Hide(p2ResultBox);
    p2Show(p2LoadingBox);

    p2SetMessage(
        p2AnalyzeMessage,
        "Sending audio to the analysis server..."
    );

    try {

        const response = await fetch(
            `${API_BASE_URL}/analysis`,
            {
                method: "POST",

                // Send the WAV bytes directly.
                // Do not use FormData here.
                headers: {
                    "Content-Type": "audio/wav"
                },

                body: p2CurrentAudio,

                credentials: "include",

                signal: p2AnalysisController.signal
            }
        );


        const data = await response.json();


        if (!response.ok) {

            throw new Error(
                data.detail ||
                data.message ||
                `Analysis failed (${response.status}).`
            );

        }


        if (data.success === false) {
            throw new Error(data.message || "Analysis failed.");
        }


        // Backend response:
        // {
        //   success: true,
        //   analysis_id: "...",
        //   prediction: {
        //       label: "...",
        //       confidence: ...
        //   }
        // }

        const prediction = data.prediction?.label;

        if (!prediction) {
            throw new Error(
                "The server did not return a prediction label."
            );
        }


        p2SetMessage(p2PredictionText, prediction);

        p2Hide(p2LoadingBox);
        p2Show(p2ResultBox);

        p2SetMessage(
            p2AnalyzeMessage,
            "Analysis completed successfully."
        );

        p2AddHistory(
            p2CurrentAudio.name,
            prediction
        );

        p2ResetFeedback();


    } catch (error) {

        if (error.name === "AbortError") {
            return;
        }

        console.error("Analysis error:", error);

        p2Hide(p2LoadingBox);

        p2SetMessage(
            p2AnalyzeMessage,
            error.message || "Unable to analyze audio."
        );

        alert(error.message || "Analysis failed.");

    } finally {

        p2IsAnalyzing = false;

        p2AnalysisController = null;

        if (p2AnalyzeButton) {
            p2AnalyzeButton.disabled = !p2CurrentAudio;
        }

    }

}


// ==================================================
// RESET FEEDBACK
// ==================================================

function p2ResetFeedback() {

    p2CurrentFeedbackChoice = null;

    p2Hide(p2FeedbackYesForm);
    p2Hide(p2FeedbackNoForm);
    p2Hide(p2FeedbackSuccess);

    if (p2FeedbackYesText) {
        p2FeedbackYesText.value = "";
    }

    if (p2FeedbackNoText) {
        p2FeedbackNoText.value = "";
    }

    if (p2FeedbackYes) {
        p2FeedbackYes.disabled = false;
    }

    if (p2FeedbackNo) {
        p2FeedbackNo.disabled = false;
    }

}


// ==================================================
// FEEDBACK BUTTONS
// ==================================================

if (p2FeedbackYes) {

    p2FeedbackYes.addEventListener("click", function () {

        p2CurrentFeedbackChoice = true;

        p2Show(p2FeedbackYesForm);
        p2Hide(p2FeedbackNoForm);
        p2Hide(p2FeedbackSuccess);

    });

}


if (p2FeedbackNo) {

    p2FeedbackNo.addEventListener("click", function () {

        p2CurrentFeedbackChoice = false;

        p2Show(p2FeedbackNoForm);
        p2Hide(p2FeedbackYesForm);
        p2Hide(p2FeedbackSuccess);

    });

}


// ==================================================
// SUBMIT FEEDBACK
// ==================================================

if (p2SubmitYes) {

    p2SubmitYes.addEventListener("click", function () {

        p2SubmitFeedback(
            true,
            p2FeedbackYesText?.value.trim() || ""
        );

    });

}


if (p2SubmitNo) {

    p2SubmitNo.addEventListener("click", function () {

        p2SubmitFeedback(
            false,
            p2FeedbackNoText?.value.trim() || ""
        );

    });

}


async function p2SubmitFeedback(helpful, comment) {

    try {

        p2SubmitYes.disabled = true;
        p2SubmitNo.disabled = true;


        const response = await fetch(
            `${API_BASE_URL}/feedback`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                credentials: "include",

                // Backend expects these two fields.
                body: JSON.stringify({
                    helpful: helpful,
                    comment: comment
                })
            }
        );


        const data = await response.json();


        if (!response.ok) {

            throw new Error(
                data.detail ||
                data.message ||
                `Feedback submission failed (${response.status}).`
            );

        }


        p2Hide(p2FeedbackYesForm);
        p2Hide(p2FeedbackNoForm);

        p2Show(p2FeedbackSuccess);

        p2SetMessage(
            p2FeedbackSuccess,
            data.message || "Thank you for your feedback!"
        );


    } catch (error) {

        console.error("Feedback error:", error);

        alert(
            error.message ||
            "Unable to submit feedback."
        );

        p2SubmitYes.disabled = false;
        p2SubmitNo.disabled = false;

    }

}


// ==================================================
// SESSION HISTORY
// ==================================================

function p2AddHistory(fileName, prediction) {

    const entry = {
        fileName: fileName,
        prediction: prediction,
        timestamp: new Date()
    };

    p2SessionHistory.unshift(entry);

    p2RenderHistory();

}


function p2RenderHistory() {

    const historyContainer =
        document.getElementById("sessionHistory");

    if (!historyContainer) {
        return;
    }

    historyContainer.replaceChildren();


    if (p2SessionHistory.length === 0) {

        const empty = document.createElement("article");

        empty.className = "empty-state";

        const heading = document.createElement("h3");
        heading.textContent = "No analyses yet";

        const paragraph = document.createElement("p");
        paragraph.textContent =
            "Once you analyze a recording, your recent result will appear here.";

        empty.append(heading, paragraph);

        historyContainer.appendChild(empty);

        return;
    }


    p2SessionHistory.forEach(entry => {

        const article = document.createElement("article");

        article.className = "history-item";


        const heading = document.createElement("h3");

        heading.textContent = entry.prediction;


        const file = document.createElement("p");

        file.textContent = `File: ${entry.fileName}`;


        const date = document.createElement("small");

        date.textContent = entry.timestamp.toLocaleString();


        article.append(heading, file, date);

        historyContainer.appendChild(article);

    });

}


// ==================================================
// PAGE NAVIGATION
// ==================================================

function p2ShowAppView(viewName) {

    const sections = document.querySelectorAll(
        "[data-page-section]"
    );

    sections.forEach(section => {

        if (section.dataset.pageSection === viewName) {
            section.classList.remove("hidden");
        } else {
            section.classList.add("hidden");
        }

    });


    const navigationButtons = document.querySelectorAll(
        "[data-view-link]"
    );

    navigationButtons.forEach(button => {

        const active =
            button.dataset.viewLink === viewName;

        button.classList.toggle("is-active", active);

    });

}


document.querySelectorAll("[data-view-link]").forEach(button => {

    button.addEventListener("click", function (event) {

        event.preventDefault();

        const view = button.dataset.viewLink;

        p2ShowAppView(view);

    });

});


// ==================================================
// JUMP TO AUDIO
// ==================================================

const p2JumpToAudio = document.getElementById("jumpToAudio");

if (p2JumpToAudio) {

    p2JumpToAudio.addEventListener("click", function () {

        p2ShowAppView("analyze");

    });

}


// ==================================================
// LOGIN PAGE COMPATIBILITY BUTTONS
// ==================================================

const p2GetStarted = document.getElementById("getStartedButton");
const p2NavLogin = document.getElementById("navLoginButton");
const p2BackHome = document.getElementById("backToHome");
const p2LandingBrand = document.getElementById("landingBrandLink");


if (p2GetStarted) {

    p2GetStarted.addEventListener("click", function () {

        document.getElementById("loginPanel")?.scrollIntoView({
            behavior: "smooth"
        });

    });

}


if (p2NavLogin) {

    p2NavLogin.addEventListener("click", function () {

        document.getElementById("loginPanel")?.scrollIntoView({
            behavior: "smooth"
        });

    });

}


if (p2BackHome) {

    p2BackHome.addEventListener("click", function () {

        document.getElementById("landingHome")?.scrollIntoView({
            behavior: "smooth"
        });

    });

}


if (p2LandingBrand) {

    p2LandingBrand.addEventListener("click", function (event) {

        event.preventDefault();

        document.getElementById("landingHome")?.scrollIntoView({
            behavior: "smooth"
        });

    });

}


// ==================================================
// FIXED DARK THEME
// ==================================================

document.documentElement.dataset.theme = "dark";

document.querySelectorAll("[data-theme-toggle]").forEach(button => {

    button.style.display = "none";

});


// ==================================================
// INITIAL UI STATE
// ==================================================

p2Hide(p2AudioSection);
p2Hide(p2LoadingBox);
p2Hide(p2ResultBox);

p2SetMessage(
    p2SelectedFile,
    "No file selected"
);

if (p2AnalyzeButton) {
    p2AnalyzeButton.disabled = true;
}

p2SetMessage(
    p2AnalyzeMessage,
    "Record or upload a WAV file to continue."
);

console.log("InfantCry frontend initialized.");
