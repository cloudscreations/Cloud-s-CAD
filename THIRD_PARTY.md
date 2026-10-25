# Third-party software

Cloud's CAD is GPL v3. It includes the following open-source components, unmodified, under their own licenses. Their notices stay with them in the packages.

| Component | Version | License | Used for |
|---|---|---|---|
| [three.js](https://threejs.org) | 0.186.1 | MIT | 3D viewing |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | 0.0.18 / 0.9.16 | MIT | Join / Cut / Overlap in 3D Shapes |
| [Manifold](https://github.com/elalish/manifold) (manifold-3d, WebAssembly) | 3.4.1 | Apache-2.0 | Solid modelling: round, hollow, offset, holes, revolve, sweep, loft |
| [Rapier](https://rapier.rs) (@dimforge/rapier3d-compat, WebAssembly) | 0.21.0 | Apache-2.0 | Physics tab |
| [LibreDWG](https://www.gnu.org/software/libredwg/) via @mlightcad/libredwg-web (WebAssembly) | 0.7.15 | GPL-3.0 | Reading DWG files |
| [dxf-parser](https://github.com/gdsestimating/dxf-parser) | 1.1.2 | MIT | Reading DXF files |
| [Clipper](https://sourceforge.net/projects/jsclipper/) (clipper-lib) | 6.4.2 | Boost Software License | Polygon offsets and clean-up |
| [mdb-reader](https://github.com/andipaetzold/mdb-reader) | 3.2.0 | MIT | Reading the controller settings file (Hotwire8700.dbi) |
| [buffer](https://github.com/feross/buffer) | 6.0.3 | MIT | Browser shim |
| [Electron](https://www.electronjs.org) | 45.0.0 | MIT | Desktop (Windows/Linux) app |
| [cura-wasm](https://github.com/Cloud-Technologies-LLC/CuraWASM) and definitions | 1.5.2 / 1.5.1 | MIT, LGPL-3.0 and AGPL-3.0 (see its package) | Optional bundled 3D-print slicer (desktop app only) |

Inspiration only (no code copied): FreeCAD, LibreCAD, Blender, Fusion 360, Kovac.

To regenerate this list: `cd web && npm ls --all` and check each package's `license` field.
