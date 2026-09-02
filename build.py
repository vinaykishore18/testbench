#!/usr/bin/env python3
"""Bundle the multi-file site into one self-contained HTML file.

  python3 build.py            -> dist/testbench.html     (full standalone page)
  python3 build.py --body     -> dist/artifact-body.html (no <html>/<head> wrapper)

The multi-file version in this folder is what you deploy. The bundle is for
handing someone a single file, or a host that only takes one page.
"""
import re, sys, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "css" / "testbench.css").read_text()

js_files = sorted((root / "js").glob("*.js"))
js = "\n\n".join("/* ---- %s ---- */\n%s" % (f.name, f.read_text()) for f in js_files)

# The deployed site ships a strict policy (script-src 'self'). Bundling inlines the
# scripts, which that policy would block, so the bundle carries a policy that permits
# its own inline script and nothing else.
BUNDLE_CSP = (
    "default-src 'none'; script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; "
    "media-src 'self' blob:; connect-src 'self'; base-uri 'self'; "
    "form-action 'none'; object-src 'none'"
)
html = re.sub(
    r'<meta http-equiv="Content-Security-Policy"[^>]*>',
    '<meta http-equiv="Content-Security-Policy" content="%s">' % BUNDLE_CSP,
    html,
)

html = html.replace(
    '<link rel="stylesheet" href="css/testbench.css">',
    "<style>\n" + css + "\n</style>",
)
html = re.sub(r'\n<script src="js/[^"]+"></script>', "", html)
html = html.replace("</body>", "<script>\n" + js + "\n</script>\n</body>")

out = root / "dist"
out.mkdir(exist_ok=True)

if "--body" in sys.argv:
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
    keep = []
    pattern = r'<title>.*?</title>|<link rel="(?:preconnect|stylesheet)"[^>]*>|<style>.*?</style>'
    for tag in re.findall(pattern, head, re.S):
        if "icon" in tag:
            continue
        keep.append(tag)
    (out / "artifact-body.html").write_text("\n".join(keep) + "\n" + body)
    print("wrote dist/artifact-body.html")
else:
    (out / "testbench.html").write_text(html)
    print("wrote dist/testbench.html")
