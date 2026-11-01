from pydantic import BaseModel , EmailStr


class Entry(BaseModel):
    Mail : EmailStr
    Password : str

class Feedback(BaseModel):
    helpful : bool
    comment : str | None = None
