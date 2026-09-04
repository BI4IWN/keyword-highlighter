#!/usr/bin/env python3
# 打包扩展为 zip（只含运行时文件，manifest 位于压缩包根目录），便于分发安装
# 用法: python3 tools/pack.py （或 npm run pack）
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = [
    "manifest.json", "background.js", "content.js", "content.css",
    "popup.html", "popup.css", "popup.js",
]


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    out_dir = ROOT / "dist"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"keyword-highlighter-v{version}.zip"
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in RUNTIME:
            zf.write(ROOT / name, name)
        for icon in sorted((ROOT / "icons").glob("*.png")):
            zf.write(icon, f"icons/{icon.name}")
    print(f"打包完成: {out}")
    with zipfile.ZipFile(out) as zf:
        bad = zf.testzip()
        if bad:
            raise SystemExit(f"zip 校验失败: {bad}")
        for info in zf.infolist():
            print(f"  {info.filename}  {info.file_size} bytes")


if __name__ == "__main__":
    main()
