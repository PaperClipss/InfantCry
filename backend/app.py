
from fastapi import (
    FastAPI,
    HTTPException,
    status,
    UploadFile,
    File,
    Response,
    Cookie,
    Request
)
import requests
from pathlib import Path
from datetime import datetime, timezone
import tempfile
import secrets
import json
import uuid

from passlib.context import CryptContext

from models import Entry, Feedback
from inference import load_inference_model, predict_cry, CLASS_NAMES


# --------------------------------------------------
# 1. APPLICATION SETUP
# --------------------------------------------------

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = "crnn_semantic_weighted_no_aug_best.pth"
CONFIG_PATH = "preprocessing_config_semantic.json"

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

pwd_context = CryptContext(
    schemes=["argon2"],
    deprecated="auto"
)
database = {}
login_record = {}
analysis_records = {}
Fb = {}

sess =[]
for i in login_record.keys():
    sess.append(i)

session_id = 0

# --------------------------------------------------
# 2. IN-MEMORY STORAGE
# --------------------------------------------------


USER_CNT = 0


# --------------------------------------------------
# 3. LOAD THE REAL INFERENCE MODEL
# --------------------------------------------------

cry_model = load_inference_model(
    checkpoint_path=MODEL_PATH,
    config_path=CONFIG_PATH
)


# --------------------------------------------------
# 4. HELPER FUNCTION: AUTHENTICATION
# --------------------------------------------------

def get_current_user(session_id):

    if not session_id or session_id not in login_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    return login_record[session_id]


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

    global USER_CNT

    # Only one account is allowed.
    if database:

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists"
        )

    password_hashed = pwd_context.hash(entry.Password)

    USER_CNT += 1

    database[USER_CNT] = {
        "email": str(entry.Mail),
        "password": password_hashed,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

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

    if not database:

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    user = database.get(USER_CNT)

    if (
        user["email"] != str(entry.Mail)
        or not pwd_context.verify(
            entry.Password,
            user["password"]
        )
    ):

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    # Only one active session.
    login_record.clear()
    global session_id
    session_id = secrets.token_urlsafe(32)

    login_record[session_id] = {
        "email": user["email"]
    }

    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=False,  # Set True when deployed with HTTPS.
        samesite="lax",
        max_age=60 * 60 * 24
    )

    return {
        "success": True,
        "message": "Login successful"
    }


# --------------------------------------------------
# 8. POST /api/auth/logout
# --------------------------------------------------

@app.post("/api/auth/logout")
def Logout(
    response: Response,
):
    get_current_user(session_id)

    login_record.pop(session_id, None)

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
# 9. POST /api/analysis
# --------------------------------------------------

@app.post("/api/analysis")
async def Analysis(request: Request):

    user = get_current_user(session_id)

    temp_path = None

    try:
        audio_bytes = await request.body()


        #audio_bytes = Path("test_audio(burping).wav").read_bytes()


        if len(audio_bytes) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
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

        analysis_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        analysis_records[analysis_id] = {
            "analysis_id": analysis_id,
            "email": user["email"],
            "filename": "audio.wav",
            "prediction": prediction,
            "confidence": confidence,
            "timestamp": timestamp
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


# --------------------------------------------------
# 10. POST /api/feedback
# --------------------------------------------------

@app.post(
    "/api/feedback",
    status_code=status.HTTP_202_ACCEPTED
)
def Feedback(
    fb: Feedback,
):
    ana = list()
    for i in analysis_records.keys():
        ana.append(i)
    analysis_id = ana[-1]
    user = get_current_user(session_id)

    analysis = analysis_records.get(analysis_id)

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

    # Store feedback against its analysis ID.
    Fb[analysis_id] = {
        "analysis_id": analysis_id,
        "email": user["email"],
        "helpful": fb.helpful,
        "comment": fb.comment,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    return {
        "success": True,
        "message": "Feedback submitted successfully"
    }


# --------------------------------------------------
# 11. GET /api/admin/dashboard
# --------------------------------------------------

@app.get("/api/admin/dashboard")
def AdminDashboard(
):

    get_current_user(session_id)

    total_analyses = len(analysis_records)
    total_feedback = len(Fb)

    helpful_count = sum(
        1 for item in Fb.values()
        if item["helpful"]
    )

    class_distribution = {}

    for item in analysis_records.values():

        label = item["prediction"]

        class_distribution[label] = (
            class_distribution.get(label, 0) + 1
        )

    return {
        "total_analyses": total_analyses,
        "total_feedback": total_feedback,
        "helpful_feedback": helpful_count,
        "not_helpful_feedback": total_feedback - helpful_count,
        "class_distribution": class_distribution
    }


# --------------------------------------------------
# 12. GET /api/admin/entries
# --------------------------------------------------

@app.get("/api/admin/entries")
def AdminEntries(
):

    get_current_user(session_id)

    return {
        "total": len(analysis_records),
        "entries": list(analysis_records.values())
    }


# --------------------------------------------------
# 13. GET /api/admin/model-config
# --------------------------------------------------

@app.get("/api/admin/model-config")
def AdminModelConfig(
):

    get_current_user(session_id)

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
def AdminFeedback(
):

    get_current_user(session_id)

    return {
        "total": len(Fb),
        "feedback": list(Fb.values())
    }
