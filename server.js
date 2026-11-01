
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
