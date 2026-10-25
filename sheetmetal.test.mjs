import { planSheet, foldedSolid, flatEnts } from './sheetmetal.js';
import { signedVolume } from './solids.js';
const T=2,R=2,K=0.33,W=30;
// L bracket 40 and 30 long (centreline)
const p=planSheet([[0,0],[40,0],[40,30]],{T,R,K});
const Rc=3, sb=Rc*Math.tan(Math.PI/4), ba=Math.PI/2*(R+K*T);
const flat=(40-sb)+(30-sb)+ba;
console.log('flat',p.flatLength.toFixed(3),'expect',flat.toFixed(3), 'bends',p.bends.length, p.lines.length);
const s=foldedSolid([[0,0],[40,0],[40,30]],{T,R,K,W});
const v=Math.abs(signedVolume(s.pos)); const expect=T*W*(40-sb+30-sb+Math.PI/2*Rc);
console.log('vol',v.toFixed(1),'expect',expect.toFixed(1));
console.log(flatEnts(p,W).length);
try{planSheet([[0,0],[3,0],[3,3]],{T,R,K})}catch(e){console.log('ok err',e.message)}
