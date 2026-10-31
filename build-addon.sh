#!/usr/bin/env bash
# Packs the add-on into anki_buddy_board.ankiaddon (double-click it to install).
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import pathlib, zipfile
src = pathlib.Path("anki-addon/anki_buddy_board")
with zipfile.ZipFile("anki_buddy_board.ankiaddon", "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(src.rglob("*")):
        rel = f.relative_to(src)
        if f.is_file() and rel.parts[0] not in ("user_files", "__pycache__") and rel.name != "meta.json":
            z.write(f, rel)
print("Built anki_buddy_board.ankiaddon")
PY
