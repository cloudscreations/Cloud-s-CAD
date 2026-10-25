// Cloud's CAD - 3D viewer (three.js). License: GPL v3
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

// Any three.js object -> flat triangle positions (world space)
export function objectToPositions(obj) {
  obj.updateMatrixWorld(true);
  const out = [];
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry, pos = g.attributes.position;
    if (!pos) return;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return new Float32Array(out);
}
export function parseGLB(buf) {
  return new Promise((res, rej) => new GLTFLoader().parse(buf, '', (g) => res(objectToPositions(g.scene)), rej));
}
export function parsePLY(buf) {
  const g = new PLYLoader().parse(buf);
  return objectToPositions(new THREE.Mesh(g));
}

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4);
  dl.position.set(3, -5, 8);
  scene.add(dl);
  let group = new THREE.Group();
  scene.add(group);
  let bbox = null, grid = null, overlays = [];
  function setOverlay(list) {
    for (const o of overlays) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
    overlays = [];
    for (const { pos, color } of list || []) {
      if (!pos || !pos.length) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      scene.add(m); overlays.push(m);
    }
  }

  function setBg(dark) { scene.background = new THREE.Color(dark ? 0x0c0f14 : 0xeef1f5); }
  setBg(true);

  function setMesh(pos) {
    setOverlay([]);
    scene.remove(group);
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    group = new THREE.Group();
    scene.add(group);
    if (grid) { scene.remove(grid); grid = null; }
    if (!pos || !pos.length) { bbox = null; return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6aa3ff, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, flatShading: true }));
    group.add(mesh);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({ color: 0x1b2a44 })));
    g.computeBoundingBox();
    bbox = g.boundingBox.clone();
    const size = bbox.getSize(new THREE.Vector3());
    const m = Math.max(size.x, size.y, size.z);
    grid = new THREE.GridHelper(m * 3, 12, 0x5a6678, 0x2a3342);
    grid.rotation.x = Math.PI / 2;
    grid.position.set((bbox.min.x + bbox.max.x) / 2, (bbox.min.y + bbox.max.y) / 2, bbox.min.z);
    scene.add(grid);
  }
  function frame(dir = [1.3, -1.6, 1]) {
    if (!bbox) { camera.position.set(5, -6, 4); controls.target.set(0, 0, 0); controls.update(); return; }
    const c = bbox.getCenter(new THREE.Vector3()), s = bbox.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z) * 1.25 || 1;
    const d = new THREE.Vector3(...dir).normalize().multiplyScalar(r * 2.2);
    camera.position.copy(c).add(d);
    camera.near = r / 1000; camera.far = r * 100; camera.updateProjectionMatrix();
    controls.target.copy(c);
    controls.update();
  }
  function resize() {
    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  let running = false;
  function loop() { if (!running) return; controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); }
  function start() { if (!running) { running = true; resize(); loop(); } }
  function stop() { running = false; }
  window.addEventListener('resize', resize);
  return { scene, setMesh, setOverlay, frame, start, stop, resize, setBg, camera, controls, THREE };
}
