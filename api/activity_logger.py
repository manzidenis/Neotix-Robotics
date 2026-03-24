from sqlalchemy.orm import Session

from api.models import ActivityLog, User


def log_activity(
    db: Session,
    user: User | None,
    action: str,
    details: str = "",
    dataset_id: int | None = None,
    episode_id: int | None = None,
) -> None:
    """Stage an activity log row. Caller is responsible for db.commit()."""
    entry = ActivityLog(
        user_id=user.id if user else None,
        username=user.username if user else "system",
        action=action,
        details=details,
        dataset_id=dataset_id,
        episode_id=episode_id,
    )
    db.add(entry)
