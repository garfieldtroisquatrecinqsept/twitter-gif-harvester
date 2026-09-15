"""Construit le paquet Firefox (dist/firefox/ + XPI) a partir des sources communes."""

import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "firefox"
XPI = ROOT / "dist" / "twitter-gif-harvest-firefox.xpi"

INCLUDE_DIRS = ["icons", "src/lib", "src/content", "src/options", "src/popup"]
INCLUDE_FILES = ["src/background/core.js", "src/background/background-firefox.js"]


def collect():
    files = []
    for folder in INCLUDE_DIRS:
        base = ROOT / folder
        for path in sorted(base.rglob("*")):
            if path.is_file():
                files.append(path.relative_to(ROOT))
    for name in INCLUDE_FILES:
        files.append(Path(name))
    return files


def referenced_paths(manifest):
    refs = set()
    for size, path in manifest.get("icons", {}).items():
        refs.add(path)
    action = manifest.get("action", {})
    refs.add(action.get("default_popup"))
    for size, path in action.get("default_icon", {}).items():
        refs.add(path)
    refs.add(manifest.get("options_ui", {}).get("page"))
    for script in manifest.get("background", {}).get("scripts", []):
        refs.add(script)
    for entry in manifest.get("content_scripts", []):
        for path in entry.get("js", []) + entry.get("css", []):
            refs.add(path)
    return {r for r in refs if r}


def main():
    manifest = json.loads((ROOT / "manifest.firefox.json").read_text(encoding="utf-8"))

    DIST.mkdir(parents=True, exist_ok=True)
    for child in DIST.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    files = collect()
    for relative in files:
        target = DIST / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)

    (DIST / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    missing = [ref for ref in referenced_paths(manifest) if not (DIST / ref).exists()]
    if missing:
        print("ECHEC : fichiers references par le manifeste mais absents du paquet :")
        for ref in sorted(missing):
            print("  -", ref)
        return 1

    XPI.parent.mkdir(parents=True, exist_ok=True)
    if XPI.exists():
        XPI.unlink()
    with zipfile.ZipFile(XPI, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(DIST / "manifest.json", "manifest.json")
        for relative in files:
            archive.write(DIST / relative, str(relative).replace("\\", "/"))

    total = len(files) + 1
    print(f"dist/firefox/ : {total} fichiers")
    print(f"{XPI.relative_to(ROOT)} : {XPI.stat().st_size / 1024:.1f} Ko")
    print("manifeste verifie : toutes les references existent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
