"""Generate the review SQL and column dictionary without connecting to Oracle."""
from pathlib import Path
import sys
from alembic import command
from alembic.config import Config
from sqlalchemy.dialects import oracle

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.models import metadata


def main():
    directory = ROOT / "database"
    directory.mkdir(exist_ok=True)
    with (directory / "upgrade.sql").open("w") as stream:
        config = Config(str(ROOT / "backend/alembic.ini"), output_buffer=stream)
        command.upgrade(config, "head", sql=True)
    lines = ["# Column dictionary", "", "Generated from canonical SQLAlchemy metadata. All operational changes go through Alembic.", "",
             f"{len(metadata.tables)} tables; {sum(len(t.c) for t in metadata.tables.values())} columns.", ""]
    for table in metadata.tables.values():
        lines += [f"## `{table.name}`", "", "| Column | Oracle type | Nullable | Default | References |", "| --- | --- | --- | --- | --- |"]
        for column in table.c:
            type_ = str(column.type.compile(dialect=oracle.dialect()))
            default = str(column.server_default.arg) if column.server_default is not None else ""
            references = ", ".join(sorted(f.target_fullname for f in column.foreign_keys))
            lines.append(f"| `{column.name}` | `{type_}` | {'yes' if column.nullable else 'no'} | `{default}` | {references} |")
        lines.append("")
    (directory / "data-dictionary.md").write_text("\n".join(lines))
    print("Generated database/upgrade.sql and database/data-dictionary.md; no Oracle connection used.")


if __name__ == "__main__":
    main()
