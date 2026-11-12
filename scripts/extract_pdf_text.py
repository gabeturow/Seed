#!/usr/bin/env python3
"""Reads every PDF (and Word .docx) in a folder and saves their text to database/pdf-text.json.

Usage:
    python3 -m pip install --user pypdf        (once)
    python3 scripts/extract_pdf_text.py "/path/to/folder"

Then, on the site (run on your computer, localhost:3000), go to Scout and click
"Attach text from the PDF folder". That matches each file to an article already in the
library and stores the text so the research assistant can read it.

Nothing is sent anywhere by this script. Files with no readable text (scanned images) are listed at the end.
"""
import hashlib, json, logging, re, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("Install the PDF reader first:  python3 -m pip install --user pypdf")

logging.getLogger("pypdf").setLevel(logging.ERROR)  # quiet font warnings

OUT = Path(__file__).resolve().parent.parent / "database" / "pdf-text.json"


def clean(text):
    text = text.replace("\x00", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def read_pdf(path):
    reader = PdfReader(str(path))
    meta = (reader.metadata.title or "").strip() if reader.metadata else ""
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # one bad page shouldn't lose the whole file
            pages.append("")
    return clean("\n".join(pages)), len(pages), meta


def read_docx(path):
    with zipfile.ZipFile(path) as z:
        root = ElementTree.fromstring(z.read("word/document.xml"))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paras = ["".join(t.text or "" for t in p.iter(ns + "t")) for p in root.iter(ns + "p")]
    return clean("\n".join(paras)), 0, ""


def main():
    if len(sys.argv) != 2 or not Path(sys.argv[1]).is_dir():
        sys.exit(__doc__)
    folder = Path(sys.argv[1])
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".pdf", ".docx") or p.name.endswith(".0730"))
    seen, items, empty, dupes, failed = {}, [], [], [], []
    for p in files:
        try:
            text, pages, meta = read_docx(p) if p.suffix.lower() == ".docx" else read_pdf(p)
        except Exception as e:  # unreadable or password-protected
            failed.append(f"{p.name} ({type(e).__name__})")
            continue
        if len(text) < 500:
            empty.append(p.name)
            continue
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
        if digest in seen:
            dupes.append(f"{p.name} (same text as {seen[digest]})")
            continue
        seen[digest] = p.name
        items.append({"file": p.name, "pdf_title": meta, "pages": pages, "chars": len(text), "text": text})
        print(f"  {len(text):>8} chars  {p.name}")
    OUT.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nSaved {len(items)} files to {OUT}")
    for label, lst in (("Skipped as duplicates", dupes), ("No readable text (scanned?)", empty), ("Couldn't open", failed)):
        if lst:
            print(f"\n{label}:")
            for x in lst:
                print("  -", x)


if __name__ == "__main__":
    main()
