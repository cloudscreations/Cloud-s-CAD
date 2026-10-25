// Cloud's CAD - simple 3D modeller (a small Blender-style tool). License: GPL v3
// Object mode: add shapes, move / turn / resize with a gizmo, join, subtract, intersect, mirror, array, duplicate.
// Edit mode: pick points or faces, move them, extrude faces, subdivide, delete.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ask } from './ask.js';
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

// ---------- pure mesh helpers (no DOM, tested in node) ----------
export function weld(geo) {
  const g = geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const w = mergeVertices(g, 1e-5);
  // drop triangles that collapsed (poles of a sphere, etc.)
  const idx = w.index.array, keep = [];
  for (let i = 0; i < idx.length; i += 3) if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  w.setIndex(keep);
  w.computeVertexNormals();
  return w;
}
export function makeShape(kind, s = 2) {
  let g;
  switch (kind) {
    case 'cube': g = new THREE.BoxGeometry(s, s, s); break;
    case 'sphere': g = new THREE.SphereGeometry(s / 2, 32, 20); g.rotateX(Math.PI / 2); break;
    case 'cylinder': g = new THREE.CylinderGeometry(s / 2, s / 2, s, 32); g.rotateX(Math.PI / 2); break;
    case 'cone': g = new THREE.ConeGeometry(s / 2, s, 32); g.rotateX(Math.PI / 2); break;
    case 'torus': g = new THREE.TorusGeometry(s / 2, s / 6, 16, 40); break;
    case 'wedge': { // right-angle ramp, handy for crown and corner blocks
      const h = s / 2;
      const P = [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, -h, h], [-h, h, h]];
      const F = [[0, 3, 2], [0, 2, 1], [0, 4, 5], [0, 5, 3], [0, 1, 4], [3, 5, 2], [1, 2, 5], [1, 5, 4]];
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(F.flatMap((f) => f.flatMap((i) => P[i])), 3));
      break;
    }
    case 'plane': g = new THREE.BoxGeometry(s, s, s / 20); break;
    default: throw new Error('unknown shape ' + kind);
  }
  return weld(g);
}
// Triangles that touch each other on an edge and face the same way = one "face" as a person sees it
export function faceGroup(index, pos, tri, cosTol = 0.9995) {
  const nT = index.length / 3, nrm = [];
  const N = (t) => {
    if (nrm[t]) return nrm[t];
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z) || 1;
    return (nrm[t] = [x / l, y / l, z / l]);
  };
  const edgeMap = new Map(); const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const key = ek(index[t * 3 + k], index[t * 3 + (k + 1) % 3]); (edgeMap.get(key) || edgeMap.set(key, []).get(key)).push(t); }
  const seen = new Set([tri]), q = [tri];
  while (q.length) {
    const t = q.pop(), n0 = N(t);
    for (let k = 0; k < 3; k++) for (const u of edgeMap.get(ek(index[t * 3 + k], index[t * 3 + (k + 1) % 3])) || []) {
      if (seen.has(u)) continue; const n1 = N(u);
      if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] >= cosTol) { seen.add(u); q.push(u); }
    }
  }
  return [...seen];
}
// Extrude the given triangles: they get new points, and side walls join them to the old edge.
// Returns { pos, index, newVerts } (plain arrays)
export function extrudeFaces(posIn, indexIn, tris) {
  const pos = Array.from(posIn), index = Array.from(indexIn), set = new Set(tris);
  const map = new Map(); const nv = [];
  const dup = (i) => { if (!map.has(i)) { const n = pos.length / 3; pos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); map.set(i, n); nv.push(n); } return map.get(i); };
  const cnt = new Map(), dir = []; const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  for (const t of tris) for (let k = 0; k < 3; k++) { const a = index[t * 3 + k], b = index[t * 3 + (k + 1) % 3], key = ek(a, b); cnt.set(key, (cnt.get(key) || 0) + 1); dir.push([a, b, key]); }
  const walls = [];
  for (const [a, b, key] of dir) if (cnt.get(key) === 1) walls.push([a, b]);
  for (const t of set) for (let k = 0; k < 3; k++) index[t * 3 + k] = dup(index[t * 3 + k]);
  for (const [a, b] of walls) { const a2 = map.get(a), b2 = map.get(b); index.push(a, b, b2, a, b2, a2); }
  return { pos, index, newVerts: nv };
}
export function subdivide(posIn, indexIn) {
  const pos = Array.from(posIn), out = [], mid = new Map();
  const m = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (mid.has(k)) return mid.get(k); const n = pos.length / 3; pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2); mid.set(k, n); return n; };
  for (let t = 0; t < indexIn.length; t += 3) { const a = indexIn[t], b = indexIn[t + 1], c = indexIn[t + 2], ab = m(a, b), bc = m(b, c), ca = m(c, a); out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca); }
  return { pos, index: out };
}
export function deleteVerts(posIn, indexIn, verts) {
  const dead = new Set(verts), out = [];
  for (let t = 0; t < indexIn.length; t += 3) if (!dead.has(indexIn[t]) && !dead.has(indexIn[t + 1]) && !dead.has(indexIn[t + 2])) out.push(indexIn[t], indexIn[t + 1], indexIn[t + 2]);
  // compact unused points
  const used = new Map(), pos = [], idx = [];
  for (const i of out) { if (!used.has(i)) { used.set(i, pos.length / 3); pos.push(posIn[i * 3], posIn[i * 3 + 1], posIn[i * 3 + 2]); } idx.push(used.get(i)); }
  return { pos, index: idx };
}

