"""Queue one transaction of deduplicated work reminders after migration."""
from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.app.runtime import runtime_settings
from backend.app.database import create_application_engine
from backend.app.delivery_reminders import run

if __name__=='__main__':
    cfg=runtime_settings();engine=create_application_engine(cfg.database_url)
    try:
        with engine.begin() as db:result=run(db)
        print(json.dumps({'environment':cfg.environment,**result},default=str))
    finally:engine.dispose()
