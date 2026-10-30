"""QA-style entry point. Reference seeds are versioned Alembic migrations."""
from pathlib import Path
from alembic import command
from alembic.config import Config


def run():
    root = Path(__file__).resolve().parents[2]
    command.upgrade(Config(str(root / "backend/alembic.ini")), "head")


if __name__ == "__main__":
    run()
