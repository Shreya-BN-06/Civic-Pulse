"""
CivicPulse — single-file FastAPI backend.

Everything (DB setup, AI classification, routes, seed logic) lives in this
one file so you can drop it next to an existing frontend and just run it.

Setup:
    pip install fastapi "uvicorn[standard]" python-multipart anthropic pydantic nanoid

Run:
    export ANTHROPIC_API_KEY=sk-ant-...      (or put it in a .env file next to this script)
    python main.py
    # or: uvicorn main:app --reload --port 4000

Seed demo data (optional, run once):
    python main.py --seed

API docs once running:
    http://localhost:4000/docs
"""

import base64
import json
import math
import mimetypes
import os
import random
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, List


def _load_env_file(path: Path):
    """
    Minimal .env loader — no external dependency required.
    Reads KEY=VALUE lines from a .env file next to this script, if present,
    and sets them into os.environ (without overriding anything already set).
    Silently does nothing if the file doesn't exist.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from nanoid import generate as nanoid
from anthropic import Anthropic


# ============================================================================
# CONFIG / PATHS
# ============================================================================

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = BASE_DIR / "uploads"
DB_PATH = DATA_DIR / "civicpulse.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

PORT = int(os.getenv("PORT", 4000))


# ============================================================================
# DATABASE
# ============================================================================

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    ward TEXT,
    points INTEGER DEFAULT 0,
    role TEXT DEFAULT 'citizen', -- citizen | staff | admin
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    category TEXT,
    description TEXT,
    ai_label TEXT,
    ai_confidence REAL,
    severity TEXT,
    status TEXT DEFAULT 'reported', -- reported|acknowledged|verified|assigned|in_progress|resolved|closed|reopened
    lat REAL,
    lng REAL,
    ward TEXT,
    photo_path TEXT,
    resolved_photo_path TEXT,
    duplicate_of TEXT,
    verification_count INTEGER DEFAULT 0,
    dispute_count INTEGER DEFAULT 0,
    assigned_staff_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY (reporter_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL, -- confirm | dispute
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(report_id, user_id),
    FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE TABLE IF NOT EXISTS status_history (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    changed_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_ward ON reports(ward);
CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
"""


def init_db():
    conn = get_connection()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


# ============================================================================
# AI CLASSIFICATION (Claude vision)
# ============================================================================

anthropic_client = Anthropic()  # reads ANTHROPIC_API_KEY from env

VALID_CATEGORIES = [
    "Road damage",
    "Water leakage",
    "Streetlight",
    "Waste management",
    "Drainage",
    "Illegal dumping",
    "Broken signage",
    "Other",
]
VALID_SEVERITIES = ["low", "medium", "high"]

AI_SYSTEM_PROMPT = f"""You are the triage system for a civic infrastructure reporting platform.
Given a photo of a reported community issue, classify it precisely.

Respond with ONLY a JSON object, no markdown fences, no preamble, in this exact shape:
{{
  "label": one of [{", ".join(f'"{c}"' for c in VALID_CATEGORIES)}],
  "confidence": number between 0 and 1,
  "severity": one of ["low", "medium", "high"],
  "reasoning": a short one-sentence explanation a citizen would understand
}}

Severity guidance:
- "high": immediate safety hazard (deep pothole, exposed wiring, active flooding/leak, no streetlight on a busy road)
- "medium": clear problem but not an immediate hazard
- "low": cosmetic or minor issue

If the photo doesn't clearly show an infrastructure issue, use label "Other" with low confidence and explain why in reasoning."""


