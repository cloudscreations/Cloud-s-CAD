# Cloud's CAD Architecture (draft)

## Decision 1: Base
| Option | Pros | Cons |
|---|---|---|
| **Fork FreeCAD** | 3D parametric, CAM workbench, Python scripting already exist; LGPL core | Large codebase, steep learning curve, UI is complex |
| **New app on OpenCASCADE** | Clean, focused UI; full control | Much more to build; slower to first release |
| **FreeCAD workbench/plugin first** | Fastest path to something usable; low risk | Tied to FreeCAD's UI |

**Recommendation:** Start as a FreeCAD workbench (Python) for Phases 1-3 to validate hotwire output quickly. Decide later whether to spin out a standalone app.

## Layers
1. **Geometry kernel:** OpenCASCADE (via FreeCAD). 2D profile logic in Python.
2. **File I/O:** DXF (ezdxf), STEP/IGES/STL (OpenCASCADE), SVG, G-code parser.
3. **Toolpath engine:** Pluggable generators (hotwire, 3D print, mill/route).
4. **Post-processors:** One small module per controller (Marlin, Klipper, GRBL, LinuxCNC, hotwire).
5. **Machine link:** Serial/USB sender plus OctoPrint and Moonraker network clients.
6. **UI:** FreeCAD workbench first; standalone Qt UI later if needed.
7. **Plugin API:** Python entry points for new importers, toolpaths, and posts.

## Hotwire specifics (Phase 2)
- Two-axis (or four-axis, if the machine has it) wire path from a 2D profile
- Kerf/wire-offset compensation, wire heat/speed settings
- Controller format still unknown. Need: machine make/controller, how files are loaded today (G-code? proprietary?), and sample files.

## Licensing
- Project: GPL v3.
- Allowed: GPL/LGPL/MIT/BSD dependencies. Keep notices in THIRD_PARTY_LICENSES.md.
- Check each library before adding. Avoid anything proprietary or license-restricted.

## Safety
- Every sender enforces machine limits and has a visible stop control.
- Simulate before running; warn on out-of-bounds moves.
- Test post-processors on cheap material before real jobs.
