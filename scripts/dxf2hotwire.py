#!/usr/bin/env python3
"""
dxf2hotwire - Cloud's CAD, step 1.

DXF profile in -> scale fixed -> chained toolpath -> hotwire G-code + SVG preview.
Replaces the FreeCAD -> LibreCAD (fix scale) -> BobCAD (make G-code) chain.

License: GPL v3

Usage examples:
  python3 dxf2hotwire.py profile.dxf -o profile.nc --preview profile.svg
  python3 dxf2hotwire.py profile.dxf --units-in mm --units-out in
  python3 dxf2hotwire.py profile.dxf --fit-width 3.5 --units-out in   # force known width
  python3 dxf2hotwire.py profile.dxf --post my_machine.json
"""
import argparse
import json
import math
import sys

import ezdxf
from ezdxf import path as ezpath

INSUNITS = {0: None, 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m"}
TO_MM = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4, "ft": 304.8}
SUPPORTED = {"LINE", "ARC", "CIRCLE", "ELLIPSE", "LWPOLYLINE", "POLYLINE", "SPLINE"}

# Generic post-processor. Edit or override with --post file.json so the output
# matches what your machine's controller expects (copy a real BobCAD file's
# header/footer/wire-on codes into this).
DEFAULT_POST = {
    "header": ["G90"],            # lines after the unit code (G20/G21)
    "footer": ["M30"],
    "rapid": "G0",
    "cut": "G1",
    "decimals": 4,
    "feed": 300.0,                # cut feed in output units per minute
    "wire_on": [],                # e.g. ["M3"] if your controller switches heat by M-code
    "wire_off": [],               # e.g. ["M5"]
    "comment_style": "paren",     # "paren" -> (text), "semi" -> ; text
    "line_numbers": False,
    "axes": ["X", "Y"],
}


def comment(post, text):
    return f"({text})" if post["comment_style"] == "paren" else f"; {text}"


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def load_paths(doc, flatten_dist):
    paths, skipped = [], {}
    for e in doc.modelspace():
        t = e.dxftype()
        if t not in SUPPORTED:
            skipped[t] = skipped.get(t, 0) + 1
            continue
        try:
            p = ezpath.make_path(e)
        except Exception:
            skipped[t] = skipped.get(t, 0) + 1
            continue
        for sp in p.sub_paths():
            pts = [(v.x, v.y) for v in sp.flattening(flatten_dist)]
            if len(pts) >= 2:
                paths.append(pts)
    return paths, skipped


def chain_paths(paths, tol):
    """Join open pieces end to end. Returns list of (points, closed)."""
    pool = [list(p) for p in paths]
    chains = []
    while pool:
        cur = pool.pop(0)
        grew = True
        while grew and dist(cur[0], cur[-1]) > tol:
            grew = False
            for i, other in enumerate(pool):
                if dist(cur[-1], other[0]) <= tol:
                    cur += other[1:]
                elif dist(cur[-1], other[-1]) <= tol:
                    cur += other[::-1][1:]
                elif dist(cur[0], other[-1]) <= tol:
                    cur = other[:-1] + cur
                elif dist(cur[0], other[0]) <= tol:
                    cur = other[::-1][:-1] + cur
                else:
                    continue
                pool.pop(i)
                grew = True
                break
        closed = dist(cur[0], cur[-1]) <= tol
        if closed:
            cur[-1] = cur[0]
        chains.append((cur, closed))
    return chains


def order_chains(chains):
    """Nearest-start ordering to cut down on rapid travel."""
    remaining, ordered, pos = list(chains), [], (0.0, 0.0)
    while remaining:
        best = min(remaining, key=lambda c: dist(pos, c[0][0]))
        remaining.remove(best)
        ordered.append(best)
        pos = best[0][-1]
    return ordered


def bbox(chains):
    xs = [p[0] for c, _ in chains for p in c]
    ys = [p[1] for c, _ in chains for p in c]
    return min(xs), min(ys), max(xs), max(ys)


def transform(chains, factor, normalize, mirror_x, mirror_y):
    out = []
    for pts, closed in chains:
        new = []
        for x, y in pts:
            x, y = x * factor, y * factor
            if mirror_x:
                x = -x
            if mirror_y:
                y = -y
            new.append((x, y))
        out.append((new, closed))
    if normalize:
        x0, y0, _, _ = bbox(out)
        out = [([(x - x0, y - y0) for x, y in pts], closed) for pts, closed in out]
    return out


def write_gcode(chains, post, units_out, source_name):
    d = post["decimals"]
    fmt = lambda v: f"{v:.{d}f}".rstrip("0").rstrip(".") if v != 0 else "0"
    ax, ay = post["axes"]
    lines = []
    n = [10]

    def emit(s):
        if post["line_numbers"] and not s.startswith(("(", ";")):
            lines.append(f"N{n[0]} {s}")
            n[0] += 10
        else:
            lines.append(s)

    emit(comment(post, f"Cloud's CAD dxf2hotwire - source: {source_name}"))
    emit("G21" if units_out == "mm" else "G20")
    for h in post["header"]:
        emit(h)
    for i, (pts, closed) in enumerate(chains, 1):
        emit(comment(post, f"path {i} {'closed' if closed else 'open'}"))
        emit(f"{post['rapid']} {ax}{fmt(pts[0][0])} {ay}{fmt(pts[0][1])}")
        for w in post["wire_on"]:
            emit(w)
        first = True
        for x, y in pts[1:]:
            f = f" F{fmt(post['feed'])}" if first else ""
            emit(f"{post['cut']} {ax}{fmt(x)} {ay}{fmt(y)}{f}")
            first = False
        for w in post["wire_off"]:
            emit(w)
    for f in post["footer"]:
        emit(f)
    return "\n".join(lines) + "\n"


