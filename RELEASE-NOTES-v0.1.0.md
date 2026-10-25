# Cloud's CAD v0.1.0 (beta)

A free, open-source (GPL v3) CAD/CAM app built for hot-wire foam cutting, with 3D modelling and 3D printing in the same place.

## What's in it
- 2D drawing: lines, curves, arcs, circles, polygons, ellipses; trim, extend, break, join, offset, fillet, chamfer, stretch, mirror, arrays; snaps; DXF in and out.
- **New:** Dimension, Angle and Radius tools (saved and printed on the drawing sheet), Reverse cut direction, Length and area readout.
- Machine tab: turns a drawing into relative-move G-code (.tap), color-coded cut preview with problem marks, Send to machine (DNC folder).
- Library by customer with reference photos, update-from-drawing, nesting with tethers.
- Machine settings viewer/editor for the old Machine Tools settings file (Hotwire8700.dbi).
- 3D Build modeller, 3D viewer, 3D Print slicer (Cura engine bundled in the desktop app).

## Known limits
- The Windows build is unsigned (SmartScreen warning).
- Tested in a browser and with automated tests; not yet tested on real Windows/Linux installs or on a live cutter.
- No live machine control. Controller commands export is a draft.
- The desktop app does not run on Windows XP.

## Files
- `CloudsCAD.exe` Windows portable
- `CloudsCAD-Linux.tar.gz` Linux
- `clouds-cad.html` single file, opens in any browser, works offline
