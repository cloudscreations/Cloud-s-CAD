// Cloud's CAD - Physics tab: drop, slide and tip tests with a rigid-body engine. License: GPL v3
import * as M from './mesh.js';

export function initPhysics({ $, state, getViewerFactory, mmPerUnit, toast }) {
  let viewer = null, R = null, world = null, items = [], ground = null, groundMesh = null, running = false, what = 'model', t = 0, raf = 0, last = 0;
  const THREE_ = () => viewer.THREE;
  const say = (s) => { $('phRead').textContent = s; };

  async function ensure() {
    if (!viewer) {
      const { createViewer } = await getViewerFactory();
      viewer = createViewer($('phView'));
      viewer.setBg(true);
    }
    if (!R) { R = (await import('@dimforge/rapier3d-compat')).default; await R.init(); }
    return viewer;
  }
  function clear() {
    for (const it of items) { viewer.scene.remove(it.mesh); it.mesh.geometry.dispose(); }
    items = []; if (groundMesh) { viewer.scene.remove(groundMesh); groundMesh = null; }
    world = null; t = 0;
  }
  function modelHullAndGeom(THREE) {
    const k = mmPerUnit(), pos = M.scalePositions(state.model, k), b = M.bboxOf(pos);
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const p = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { p[i] = pos[i] - c[0]; p[i + 1] = pos[i + 1] - c[1]; p[i + 2] = pos[i + 2] - c[2]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.computeVertexNormals();
    const step = Math.max(1, Math.floor(p.length / 3 / 4000)), hull = [];  // thin out huge meshes for the hull
    for (let i = 0; i < p.length; i += 9 * step) hull.push(p[i], p[i + 1], p[i + 2]);
    return { g, hull: Float32Array.from(hull), size: b.size };
  }
  async function setup() {
    await ensure(); clear();
    const THREE = THREE_(), v = viewer;
    const tilt = (+$('phTilt').value * Math.PI) / 180, fr = +$('phFric').value / 50, bo = +$('phBounce').value / 100;
    const H = (parseFloat($('phH').value) || 100) * mmPerUnit(), n = Math.max(1, Math.min(40, parseInt($('phN').value) || 1));
    world = new R.World({ x: 0, y: 0, z: -9810 });
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tilt);
    const gb = world.createRigidBody(R.RigidBodyDesc.fixed().setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    world.createCollider(R.ColliderDesc.cuboid(3000, 3000, 10).setTranslation(0, 0, -10).setFriction(fr * 1.0).setRestitution(bo), gb);
    groundMesh = new THREE.Mesh(new THREE.BoxGeometry(6000, 6000, 20), new THREE.MeshStandardMaterial({ color: 0x2a3342, roughness: 0.9 }));
    groundMesh.position.set(0, 0, -10); groundMesh.setRotationFromQuaternion(q); groundMesh.translateZ(0);
    v.scene.add(groundMesh);
    if (what === 'model' && !(state.model && state.model.length)) { say('There is no 3D model yet. Make one in the 3D tab, or pick Box or Ball.'); return false; }
    let shape;
    if (what === 'model') shape = modelHullAndGeom(THREE);
    else if (what === 'box') shape = { g: new THREE.BoxGeometry(40, 40, 40), size: [40, 40, 40] };
    else shape = { g: new THREE.SphereGeometry(25, 24, 16), size: [50, 50, 50] };
    const gap = Math.max(...shape.size) * 1.3, cols = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) {
      const cx = ((i % cols) - (cols - 1) / 2) * gap, cy = (Math.floor(i / cols) - (cols - 1) / 2) * gap;
      const z = H + shape.size[2] / 2 + (i % 2) * 5;                                   // slight stagger so copies tumble
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(cx, cy, z));
      let cd = what === 'model' ? R.ColliderDesc.convexHull(shape.hull) : what === 'box' ? R.ColliderDesc.cuboid(20, 20, 20) : R.ColliderDesc.ball(25);
      if (!cd) { say('That model is too odd to simulate as one solid. Try a simpler one.'); return false; }
      world.createCollider(cd.setFriction(fr).setRestitution(bo).setDensity(0.001), body);
      const mesh = new THREE.Mesh(shape.g, new THREE.MeshStandardMaterial({ color: 0x6aa3ff, roughness: 0.55, flatShading: true }));
      v.scene.add(mesh); items.push({ body, mesh, q0: body.rotation() });
    }
    sync();
    const S = Math.max(gap * cols, H, 100);
    v.camera.position.set(S * 1.6, -S * 2, S * 1.2); v.controls.target.set(0, 0, S * 0.25); v.controls.update();
    v.camera.near = S / 500; v.camera.far = S * 100; v.camera.updateProjectionMatrix();
    say(`${n} × ${what === 'model' ? 'your model' : what}. Press Play.`);
    return true;
  }
  function sync() { for (const it of items) { const p = it.body.translation(), r = it.body.rotation(); it.mesh.position.set(p.x, p.y, p.z); it.mesh.quaternion.set(r.x, r.y, r.z, r.w); } }
  function tick(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000) * ($('phSlow').checked ? 0.25 : 1); last = now;
    world.timestep = 1 / 120; let n = Math.max(1, Math.round(dt * 120));
    for (let i = 0; i < n; i++) { world.step(); t += 1 / 120; }
    sync();
    const awake = items.filter((it) => !it.body.isSleeping()).length;
    if (!awake) { running = false; $('phPlay').textContent = 'Play'; finish(); return; }
    say(`${t.toFixed(1)} s: ${awake} still moving`);
    raf = requestAnimationFrame(tick);
  }
  function finish() {
    let tipped = 0, slid = 0; const tilt = +$('phTilt').value;
    for (const it of items) {
      const r = it.body.rotation(), a = it.q0, dot = Math.abs(r.x * a.x + r.y * a.y + r.z * a.z + r.w * a.w), ang = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
      if (ang > 25) tipped++;
      if (tilt > 0) { const p = it.body.translation(); if (Math.hypot(p.x, p.y) > 150) slid++; }
    }
    const n = items.length;
    say(`At rest after ${t.toFixed(1)} s. ` + (tipped ? `${tipped} of ${n} ended up turned over or tilted from how ${n === 1 ? 'it was' : 'they were'} dropped.` : `${n === 1 ? 'It' : 'All'} landed the way ${n === 1 ? 'it was' : 'they were'} dropped.`) + (tilt > 0 ? (slid ? ` ${slid} slid away down the slope.` : ' Nothing slid on this slope.') : ''));
  }
  async function play() {
    if (running) { running = false; $('phPlay').textContent = 'Play'; return; }
    if (!world || t === 0 && false) { /* fresh */ }
    if (!world) { if (!(await setup())) return; }
    running = true; $('phPlay').textContent = 'Pause'; last = performance.now(); raf = requestAnimationFrame(tick);
  }
  async function reset() { running = false; $('phPlay').textContent = 'Play'; try { await setup(); } catch (e) { say('Physics could not start: ' + (e.message || e)); } }
  $('phPlay').addEventListener('click', () => play().catch((e) => say('Physics could not start: ' + (e.message || e))));
  $('phReset').addEventListener('click', reset);
  const pick = (w, id) => { what = w; ['phModel', 'phBox', 'phBall'].forEach((x) => $(x).classList.toggle('primary', x === id)); reset(); };
  $('phModel').addEventListener('click', () => pick('model', 'phModel')); $('phBox').addEventListener('click', () => pick('box', 'phBox')); $('phBall').addEventListener('click', () => pick('ball', 'phBall'));
  $('phTilt').addEventListener('input', () => { $('phTiltV').textContent = $('phTilt').value; reset(); });
  ['phFric', 'phBounce', 'phN', 'phH'].forEach((id) => $(id).addEventListener('change', reset));
  return {
    enter() { document.querySelectorAll('.uName').forEach((e) => (e.textContent = state.units)); $('phModel').classList.add('primary'); if (!$('phH').dataset.set) { $('phH').value = +(100 / mmPerUnit()).toPrecision(3); $('phH').dataset.set = 1; } ensure().then(() => { viewer.start(); viewer.resize(); if (!world) reset(); }).catch((e) => say('Physics could not start: ' + (e.message || e))); },
    leave() { running = false; $('phPlay').textContent = 'Play'; viewer && viewer.stop(); },
  };
}
