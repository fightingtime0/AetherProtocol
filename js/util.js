"use strict";
/* ============================================================
   util.js — constants, helpers, persistent save, shared state
   ============================================================ */
// Internal render size. Raised from 480x270: at the old size you often could
// not see what was shooting you, and shrinking weapon ranges instead would
// have punished the long-range weapons. Kept 16:9 so fit() still letterboxes
// cleanly on normal displays — switch to a square here if you want that.
const VW=672, VH=378;          // internal render size
let WW=1280, WH=720;           // world size (set by difficulty)

const $=id=>document.getElementById(id);
const rnd=(a,b)=>a+Math.random()*(b-a);
const irnd=(a,b)=>Math.floor(rnd(a,b));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TAU=Math.PI*2;
const now=()=>performance.now();

/* ---------------- persistence (localStorage) ---------------- */
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
let save={shards:0,best:0,meta:{},name:'',sprite:null,records:[],cls:'arc',diff:'normal',
  mute:false,unlocked:['arc','tem','hex','voi','tec'],bgUrl:''};
try{ const r=lsGet('aetherv2'); if(r) save=Object.assign(save,JSON.parse(r)); }catch(e){}
if(!Array.isArray(save.unlocked)||!save.unlocked.length) save.unlocked=['arc','tem','hex','voi','tec'];
function persist(){ lsSet('aetherv2',JSON.stringify(save)); }

/* ---------------- shared runtime state ---------------- */
let mode='title';          // title|play|dead
let role='solo';           // solo|host|client
let S=null;                // host sim state
let V=null;                // client view state
let myId=0;
let peer=null, conns=[];   // host: conns list; client: conns[0]
let cam={x:0,y:0};
let myUpgrades=[];   // formatted stat deltas for the upgrade HUD (own player only)
let dodgePending=0;  // client dashed; rides the next input packet
let picking=null;
const keys={};
let touch={active:false,id:-1,ox:0,oy:0,dx:0,dy:0};
let myPos={x:WW/2,y:WH/2,inv:0,dashT:0,dashing:0,spd:66,dcd:2.2,dead:false};
let obstacles=[];
let diffKey='normal';
const DIFF=()=>DIFFS[diffKey]||DIFFS[Object.keys(DIFFS)[0]];

/* ---------------- default player sprite ---------------- */
const DEFAULT_MAGE=(()=>{ // 11x11
  const P={1:'#2b1f4e',2:'#4ef0e8',3:'#ffd35c',4:'#e8ecff',5:'#7a5cff'};
  const rows=[
  "...........",
  "....343....",
  "...33433...",
  "..3334333..",
  "....444....",
  "...14241...",
  "..1142411..",
  ".5.11211.5.",
  "...1...1...",
  "..22...22..",
  "..........."];
  return rows.map(r=>[...r].map(c=>P[c]||null));
})();
if(!save.sprite) save.sprite=DEFAULT_MAGE.map(r=>r.slice());
/* Idle animation. save.sprite stays the FIRST frame (so old saves and the
   network format keep working untouched); save.sprite2 is the optional second
   frame and save.anim toggles cycling. Two frames by default. */
if(!save.sprite2) save.sprite2=save.sprite.map(r=>r.slice());
if(save.anim===undefined) save.anim=true;
const ANIM_MS=380;                       // per-frame dwell for the idle cycle
function spriteFrames(){ return save.anim?[save.sprite,save.sprite2]:[save.sprite]; }
/* Which frame should be showing right now. Shared by the editor preview, the
   local player and remote players so everyone animates in step. */
function animFrame(n){ return n<=1?0:Math.floor(now()/ANIM_MS)%n; }

function spriteToCanvas(px){ // px: 11x11 array of color|null
  const oc=document.createElement('canvas'); oc.width=11; oc.height=11;
  const o=oc.getContext('2d');
  for(let y=0;y<11;y++)for(let x=0;x<11;x++){ const c=px[y]&&px[y][x];
    if(c){o.fillStyle=c;o.fillRect(x,y,1,1);} }
  return oc;
}

