from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import unquote
import json
import os
import secrets
import tempfile

import psycopg
from fastapi import (
    FastAPI,
    HTTPException,
    status,
    Response,
    Cookie,
    Request,
    Depends,
    Header,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext

from dbpy import pool
from models import Entry, Feedback as FeedbackIn
from model.crnn.inference import load_inference_model, predict_cry, CLASS_NAMES


# --------------------------------------------------
# 1. SETTINGS
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = "model/crnn/crnn_semantic_weighted_no_aug_best.pth"
CONFIG_PATH = "model/crnn/preprocessing_config_semantic.json"

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
MIN_PASSWORD_LENGTH = 6
SESSION_HOURS = 24

# This account is created on startup if it doesn't exist yet.
# Set ADMIN_PASSWORD in .env; the fallback is for local development only.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@gmail.com").strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "123456")

pwd_context = CryptContext(
    schemes=["argon2"],
    deprecated="auto"
)
# Used so a wrong e-mail takes as long to reject as a wrong password.
DUMMY_HASH = pwd_context.hash("not-a-real-password")


# --------------------------------------------------
# 2. APPLICATION SETUP
# --------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    pool.open()
    pool.wait()

    with pool.connection() as conn:
        # Seed the admin account (does nothing if it already exists).
        conn.execute(
            """
            INSERT INTO cry_analysis.users (email, password_hash, level)
            VALUES (%s, %s, 'admin')
            ON CONFLICT (email) DO NOTHING
            """,
            (ADMIN_EMAIL, pwd_context.hash(ADMIN_PASSWORD)),
        )
        # Housekeeping: drop expired sessions.
        conn.execute(
            "DELETE FROM cry_analysis.sessions WHERE expires_at < NOW()"
        )

    yield

    # Shutdown
    pool.close()


app = FastAPI(lifespan=lifespan)

# Development setting: any origin may call the API.
# Tighten this to your real frontend address(es) before deploying.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


def normalize_email(value):
    return str(value).strip().lower()


def find_user(email):
    with pool.connection() as conn:
        return conn.execute(
            "SELECT user_id, email, password_hash, level "
            "FROM cry_analysis.users WHERE email = %s",
            (email,),
        ).fetchone()


# --------------------------------------------------
# 3. LOAD THE REAL INFERENCE MODEL
# --------------------------------------------------

cry_model = load_inference_model(
    checkpoint_path=MODEL_PATH,
    config_path=CONFIG_PATH
)


# --------------------------------------------------
# 4. AUTHENTICATION HELPERS
# --------------------------------------------------
# The session token is read from either:
#   - the header   Authorization: Bearer <token>   (what the frontend sends)
#   - the cookie   session_id                      (set at login as a fallback)

def get_current_user(
    authorization: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias="session_id"),
):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif session_cookie:
        token = session_cookie

    row = None
    if token:
        with pool.connection() as conn:
            row = conn.execute(
                """
                SELECT u.user_id, u.email, u.level
                FROM cry_analysis.sessions s
                JOIN cry_analysis.users u ON u.user_id = s.user_id
                WHERE s.token = %s AND s.expires_at > NOW()
                """,
                (token,),
            ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    return {
        "user_id": row["user_id"],
        "email": row["email"],
        "level": row["level"],
        "token": token
    }


def require_admin(user=Depends(get_current_user)):
    if user["level"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required"
        )
    return user


# --------------------------------------------------
# 5. GET /
# --------------------------------------------------

@app.get("/")
def Home():

    return {
        "success": True,
        "message": "The API is working"
    }


# --------------------------------------------------
# 6. POST /api/auth/signup
# --------------------------------------------------

@app.post(
    "/api/auth/signup",
    status_code=status.HTTP_201_CREATED
)
def Signup(entry: Entry):

    email = normalize_email(entry.Mail)

    if len(entry.Password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )

    password_hashed = pwd_context.hash(entry.Password)

    try:
        with pool.connection() as conn:
            conn.execute(
                "INSERT INTO cry_analysis.users (email, password_hash) "
                "VALUES (%s, %s)",
                (email, password_hashed),
            )
    except psycopg.errors.UniqueViolation:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists"
        )

    return {
        "success": True,
        "message": "Account created successfully"
    }


# --------------------------------------------------
# 7. POST /api/auth/login
# --------------------------------------------------

