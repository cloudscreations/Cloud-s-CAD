# Cloud's CAD Roadmap

Each phase ships something usable before the next one starts.

## Phase 0: Foundation (now)
- [x] README, goals, interoperability rules
- [ ] Choose base: fork FreeCAD vs. standalone app on OpenCASCADE (see ARCHITECTURE.md)
- [ ] Create GitHub repo, GPL v3 LICENSE, CONTRIBUTING.md, THIRD_PARTY_LICENSES.md
- [ ] Set up build + CI on Windows and Linux
- [ ] Check every dependency's license for GPL v3 compatibility

## Phase 1: File compatibility
- [ ] Import/export DXF (2D profiles)
- [ ] Import/export STEP, STL, SVG
- [ ] G-code viewer (read and preview toolpaths)
- [ ] Test against DXF/STEP files exported from BobCAD and other CAD programs

## Phase 2: 2D profile tools + hotwire output (first real milestone)
- [ ] Profile cleanup: close gaps, remove duplicates, smooth, offset
- [ ] Trace/match a profile from an image or measured points
- [ ] Hotwire toolpath generator (kerf compensation, wire angle, entry/exit)
- [ ] Post-processor for the hotwire controller (format TBD)
- [ ] Simulate the cut before sending

## Phase 3: Machine connectivity
- [ ] Serial/USB sender with pause, resume, and emergency stop
- [ ] GRBL and LinuxCNC post-processors
- [x] 3D printing: built-in slicer, CuraEngine (WASM) in the desktop app, optional PrusaSlicer, USB (Marlin) and Moonraker/OctoPrint control (needs testing on real printers)
- [ ] OrcaSlicer connection, per-printer start/end G-code, multiple parts on one bed
- [ ] Machine profiles (bed size, limits, controller type)

## Phase 4: General CAM
- [ ] 2.5D milling/routing: pocket, profile, drill
- [ ] Tool library and feeds/speeds
- [ ] Toolpath simulation and collision warnings

## Phase 5: Full 3D modeling and polish
- [ ] Parametric 3D modeling
- [ ] Assemblies, nesting, drawings
- [ ] Plugin API + docs so the community can extend it
- [ ] Packaged installers

## Ground rules
- Compatibility only through open formats and files you create yourself. No decompiling or copying proprietary software.
- Credit all upstream authors and keep their license notices.
- Test on real machines before calling a post-processor "supported."
- Safety first: any code that moves a machine needs limits checks and a clear stop control.

## Next
- STEP import/export (needs OpenCASCADE, large)
- True NURBS surfaces
- Parametric 2D constraints, layers
- Direct send to the hotwire controller (needs network capture)
- GRBL / CNC router output
