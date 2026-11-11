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
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent

sys.path.insert(0, str(PROJECT_ROOT))

MODEL_PATH = PROJECT_ROOT / "model" / "crnn"/"crnn_semantic_weighted_no_aug_best.pth"
CONFIG_PATH = PROJECT_ROOT / "model" / "crnn"/"preprocessing_config_semantic.json"
from datetime import datetime, timezone
from urllib.parse import unquote
import tempfile
import secrets
import json
import uuid

from passlib.context import CryptContext

from models import Entry, Feedback as FeedbackIn
from model.crnn.inference import load_inference_model, predict_cry, CLASS_NAMES


# --------------------------------------------------
# 1. APPLICATION SETUP
# --------------------------------------------------

app = FastAPI()

# Development setting: any origin may call the API.
# Tighten this to your real frontend address(es) before deploying.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = "model/crnn/crnn_semantic_weighted_no_aug_best.pth"
CONFIG_PATH = "model/crnn/preprocessing_config_semantic.json"

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
MIN_PASSWORD_LENGTH = 6

# Accounts whose e-mail is listed here get the admin dashboard.
ADMIN_EMAILS = {"nik@gmail.com"}

pwd_context = CryptContext(
    schemes=["argon2"],
    deprecated="auto"
)
# Used so a wrong e-mail takes as long to reject as a wrong password.
DUMMY_HASH = pwd_context.hash("not-a-real-password")


# --------------------------------------------------
# 2. IN-MEMORY STORAGE  (same shapes as before)
# --------------------------------------------------
#   database[user_id]        = {"email", "password", "created_at"}
#   login_record[token]      = {"email", "level"}
#   analysis_records[id]     = {"analysis_id", "email", "filename", "prediction", "confidence", "timestamp"}
#   Fb[analysis_id]          = {"analysis_id", "email", "helpful", "comment", "timestamp"}

database = {}
login_record = {}
analysis_records = {}
Fb = {}

USER_CNT = 0


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_email(value):
    return str(value).strip().lower()


def find_user(email):
    for user in list(database.values()):
        if user["email"] == email:
            return user
    return None


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

    session = login_record.get(token) if token else None

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    return {
        "email": session["email"],
        "level": session["level"],
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
# 6. POST /api/auth/signup   (any number of accounts)
# --------------------------------------------------

database[USER_CNT] = {
    "email" : normalize_email("nik@gmail.com"),
    "password" : pwd_context.hash("123456"),
    "created_at" : now_iso()
}
USER_CNT += 1
@app.post(
    "/api/auth/signup",
    status_code=status.HTTP_201_CREATED
)
def Signup(entry: Entry):

    global USER_CNT

    email = normalize_email(entry.Mail)

    if len(entry.Password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )

    if find_user(email) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists"
        )

    password_hashed = pwd_context.hash(entry.Password)


    database[USER_CNT] = {
        "email": email,
        "password": password_hashed,
        "created_at": now_iso()
    }
    USER_CNT += 1
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
    stored_hash = user["password"] if user else DUMMY_HASH
    password_ok = pwd_context.verify(entry.Password, stored_hash)

    if user is None or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    level = "admin" if user["email"] in ADMIN_EMAILS else "normal"

    # One entry per login, so several people can be signed in at once.
    token = secrets.token_urlsafe(32)

    login_record[token] = {
        "email": user["email"],
        "level": level
    }

    response.set_cookie(
        key="session_id",
        value=token,
        httponly=True,
        secure=False,  # Set True when deployed with HTTPS.
        samesite="lax",
        max_age=60 * 60 * 24
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

    login_record.pop(user["token"], None)

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

        result = predict_cry(
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

        analysis_id = str(uuid.uuid4())

        analysis_records[analysis_id] = {
            "analysis_id": analysis_id,
            "email": user["email"],
            "filename": filename,
            "prediction": prediction,
            "confidence": confidence,
            "timestamp": now_iso()
        }

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

    mine = [
        row for row in list(analysis_records.values())
        if row["email"] == user["email"]
    ]
    mine.reverse()          # dicts keep insertion order -> newest first

    return {
        "total": len(mine),
        "entries": mine[:limit]
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

    analysis_id = getattr(fb, "analysis_id", None)

    if analysis_id:
        analysis = analysis_records.get(analysis_id)
    else:
        # No id given: use this user's most recent analysis.
        analysis = None
        for row in reversed(list(analysis_records.values())):
            if row["email"] == user["email"]:
                analysis = row
                break

    if analysis is None:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis record not found"
        )

    if analysis["email"] != user["email"]:

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot submit feedback for this analysis"
        )

    # One feedback entry per analysis (a second submit replaces the first).
    Fb[analysis["analysis_id"]] = {
        "analysis_id": analysis["analysis_id"],
        "email": user["email"],
        "helpful": fb.helpful,
        "comment": fb.comment,
        "timestamp": now_iso()
    }

    return {
        "success": True,
        "message": "Feedback submitted successfully"
    }


# --------------------------------------------------
# 11. GET /api/admin/dashboard
# --------------------------------------------------

@app.get("/api/admin/dashboard")
def AdminDashboard(admin=Depends(require_admin)):

    feedback_rows = list(Fb.values())
    analysis_rows = list(analysis_records.values())

    total_feedback = len(feedback_rows)
    helpful_count = sum(1 for item in feedback_rows if item["helpful"])

    class_distribution = {}

    for item in analysis_rows:

        label = item["prediction"]

        class_distribution[label] = (
            class_distribution.get(label, 0) + 1
        )

    return {
        "total_users": len(database),
        "total_analyses": len(analysis_rows),
        "total_feedback": total_feedback,
        "helpful_feedback": helpful_count,
        "not_helpful_feedback": total_feedback - helpful_count,
        "class_distribution": class_distribution
    }


# --------------------------------------------------
# 12. GET /api/admin/entries
# --------------------------------------------------

@app.get("/api/admin/entries")
def AdminEntries(admin=Depends(require_admin)):

    entries = list(analysis_records.values())
    entries.reverse()

    return {
        "total": len(entries),
        "entries": entries
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

    items = list(Fb.values())
    items.reverse()

    return {
        "total": len(items),
        "feedback": items
    }
