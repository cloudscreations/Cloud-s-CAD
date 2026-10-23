#!/usr/bin/env python3
"""
tap_preview - Cloud's CAD helper.

Reads a hotwire .tap / G-code file (G01/G02/G03, absolute G90 or relative G91),
rebuilds the path, reports size and where it ends, and draws an SVG preview
(blue = start, red = end). Used to check that we understand a machine's dialect.

License: GPL v3
Usage: python3 tap_preview.py file.tap [-o preview.svg]
"""
import math
import re
import sys

WORD = re.compile(r"([A-Za-z])\s*(-?\d*\.?\d*)")


def parse(text):
    relative = False
    pos = [0.0, 0.0]
    segs = []  # (list of points, kind, line number)
    codes_seen = {}
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.split(";")[0].split("(")[0].strip()
        if not line:
            continue
        words = {}
        order = []
        for letter, num in WORD.findall(line):
            letter = letter.upper()
            if num in ("", "-", ".", "-."):
                num = "0"
            val = float(num)
            if letter in "GM":
                code = f"{letter}{int(val):02d}"
                order.append(code)
                codes_seen[code] = codes_seen.get(code, 0) + 1
            else:
                words[letter] = val
        if "G91" in order:
            relative = True
        if "G90" in order:
            relative = False
        move = next((c for c in order if c in ("G00", "G01", "G02", "G03")), None)
        if move is None:
            if "X" in words or "Y" in words:
                move = "G01"
            else:
                continue
        dx, dy = words.get("X"), words.get("Y")
        if relative:
            end = [pos[0] + (dx or 0.0), pos[1] + (dy or 0.0)]
        else:
            end = [dx if dx is not None else pos[0], dy if dy is not None else pos[1]]
        if move in ("G02", "G03") and ("I" in words or "J" in words):
            c = (pos[0] + words.get("I", 0.0), pos[1] + words.get("J", 0.0))
            r0 = math.hypot(pos[0] - c[0], pos[1] - c[1])
            r1 = math.hypot(end[0] - c[0], end[1] - c[1])
            a0 = math.atan2(pos[1] - c[1], pos[0] - c[0])
            a1 = math.atan2(end[1] - c[1], end[0] - c[0])
            sweep = a1 - a0
            if move == "G02":  # clockwise
                if sweep >= 0:
                    sweep -= 2 * math.pi
            else:
                if sweep <= 0:
                    sweep += 2 * math.pi
            steps = max(4, int(abs(sweep) / math.radians(3)))
            pts = [(c[0] + r0 * math.cos(a0 + sweep * k / steps),
                    c[1] + r0 * math.sin(a0 + sweep * k / steps)) for k in range(steps + 1)]
            pts[-1] = tuple(end)
            segs.append((pts, move, n, abs(r0 - r1), c))
        else:
            segs.append(([tuple(pos), tuple(end)], move, n, 0.0, None))
        pos = end
    return segs, pos, relative, codes_seen


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    out = sys.argv[sys.argv.index("-o") + 1] if "-o" in sys.argv else path.rsplit(".", 1)[0] + ".svg"
    segs, end, relative, codes = parse(open(path).read())
    allpts = [p for s in segs for p in s[0]]
    xs, ys = [p[0] for p in allpts], [p[1] for p in allpts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    length = sum(math.dist(a, b) for s in segs for a, b in zip(s[0], s[0][1:]))
    arcs = sum(1 for s in segs if s[1] in ("G02", "G03"))
    worst = max((s[3] for s in segs), default=0.0)
    print(f"Codes used: {dict(sorted(codes.items()))}")
    print(f"Moves: {len(segs)} ({arcs} arcs, {len(segs) - arcs} lines), mode: {'relative' if relative else 'absolute'}")
    print(f"Extent: x {x0:.3f}..{x1:.3f} ({x1 - x0:.3f}), y {y0:.3f}..{y1:.3f} ({y1 - y0:.3f})")
    print(f"Total path length: {length:.3f}")
    print(f"End point relative to start: ({end[0]:.4f}, {end[1]:.4f})")
    print(f"Arc radius mismatch (start vs end), worst: {worst:.5f}")

    w, h = x1 - x0, y1 - y0
    pad = max(w, h) * 0.06 or 1
    sw = max(w, h) / 350
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - pad:.3f} {-(y1 + pad):.3f} '
             f'{w + 2 * pad:.3f} {h + 2 * pad:.3f}" width="1000">',
             '<rect x="-1e6" y="-1e6" width="2e6" height="2e6" fill="white"/>']
    total = len(segs)
    for i, s in enumerate(segs):
        t = i / max(1, total - 1)
        color = f"rgb({int(40 + 200 * t)},{int(80 * (1 - abs(2 * t - 1)))},{int(220 * (1 - t))})"
        d = " ".join(f"{x:.4f},{-y:.4f}" for x, y in s[0])
        parts.append(f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="{sw:.4f}" stroke-linecap="round"/>')
    parts.append(f'<circle cx="0" cy="0" r="{sw * 3:.4f}" fill="#2a9d8f"/>')
    parts.append(f'<circle cx="{end[0]:.4f}" cy="{-end[1]:.4f}" r="{sw * 3:.4f}" fill="#e76f51"/>')
    parts.append("</svg>")
    open(out, "w").write("\n".join(parts))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
