import uuid

from pydantic import BaseModel, EmailStr


class Entry(BaseModel):
    Mail: EmailStr
    Password: str


class Feedback(BaseModel):
    helpful: bool
    comment: str | None = None
    # Optional: if omitted, feedback goes to the user's most recent analysis.
    analysis_id: uuid.UUID | None = None
