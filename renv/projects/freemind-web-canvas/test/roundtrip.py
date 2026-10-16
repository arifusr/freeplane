"""Entrypoint eksperimen renv: jalankan uji round-trip .mm (Node) + render SVG, tulis metrics.json.

Kontrak renv: baca RENV_RUN_DIR, tulis metrics.json (map flat nama->nilai) + artefak.
"""
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(__file__).resolve().parent.parent
run_dir = Path(os.environ["RENV_RUN_DIR"]).resolve()


def run_node(script, *args):
    proc = subprocess.run(["node", script, *args], cwd=str(root), capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        raise SystemExit(f"{script} gagal (exit {proc.returncode})")
    line = next((l for l in reversed(proc.stdout.splitlines()) if l.strip().startswith("{")), None)
    if line is None:
        raise SystemExit(f"{script}: tidak ada output JSON")
    return json.loads(line)


metrics = run_node("test/roundtrip.mjs")

svg_metrics = run_node("test/render_svg.mjs", str(run_dir / "mindmap.svg"))
metrics.update(svg_metrics)

svg_path = run_dir / "mindmap.svg"
tree = ET.parse(svg_path)
svg_root = tree.getroot()
metrics["svg_valid_xml"] = 1
metrics["svg_texts"] = sum(1 for el in svg_root.iter() if el.tag.endswith("text"))
metrics["svg_paths"] = sum(1 for el in svg_root.iter() if el.tag.endswith("path"))

metrics = {k: (int(v) if isinstance(v, bool) else v) for k, v in metrics.items()}
metrics["ok"] = 1 if metrics.get("failures", 1) == 0 else 0
(run_dir / "metrics.json").write_text(json.dumps(metrics))
print("metrics:", json.dumps(metrics))
