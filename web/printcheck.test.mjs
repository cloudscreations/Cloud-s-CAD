import { setKernelLoader } from './solids.js';
import { runChecks, reorient, arrangePieces, splitBodies, topology } from './printcheck.js';
import { extrudeLoops } from './mesh.js';
import Module from 'manifold-3d';
setKernelLoader(async()=>{const w=await Module();w.setup();return w;});
const sq=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const box=extrudeLoops([sq(0,0,20,20)],10);
const r=await runChecks(box,{bed:{x:200,y:200,z:200}}); console.log(r.notes.map(n=>n.kind+': '+n.msg));
// T shape with overhang + thin fin
const thin=extrudeLoops([sq(0,0,20,0.4)],10);
const r2=await runChecks(extrudeLoops([[[0,0],[30,0],[30,2],[0,2]]],10),{}); console.log(r2.notes.map(n=>n.msg));
const two=new Float32Array([...box,...box.map((v,i)=>i%3==0?v+40:v)]);
console.log('bodies',splitBodies(two).length, topology(two).bodies);
const a=arrangePieces(splitBodies(two),100,100,5); console.log('arranged',a.left,a.pos.length);
const up=reorient(box,[0,1,0]); console.log(topology(up).watertight);
const open=box.slice(0,box.length-18); console.log((await runChecks(open,{})).notes[0]);