function toast(msg){ const d=document.createElement('div'); d.className='toast'; d.textContent=msg;
  $('toasts').appendChild(d); setTimeout(()=>d.remove(),3000); }

/* ---------------- world gen & collision ---------------- */
function genWorld(){
  const D=DIFF();
  WW=D.worldW; WH=D.worldH;
  const obs=[];
  const kinds=['crystal','rock','pillar','scrap'];
  for(let i=0;i<D.obstacles;i++){
    let x,y,ok=false,tries=0;
    while(!ok&&tries++<30){ x=rnd(50,WW-50); y=rnd(50,WH-50);
      ok=Math.hypot(x-WW/2,y-WH/2)>110 && obs.every(o=>Math.hypot(o.x-x,o.y-y)>o.r+28); }
    if(ok) obs.push({x,y,r:rnd(D.obstacleRadius[0],D.obstacleRadius[1]),kind:kinds[irnd(0,kinds.length)],hue:Math.random()});
  }
  return obs;
}
function collideObstacles(ent){
  for(const o of obstacles){
    const dx=ent.x-o.x, dy=ent.y-o.y, d=Math.hypot(dx,dy), min=o.r+(ent.r||3);
    if(d<min&&d>0){ ent.x=o.x+dx/d*min; ent.y=o.y+dy/d*min; }
  }
  if(TM)collideTiles(ent);   // Descent tilemap walls/doors/pits (null everywhere else)
  ent.x=clamp(ent.x,6,WW-6); ent.y=clamp(ent.y,6,WH-6);
}
function bulletHitsObstacle(b){
  if(TM&&shotSolid(tileAt(b.x,b.y)))return true;
  for(const o of obstacles) if(Math.hypot(b.x-o.x,b.y-o.y)<o.r) return true;
  return b.x<0||b.x>WW||b.y<0||b.y>WH;
}

/* ---------------- Descent tilemap core ----------------
   TM is null outside a Descent run, so every hook above is a no-op for
   Survival/Battleground/Siege/Training. Lives here (not dungeon.js) because
   collideObstacles/bulletHitsObstacle are the single choke points every
   mover and every bullet already goes through — and the older test suites
   and the Battleground server load util.js but not dungeon.js.
   Headless-safe: nothing here touches the page.
   TM = {w,h,ts, t:Uint8Array(w*h), biome, rooms:[...], doors:[...], seed, floor} */
let TM=null;
const T_VOID=0, T_FLOOR=1, T_WALL=2, T_DOOR=3 /*open*/, T_DOORX=4 /*closed*/, T_PIT=5, T_HAZ=6;
function tileAt(px,py){
  if(!TM)return T_FLOOR;
  const tx=Math.floor(px/TM.ts), ty=Math.floor(py/TM.ts);
  if(tx<0||ty<0||tx>=TM.w||ty>=TM.h)return T_VOID;
  return TM.t[ty*TM.w+tx];
}
function tileAtT(tx,ty){
  if(!TM||tx<0||ty<0||tx>=TM.w||ty>=TM.h)return T_VOID;
  return TM.t[ty*TM.w+tx];
}
function walkSolid(v){ return v===T_VOID||v===T_WALL||v===T_DOORX||v===T_PIT; }
function shotSolid(v){ return v===T_VOID||v===T_WALL||v===T_DOORX; } // bullets fly over pits/hazards
/* Something ended up with its centre INSIDE a solid tile (a blink/teleport,
   a pull-in, a spawn on a bad spot, a door closing on it). Pushing out of
   each tile separately is ambiguous from in there, so move it to the centre
   of the nearest walkable tile instead — ring search, nearest first. */
