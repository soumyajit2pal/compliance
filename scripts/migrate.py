"""Apply the selected UAT or Prod migration chain; never stamp/create_all."""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.seed import run

if __name__ == "__main__":
    run()
