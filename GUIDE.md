# Getting started

## 1. Open it
- **Windows:** run `CloudsCAD.exe` (portable, nothing to install). Double-clicking a `.dwg` or `.dxf` can open it directly.
- **Any browser:** open `clouds-cad.html`. Works offline.

## 2. Hotwire foam cutting in 5 steps
1. **Draw (2D):** open a DWG/DXF (Open file…) or draw. The outline must be closed. Red circles mark gaps; use *Clean up the file* to close small ones.
2. **Machine tab:** pick material and units. Press *Play the cut* to watch the wire path.
3. Optional: **Nest in a foam block** to fit several profiles into one block with tether lines.
4. Press **Send to machine** (choose your DNC folder once, for example `C:\CODE`). The `.tap` shows on the machine pendant.
5. Run it.

### The `.tap` format
Plain text with incremental moves (`G91`), a header of `M90`, `G74`, `M11`, then `G01 X.. Y..` / `G02 / G03` arcs. The exact dialect Cloud's CAD writes was matched against files from the original BobCAD post.

### Machine setup notes
See [MACHINE-NOTES.md](MACHINE-NOTES.md): the ExtraTech controller (192.168.50.2), the JobServer folder watch, controller ports found by reading the old software, and how to test the connection from the Machine tab (read-only).

## 3. 3D
- **3D Model tab → Make a solid:** extrude, spin, sweep along an open line, or loft two outlines. Then add steps (round, hollow, screw hole…). Change any number in the list to rebuild. *Undo last change* steps back.
- **Check it for 3D printing:** red = too thin, orange = needs supports. *Repair* seals small gaps. *Lay it the best way* picks the orientation with least support.
- **Fill the print bed:** copies laid out on your bed size (set in the 3D Print tab).
- Export STL, or open the 3D Print tab to slice.

## 4. Sheet metal
Draw one open line in the Draw tab down the middle of the metal (an L is 2 lines). Sheet metal tab → *Use the line in my drawing*, set thickness, width, radius, material. *Send flat pattern to my drawing* gives the outline plus a line down each bend.

## 5. Physics
Physics tab → pick *My model / Box / Ball*, tilt the floor, press Play. It tells you whether parts tipped or slid. Parts are treated as solid convex shapes.

## Tips
- Undo/Redo are in the header; **Q** deletes the selection; History brings back earlier versions.
- Everything stays on your computer.

- Press `/` or Ctrl+K to search for any command by name.
- In the 3D tab, slow steps run in the background; press **Stop** if one takes too long. Very detailed curved models (over about 8,000 triangles) are refused for rounding/hollowing on purpose.
