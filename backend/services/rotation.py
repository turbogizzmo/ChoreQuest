"""Shared rotation logic for chore rotation scheduling."""

from datetime import date, datetime, timedelta, timezone

from backend.models import ChoreRotation, RotationCadence


# ---------------------------------------------------------------------------
# Calendar helpers
# ---------------------------------------------------------------------------

def week_start_for(d: date, rotation_day: int = 0) -> date:
    """Return the most recent occurrence of *rotation_day* (0=Mon…6=Sun)
    on or before *d*.

    Examples
    --------
    rotation_day=0 (Monday) → behaves like the old monday_of_week()
    rotation_day=6 (Sunday) → returns last Sunday on or before d
    """
    days_back = (d.weekday() - rotation_day) % 7
    return d - timedelta(days=days_back)


# Keep the old name as a convenience alias (used in tests / other services).
def monday_of_week(d: date) -> date:
    return week_start_for(d, rotation_day=0)


def _boundaries_between(a: date, b: date, rotation_day: int = 0) -> int:
    """Number of rotation-day boundaries from *a* (exclusive) to *b* (inclusive).

    Positive when b > a, negative when b < a.  Two dates in the same
    "rotation week" return 0.
    """
    return (week_start_for(b, rotation_day) - week_start_for(a, rotation_day)).days // 7


# ---------------------------------------------------------------------------
# Core rotation logic
# ---------------------------------------------------------------------------

def should_advance_rotation(rotation: ChoreRotation, now: datetime) -> bool:
    """Determine whether a rotation should advance to the next kid.

    Cadence semantics
    -----------------
    daily       — advance whenever a new calendar *day* begins.
    weekly      — advance on every configured *rotation_day* boundary
                  (default: Monday).  A rotation created on Thursday will
                  advance for the first time the following rotation_day,
                  giving the first kid a full period.
    fortnightly — advance every *second* rotation_day boundary.
    monthly     — advance when the calendar **month** changes.
    """
    if rotation.last_rotated is None:
        return True

    cadence = _cadence_value(rotation.cadence)
    rday = _rotation_day(rotation)

    now_date = now.date() if hasattr(now, "date") else now
    last_date = (
        rotation.last_rotated.date()
        if hasattr(rotation.last_rotated, "date")
        else rotation.last_rotated
    )

    if cadence == "daily":
        return (now_date - last_date).days >= 1

    if cadence == "weekly":
        return week_start_for(now_date, rday) > week_start_for(last_date, rday)

    if cadence == "fortnightly":
        return _boundaries_between(last_date, now_date, rday) >= 2

    if cadence == "monthly":
        return (now_date.year, now_date.month) > (last_date.year, last_date.month)

    # Fallback: rolling 7-day window
    return (now_date - last_date).days >= 7


def advance_rotation(rotation: ChoreRotation, now: datetime) -> None:
    """Advance the rotation to the next kid and record the timestamp."""
    rotation.current_index = (rotation.current_index + 1) % len(rotation.kid_ids)
    rotation.last_rotated = now


def get_rotation_kid_for_day(
    rotation: ChoreRotation,
    target_day: date,
    reference_day: date,
    active_weekdays: list[int] | None = None,
) -> int:
    """Return the kid ID that should be assigned on ``target_day``
    given the rotation's current state as of ``reference_day``.

    Cadence projection
    ------------------
    daily       — one step per occurrence (or per configured weekday).
    weekly      — one step per rotation-day boundary.
    fortnightly — one step per two rotation-day boundaries.
    monthly     — one step per calendar month.
    """
    cadence = _cadence_value(rotation.cadence)
    rday = _rotation_day(rotation)

    if cadence == "daily":
        if active_weekdays is not None:
            offset = _count_occurrences(reference_day, target_day, active_weekdays)
        else:
            offset = (target_day - reference_day).days

    elif cadence == "weekly":
        offset = _boundaries_between(reference_day, target_day, rday)

    elif cadence == "fortnightly":
        boundaries = _boundaries_between(reference_day, target_day, rday)
        offset = boundaries // 2

    elif cadence == "monthly":
        months_ref = reference_day.year * 12 + reference_day.month
        months_target = target_day.year * 12 + target_day.month
        offset = months_target - months_ref

    else:
        offset = 0

    idx = (rotation.current_index + offset) % len(rotation.kid_ids)
    return int(rotation.kid_ids[idx])


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _rotation_day(rotation: ChoreRotation) -> int:
    """Safely read rotation_day from a rotation object (handles legacy rows
    that don't have the column yet by defaulting to 0 / Monday)."""
    return getattr(rotation, "rotation_day", None) or 0


def _count_occurrences(start: date, end: date, weekdays: list[int]) -> int:
    """Count how many *weekday* occurrences fall in the range (start, end].

    Returns a negative number when *end* < *start*.
    """
    if start == end or not weekdays:
        return 0

    forward = end >= start
    a, b = (start, end) if forward else (end, start)

    total_days = (b - a).days
    full_weeks, remaining = divmod(total_days, 7)

    wd_set = set(weekdays)
    count = full_weeks * len(wd_set)
    for i in range(1, remaining + 1):
        if (a + timedelta(days=i)).weekday() in wd_set:
            count += 1

    return count if forward else -count


def _cadence_value(cadence: RotationCadence | str) -> str:
    """Safely extract the string value from a cadence enum or string."""
    return cadence.value if hasattr(cadence, "value") else str(cadence)