@app.post("/api/auth/login")
def Login(
    entry: Entry,
    response: Response
):

    email = normalize_email(entry.Mail)
    user = find_user(email)

    # Always run one password check so timing doesn't reveal which e-mails exist.
    stored_hash = user["password_hash"] if user else DUMMY_HASH
    password_ok = pwd_context.verify(entry.Password, stored_hash)

    if user is None or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    level = user["level"]

    # One row per login, so several people can be signed in at once.
    token = secrets.token_urlsafe(32)

    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO cry_analysis.sessions (token, user_id, expires_at) "
            "VALUES (%s, %s, NOW() + make_interval(hours => %s))",
            (token, user["user_id"], SESSION_HOURS),
        )

    response.set_cookie(
        key="session_id",
        value=token,
        httponly=True,
        secure=False,  # Set True when deployed with HTTPS.
        samesite="lax",
        max_age=60 * 60 * SESSION_HOURS
    )

    # The frontend reads "level" to choose between the user area and the admin panel.
    return {
        "success": True,
        "message": "Login successful",
        "token": token,
        "email": user["email"],
        "level": level
    }


# --------------------------------------------------
# 8. GET /api/auth/me   and   POST /api/auth/logout
# --------------------------------------------------

@app.get("/api/auth/me")
def Me(user=Depends(get_current_user)):

    return {
        "email": user["email"],
        "level": user["level"]
    }


@app.post("/api/auth/logout")
def Logout(
    response: Response,
    user=Depends(get_current_user)
):

    with pool.connection() as conn:
        conn.execute(
            "DELETE FROM cry_analysis.sessions WHERE token = %s",
            (user["token"],),
        )

    response.delete_cookie(
        key="session_id",
        httponly=True,
        secure=False,
        samesite="lax"
    )

    return {
        "success": True,
        "message": "Logout successful"
    }


# --------------------------------------------------
# 9. POST /api/analysis   and   GET /api/analysis/history
# --------------------------------------------------

@app.post("/api/analysis")
async def Analysis(
    request: Request,
    user=Depends(get_current_user),
    x_filename: str | None = Header(default=None),
):

    temp_path = None

    try:
        audio_bytes = await request.body()

        if len(audio_bytes) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,  # Content Too Large
                detail="Audio file exceeds the 10 MB limit"
            )

        if not audio_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded audio file is empty"
            )

        with tempfile.NamedTemporaryFile(
            suffix=".wav",
            delete=False
        ) as temp:

            temp_path = Path(temp.name)
            temp.write(audio_bytes)

        # Model inference is blocking, so keep it off the event loop.
        result = await run_in_threadpool(
            predict_cry,
            str(temp_path),
            inference=cry_model
        )

        prediction = result["predicted_class"]
        confidence = float(result["confidence"])

        # The frontend sends the original file name (URL-encoded) in X-Filename.
        filename = "audio.wav"
        if x_filename:
            cleaned = Path(unquote(x_filename)).name.strip()[:120]
            if cleaned:
                filename = cleaned

        def save():
            with pool.connection() as conn:
                return conn.execute(
                    "INSERT INTO cry_analysis.analyses "
                    "(user_id, filename, prediction, confidence) "
                    "VALUES (%s, %s, %s, %s) RETURNING analysis_id",
                    (user["user_id"], filename, prediction, confidence),
                ).fetchone()["analysis_id"]

        analysis_id = str(await run_in_threadpool(save))

        return {
            "success": True,
            "analysis_id": analysis_id,
            "prediction": {
                "label": prediction,
                "confidence": confidence
            },
            "message": "Audio analysis completed"
        }

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Audio analysis failed"
        ) from exc

    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@app.get("/api/analysis/history")