def _media_type_for(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "image/jpeg"


def classify_issue_photo(absolute_path: str, user_description: str = "") -> dict:
    """
    Sends the uploaded photo to Claude for category + severity classification.
    Returns {"label", "confidence", "severity", "reasoning"}. Raises on failure
    — the caller is expected to catch and fall back to a safe default.
    """
    path = Path(absolute_path)
    image_bytes = path.read_bytes()
    b64_data = base64.standard_b64encode(image_bytes).decode("utf-8")
    media_type = _media_type_for(path)

    user_text = (
        f'Citizen\'s description of the issue: "{user_description}"'
        if user_description
        else "No description was provided by the citizen — classify from the photo alone."
    )

    response = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        system=AI_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": b64_data},
                    },
                    {"type": "text", "text": user_text},
                ],
            }
        ],
    )

    text_block = next((b for b in response.content if b.type == "text"), None)
    if text_block is None:
        raise ValueError("No text response from model")

    cleaned = text_block.text.replace("```json", "").replace("```", "").strip()
    parsed = json.loads(cleaned)  # raises json.JSONDecodeError on bad output, caught by caller

    if parsed.get("label") not in VALID_CATEGORIES:
        parsed["label"] = "Other"
    if parsed.get("severity") not in VALID_SEVERITIES:
        parsed["severity"] = "medium"
    try:
        parsed["confidence"] = max(0.0, min(1.0, float(parsed.get("confidence", 0.5))))
    except (TypeError, ValueError):
        parsed["confidence"] = 0.5
    parsed.setdefault("reasoning", "")

    return parsed


# ============================================================================
# UTILITIES
# ============================================================================

CATEGORY_TO_DEPT = {
    "Road damage": "Roads & Infrastructure",
    "Water leakage": "Water Board",
    "Streetlight": "Electrical & Lighting",
    "Waste management": "Sanitation",
    "Drainage": "Stormwater & Drainage",
    "Illegal dumping": "Sanitation",
    "Broken signage": "Roads & Infrastructure",
    "Other": "General Ward Office",
}

VALID_STATUSES = [
    "reported", "acknowledged", "verified", "assigned",
    "in_progress", "resolved", "closed", "reopened",
]


def new_ticket_id() -> str:
    return f"CP-{random.randint(10000, 99999)}"


