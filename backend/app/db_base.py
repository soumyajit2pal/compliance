"""Side-effect-free metadata; importing models never connects or creates tables."""
import hashlib
from sqlalchemy import MetaData


def object_name(constraint, table):
    columns = "_".join(col.name for col in constraint.columns)
    kind = constraint.__class__.__name__.replace("Constraint", "").lower()
    if kind == "foreignkey":
        columns += "_" + "_".join(e.target_fullname for e in constraint.elements)
    value = f"{kind}_{table.name}_{columns}"
    return value[:18] + "_" + hashlib.sha1(value.encode()).hexdigest()[:8]


metadata = MetaData(naming_convention={
    "key": object_name, "ix": "ix_%(key)s", "uq": "uq_%(key)s",
    "fk": "fk_%(key)s", "pk": "pk_%(key)s",
})
