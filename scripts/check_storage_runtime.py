"""Read-only UAT storage/revision snapshot; never exports credentials or rows.

Print hashes rather than user, grant, directory or business payloads so a
before/after deployment comparison can verify preservation safely.
"""
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime, timezone
import sqlalchemy as sa

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.app.runtime import runtime_settings
from backend.app import models as m
from backend.app.storage import stored_path


def snapshot():
    cfg=runtime_settings()
    if cfg.environment!='uat':raise RuntimeError('This verification tool refuses Prod.')
    engine=sa.create_engine(cfg.database_url,hide_parameters=True)
    try:
        with engine.connect() as db:
            tables=['user','user_role','directory_configuration','regulatory_instrument','instrument_version',
                    'regulatory_clause','document','migration_batch','migration_row','compliance_obligation',
                    'notification_link','notification_scope','notification_assessment','regulatory_deadline',
                    'ldap_department_request']
            counts={};fingerprints={}
            for name in tables:
                table=getattr(m,name)
                rows=[dict(row) for row in db.execute(sa.select(table).order_by(table.c.id)).mappings()]
                counts[name]=len(rows)
                fingerprints[name]=hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()
            files={'portal_documents':0,'verified':0,'unavailable':0,'hash_mismatch':0,'external_documents':0}
            for row in db.execute(sa.select(m.document)).mappings():
                if row['storage_uri']!='portal://'+row['id']:
                    files['external_documents']+=1;continue
                files['portal_documents']+=1
                path=stored_path(cfg.storage,row['id'],row['file_name'])
                if not path.is_file():files['unavailable']+=1
                elif hashlib.sha256(path.read_bytes()).hexdigest()!=row['file_hash']:files['hash_mismatch']+=1
                else:files['verified']+=1
            fixture_users=db.execute(sa.select(sa.func.count()).select_from(m.user).where(sa.or_(
                m.user.c.username.like('ldapqa.profile.%'),m.user.c.username.like('browser.%'),
                m.user.c.username.like('api.%.%')))).scalar_one()
            return {'checked_at':datetime.now(timezone.utc).isoformat(),'environment':cfg.environment,
                'revision':db.execute(sa.text('SELECT version_num FROM cbd_alembic_version')).scalar_one(),
                'counts':counts,'fingerprints':fingerprints,'document_files':files,
                'temporary_fixture_users_remaining':fixture_users,
                'storage_root':str(cfg.storage),'staging_root':str(cfg.storage/'staging'),
                'legacy_staging_present':(cfg.storage.parent/'staging').exists(),
                'log_file':str(cfg.log_dir/cfg.log_file_name),
                'log_mode':'deep' if cfg.deep_logging else 'basic',
                'log_max_bytes':cfg.log_max_bytes,'log_backup_count':cfg.log_backup_count}
    finally:engine.dispose()


if __name__=='__main__':print(json.dumps(snapshot(),indent=2))