def dist_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in meters between two lat/lng points."""
    R = 6371000
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lng = to_rad(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def department_for_category(category: str) -> str:
    return CATEGORY_TO_DEPT.get(category, "General Ward Office")


# ============================================================================
# PYDANTIC SCHEMAS
# ============================================================================

class UserOut(BaseModel):
    id: str
    name: str
    email: Optional[str] = None
    ward: Optional[str] = None
    points: int
    role: str
    created_at: str


class StatusHistoryOut(BaseModel):
    id: str
    report_id: str
    status: str
    note: Optional[str] = None
    changed_by: Optional[str] = None
    created_at: str


class ReportOut(BaseModel):
    id: str
    reporter_id: str
    category: Optional[str] = None
    description: Optional[str] = None
    ai_label: Optional[str] = None
    ai_confidence: Optional[float] = None
    severity: Optional[str] = None
    status: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    ward: Optional[str] = None
    photo_path: Optional[str] = None
    resolved_photo_path: Optional[str] = None
    duplicate_of: Optional[str] = None
    verification_count: int
    dispute_count: int
    assigned_staff_id: Optional[str] = None
    created_at: str
    resolved_at: Optional[str] = None


class ReportDetailOut(ReportOut):
    history: List[StatusHistoryOut] = []


class VerifyRequest(BaseModel):
    user_id: str
    type: str  # "confirm" | "dispute"


class StatusUpdateRequest(BaseModel):
    status: str
    note: Optional[str] = None
    changed_by: Optional[str] = None


class CreateReportResponse(BaseModel):
    report: ReportOut
    ai: dict
    department_routed_to: str
    duplicate_of: Optional[str] = None


class DashboardOut(BaseModel):
    ward: str
    open_cases: int
    median_resolution_days: Optional[float] = None
    top_category: Optional[str] = None
    total_reports: int
    category_breakdown: list
    community_verified_pct: float
    predictive_hotspots: list


# ============================================================================
# FASTAPI APP
# ============================================================================

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="CivicPulse API",
    description="Community issue reporting, verification, and tracking platform.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # fine for a demo; lock this down for production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


@app.get("/api/health")
def health_check():
    return {"ok": True}


# ---------- USERS ----------

@app.get("/api/users/{user_id}", response_model=UserOut, tags=["users"])
def get_user(user_id: str):
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


@app.get("/api/leaderboard", response_model=List[UserOut], tags=["users"])
def get_leaderboard(ward: Optional[str] = Query(default=None)):
    conn = get_connection()
    if ward:
        rows = conn.execute(
            "SELECT * FROM users WHERE role = 'citizen' AND ward = ? ORDER BY points DESC LIMIT 20",
            (ward,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM users WHERE role = 'citizen' ORDER BY points DESC LIMIT 20"
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------- REPORTS ----------

@app.get("/api/reports", response_model=List[ReportOut], tags=["reports"])
def list_reports(
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    ward: Optional[str] = Query(default=None),
    limit: int = Query(default=200),
):
    conn = get_connection()
    query = "SELECT * FROM reports WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if category:
        query += " AND category = ?"
        params.append(category)
    if ward:
        query += " AND ward = ?"
        params.append(ward)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/reports/{report_id}", response_model=ReportDetailOut, tags=["reports"])
def get_report(report_id: str):
    conn = get_connection()
    report = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if not report:
        conn.close()
        raise HTTPException(status_code=404, detail="Report not found")
    history = conn.execute(
        "SELECT * FROM status_history WHERE report_id = ? ORDER BY created_at ASC",
        (report_id,),
    ).fetchall()
    conn.close()
    result = dict(report)
    result["history"] = [dict(h) for h in history]
    return result


@app.post("/api/reports", response_model=CreateReportResponse, status_code=201, tags=["reports"])
async def create_report(
    reporter_id: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    description: Optional[str] = Form(default=None),
    ward: Optional[str] = Form(default=None),
    manual_category: Optional[str] = Form(default=None),
    photo: Optional[UploadFile] = File(default=None),
):
    """
    Creates a new issue report. If a photo is attached, it's run through
    Claude's vision API for categorization + severity scoring. The new
    report is checked against nearby open reports of the same category
    for duplicates within ~80 meters.
    """
    conn = get_connection()

    reporter = conn.execute("SELECT * FROM users WHERE id = ?", (reporter_id,)).fetchone()
    if not reporter:
        conn.close()
        raise HTTPException(status_code=400, detail="Unknown reporter_id")

    photo_path_for_db: Optional[str] = None
    photo_abs_path: Optional[Path] = None

    if photo is not None:
        ext = Path(photo.filename or "upload.jpg").suffix or ".jpg"
        filename = f"{nanoid(size=12)}{ext}"
        dest_path = UPLOADS_DIR / filename
        with open(dest_path, "wb") as f:
            shutil.copyfileobj(photo.file, f)
        photo_path_for_db = f"/uploads/{filename}"
        photo_abs_path = dest_path

    # --- AI classification step ---
    ai_result = {
        "label": manual_category or "Other",
        "confidence": 0.5,
        "severity": "medium",
        "reasoning": "No photo provided — using manual category.",
    }
    if photo_abs_path is not None:
        try:
            ai_result = classify_issue_photo(str(photo_abs_path), description or "")
        except Exception as err:  # noqa: BLE001 — AI calls can fail many ways; always fall back safely
            print(f"AI classification failed, falling back: {err}")
            ai_result = {
                "label": manual_category or "Other",
                "confidence": 0.4,
                "severity": "medium",
                "reasoning": "AI classification unavailable — using fallback.",
            }

    category = manual_category or ai_result["label"]

    # --- Duplicate detection: same category, still open, within ~80m ---
    nearby = conn.execute(
        """
        SELECT * FROM reports
        WHERE category = ? AND status NOT IN ('resolved', 'closed')
        AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
        """,
        (category, lat - 0.001, lat + 0.001, lng - 0.001, lng + 0.001),
    ).fetchall()

    duplicate_of: Optional[str] = None
    for candidate in nearby:
        d = dist_meters(lat, lng, candidate["lat"], candidate["lng"])
        if d <= 80:
            duplicate_of = candidate["id"]
            break

    report_id = new_ticket_id()
    conn.execute(
        """
        INSERT INTO reports
            (id, reporter_id, category, description, ai_label, ai_confidence, severity,
             status, lat, lng, ward, photo_path, duplicate_of, verification_count)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)
        """,
        (
            report_id, reporter_id, category, description, ai_result["label"],
            ai_result["confidence"], ai_result["severity"], "reported",
            lat, lng, ward, photo_path_for_db, duplicate_of,
        ),
    )

    note = (
        f"Auto-detected as likely duplicate of {duplicate_of}"
        if duplicate_of
        else "Initial report submitted"
    )
    conn.execute(
        "INSERT INTO status_history (id, report_id, status, note, changed_by) VALUES (?,?,?,?,?)",
        (nanoid(), report_id, "reported", note, reporter_id),
    )

    if duplicate_of:
        conn.execute(
            "UPDATE reports SET verification_count = verification_count + 1 WHERE id = ?",
            (duplicate_of,),
        )

    conn.execute("UPDATE users SET points = points + 25 WHERE id = ?", (reporter_id,))

    conn.commit()
    created = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    conn.close()

    return {
        "report": dict(created),
        "ai": ai_result,
        "department_routed_to": department_for_category(category),
        "duplicate_of": duplicate_of,
    }


@app.post("/api/reports/{report_id}/verify", response_model=ReportOut, tags=["reports"])
def verify_report(report_id: str, body: VerifyRequest):
    if body.type not in ("confirm", "dispute"):
        raise HTTPException(status_code=400, detail="type must be 'confirm' or 'dispute'")

    conn = get_connection()
    report = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if not report:
        conn.close()
        raise HTTPException(status_code=404, detail="Report not found")

    try:
        conn.execute(
            "INSERT INTO verifications (id, report_id, user_id, type) VALUES (?,?,?,?)",
            (nanoid(), report_id, body.user_id, body.type),
        )
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=409, detail="You have already voted on this report.")

    field = "verification_count" if body.type == "confirm" else "dispute_count"
    conn.execute(f"UPDATE reports SET {field} = {field} + 1 WHERE id = ?", (report_id,))

    updated = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()

    if body.type == "confirm" and updated["verification_count"] >= 5 and updated["status"] == "reported":
        conn.execute("UPDATE users SET points = points + 10 WHERE id = ?", (body.user_id,))
        conn.execute("UPDATE reports SET status = 'verified' WHERE id = ?", (report_id,))
        conn.execute(
            "INSERT INTO status_history (id, report_id, status, note, changed_by) VALUES (?,?,?,?,?)",
            (nanoid(), report_id, "verified", "Auto-verified after 5 community confirmations", "system"),
        )
    else:
        conn.execute("UPDATE users SET points = points + 5 WHERE id = ?", (body.user_id,))

    conn.commit()
    final = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    conn.close()
    return dict(final)


@app.post("/api/reports/{report_id}/status", response_model=ReportOut, tags=["reports"])
def update_status(report_id: str, body: StatusUpdateRequest):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    conn = get_connection()
    report = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if not report:
        conn.close()
        raise HTTPException(status_code=404, detail="Report not found")

    if body.status == "resolved":
        conn.execute(
            "UPDATE reports SET status = ?, resolved_at = datetime('now') WHERE id = ?",
            (body.status, report_id),
        )
    else:
        conn.execute("UPDATE reports SET status = ? WHERE id = ?", (body.status, report_id))

    conn.execute(
        "INSERT INTO status_history (id, report_id, status, note, changed_by) VALUES (?,?,?,?,?)",
        (nanoid(), report_id, body.status, body.note, body.changed_by or "staff"),
    )

    if body.status == "resolved":
        conn.execute("UPDATE users SET points = points + 15 WHERE id = ?", (report["reporter_id"],))

    conn.commit()
    final = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    conn.close()
    return dict(final)


# ---------- DASHBOARD / ANALYTICS ----------

@app.get("/api/dashboard/{ward}", response_model=DashboardOut, tags=["dashboard"])
def get_dashboard(ward: str):
    conn = get_connection()

    open_cases = conn.execute(
        "SELECT COUNT(*) c FROM reports WHERE ward = ? AND status NOT IN ('resolved','closed')",
        (ward,),
    ).fetchone()["c"]

    resolved_rows = conn.execute(
        "SELECT created_at, resolved_at FROM reports WHERE ward = ? AND resolved_at IS NOT NULL",
        (ward,),
    ).fetchall()

    median_days = None
    if resolved_rows:
        durations = []
        for r in resolved_rows:
            created = datetime.fromisoformat(r["created_at"].replace(" ", "T"))
            resolved = datetime.fromisoformat(r["resolved_at"].replace(" ", "T"))
            durations.append((resolved - created).total_seconds() / 86400)
        durations.sort()
        median_days = round(durations[len(durations) // 2], 1)

    category_rows = conn.execute(
        "SELECT category, COUNT(*) c FROM reports WHERE ward = ? GROUP BY category ORDER BY c DESC",
        (ward,),
    ).fetchall()
    category_breakdown = [dict(r) for r in category_rows]
    top_category = category_breakdown[0]["category"] if category_breakdown else None
    total_reports = sum(r["c"] for r in category_breakdown)

    verified_pct_row = conn.execute(
        """
        SELECT ROUND(100.0 * SUM(CASE WHEN verification_count > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) pct
        FROM reports WHERE ward = ?
        """,
        (ward,),
    ).fetchone()
    verified_pct = verified_pct_row["pct"] if verified_pct_row and verified_pct_row["pct"] is not None else 0.0

    hotspot_rows = conn.execute(
        """
        SELECT category, ROUND(lat,3) glat, ROUND(lng,3) glng, COUNT(*) c
        FROM reports WHERE ward = ?
        GROUP BY category, glat, glng
        HAVING c >= 2
        ORDER BY c DESC
        """,
        (ward,),
    ).fetchall()
    hotspots = [dict(r) for r in hotspot_rows]

    conn.close()

    return {
        "ward": ward,
        "open_cases": open_cases,
        "median_resolution_days": median_days,
        "top_category": top_category,
        "total_reports": total_reports,
        "category_breakdown": category_breakdown,
        "community_verified_pct": verified_pct,
        "predictive_hotspots": hotspots,
    }


# ============================================================================
# SEED DATA (run with: python main.py --seed)
# ============================================================================

def seed_demo_data():
    init_db()
    conn = get_connection()
    conn.executescript(
        "DELETE FROM verifications; DELETE FROM status_history; DELETE FROM reports; DELETE FROM users;"
    )

    users = [
        {"id": nanoid(), "name": "Ananya Rao", "email": "ananya@example.com", "ward": "HSR-04", "points": 2140, "role": "citizen"},
        {"id": nanoid(), "name": "Praveen Kumar", "email": "praveen@example.com", "ward": "HSR-04", "points": 1980, "role": "citizen"},
        {"id": nanoid(), "name": "Fatima Sheikh", "email": "fatima@example.com", "ward": "KOR-01", "points": 1710, "role": "citizen"},
        {"id": nanoid(), "name": "Demo Citizen", "email": "demo@civicpulse.app", "ward": "HSR-04", "points": 1455, "role": "citizen"},
        {"id": nanoid(), "name": "Ward Ops — HSR", "email": "ops.hsr@civicpulse.app", "ward": "HSR-04", "points": 0, "role": "staff"},
        {"id": nanoid(), "name": "Platform Admin", "email": "admin@civicpulse.app", "ward": None, "points": 0, "role": "admin"},
    ]
    for u in users:
        conn.execute(
            "INSERT INTO users (id, name, email, ward, points, role) VALUES (?,?,?,?,?,?)",
            (u["id"], u["name"], u["email"], u["ward"], u["points"], u["role"]),
        )

    ananya, praveen, fatima, demo, staff, admin = users

    sample_reports = [
        {"category": "Road damage", "description": "Large pothole forming near the service lane, getting worse after rain.",
         "ai_label": "Pothole — road surface failure", "ai_confidence": 0.94, "severity": "high",
         "status": "in_progress", "lat": 12.9121, "lng": 77.6446, "ward": "HSR-04", "verification_count": 47, "reporter": ananya},
        {"category": "Water leakage", "description": "Pipe leak flooding the footpath outside the BWSSB junction box.",
         "ai_label": "Water pipeline leak", "ai_confidence": 0.89, "severity": "high",
         "status": "verified", "lat": 12.9135, "lng": 77.6402, "ward": "HSR-04", "verification_count": 22, "reporter": praveen},
        {"category": "Streetlight", "description": "Streetlight has been out for two weeks near the park entrance.",
         "ai_label": "Non-functional streetlight", "ai_confidence": 0.91, "severity": "medium",
         "status": "reported", "lat": 12.9098, "lng": 77.6478, "ward": "HSR-04", "verification_count": 9, "reporter": fatima},
        {"category": "Waste management", "description": "Garbage bin overflowing for days, attracting strays.",
         "ai_label": "Overflowing waste bin", "ai_confidence": 0.97, "severity": "medium",
         "status": "resolved", "lat": 12.9156, "lng": 77.6390, "ward": "HSR-04", "verification_count": 15, "reporter": demo},
        {"category": "Drainage", "description": "Stormwater drain blocked, water pooling badly every monsoon.",
         "ai_label": "Blocked stormwater drain", "ai_confidence": 0.86, "severity": "high",
         "status": "assigned", "lat": 12.9180, "lng": 77.6510, "ward": "KOR-01", "verification_count": 31, "reporter": fatima},
        {"category": "Road damage", "description": "Second pothole on the same stretch as last year, repair didn't hold.",
         "ai_label": "Pothole — road surface failure", "ai_confidence": 0.92, "severity": "high",
         "status": "reported", "lat": 12.9125, "lng": 77.6449, "ward": "HSR-04", "verification_count": 18, "reporter": praveen},
    ]

    for i, r in enumerate(sample_reports):
        rid = new_ticket_id()
        days_ago = f"-{(i + 1) * 2} days"
        conn.execute(
            """
            INSERT INTO reports
                (id, reporter_id, category, description, ai_label, ai_confidence, severity,
                 status, lat, lng, ward, verification_count, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', ?))
            """,
            (rid, r["reporter"]["id"], r["category"], r["description"], r["ai_label"],
             r["ai_confidence"], r["severity"], r["status"], r["lat"], r["lng"],
             r["ward"], r["verification_count"], days_ago),
        )
        conn.execute(
            "INSERT INTO status_history (id, report_id, status, note, changed_by) VALUES (?,?,?,?,?)",
            (nanoid(), rid, "reported", "Initial report submitted", r["reporter"]["id"]),
        )
        if r["status"] != "reported":
            conn.execute(
                "INSERT INTO status_history (id, report_id, status, note, changed_by) VALUES (?,?,?,?,?)",
                (nanoid(), rid, r["status"], "Status updated", staff["id"]),
            )

    conn.commit()
    conn.close()
    print(f"Seeded {len(users)} users and {len(sample_reports)} reports.")
    print(f"Demo citizen id: {demo['id']}  (use this as reporter_id when testing report creation)")


# ============================================================================
# ENTRYPOINT
# ============================================================================

if __name__ == "__main__":
    if "--seed" in sys.argv:
        seed_demo_data()
    else:
        import uvicorn
        uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