// Boolean results can leave "T-junctions" (a long edge on one side, several short ones on the other). Sew them shut.
export function fixTJunctions(posIn, indexIn, tol = 1e-5) {
  const pos = Array.from(posIn); let index = Array.from(indexIn);
  for (let pass = 0; pass < 4; pass++) {
    const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a), cnt = new Map();
    for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) { const key = ek(index[t + k], index[t + (k + 1) % 3]); cnt.set(key, (cnt.get(key) || 0) + 1); }
    const bv = new Set(), bad = [];
    for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) { const a = index[t + k], b = index[t + (k + 1) % 3]; if (cnt.get(ek(a, b)) === 1) { bv.add(a); bv.add(b); bad.push([t, k, a, b]); } }
    if (!bad.length) break;
    const verts = [...bv], split = new Map(); let changed = false;
    for (const [t, k, a, b] of bad) {
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2], dx = pos[b * 3] - ax, dy = pos[b * 3 + 1] - ay, dz = pos[b * 3 + 2] - az, L2 = dx * dx + dy * dy + dz * dz; if (L2 < 1e-18) continue;
      const on = [];
      for (const v of verts) {
        if (v === a || v === b) continue; const px = pos[v * 3] - ax, py = pos[v * 3 + 1] - ay, pz = pos[v * 3 + 2] - az, u = (px * dx + py * dy + pz * dz) / L2;
        if (u <= 1e-6 || u >= 1 - 1e-6) continue; const qx = px - dx * u, qy = py - dy * u, qz = pz - dz * u;
        if (qx * qx + qy * qy + qz * qz <= tol * tol) on.push([u, v]);
      }
      if (on.length) { on.sort((x, y) => x[0] - y[0]); split.set(t, { k, a, b, list: on.map((x) => x[1]) }); changed = true; }
    }
    if (!changed) break;
    const out = [];
    for (let t = 0; t < index.length; t += 3) {
      const sp = split.get(t); if (!sp) { out.push(index[t], index[t + 1], index[t + 2]); continue; }
      const c = index[t + (sp.k + 2) % 3], chain = [sp.a, ...sp.list, sp.b];
      for (let i = 0; i + 1 < chain.length; i++) out.push(chain[i], chain[i + 1], c);
    }
    index = out;
  }
  return { pos, index };
}
// Is the mesh closed (every edge shared by exactly two triangles)? Needed for clean cuts and printing.
export function isClosed(index) {
  const c = new Map(); const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) { const key = ek(index[t + k], index[t + (k + 1) % 3]); c.set(key, (c.get(key) || 0) + 1); }
  for (const v of c.values()) if (v !== 2) return false;
  return true;
}

