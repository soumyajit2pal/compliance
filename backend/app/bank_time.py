"""Bank calendar dates and display conversions for stored UTC instants."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


TIME_ZONE = 'Asia/Kolkata'
IST = ZoneInfo(TIME_ZONE)


def to_ist(value):
    """Oracle's timezone-less application timestamps represent UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST)


def today():
    return datetime.now(IST).date()