def write_svg(chains, path, units_out):
    x0, y0, x1, y1 = bbox(chains)
    w, h = x1 - x0, y1 - y0
    pad = max(w, h) * 0.05 or 1
    stroke = max(w, h) / 400 or 0.01
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - pad:.4f} {-(y1 + pad):.4f} '
        f'{w + 2 * pad:.4f} {h + 2 * pad:.4f}" width="900">',
        '<rect x="-1e6" y="-1e6" width="2e6" height="2e6" fill="white"/>',
    ]
    for pts, closed in chains:
        d = " ".join(f"{x:.4f},{-y:.4f}" for x, y in pts)
        parts.append(
            f'<polyline points="{d}" fill="none" stroke="#c0392b" stroke-width="{stroke:.4f}"/>'
        )
    parts.append(
        f'<text x="{x0:.4f}" y="{-(y1 + pad / 2):.4f}" font-size="{pad / 2:.4f}" fill="#333">'
        f"{w:.3f} x {h:.3f} {units_out}</text>"
    )
    parts.append("</svg>")
    with open(path, "w") as f:
        f.write("\n".join(parts))


def main():
    ap = argparse.ArgumentParser(description="DXF profile to hotwire G-code")
    ap.add_argument("dxf")
    ap.add_argument("-o", "--out", help="G-code output file (default: input name + .nc)")
    ap.add_argument("--preview", help="write an SVG preview of the toolpath")
    ap.add_argument("--units-in", choices=list(TO_MM), help="force DXF units (use if the file has none or wrong)")
    ap.add_argument("--units-out", choices=["mm", "in"], default="mm")
    ap.add_argument("--scale", type=float, default=1.0, help="extra scale factor on top of unit conversion")
    ap.add_argument("--fit-width", type=float, help="scale so the profile is exactly this wide (output units)")
    ap.add_argument("--fit-height", type=float, help="scale so the profile is exactly this tall (output units)")
    ap.add_argument("--feed", type=float, help="cut feed rate, output units/min")
    ap.add_argument("--tol", type=float, default=0.01, help="gap tolerance when joining pieces (source units)")
    ap.add_argument("--arc-tol", type=float, default=0.005, help="arc/curve flattening accuracy (source units)")
    ap.add_argument("--no-normalize", action="store_true", help="keep original origin instead of moving to 0,0")
    ap.add_argument("--mirror-x", action="store_true")
    ap.add_argument("--mirror-y", action="store_true")
    ap.add_argument("--post", help="JSON file overriding the generic post-processor settings")
    a = ap.parse_args()

    post = dict(DEFAULT_POST)
    post_override = json.load(open(a.post)) if a.post else {}
    post.update(post_override)
    if a.feed:
        post["feed"] = a.feed
    elif not a.post or "feed" not in post_override:
        post["feed"] = 300.0 if a.units_out == "mm" else 12.0  # placeholder: set your real hotwire speed

    doc = ezdxf.readfile(a.dxf)
    declared = INSUNITS.get(doc.header.get("$INSUNITS", 0))
    src = a.units_in or declared
    if src is None:
        src = a.units_out
        print(f"WARNING: DXF has no units. Assuming {src}. If the size looks wrong, use --units-in or --fit-width.")
    elif a.units_in and declared and a.units_in != declared:
        print(f"NOTE: file says {declared}, you forced {a.units_in}.")

    paths, skipped = load_paths(doc, a.arc_tol)
    if not paths:
        sys.exit("No usable geometry found (supported: LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE, POLYLINE, SPLINE).")
    if skipped:
        print(f"Skipped unsupported entities: {skipped}")

    chains = order_chains(chain_paths(paths, a.tol))

    factor = TO_MM[src] / TO_MM[a.units_out] * a.scale
    x0, y0, x1, y1 = bbox(chains)
    if a.fit_width:
        factor = a.fit_width / (x1 - x0)
    elif a.fit_height:
        factor = a.fit_height / (y1 - y0)

    chains = transform(chains, factor, not a.no_normalize, a.mirror_x, a.mirror_y)
    bx0, by0, bx1, by1 = bbox(chains)
    length = sum(dist(p, q) for pts, _ in chains for p, q in zip(pts, pts[1:]))

    out = a.out or a.dxf.rsplit(".", 1)[0] + ".nc"
    with open(out, "w") as f:
        f.write(write_gcode(chains, post, a.units_out, a.dxf.split("/")[-1]))
    if a.preview:
        write_svg(chains, a.preview, a.units_out)

    print(f"Units: DXF {src} -> output {a.units_out}  (factor {factor:.6f})")
    print(f"Paths: {len(chains)}  ({sum(1 for _, c in chains if c)} closed)")
    print(f"Size:  {bx1 - bx0:.4f} x {by1 - by0:.4f} {a.units_out}")
    print(f"Cut length: {length:.3f} {a.units_out}  (~{length / post['feed']:.1f} min at feed {post['feed']:g})")
    print(f"Wrote {out}" + (f" and {a.preview}" if a.preview else ""))


if __name__ == "__main__":
    main()
