# Cloud's CAD

A free, open-source CAD/CAM app for everyone: draw, design, and send the result straight to your machine. Built for makers, small shops, and anyone tired of paying for software.

**Status:** v0.1.0 beta. Works in a browser and as a desktop app. Not yet tested on real Windows/Mac/phone installs or on a live machine controller.
**License:** GPL v3 (free to use, modify, and share; derivatives stay open)

## Goals
- One app from drawing to cutting or printing
- Opens and saves common formats (DXF, STEP, STL, SVG, G-code) so it works with BobCAD and other CAD programs
- Talks directly to 3D printers and CNC machines
- First-class hotwire foam cutting support (rare in free software)
- Easy to learn, with a plugin system so the community can extend it

## Machine support (planned)
| Machine type | Controller / firmware | Connection |
|---|---|---|
| 3D printers | Marlin, Klipper | USB serial, OctoPrint, Moonraker |
| CNC routers/mills | GRBL, LinuxCNC | USB serial, network |
| Hotwire foam cutters | TBD (depends on controller) | TBD |

## Interoperability rules
- Compatibility with other programs (including BobCAD) goes through open/published formats and files you export yourself.
- No decompiling, cracking, or copying proprietary code, assets, or branding.
- Third-party code is used only under compatible licenses, with notices kept intact.

## Built on
Open-source foundations such as FreeCAD, OpenCASCADE, LibreCAD, and Blender ideas/code where license-compatible. Credit to all original authors.

## Contributing
Not open yet. Planned: issues, a `CONTRIBUTING.md`, and a plugin guide once Phase 1 ships.

## 3D Build (new): a simple Blender-style modeller
Open the **3D Build** tab. Add a cube, sphere, cylinder, cone, torus, wedge or plane, then move, turn and resize with the gizmo (keys G, R, S) or type exact numbers. **Join**, **Cut** and **Overlap** combine two shapes (click one, Shift+click the other). Mirror, make rows of copies, and Undo/Redo. **Tab** enters edit mode: pick points or faces, press **E** to extrude a face and drag the arrow, or split faces smaller. Send the result to the 3D tab (then 3D Print) or save STL/OBJ. Not a full Blender: no sculpting, bevel, loop cuts, materials or animation yet.

## 3D printing (new)
Open the **3D Print** tab with any 3D model. Built-in slicer (walls, top/bottom skins, infill, skirt/brim, supports, retraction) with a layer preview, G-code export, and direct printer control:
- **USB** (Marlin-style firmware): Connect, preheat, jog, start, pause, cancel, emergency stop.
- **Network** (Klipper/Moonraker or OctoPrint): upload and start. Needs the desktop app (browsers block these calls).
Limits: basic slicer (no bridging, tree supports, gyroid, ironing); not tested on real printers yet, so watch the first layer. Bambu Lab printers are not supported (use Bambu Studio).
- **Cura engine built in (desktop app, default):** CuraEngine compiled to WebAssembly (AGPL-3.0) is bundled, so you get a real slicer with supports, bridging and tuned walls and nothing to install. The browser-only page uses the basic slicer.
- **PrusaSlicer (optional, desktop app):** install [PrusaSlicer](https://www.prusa3d.com/prusaslicer/) (free, AGPL). Cloud's CAD finds it, sends your model and settings to it, and previews and sends the result. Nothing is bundled or downloaded. SuperSlicer should work the same way (untested). OrcaSlicer and Cura use different command lines and are not connected yet.

## Shop tools (new)
- **Library by customer:** save each customer's profiles under their name, filter the library by customer (or see them grouped), and use "Save every separate piece as its own profile" when a customer sends several styles in one file. Export just one customer if you want to send or back up only theirs.
- **Dimensions**: Dimension, Angle and Radius tools leave measurements on the drawing (saved with the project and printed on the drawing sheet; Clear dims removes them). Reverse flips cut direction; Length and area reads out the selection.
- **Reference pictures:** attach a photo or screenshot to a profile (Add photo, Ctrl+V paste, drag and drop, or the camera on a phone), or press "Snip from drawing" to save a clean picture of the drawing with its size. Click any card to see the picture large next to the drawing. Pictures travel with Export library.
- **Update a saved profile:** Open it from the Library, make your changes, go back to the Library tab and press "Update ... with the drawing". The name, customer, notes and picture stay. (Edit on a card still changes just the text, and has a box to replace the shape too.)
- **Machine settings:** in the Machine tab, open the controller settings file from the old Machine Tools suite (Hotwire8700.dbi). See every setting in plain words (table size, speeds, the nine cutting-material presets), edit the safe ones (the dangerous ones are locked until you unlock them), compare two files, save a list of changes and print a settings sheet. It can also save your changes as the controller's own text commands (draft). It does not send anything to the controller yet.
- **Send to machine:** in the Machine tab, choose the folder your DNC program watches (for example C:\CODE) once, then press Send to machine and the .tap lands there and shows on the pendant. It asks before replacing a file with the same name. Desktop app: plain folder; Chrome/Edge: asks once and remembers; other browsers just download.
- **Workstations:** open several drawings at once in the tab bar under the header (+ New, Duplicate, double-click to rename). Copy pieces in one and Paste into another (Ctrl+C / Ctrl+V; units convert). All of them are restored when you reopen the app.
- **Add drawing...** puts a second file into the open drawing (converts inches/mm).
- **Clean up the file** removes duplicate, overlapping and tiny loose pieces and closes small gaps. Files whose size looks wrong for their units trigger a question.
- **Mirror + join** turns a half profile into one closed outline. **Smooth** turns jagged traced lines into smooth curves and keeps corners.
- **Nest in a foam block** lines closed profiles up in a row inside a block you size, then joins them with thin in-and-out tether lines so the wire follows one path (top half, then the other half, or one closed loop).
- **Library** tab: save profiles with customer/tags/notes, search, insert/open, find the closest match to the open drawing (any size, turned or flipped), export/import a backup.
- **History** keeps earlier versions of your drawing automatically; Undo goes back 5000 steps and opening a file no longer erases it.


## Download
Get the latest build from the **Releases** page (Windows `.exe`, Mac zips, Linux, a single-file `clouds-cad.html` that runs in any browser, and a phone/PWA zip). The Windows and Mac builds are **unsigned**, so Windows SmartScreen or macOS Gatekeeper will warn you the first time.

## Build it yourself
Needs Node.js 20+.
```
cd web
npm install
npm test            # unit + UI tests
node build.mjs      # writes ../clouds-cad.html and ../mobile/
```
Desktop app (Electron):
```
cp clouds-cad.html desktop/app.html
cd desktop
npm install
npx electron .                                  # run it
npx electron-builder --config eb.json --win portable   # Windows exe
```

## Not done yet / honest limits
- No live connection to a machine controller yet. "Send to machine" copies the .tap into the folder your DNC program watches.
- "Save as controller commands" in Machine settings is a draft and has not been checked against a real controller.
- Drawing dimensions are not constraints (they do not drive the shape). Parametric constraints are on the roadmap.
- Bambu Lab printers are not supported.

## Contributing
Issues and pull requests are welcome. Run `npm test` in `web/` before sending a change, and keep the interface simple: few buttons, plain words.
