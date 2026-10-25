#!/usr/bin/env python3
"""
tap2dxf - Cloud's CAD helper.

Turns a hotwire .tap file (G01/G02/G03, relative or absolute) back into a DXF with true
LINE and ARC entities. Use it to pull existing BobCAD jobs into any CAD program.
Start point of the wire is placed at 0,0. Units are assumed inches unless --mm is given.

License: GPL v3
Usage: python3 tap2dxf.py file.tap [-o out.dxf] [--mm]
"""
import math
import sys

import ezdxf

from tap_preview import parse


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    out = sys.argv[sys.argv.index("-o") + 1] if "-o" in sys.argv else src.rsplit(".", 1)[0] + ".dxf"
    mm = "--mm" in sys.argv
    segs, _, _, _ = parse(open(src).read())[:4]
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4 if mm else 1
    msp = doc.modelspace()
    lines = arcs = 0
    for s in segs:
        pts, kind, _, _, center = s
        p0, p1 = pts[0], pts[-1]
        if kind in ("G02", "G03") and center is not None:
            r = math.hypot(p0[0] - center[0], p0[1] - center[1])
            a0 = math.degrees(math.atan2(p0[1] - center[1], p0[0] - center[0]))
            a1 = math.degrees(math.atan2(p1[1] - center[1], p1[0] - center[0]))
            if kind == "G02":  # clockwise in the file = counter-clockwise from end to start
                a0, a1 = a1, a0
            msp.add_arc(center, r, a0, a1)
            arcs += 1
        elif math.dist(p0, p1) > 1e-9:
            msp.add_line(p0, p1)
            lines += 1
    doc.saveas(out)
    print(f"Wrote {out}: {lines} lines, {arcs} arcs")


if __name__ == "__main__":
    main()
