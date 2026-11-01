from pydantic import BaseModel , EmailStr


class Entry(BaseModel):
    Mail : EmailStr
    Password : str

class Feedback(BaseModel):
    analysis_id : str
    helpful : bool
    comment : str | None = None