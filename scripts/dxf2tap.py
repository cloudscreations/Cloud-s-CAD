#!/usr/bin/env python3
"""
dxf2tap - Cloud's CAD, step 3.

DXF profile in -> .tap file in the same dialect BobCAD produces for the shop's hotwire machine:
relative moves (G91), real G02/G03 arcs with I/J, no feed codes (speed is set at the machine),
header/footer copied from a known-good file.

The wire must be sitting at the START POINT of the profile when the program runs, unless you
give --lead-in. The tool prints the start point and the cut direction so you can check.

License: GPL v3

Examples:
  python3 dxf2tap.py profile.dxf -o profile.tap
  python3 dxf2tap.py profile.dxf --units-in mm --lead-in -0.5,-0.6 --lead-out 0.5,0.02
  python3 dxf2tap.py profile.dxf --fit-width 3.5          # force a known width (inches)
"""
import argparse
import json
import math
import sys

import ezdxf
from ezdxf import path as ezpath

INSUNITS = {0: None, 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m"}
TO_IN = {"in": 1.0, "ft": 12.0, "mm": 1 / 25.4, "cm": 1 / 2.54, "m": 1 / 0.0254}

# Copied from a real BobCAD file for this machine. Meaning of M90/G74/M11/M21 not documented
# by us - they are kept exactly as BobCAD writes them.
DEFAULT_POST = {
    "header": ["M90", "G74", "G91", "M11", ""],
    "footer": ["M21", "M02"],
    "decimals": 4,
}


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


# ---- segments: ('L', p0, p1) or ('A', p0, p1, center, ccw) -------------------------------

def rev(s):
    if s[0] == "L":
        return ("L", s[2], s[1])
    return ("A", s[2], s[1], s[3], not s[4])


def extract(doc, flat_tol):
    segs, skipped = [], {}

    def add(e):
        t = e.dxftype()
        if t == "LINE":
            s, f = e.dxf.start, e.dxf.end
            segs.append(("L", (s.x, s.y), (f.x, f.y)))
        elif t == "ARC":
            c = e.ocs().to_wcs(e.dxf.center)
            sp, ep = e.start_point, e.end_point
            ccw = e.dxf.extrusion.z >= 0
            segs.append(("A", (sp.x, sp.y), (ep.x, ep.y), (c.x, c.y), ccw))
        elif t == "CIRCLE":
            c = e.ocs().to_wcs(e.dxf.center)
            r = e.dxf.radius
            a, b = (c.x + r, c.y), (c.x - r, c.y)
            segs.append(("A", a, b, (c.x, c.y), True))
            segs.append(("A", b, a, (c.x, c.y), True))
        elif t in ("LWPOLYLINE", "POLYLINE"):
            for v in e.virtual_entities():
                add(v)
        elif t in ("SPLINE", "ELLIPSE"):
            for sp in ezpath.make_path(e).sub_paths():
                pts = [(v.x, v.y) for v in sp.flattening(flat_tol)]
                for p, q in zip(pts, pts[1:]):
                    segs.append(("L", p, q))
            skipped[t + " (flattened to lines)"] = skipped.get(t + " (flattened to lines)", 0) + 1
        else:
            skipped[t] = skipped.get(t, 0) + 1

    for e in doc.modelspace():
        add(e)
    return segs, skipped


def chain(segs, tol):
    pool = list(segs)
    chains = []
    while pool:
        cur = [pool.pop(0)]
        for forward in (True, False):
            while True:
                found = None
                for i, s in enumerate(pool):
                    anchor = cur[-1][2] if forward else cur[0][1]
                    if forward:
                        if dist(s[1], anchor) <= tol:
                            found = (i, s)
                        elif dist(s[2], anchor) <= tol:
                            found = (i, rev(s))
                    else:
                        if dist(s[2], anchor) <= tol:
                            found = (i, s)
                        elif dist(s[1], anchor) <= tol:
                            found = (i, rev(s))
                    if found:
                        break
                if not found:
                    break
                pool.pop(found[0])
                if forward:
                    cur.append(found[1])
                else:
                    cur.insert(0, found[1])
        chains.append(cur)
    return chains


def xform(chains, k, mirror_x, mirror_y):
    def pt(p):
        x, y = p[0] * k, p[1] * k
        return (-x if mirror_x else x, -y if mirror_y else y)

    flip = mirror_x != mirror_y
    out = []
    for c in chains:
        new = []
        for s in c:
            if s[0] == "L":
                new.append(("L", pt(s[1]), pt(s[2])))
            else:
                new.append(("A", pt(s[1]), pt(s[2]), pt(s[3]), (not s[4]) if flip else s[4]))
        out.append(new)
    return out


def sample_points(c):
    pts = []
    for s in c:
        pts += [s[1], s[2]]
        if s[0] == "A":
            r = dist(s[1], s[3])
            for a in range(0, 360, 5):  # coarse extent safety: check circle extremes inside arc
                q = (s[3][0] + r * math.cos(math.radians(a)), s[3][1] + r * math.sin(math.radians(a)))
                a0 = math.atan2(s[1][1] - s[3][1], s[1][0] - s[3][0])
                a1 = math.atan2(s[2][1] - s[3][1], s[2][0] - s[3][0])
                aq = math.atan2(q[1] - s[3][1], q[0] - s[3][0])
                sweep = (a1 - a0) % (2 * math.pi) if s[4] else -((a0 - a1) % (2 * math.pi))
                d = (aq - a0) % (2 * math.pi) if s[4] else -((a0 - aq) % (2 * math.pi))
                if (s[4] and 0 <= d <= sweep) or ((not s[4]) and sweep <= d <= 0):
                    pts.append(q)
    return pts


def num(v, d):
    s = f"{v:.{d}f}"
    if "." in s:
        s = s.rstrip("0")
    if float(s) == 0:
        return "0."
    return s if "." in s else s + "."


def emit(chains, post, lead_in, lead_out):
    d = post["decimals"]
    r = lambda v: round(v, d)
    lines = list(post["header"])

    def move(dx, dy):
        w = ["G01"]
        if dx:
            w.append("X" + num(dx, d))
        if dy:
            w.append("Y" + num(dy, d))
        if len(w) > 1:
            lines.append(" ".join(w))

    pos = None
    for c in chains:
        start = (r(c[0][1][0]), r(c[0][1][1]))
        if pos is None:
            if lead_in:
                move(r(lead_in[0]), r(lead_in[1]))
        else:
            move(r(start[0] - pos[0]), r(start[1] - pos[1]))
        pos = start
        for s in c:
            tgt = (r(s[2][0]), r(s[2][1]))
            dx, dy = r(tgt[0] - pos[0]), r(tgt[1] - pos[1])
            if s[0] == "L":
                move(dx, dy)
            else:
                i, j = r(s[3][0] - pos[0]), r(s[3][1] - pos[1])
                code = "G03" if s[4] else "G02"
                lines.append(f"{code} X{num(dx, d)} Y{num(dy, d)} I{num(i, d)} J{num(j, d)}")
            pos = tgt
    if lead_out:
        move(r(lead_out[0]), r(lead_out[1]))
    lines += post["footer"]
    # The shop's BobCAD files use Windows (CRLF) line endings; match them.
    return "\r\n".join(lines) + "\r\n"


def vec(s):
    a, b = s.split(",")
    return float(a), float(b)


def main():
    ap = argparse.ArgumentParser(description="DXF profile to hotwire .tap (BobCAD-style dialect)")
    ap.add_argument("dxf")
    ap.add_argument("-o", "--out")
    ap.add_argument("--units-in", choices=list(TO_IN), help="force DXF units")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--fit-width", type=float, help="scale so profile is exactly this wide (inches)")
    ap.add_argument("--fit-height", type=float, help="scale so profile is exactly this tall (inches)")
    ap.add_argument("--tol", type=float, default=0.01, help="gap tolerance when joining pieces (DXF units)")
    ap.add_argument("--reverse", action="store_true", help="cut the profile in the opposite direction")
    ap.add_argument("--mirror-x", action="store_true")
    ap.add_argument("--mirror-y", action="store_true")
    ap.add_argument("--lead-in", type=vec, help="dx,dy: first move from wire start to profile start (inches)")
    ap.add_argument("--lead-out", type=vec, help="dx,dy: final move after the profile (inches)")
    ap.add_argument("--allow-multi", action="store_true",
                    help="allow several separate paths; the wire will CUT a straight line between them")
    ap.add_argument("--post", help="JSON file overriding header/footer/decimals")
    a = ap.parse_args()

    post = dict(DEFAULT_POST)
    if a.post:
        post.update(json.load(open(a.post)))

    doc = ezdxf.readfile(a.dxf)
    declared = INSUNITS.get(doc.header.get("$INSUNITS", 0))
    src = a.units_in or declared
    if src is None:
        src = "in"
        print("WARNING: DXF has no units, assuming inches. Use --units-in or --fit-width if the size looks wrong.")

    segs, skipped = extract(doc, 0.005)
    if not segs:
        sys.exit("No usable geometry (supported: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, SPLINE, ELLIPSE).")
    if skipped:
        print(f"Note: {skipped}")
    chains = chain(segs, a.tol)

    k = TO_IN[src] * a.scale
    pts = [p for c in chains for p in sample_points(c)]
    w, h = max(p[0] for p in pts) - min(p[0] for p in pts), max(p[1] for p in pts) - min(p[1] for p in pts)
    if a.fit_width:
        k = a.fit_width / w
    elif a.fit_height:
        k = a.fit_height / h
    chains = xform(chains, k, a.mirror_x, a.mirror_y)
    if a.reverse:
        chains = [[rev(s) for s in reversed(c)] for c in chains]

    if len(chains) > 1 and not a.allow_multi:
        sys.exit(f"{len(chains)} separate paths found. This machine's format has no rapid move, so the wire would "
                 f"CUT in a straight line between them. Fix the gaps (try --tol) or pass --allow-multi.")

    pts = [p for c in chains for p in sample_points(c)]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    out = a.out or a.dxf.rsplit(".", 1)[0] + ".tap"
    with open(out, "w", newline="") as f:
        f.write(emit(chains, post, a.lead_in, a.lead_out))
    st = chains[0][0][1]
    arcs = sum(1 for c in chains for s in c if s[0] == "A")
    print(f"Units: DXF {src} -> inches (factor {k:.6f})")
    print(f"Size: {max(xs) - min(xs):.4f} x {max(ys) - min(ys):.4f} in   Paths: {len(chains)}   Moves: {sum(len(c) for c in chains)} ({arcs} arcs)")
    print(f"Wire must start at DXF point ({st[0]:.4f}, {st[1]:.4f}) in; first cut direction ends at ({chains[0][0][2][0]:.4f}, {chains[0][0][2][1]:.4f})")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
