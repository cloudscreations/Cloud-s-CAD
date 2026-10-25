# Provenance: how things were learned

This file records where non-obvious knowledge came from, so anyone can check that Cloud's CAD did not copy or break anything.

## Hotwire G-code (.tap)
- The dialect (header `M90`, `G74`, `M11`, incremental `G91` moves, `G01/G02/G03`) was matched against `.tap` files the shop already had, made by its previous CAM program. Cloud's CAD writes its own code from scratch and does not contain any of that program's code, assets or branding.

## Machine controller notes (MACHINE-NOTES.md)
- Read from files copied off the shop PC from the old "Machine Tools Suite" (JobServer, logs, help books, the settings database `Hotwire8700.dbi`).
- Files were read only: never run, patched or decompiled into reusable code. The controller's network ports and message names were learned by reading strings in a disassembly of the old network control, purely to understand how the existing machine talks. Those findings are marked as leads, not facts, in MACHINE-NOTES.md.
- Cloud's CAD does **not** send commands to the controller. It writes a `.tap` file into the folder the shop's own DNC program already watches. The "Test the connection" feature only pings and checks open ports.

## DWG / DXF
- DWG is read with LibreDWG (GPL-3.0) compiled to WebAssembly. DXF is read with dxf-parser. Nothing is reverse engineered by this project.

## 3D, sheet metal and physics
- Solid operations use the Manifold library. Physics uses Rapier. Sheet-metal flat length uses the standard bend-allowance formula (bend allowance = angle × (inside radius + K × thickness)) with a K-factor chosen by material. No CAD vendor's code or tables were used.

## AI assistance
- Most code was written with an AI coding assistant (Claude) directed and tested by the project owner. Automated tests cover the geometry, nesting, G-code simulation and the main UI flows; real-machine testing has been done on one ExtraTech hotwire machine.