function tileUnstick(ent){
  const ts=TM.ts, tx0=Math.floor(ent.x/ts), ty0=Math.floor(ent.y/ts);
  for(let rr=1;rr<=24;rr++){
    let best=null,bd=1e18;
    for(let dy=-rr;dy<=rr;dy++)for(let dx=-rr;dx<=rr;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==rr)continue;
      const tx=tx0+dx, ty=ty0+dy;
      if(walkSolid(tileAtT(tx,ty)))continue;
      const cx=(tx+.5)*ts, cy=(ty+.5)*ts, d=(cx-ent.x)**2+(cy-ent.y)**2;
      if(d<bd){bd=d;best=[cx,cy];}
    }
    if(best){ ent.x=best[0]; ent.y=best[1]; return true; }
  }
  return false;
}
/* Circle (ent.r||3) vs every walk-solid tile its bounding box touches: push
   out along the closest point on the tile's AABB. Two passes settle corners. */
function collideTiles(ent){
  if(!TM)return;
  const ts=TM.ts, r=Math.min(ent.r||3,ts*0.75);
  if(walkSolid(tileAt(ent.x,ent.y))){ tileUnstick(ent); }
  for(let pass=0;pass<2;pass++){
    const x0=Math.floor((ent.x-r)/ts), x1=Math.floor((ent.x+r)/ts);
    const y0=Math.floor((ent.y-r)/ts), y1=Math.floor((ent.y+r)/ts);
    let moved=false;
    for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){
      if(!walkSolid(tileAtT(tx,ty)))continue;
      const nx=clamp(ent.x,tx*ts,(tx+1)*ts), ny=clamp(ent.y,ty*ts,(ty+1)*ts);
      const dx=ent.x-nx, dy=ent.y-ny, d=Math.hypot(dx,dy);
      if(d>=r)continue;
      if(d>1e-6){ ent.x=nx+dx/d*r; ent.y=ny+dy/d*r; }
      else{ // centre exactly on the tile edge: leave along the shallowest axis
        const cx=(tx+.5)*ts, cy=(ty+.5)*ts, ox=ent.x-cx, oy=ent.y-cy;
        if(Math.abs(ox)>Math.abs(oy)) ent.x=cx+Math.sign(ox||1)*(ts/2+r);
        else ent.y=cy+Math.sign(oy||1)*(ts/2+r);
      }
      moved=true;
    }
    if(!moved)break;
  }
}
/* Sub-step guard: anything whose frame step exceeds 12 px (under a 16 px
   tile, so single-tile walls can't be tunnelled) is walked from where it was
   to where it wants to be in ≤12 px hops, colliding at each. */
function tileSweep(ent,ox,oy){
  if(!TM)return;
  const dx=ent.x-ox, dy=ent.y-oy, d=Math.hypot(dx,dy);
  if(d<=12){ collideTiles(ent); return; }
  const n=Math.ceil(d/12), tx=ent.x, ty=ent.y;
  ent.x=ox; ent.y=oy;
  for(let i=1;i<=n;i++){
    const px=ent.x, py=ent.y;
    ent.x=px+(tx-ox)/n; ent.y=py+(ty-oy)/n;
    collideTiles(ent);
  }
}
/* Line of sight, sampled every 8 px. Default is bullet solidity (pits don't
   block sight); pass walk=true for "could I WALK this line" — enemy steering
   uses that, or it would happily beeline into a pit edge it can't cross. */
function losClear(x0,y0,x1,y1,walk){
  if(!TM)return true;
  const test=walk?walkSolid:shotSolid;
  const d=Math.hypot(x1-x0,y1-y0), n=Math.max(1,Math.ceil(d/8));
  for(let i=1;i<n;i++){
    const t=i/n;
    if(test(tileAt(x0+(x1-x0)*t,y0+(y1-y0)*t)))return false;
  }
  return true;
}
/* Seeded RNG for floor generation — host and every client build the same
   floor from {seed, floor}, so generation must never touch Math.random. */
function mulberry32(seed){
  let a=seed>>>0;
  return ()=>{ a=(a+0x6D2B79F5)>>>0; let t=a;
    t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296; };
}
