from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from api.activity_logger import log_activity
from api.auth import create_access_token, hash_password, verify_password
from api.database import get_db
from api.deps import get_current_user
from api.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


# Schemas
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    username: str
    email: str
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# Endpoints
@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already taken")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    db.flush()
    log_activity(db, user, "register", f"New account: {user.username}")
    db.commit()
    db.refresh(user)
    return user


def _do_login(username: str, password: str, db: Session) -> TokenResponse:
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token({"sub": str(user.id)})
    log_activity(db, user, "login", f"User {user.username} logged in")
    db.commit()
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """JSON login used by the frontend."""
    return _do_login(body.username, body.password, db)


@router.post("/login/swagger", response_model=TokenResponse, include_in_schema=True)
def login_swagger(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Form-data login used by Swagger UI's Authorize dialog."""
    return _do_login(form.username, form.password, db)


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
