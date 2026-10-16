"""Entrypoint eksperimen renv: jalankan uji fitur interaksi (Node) + tulis metrics.json.

Kontrak renv: baca RENV_RUN_DIR, tulis metrics.json (map flat nama->nilai).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
run_dir = Path(os.environ["RENV_RUN_DIR"]).resolve()

proc = subprocess.run(["node", "test/features_check.mjs"], cwd=str(root), capture_output=True, text=True)
sys.stdout.write(proc.stdout)
sys.stderr.write(proc.stderr)
if proc.returncode != 0:
    raise SystemExit(f"features_check.mjs gagal (exit {proc.returncode})")

line = next((l for l in reversed(proc.stdout.splitlines()) if l.strip().startswith("{")), None)
if line is None:
    raise SystemExit("features_check.mjs: tidak ada output JSON")
metrics = json.loads(line)
metrics = {k: (int(v) if isinstance(v, bool) else v) for k, v in metrics.items()}
(run_dir / "metrics.json").write_text(json.dumps(metrics))
print("metrics:", json.dumps(metrics))