def AnalysisHistory(
    limit: int = 50,
    user=Depends(get_current_user)
):
    """The signed-in user's own earlier analyses, newest first."""

    limit = max(1, min(limit, 200))

    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT a.analysis_id::text AS analysis_id,
                   u.email,
                   a.filename,
                   a.prediction,
                   a.confidence,
                   a.created_at AS timestamp
            FROM cry_analysis.analyses a
            JOIN cry_analysis.users u ON u.user_id = a.user_id
            WHERE a.user_id = %s
            ORDER BY a.created_at DESC
            LIMIT %s
            """,
            (user["user_id"], limit),
        ).fetchall()

        total = conn.execute(
            "SELECT COUNT(*) AS n FROM cry_analysis.analyses WHERE user_id = %s",
            (user["user_id"],),
        ).fetchone()["n"]

    return {
        "total": total,
        "entries": rows
    }


# --------------------------------------------------
# 10. POST /api/feedback
# --------------------------------------------------

@app.post(
    "/api/feedback",
    status_code=status.HTTP_202_ACCEPTED
)
def SubmitFeedback(
    fb: FeedbackIn,
    user=Depends(get_current_user)
):

    with pool.connection() as conn:

        if fb.analysis_id:
            analysis = conn.execute(
                "SELECT analysis_id, user_id FROM cry_analysis.analyses "
                "WHERE analysis_id = %s",
                (fb.analysis_id,),
            ).fetchone()
        else:
            # No id given: use this user's most recent analysis.
            analysis = conn.execute(
                "SELECT analysis_id, user_id FROM cry_analysis.analyses "
                "WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
                (user["user_id"],),
            ).fetchone()

        if analysis is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Analysis record not found"
            )

        if analysis["user_id"] != user["user_id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot submit feedback for this analysis"
            )

        # One feedback entry per analysis (a second submit replaces the first).
        conn.execute(
            """
            INSERT INTO cry_analysis.feedback
                (analysis_id, user_id, helpful, comment)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (analysis_id)
            DO UPDATE SET helpful    = EXCLUDED.helpful,
                          comment    = EXCLUDED.comment,
                          created_at = NOW()
            """,
            (analysis["analysis_id"], user["user_id"], fb.helpful, fb.comment),
        )

    return {
        "success": True,
        "message": "Feedback submitted successfully"
    }


# --------------------------------------------------
# 11. GET /api/admin/dashboard
# --------------------------------------------------

@app.get("/api/admin/dashboard")
def AdminDashboard(admin=Depends(require_admin)):

    with pool.connection() as conn:
        users = conn.execute(
            "SELECT COUNT(*) AS n FROM cry_analysis.users"
        ).fetchone()["n"]

        analyses = conn.execute(
            "SELECT COUNT(*) AS n FROM cry_analysis.analyses"
        ).fetchone()["n"]

        fb = conn.execute(
            "SELECT COUNT(*) AS total, "
            "COUNT(*) FILTER (WHERE helpful) AS helpful "
            "FROM cry_analysis.feedback"
        ).fetchone()

        dist = conn.execute(
            "SELECT prediction, COUNT(*) AS n "
            "FROM cry_analysis.analyses GROUP BY prediction"
        ).fetchall()

    return {
        "total_users": users,
        "total_analyses": analyses,
        "total_feedback": fb["total"],
        "helpful_feedback": fb["helpful"],
        "not_helpful_feedback": fb["total"] - fb["helpful"],
        "class_distribution": {row["prediction"]: row["n"] for row in dist}
    }


# --------------------------------------------------
# 12. GET /api/admin/entries
# --------------------------------------------------

@app.get("/api/admin/entries")
def AdminEntries(admin=Depends(require_admin)):

    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT a.analysis_id::text AS analysis_id,
                   u.email,
                   a.filename,
                   a.prediction,
                   a.confidence,
                   a.created_at AS timestamp
            FROM cry_analysis.analyses a
            JOIN cry_analysis.users u ON u.user_id = a.user_id
            ORDER BY a.created_at DESC
            """
        ).fetchall()

    return {
        "total": len(rows),
        "entries": rows
    }


# --------------------------------------------------
# 13. GET /api/admin/model-config
# --------------------------------------------------

@app.get("/api/admin/model-config")
def AdminModelConfig(admin=Depends(require_admin)):

    try:

        with open(CONFIG_PATH, "r") as config_file:
            preprocessing_config = json.load(config_file)

        return {
            "model_name": "CRNN",
            "model_status": "loaded",
            "checkpoint": MODEL_PATH,
            "classes": CLASS_NAMES,
            "preprocessing_config": preprocessing_config
        }

    except FileNotFoundError:

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Preprocessing configuration not found"
        )


# --------------------------------------------------
# 14. GET /api/admin/feedback
# --------------------------------------------------

@app.get("/api/admin/feedback")
def AdminFeedback(admin=Depends(require_admin)):

    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT f.analysis_id::text AS analysis_id,
                   u.email,
                   f.helpful,
                   f.comment,
                   f.created_at AS timestamp
            FROM cry_analysis.feedback f
            JOIN cry_analysis.users u ON u.user_id = f.user_id
            ORDER BY f.created_at DESC
            """
        ).fetchall()

    return {
        "total": len(rows),
        "feedback": rows
    }
