#!/usr/bin/env python3
"""Bundle the multi-file site into one self-contained HTML file.

  python3 build.py            -> dist/testbench.html   (full standalone page)
  python3 build.py --body     -> dist/artifact-body.html (no <html>/<head> wrapper)

The multi-file version in this folder is the one to deploy. The bundle is for
handing someone a single file, or for pasting into a host that wants one page.
"""
import os, re, sys, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "css" / "testbench.css").read_text()

js_files = sorted((root / "js").glob("*.js"))
js = "\n\n".join("/* ---- %s ---- */\n%s" % (f.name, f.read_text()) for f in js_files)

# swap the stylesheet link for the inline styles
html = html.replace('<link rel="stylesheet" href="css/testbench.css">',
                    "<style>\n" + css + "\n</style>")
# drop the individual script tags, add one bundle
html = re.sub(r'\n<script src="js/[^"]+"></script>', "", html)
html = html.replace("</body>", "<script>\n" + js + "\n</script>\n</body>")

out = root / "dist"
out.mkdir(exist_ok=True)

if "--body" in sys.argv:
    # strip the document wrapper: keep <title>, font links, <style>, markup, script
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
    keep = []
    for tag in re.findall(r'<title>.*?</title>|<link rel="(?:preconnect|stylesheet)"[^>]*>|<style>.*?</style>', head, re.S):
        if "icon" in tag:
            continue
        keep.append(tag)
    (out / "artifact-body.html").write_text("\n".join(keep) + "\n" + body)
    print("wrote dist/artifact-body.html")
else:
    (out / "testbench.html").write_text(html)
    print("wrote dist/testbench.html")