// ---------- the modeller ----------
const COLORS = [0x6aa3ff, 0xf5a524, 0x6fd08c, 0xd96ad9, 0xe86a6a, 0x5fd0d0];
export function createModeler(root, { onSend, onDownload, onToast, dark = true } = {}) {
  const view = root.querySelector('[data-m=view]'), side = root.querySelector('[data-m=side]');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  view.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
  camera.up.set(0, 0, 1); camera.position.set(6, -8, 5);
  const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(3, -5, 8); scene.add(dl);
  const grid = new THREE.GridHelper(40, 40, 0x5a6678, 0x2a3342); grid.rotation.x = Math.PI / 2; scene.add(grid);
  const setBg = (d) => { scene.background = new THREE.Color(d ? 0x0c0f14 : 0xeef1f5); };
  setBg(dark);
  const tc = new TransformControls(camera, renderer.domElement); scene.add(tc.getHelper());
  tc.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });

  const toast = (m) => onToast && onToast(m);
  let objs = [], nextId = 1, active = null, selected = new Set(), mode = 'object', snapOn = false, colorN = 0;
  const csg = new Evaluator(); csg.attributes = ['position', 'normal'];
  const undoS = [], redoS = [];

  // --- history ---
  const snap = () => objs.map((o) => ({ id: o.id, name: o.name, color: o.color, smooth: o.smooth, vis: o.mesh.visible, pos: Float32Array.from(o.mesh.geometry.attributes.position.array), idx: Uint32Array.from(o.mesh.geometry.index.array), m: o.mesh.matrix.toArray() }));
  function restore(s) {
    for (const o of objs) { scene.remove(o.mesh); o.mesh.geometry.dispose(); o.mesh.material.dispose(); }
    objs = s.map((d) => { const o = build(d.id, d.name, d.color, geoFrom(d.pos, d.idx)); o.smooth = d.smooth; o.mesh.material.flatShading = !d.smooth; o.mesh.visible = d.vis; o.mesh.matrix.fromArray(d.m); o.mesh.matrix.decompose(o.mesh.position, o.mesh.quaternion, o.mesh.scale); scene.add(o.mesh); return o; });
    selected = new Set([...selected].filter((id) => objs.some((o) => o.id === id)));
    active = objs.find((o) => o.id === (active && active.id)) || null; if (!active) selected.clear();
    leaveEdit(true); attach(); refreshUI();
  }
  const push = () => { undoS.push(snap()); if (undoS.length > 150) undoS.shift(); redoS.length = 0; };
  function undo() { if (!undoS.length) return; redoS.push(snap()); restore(undoS.pop()); }
  function redo() { if (!redoS.length) return; undoS.push(snap()); restore(redoS.pop()); }

  function geoFrom(pos, idx) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1)); g.computeVertexNormals(); return g; }
  function build(id, name, color, geo) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat); mesh.matrixAutoUpdate = true;
    return { id, name, color, smooth: false, mesh };
  }
  function add(kind, size = 2) {
    push();
    const o = build(nextId++, kind[0].toUpperCase() + kind.slice(1) + ' ' + (objs.length + 1), COLORS[colorN++ % COLORS.length], makeShape(kind, size));
    o.mesh.position.set(0, 0, kind === 'plane' ? size / 40 : size / 2);
    scene.add(o.mesh); objs.push(o); pick(o, false); refreshUI(); return o;
  }
  function addFromGeometry(geo, name, matrix) {
    const o = build(nextId++, name, COLORS[colorN++ % COLORS.length], geo);
    if (matrix) { o.mesh.matrix.copy(matrix); o.mesh.matrix.decompose(o.mesh.position, o.mesh.quaternion, o.mesh.scale); }
    scene.add(o.mesh); objs.push(o); return o;
  }

  // --- selection ---
  const outline = new THREE.BoxHelper(new THREE.Object3D(), 0xf5a524); outline.visible = false; scene.add(outline);
  function pick(o, add) {
    if (!o) { selected.clear(); active = null; } else if (add) { if (selected.has(o.id)) { selected.delete(o.id); active = objs.find((x) => selected.has(x.id)) || null; } else { selected.add(o.id); active = o; } } else { selected.clear(); selected.add(o.id); active = o; }
    attach(); refreshUI();
  }
  function attach() {
    tc.detach(); outline.visible = false;
    if (mode === 'object' && active) { tc.attach(active.mesh); outline.setFromObject(active.mesh); outline.visible = true; }
    if (mode === 'edit') attachPivot();
    for (const o of objs) o.mesh.material.emissive = new THREE.Color(selected.has(o.id) ? 0x2a1d00 : 0x000000);
  }
  tc.addEventListener('mouseDown', () => { if (mode === 'object') push(); else pushEditStart(); });
  tc.addEventListener('objectChange', () => { if (mode === 'object' && active) { outline.setFromObject(active.mesh); syncFields(); } else if (mode === 'edit') applyPivot(); });
  tc.addEventListener('mouseUp', () => { if (mode === 'edit') pivotBase = null; });

  // --- transforms ---
  const setGizmo = (m) => { tc.setMode(m); setActiveBtn(); };
  function setSnap(on) { snapOn = on; tc.setTranslationSnap(on ? 0.25 : null); tc.setRotationSnap(on ? Math.PI / 12 : null); tc.setScaleSnap(on ? 0.1 : null); }

  // --- object operations ---
  const worldGeo = (o) => { const g = o.mesh.geometry.clone(); o.mesh.updateMatrix(); g.applyMatrix4(o.mesh.matrix); return g; };
  function dupe() { if (!active) return; push(); const out = []; for (const o of objs.filter((x) => selected.has(x.id))) { const n = addFromGeometry(o.mesh.geometry.clone(), o.name + ' copy', o.mesh.matrix); n.mesh.position.x += 0.5; out.push(n); } selected = new Set(out.map((x) => x.id)); active = out[out.length - 1]; attach(); refreshUI(); }
  function del() { if (!selected.size) return; push(); for (const o of objs.filter((x) => selected.has(x.id))) { scene.remove(o.mesh); o.mesh.geometry.dispose(); } objs = objs.filter((o) => !selected.has(o.id)); selected.clear(); active = null; attach(); refreshUI(); }
  function twoSelected() { const l = objs.filter((o) => selected.has(o.id)); return l.length === 2 ? [l.find((o) => o === active) === l[0] ? l[1] : l[0], active] : null; }
  function boolean(op) {
    const pair = twoSelected();
    if (!pair) { toast('Pick two objects first: click one, then Shift+click the other. The first one you clicked is the one that gets cut (Subtract).'); return; }
    const [A, B] = pair; // A is the first one clicked, B is the active (last clicked)
    const bad = [A, B].filter((o) => !isClosed(o.mesh.geometry.index.array));
    if (bad.length) { toast(`"${bad[0].name}" has open edges (it is not a solid), so a cut may come out wrong. Undo and use Join if that happens.`); }
    push();
    const bA = new Brush(worldGeo(A)), bB = new Brush(worldGeo(B)); bA.updateMatrixWorld(); bB.updateMatrixWorld();
    const res = csg.evaluate(bA, bB, op === 'union' ? ADDITION : op === 'subtract' ? SUBTRACTION : INTERSECTION);
    const g0 = weld(res.geometry), fx = fixTJunctions(g0.attributes.position.array, g0.index.array), g = geoFrom(fx.pos, fx.index);
    if (!g.index.count) { undoS.pop(); toast('That left nothing. The two objects do not overlap (or one fully covers the other).'); return; }
    for (const o of [A, B]) { scene.remove(o.mesh); o.mesh.geometry.dispose(); }
    objs = objs.filter((o) => o !== A && o !== B);
    const n = addFromGeometry(g, op === 'union' ? 'Joined' : op === 'subtract' ? 'Cut' : 'Overlap');
    pick(n, false); toast(op === 'subtract' ? 'Cut done. The second object was used as the cutter.' : 'Done.');
  }
  function joinPlain() { // merge several objects into one without cutting them
    const l = objs.filter((o) => selected.has(o.id)); if (l.length < 2) { toast('Select two or more objects (Shift+click).'); return; }
    push(); const pos = [], idx = [];
    for (const o of l) { const g = worldGeo(o), p = g.attributes.position.array, base = pos.length / 3; pos.push(...p); for (const i of g.index.array) idx.push(i + base); }
    for (const o of l) { scene.remove(o.mesh); o.mesh.geometry.dispose(); } objs = objs.filter((o) => !selected.has(o.id));
    pick(addFromGeometry(geoFrom(pos, idx), 'Group'), false);
  }
  function mirror(axis) {
    if (!active) return; push();
    const g = worldGeo(active), p = g.attributes.position.array, idx = g.index.array, ax = 'xyz'.indexOf(axis);
    const pos = Array.from(p), n = p.length / 3, all = Array.from(idx);
    for (let i = 0; i < n; i++) { pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); pos[(n + i) * 3 + ax] *= -1; }
    for (let t = 0; t < idx.length; t += 3) all.push(idx[t] + n, idx[t + 2] + n, idx[t + 1] + n);
    const m = weld(geoFrom(pos, all)); // sewn on the mirror plane where points touch
    scene.remove(active.mesh); objs = objs.filter((o) => o !== active);
    pick(addFromGeometry(m, active.name + ' mirrored'), false);
    toast('Mirrored across the ' + axis.toUpperCase() + ' = 0 plane. Move the half so its edge sits on that plane to make one solid.');
  }
  function array(count, dx, dy, dz) {
    if (!active || count < 2) return; push(); const src = active, out = [src];
    for (let i = 1; i < count; i++) { const n = addFromGeometry(src.mesh.geometry.clone(), src.name + ' ' + (i + 1), src.mesh.matrix); n.mesh.position.add(new THREE.Vector3(dx * i, dy * i, dz * i)); out.push(n); }
    selected = new Set(out.map((o) => o.id)); attach(); refreshUI();
  }
  function setSmooth(v) { if (!active) return; active.smooth = v; active.mesh.material.flatShading = !v; active.mesh.material.needsUpdate = true; }
  function subdivideObj() { if (!active) return; push(); const g = active.mesh.geometry, r = subdivide(g.attributes.position.array, g.index.array); active.mesh.geometry.dispose(); active.mesh.geometry = geoFrom(r.pos, r.index); if (mode === 'edit') { clearSel(); rebuildEdit(); attach(); } refreshUI(); }

  // --- numbers panel ---
  function syncFields() {
    const f = (n) => side.querySelector(`[data-f=${n}]`); if (!f('px')) return;
    if (!active) { for (const n of ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz']) f(n).value = ''; return; }
    const m = active.mesh, e = new THREE.Euler().setFromQuaternion(m.quaternion, 'XYZ'), r = (v) => +v.toFixed(4);
    f('px').value = r(m.position.x); f('py').value = r(m.position.y); f('pz').value = r(m.position.z);
    f('rx').value = r(THREE.MathUtils.radToDeg(e.x)); f('ry').value = r(THREE.MathUtils.radToDeg(e.y)); f('rz').value = r(THREE.MathUtils.radToDeg(e.z));
    const bb = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    f('sx').value = r(bb.x); f('sy').value = r(bb.y); f('sz').value = r(bb.z);
  }
  function applyField(n, v) {
    if (!active || !Number.isFinite(v)) return; push(); const m = active.mesh;
    if (n[0] === 'p') m.position['xyz'['xyz'.indexOf(n[1])]] = v;
    else if (n[0] === 'r') { const e = new THREE.Euler().setFromQuaternion(m.quaternion, 'XYZ'); e['xyz'[ 'xyz'.indexOf(n[1])]] = THREE.MathUtils.degToRad(v); m.quaternion.setFromEuler(e); }
    else if (n[0] === 's' && v > 0) { const ax = 'xyz'.indexOf(n[1]); const cur = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).toArray()[ax]; if (cur > 1e-9) { const k = v / cur; const s = m.scale.toArray(); s[ax] *= k; m.scale.fromArray(s); } }
    outline.setFromObject(m); syncFields();
  }

  // --- edit mode ---
  let editObj = null, selV = new Set(), selTris = new Set(), sub = 'face', helpers = [], pivot = new THREE.Object3D(), pivotBase = null, editBase = null;
  scene.add(pivot);
  function enterEdit() { if (!active) { toast('Click an object first, then press Tab.'); return; } mode = 'edit'; editObj = active; tc.detach(); outline.visible = false; clearSel(); rebuildEdit(); attach(); setModeUI(); }
  function leaveEdit(silent) { if (mode !== 'edit' && !silent) return; mode = 'object'; clearHelpers(); selV.clear(); selTris.clear(); editObj = null; if (!silent) { attach(); setModeUI(); syncFields(); } }
  function clearHelpers() { for (const h of helpers) { scene.remove(h); h.geometry && h.geometry.dispose(); } helpers = []; }
  function clearSel() { selV.clear(); selTris.clear(); }
  function rebuildEdit() {
    clearHelpers(); if (!editObj) return; const m = editObj.mesh, g = m.geometry, p = g.attributes.position.array;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), new THREE.LineBasicMaterial({ color: 0x0b1220, depthTest: true })); edges.matrix = m.matrixWorld; edges.matrixAutoUpdate = false; edges.renderOrder = 1;
    scene.add(edges); helpers.push(edges);
    if (selTris.size) { const pos = []; for (const t of selTris) for (let k = 0; k < 3; k++) { const i = g.index.array[t * 3 + k] * 3; pos.push(p[i], p[i + 1], p[i + 2]); } const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xf5a524, transparent: true, opacity: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false })); sm.matrix = m.matrixWorld; sm.matrixAutoUpdate = false; scene.add(sm); helpers.push(sm); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(p, 3)); const cols = new Float32Array(p.length); for (let i = 0; i < p.length / 3; i++) { const s = selV.has(i); cols[i * 3] = s ? 1 : 0.65; cols[i * 3 + 1] = s ? 0.65 : 0.7; cols[i * 3 + 2] = s ? 0.1 : 0.75; } pg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false })); pts.matrix = m.matrixWorld; pts.matrixAutoUpdate = false; pts.renderOrder = 3; scene.add(pts); helpers.push(pts);
  }
  function attachPivot() {
    tc.detach(); if (mode !== 'edit' || !selV.size) return;
    const m = editObj.mesh, p = m.geometry.attributes.position.array, c = new THREE.Vector3(); for (const i of selV) c.add(new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    c.multiplyScalar(1 / selV.size).applyMatrix4(m.matrixWorld); pivot.position.copy(c); pivot.quaternion.identity(); pivot.scale.set(1, 1, 1);
    tc.setSpace('world');
    if (selTris.size) { // line the blue arrow up with the face, so pulling it out is one drag
      const idx = m.geometry.index.array, n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
      for (const t of selTris) { a.fromArray(p, idx[t * 3] * 3); b.fromArray(p, idx[t * 3 + 1] * 3); cc.fromArray(p, idx[t * 3 + 2] * 3); n.add(b.sub(a).cross(cc.sub(a))); }
      if (n.lengthSq() > 1e-18) { n.transformDirection(m.matrixWorld).normalize(); pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); tc.setSpace('local'); }
    }
    pivot.updateMatrix(); tc.attach(pivot);
  }
  function pushEditStart() { push(); const g = editObj.mesh.geometry; editBase = Float32Array.from(g.attributes.position.array); pivotBase = { m: pivot.matrix.clone(), inv: new THREE.Matrix4() }; pivot.updateMatrix(); pivotBase.m = pivot.matrix.clone(); pivotBase.inv = pivotBase.m.clone().invert(); }
  function applyPivot() {
    if (!pivotBase || !editObj) return; pivot.updateMatrix();
    const delta = pivot.matrix.clone().multiply(pivotBase.inv); // world-space change
    const m = editObj.mesh; m.updateMatrixWorld(); const inv = m.matrixWorld.clone().invert(); const full = inv.multiply(delta).multiply(m.matrixWorld);
    const g = m.geometry, a = g.attributes.position, v = new THREE.Vector3();
    for (const i of selV) { v.set(editBase[i * 3], editBase[i * 3 + 1], editBase[i * 3 + 2]).applyMatrix4(full); a.setXYZ(i, v.x, v.y, v.z); }
    a.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox(); rebuildEdit();
  }
  function extrude() {
    if (mode !== 'edit' || !selTris.size) { toast('Press Tab, switch to Faces, and click a face first.'); return; }
    push(); const g = editObj.mesh.geometry, r = extrudeFaces(g.attributes.position.array, g.index.array, [...selTris]);
    const ng = geoFrom(r.pos, r.index); editObj.mesh.geometry.dispose(); editObj.mesh.geometry = ng;
    selV = new Set(r.newVerts); // selected triangles keep their indices (they now use the new points)
    rebuildEdit(); attachPivot(); setGizmo('translate'); refreshUI();
    // nudge the gizmo onto the face normal feel: user drags the arrow
    toast('Extruded. Drag the arrow to pull it out, or type a distance with the gizmo.');
  }
  function deleteEdit() {
    if (mode !== 'edit' || !selV.size) return; push(); const g = editObj.mesh.geometry, r = deleteVerts(g.attributes.position.array, g.index.array, selV);
    editObj.mesh.geometry.dispose(); editObj.mesh.geometry = geoFrom(r.pos, r.index); clearSel(); rebuildEdit(); attach(); refreshUI();
  }
  function editClick(e, add) {
    const rect = renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const m = editObj.mesh, g = m.geometry, p = g.attributes.position.array;
    if (sub === 'vertex') {
      let best = -1, bd = 14; const v = new THREE.Vector3();
      for (let i = 0; i < p.length / 3; i++) { v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(m.matrixWorld).project(camera); const d = Math.hypot((v.x - ndc.x) * rect.width / 2, (v.y - ndc.y) * rect.height / 2); if (d < bd) { bd = d; best = i; } }
      if (!add) { selV.clear(); selTris.clear(); }
      if (best >= 0) { selV.has(best) ? selV.delete(best) : selV.add(best); }
    } else {
      const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera); const hit = rc.intersectObject(m, false)[0];
      if (!add) { selV.clear(); selTris.clear(); }
      if (hit) { const grp = faceGroup(g.index.array, p, hit.faceIndex), has = grp.every((t) => selTris.has(t)); for (const t of grp) { has ? selTris.delete(t) : selTris.add(t); } selV.clear(); for (const t of selTris) for (let k = 0; k < 3; k++) selV.add(g.index.array[t * 3 + k]); }
    }
    rebuildEdit(); attachPivot();
  }

  // --- mouse ---
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, onGizmo: !!tc.axis }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || down.onGizmo || tc.dragging || e.button !== 0) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null; if (moved > 4) return;
    if (mode === 'edit') { editClick(e, e.shiftKey); return; }
    const rect = renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
    const hit = rc.intersectObjects(objs.filter((o) => o.mesh.visible).map((o) => o.mesh), false)[0];
    pick(hit ? objs.find((o) => o.mesh === hit.object) : null, e.shiftKey);
  });

  // --- keys ---
  function onKey(e) {
    if (document.body.dataset.tab !== 'model') return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); redo(); return; }
    if (k === 'tab') { e.preventDefault(); mode === 'edit' ? leaveEdit() : enterEdit(); return; }
    if (k === 'g') setGizmo('translate'); else if (k === 'r') setGizmo('rotate'); else if (k === 's' && !ctrl) setGizmo('scale');
    else if (k === 'e' && mode === 'edit') extrude();
    else if (k === 'd' && e.shiftKey && mode === 'object') dupe();
    else if (k === 'x' || k === 'delete' || k === 'backspace') { e.preventDefault(); mode === 'edit' ? deleteEdit() : del(); }
    else if (k === 'escape') { mode === 'edit' ? (clearSel(), rebuildEdit(), attach()) : pick(null, false); }
    else if (k === 'a' && mode === 'object') { selected = new Set(objs.map((o) => o.id)); active = objs[objs.length - 1] || null; attach(); refreshUI(); }
    else if (k === '1' && mode === 'edit') { sub = 'vertex'; setModeUI(); } else if (k === '2' && mode === 'edit') { sub = 'face'; setModeUI(); }
    else if (k === 'f') frameAll();
  }
  window.addEventListener('keydown', onKey);

  // --- output ---
  function worldPositions(only) {
    const list = objs.filter((o) => o.mesh.visible && (!only || selected.has(o.id))), out = [];
    for (const o of list) { const g = worldGeo(o), p = g.attributes.position.array, idx = g.index.array; for (let i = 0; i < idx.length; i++) out.push(p[idx[i] * 3], p[idx[i] * 3 + 1], p[idx[i] * 3 + 2]); }
    return Float32Array.from(out);
  }
  function loadPositions(pos, name = 'Imported') { // triangle soup in -> editable object
    push(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3)); const o = addFromGeometry(weld(g), name); pick(o, false); frameAll();
  }
  function frameAll() {
    const b = new THREE.Box3(); objs.forEach((o) => b.expandByObject(o.mesh)); if (b.isEmpty()) { camera.position.set(6, -8, 5); orbit.target.set(0, 0, 0); orbit.update(); return; }
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()), r = Math.max(s.x, s.y, s.z, 1) * 1.25;
    camera.position.copy(c).add(new THREE.Vector3(1.3, -1.6, 1).normalize().multiplyScalar(r * 2.2)); camera.near = r / 1000; camera.far = r * 200; camera.updateProjectionMatrix(); orbit.target.copy(c); orbit.update();
  }

  // --- UI ---
  function html() {
    side.innerHTML = `
    <h3>Add a shape</h3>
    <div class="row3">${['cube', 'sphere', 'cylinder', 'cone', 'torus', 'wedge', 'plane'].map((k) => `<button data-add="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <div class="row"><div><label>Size</label><input data-m="addSize" type="number" step="any" value="2"></div><div><label>&nbsp;</label><label class="check"><input data-m="snap" type="checkbox"> Snap</label></div></div>
    <h3>Objects</h3><div data-m="list" class="mlist"></div>
    <div class="row"><button data-act="dupe" title="Shift+D">Duplicate</button><button data-act="del" title="X or Delete">Delete</button></div>
    <h3>Move it</h3>
    <div class="row3"><button data-gz="translate" title="G">Move</button><button data-gz="rotate" title="R">Turn</button><button data-gz="scale" title="S">Resize</button></div>
    <div class="nums"><span>Position</span><input data-f="px" type="number" step="any"><input data-f="py" type="number" step="any"><input data-f="pz" type="number" step="any">
      <span>Turn (deg)</span><input data-f="rx" type="number" step="any"><input data-f="ry" type="number" step="any"><input data-f="rz" type="number" step="any">
      <span>Size</span><input data-f="sx" type="number" step="any"><input data-f="sy" type="number" step="any"><input data-f="sz" type="number" step="any"></div>
    <label class="check"><input data-m="smooth" type="checkbox"> Smooth look</label>
    <h3>Combine (click one, Shift+click the other)</h3>
    <div class="row3"><button data-bool="union" title="Merge into one solid">Join</button><button data-bool="subtract" title="The first one you clicked gets cut by the second">Cut</button><button data-bool="intersect" title="Keep only the overlap">Overlap</button></div>
    <button data-act="group" class="wide" title="Merge without cutting">Merge as one piece (no cutting)</button>
    <h3>Mirror and repeat</h3>
    <div class="row3"><button data-mir="x">Mirror X</button><button data-mir="y">Mirror Y</button><button data-mir="z">Mirror Z</button></div>
    <div class="row3"><div><label>Copies</label><input data-m="aN" type="number" min="2" value="3"></div><div><label>Step X</label><input data-m="aX" type="number" step="any" value="3"></div><div><label>Step Y</label><input data-m="aY" type="number" step="any" value="0"></div></div>
    <button data-act="array" class="wide">Make a row of copies</button>
    <h3>Edit the shape <span class="hint small">(Tab)</span></h3>
    <button data-act="edit" class="wide" data-m="editBtn">Edit mode: points and faces</button>
    <div data-m="editTools" hidden>
      <div class="row"><button data-sub="vertex" title="1">Points</button><button data-sub="face" title="2">Faces</button></div>
      <div class="row"><button data-act="extrude" title="E">Extrude face</button><button data-act="delE" title="X">Delete</button></div>
      <button data-act="subdiv" class="wide">Split every face smaller (more points)</button>
      <p class="hint small">Click a face, press E, drag the arrow out. Shift+click to add more. Esc clears.</p>
    </div>
    <h3>Use it</h3>
    <div class="row"><button data-act="send" class="primary">Send to 3D tab</button><button data-act="stl">Save STL</button></div>
    <div class="row"><button data-act="obj">Save OBJ</button><button data-act="fit" title="F">Show all</button></div>
    <div class="row"><button data-act="undo">Undo</button><button data-act="redo">Redo</button></div>
    <div data-m="info" class="small hint"></div>
    <p class="hint small">Left-drag turns the view, right-drag pans, wheel zooms. Keys: G move, R turn, S resize, Tab edit, Shift+D copy, X delete, Ctrl+Z undo.</p>`;
    side.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
      if (d.add) add(d.add, parseFloat(side.querySelector('[data-m=addSize]').value) || 2);
      else if (d.gz) setGizmo(d.gz); else if (d.bool) boolean(d.bool); else if (d.mir) mirror(d.mir); else if (d.sub) { sub = d.sub; clearSel(); rebuildEdit(); attach(); setModeUI(); }
      else if (d.act) ({
        dupe, del, group: joinPlain, edit: () => (mode === 'edit' ? leaveEdit() : enterEdit()), extrude, delE: deleteEdit, subdiv: subdivideObj, undo, redo, fit: frameAll,
        array: () => array(parseInt(side.querySelector('[data-m=aN]').value, 10) || 3, parseFloat(side.querySelector('[data-m=aX]').value) || 0, parseFloat(side.querySelector('[data-m=aY]').value) || 0, 0),
        send: () => { const p = worldPositions(false); if (!p.length) return toast('Nothing to send yet. Add a shape first.'); onSend && onSend(p); },
        stl: () => { const p = worldPositions(false); if (!p.length) return toast('Nothing to save yet.'); onDownload && onDownload('model.stl', p, 'stl'); },
        obj: () => { const p = worldPositions(false); if (!p.length) return toast('Nothing to save yet.'); onDownload && onDownload('model.obj', p, 'obj'); },
      })[d.act]();
    });
    side.addEventListener('change', (e) => { const t = e.target; if (t.dataset.f) applyField(t.dataset.f, parseFloat(t.value)); else if (t.dataset.m === 'smooth') setSmooth(t.checked); else if (t.dataset.m === 'snap') setSnap(t.checked); });
  }
  function refreshUI() {
    const list = side.querySelector('[data-m=list]'); if (!list) return;
    list.innerHTML = '';
    objs.forEach((o) => {
      const r = document.createElement('div'); r.className = 'mrow' + (selected.has(o.id) ? ' on' : '') + (active === o ? ' act' : '');
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = '#' + o.color.toString(16).padStart(6, '0');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = o.name; nm.title = 'Click to select. Double-click to rename.';
      const eye = document.createElement('button'); eye.textContent = o.mesh.visible ? 'Hide' : 'Show'; eye.className = 'tiny';
      r.append(sw, nm, eye); list.append(r);
      nm.addEventListener('click', (e) => pick(o, e.shiftKey));
      nm.addEventListener('dblclick', () => { ask('Name:', o.name).then((x) => { if (x) { o.name = x; refreshUI(); } }); });
      eye.addEventListener('click', (e) => { e.stopPropagation(); o.mesh.visible = !o.mesh.visible; refreshUI(); });
    });
    if (!objs.length) list.innerHTML = '<div class="hint small">Nothing yet. Add a shape above.</div>';
    const sm = side.querySelector('[data-m=smooth]'); if (sm) sm.checked = !!(active && active.smooth);
    syncFields(); setActiveBtn(); setModeUI();
    const info = side.querySelector('[data-m=info]'); const tris = objs.reduce((t, o) => t + o.mesh.geometry.index.count / 3, 0);
    if (info) info.textContent = `${objs.length} object${objs.length === 1 ? '' : 's'}, ${tris} triangles.` + (active ? (isClosed(active.mesh.geometry.index.array) ? ' Selected one is a closed solid.' : ' Selected one has open edges.') : '');
  }
  function setActiveBtn() { side.querySelectorAll('[data-gz]').forEach((b) => b.classList.toggle('on', b.dataset.gz === tc.mode)); }
  function setModeUI() {
    const et = side.querySelector('[data-m=editTools]'); if (et) et.hidden = mode !== 'edit';
    const eb = side.querySelector('[data-m=editBtn]'); if (eb) { eb.textContent = mode === 'edit' ? 'Done editing (Tab)' : 'Edit mode: points and faces'; eb.classList.toggle('on', mode === 'edit'); }
    side.querySelectorAll('[data-sub]').forEach((b) => b.classList.toggle('on', b.dataset.sub === sub));
  }
  html(); refreshUI();

  // --- loop ---
  let running = false;
  function resize() { const w = view.clientWidth || 600, h = view.clientHeight || 400; renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function loop() { if (!running) return; orbit.update(); if (active && mode === 'object') outline.setFromObject(active.mesh); renderer.render(scene, camera); requestAnimationFrame(loop); }
  window.addEventListener('resize', resize);
  return {
    start() { if (!running) { running = true; resize(); loop(); } }, stop() { running = false; }, resize, setBg, frameAll, loadPositions, worldPositions, add, undo, redo, boolean, extrude, enterEdit, leaveEdit,
    _debug: { get objs() { return objs; }, get mode() { return mode; }, pick, selectFace(objIdx, tri) { editObj = objs[objIdx]; const g = editObj.mesh.geometry; const grp = faceGroup(g.index.array, g.attributes.position.array, tri); selTris = new Set(grp); selV = new Set(); for (const t of grp) for (let k = 0; k < 3; k++) selV.add(g.index.array[t * 3 + k]); }, get selTris() { return selTris; } },
  };
}
