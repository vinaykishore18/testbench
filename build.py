#!/usr/bin/env python3
"""Bundle the multi-file site into one self-contained HTML file.

  python3 build.py            -> dist/testbench.html     (full standalone page)
  python3 build.py --body     -> dist/artifact-body.html (no <html>/<head> wrapper)

The multi-file version in this folder is what you deploy. The bundle is for
handing someone a single file, or a host that only takes one page.
"""
import re, sys, pathlib, hashlib, base64

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "css" / "testbench.css").read_text()

# _boot.js must run first — it is the guard that catches everything else
# failing. Plain sorted() puts an underscore after every digit, which quietly
# made the boot guard the LAST thing to load in every bundle ever built.
js_files = sorted((root / "js").glob("*.js"),
                  key=lambda f: (f.name != "_boot.js", f.name))
js = "\n\n".join("/* ---- %s ---- */\n%s" % (f.name, f.read_text()) for f in js_files)


def safe_inline(text, tag):
    """A closing tag inside a string literal ends the element early and the rest
    of the file is parsed as HTML. Nothing in the tree does this today; one day
    something will."""
    return text.replace("</" + tag, "<\\/" + tag)


js = safe_inline(js, "script")
css = safe_inline(css, "style")

# The bundle's policy names the exact hash of its one inline script rather than
# allowing inline script in general. Same behaviour, and an injected <script> is
# still refused — which 'unsafe-inline' would have handed over entirely.
js_hash = base64.b64encode(hashlib.sha256(js.encode()).digest()).decode()

# The deployed site ships a strict policy (script-src 'self'). Bundling inlines the
# scripts, which that policy would block, so the bundle carries a policy that permits
# its own inline script and nothing else.
BUNDLE_CSP = (
    "default-src 'none'; script-src 'sha256-%s'; "
    "style-src 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; img-src 'self' data:; "
    "media-src 'self' blob:; connect-src 'self'; worker-src blob:; "
    "base-uri 'self'; form-action 'none'; object-src 'none'; frame-ancestors 'none'"
) % js_hash
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
# exactly the bytes that were hashed, or the browser refuses to run them
html = html.replace("</body>", "<script>" + js + "</script>\n</body>")

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
