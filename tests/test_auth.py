"""
Pytest tests for authentication endpoints.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api.database import Base, get_db
from api.main import app

# ── In-memory SQLite for tests ─────────────────────────────────────────────────
TEST_DATABASE_URL = "sqlite:///./test_neotix.db"
test_engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    """Create fresh tables before each test, drop after."""
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture()
def client():
    return TestClient(app)


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_register_user(client):
    resp = client.post("/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "secret123"
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["username"] == "testuser"
    assert data["email"] == "test@example.com"
    assert "id" in data
    assert "hashed_password" not in data


def test_register_duplicate_username(client):
    payload = {"username": "dupuser", "email": "dup@example.com", "password": "pass"}
    client.post("/auth/register", json=payload)
    resp = client.post("/auth/register", json={**payload, "email": "other@example.com"})
    assert resp.status_code == 409


def test_login_user(client):
    client.post("/auth/register", json={
        "username": "loginuser", "email": "login@example.com", "password": "mypass"
    })
    resp = client.post("/auth/login", json={"username": "loginuser", "password": "mypass"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["username"] == "loginuser"


def test_login_wrong_password(client):
    client.post("/auth/register", json={
        "username": "user2", "email": "u2@example.com", "password": "correct"
    })
    resp = client.post("/auth/login", json={"username": "user2", "password": "wrong"})
    assert resp.status_code == 401


def test_get_me_requires_auth(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_get_me_with_token(client):
    client.post("/auth/register", json={
        "username": "meuser", "email": "me@example.com", "password": "pass"
    })
    login = client.post("/auth/login", json={"username": "meuser", "password": "pass"})
    token = login.json()["access_token"]

    resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "meuser"
