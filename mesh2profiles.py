#!/usr/bin/env python3
"""
mesh2profiles - Cloud's CAD, step 2.

Import a 3D model from ANY source (AI generator, scan, download, other CAD) and turn it
into 2D profiles a hotwire can cut. Output is DXF, which feeds straight into dxf2hotwire.py.

Formats: STL, OBJ, PLY, GLB/GLTF, 3MF, OFF (anything trimesh can read).

License: GPL v3

Examples:
  python3 mesh2profiles.py model.glb --size z=300 --views front,side,top -o out/model
  python3 mesh2profiles.py model.stl --size x=88.9 --section z=50 -o out/slice
  python3 mesh2profiles.py model.obj --info          # just print the size
Then:
  python3 dxf2hotwire.py out/model_front.dxf --units-in mm --units-out in
"""
import argparse
import os
import sys

import ezdxf
import numpy as np
import shapely
import trimesh
from shapely.geometry import MultiPolygon, Polygon

AX = {"x": 0, "y": 1, "z": 2}
# view name -> (horizontal axis, vertical axis) of the 2D drawing
VIEWS = {"front": (0, 2), "side": (1, 2), "top": (0, 1)}


def load_mesh(path):
    scene = trimesh.load(path, force="scene")
    meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    if not meshes:
        sys.exit("No mesh geometry found in that file.")
    # bake scene transforms so multi-part files come out in the right place
    mesh = scene.to_geometry() if hasattr(scene, "to_geometry") else scene.dump(concatenate=True)
    if isinstance(mesh, list):
        mesh = trimesh.util.concatenate(mesh)
    return mesh


def silhouette(mesh, h, v):
    """Outline of the model as seen from one direction (union of all projected triangles)."""
    tris = mesh.triangles[:, :, [h, v]]
    area = 0.5 * np.abs(
        (tris[:, 1, 0] - tris[:, 0, 0]) * (tris[:, 2, 1] - tris[:, 0, 1])
        - (tris[:, 2, 0] - tris[:, 0, 0]) * (tris[:, 1, 1] - tris[:, 0, 1])
    )
    tris = tris[area > 1e-12]
    polys = shapely.polygons(tris)
    return shapely.union_all(polys).buffer(0)


def section(mesh, axis, value, h, v):
    """Cross-section outline where a plane through the model at axis=value cuts it."""
    normal = np.zeros(3)
    normal[axis] = 1
    origin = np.zeros(3)
    origin[axis] = value
    path = mesh.section(plane_origin=origin, plane_normal=normal)
    if path is None:
        sys.exit(f"Plane at {value} misses the model.")
    polys = []
    for line in path.discrete:
        pts = np.asarray(line)[:, [h, v]]
        if len(pts) >= 4 and np.allclose(pts[0], pts[-1]):
            polys.append(Polygon(pts))
    if not polys:
        sys.exit("Cross-section has no closed outline (model may not be watertight).")
    # even-odd combine so holes inside outlines stay holes
    result = polys[0]
    for p in polys[1:]:
        result = result.symmetric_difference(p)
    return result.buffer(0)


def write_dxf(geom, path, simplify):
    if simplify > 0:
        geom = geom.simplify(simplify, preserve_topology=True)
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4  # millimetres
    msp = doc.modelspace()
    n = 0
    for p in polys:
        if p.is_empty:
            continue
        for ring in [p.exterior, *p.interiors]:
            msp.add_lwpolyline(list(ring.coords)[:-1], format="xy", close=True)
            n += 1
    doc.saveas(path)
    x0, y0, x1, y1 = geom.bounds
    return n, x1 - x0, y1 - y0


def main():
    ap = argparse.ArgumentParser(description="3D model to hotwire-ready 2D profiles")
    ap.add_argument("model")
    ap.add_argument("-o", "--out", default=None, help="output prefix (default: model name)")
    ap.add_argument("--size", help="scale so one axis has a known size in mm, e.g. z=300")
    ap.add_argument("--views", default="", help="comma list of: front,side,top")
    ap.add_argument("--section", help="cross-section at axis=position (mm, after scaling), e.g. z=50")
    ap.add_argument("--up", choices=["x", "y", "z"], default="z", help="axis that is 'up' in the model")
    ap.add_argument("--simplify", type=float, default=0.05, help="outline simplification tolerance (mm)")
    ap.add_argument("--info", action="store_true", help="print size and exit")
    a = ap.parse_args()

    mesh = load_mesh(a.model)
    # Many AI/web models are Y-up (glTF). Rotate so the chosen axis becomes Z.
    if a.up == "y":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    elif a.up == "x":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0]))

    ext = mesh.extents
    print(f"Model: {len(mesh.faces)} triangles, watertight={mesh.is_watertight}")
    print(f"Raw size (model units): x={ext[0]:.4f} y={ext[1]:.4f} z={ext[2]:.4f}")

    if a.size:
        axn, val = a.size.split("=")
        factor = float(val) / ext[AX[axn.lower()]]
        mesh.apply_scale(factor)
        print(f"Scaled x{factor:.6f} so {axn} = {val} mm")
    else:
        print("WARNING: no --size given. AI/web models have arbitrary units; set one real dimension with --size.")

    mesh.apply_translation(-mesh.bounds[0])  # sit at origin
    ext = mesh.extents
    print(f"Size (mm): x={ext[0]:.3f} y={ext[1]:.3f} z={ext[2]:.3f}")
    if a.info:
        return

    prefix = a.out or os.path.splitext(a.model)[0]
    os.makedirs(os.path.dirname(prefix) or ".", exist_ok=True)

    for name in [v for v in a.views.split(",") if v]:
        if name not in VIEWS:
            sys.exit(f"Unknown view '{name}'. Use front, side, top.")
        h, v = VIEWS[name]
        out = f"{prefix}_{name}.dxf"
        n, w, ht = write_dxf(silhouette(mesh, h, v), out, a.simplify)
        print(f"{name:5s}: {w:.2f} x {ht:.2f} mm, {n} outline(s) -> {out}")

    if a.section:
        axn, val = a.section.split("=")
        axis = AX[axn.lower()]
        h, v = [i for i in range(3) if i != axis]
        out = f"{prefix}_section_{axn}{val}.dxf"
        n, w, ht = write_dxf(section(mesh, axis, float(val), h, v), out, a.simplify)
        print(f"section {axn}={val}: {w:.2f} x {ht:.2f} mm, {n} outline(s) -> {out}")


if __name__ == "__main__":
    main()
