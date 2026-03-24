from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.database import get_db
from api.deps import get_current_user
from api.models import ActivityLog, User

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("")
def list_activity(
    user: str | None = None,
    action: str | None = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ActivityLog).order_by(ActivityLog.created_at.desc())
    if user:
        q = q.filter(ActivityLog.username.contains(user))
    if action:
        q = q.filter(ActivityLog.action == action)

    total = q.count()
    items = q.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [
            {
                "id": a.id,
                "username": a.username,
                "action": a.action,
                "details": a.details,
                "dataset_id": a.dataset_id,
                "episode_id": a.episode_id,
                "created_at": a.created_at,
            }
            for a in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, -(-total // page_size)),
    }
