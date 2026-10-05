"use strict";
/* ============================================================
   dungeon.js — DESCENT: floor generation, rooms, encounters,
   flow-field steering. Loaded after moba.js, before net.js.

   HEADLESS-SAFE: nothing in here touches the page (no document,
   no ctx). Drawing lives in render.js, sprite baking in data.js.

   DETERMINISM: every floor is built from {seed, floor} with
   mulberry32 (util.js) only — never rnd()/Math.random — so the
   host and every client build the identical tilemap.
   ============================================================ */

/* ---------------- template stamping ----------------
   A template is the INTERIOR of a room (the outer ring of tiles is always
   wall): cw*cell[0]-2 × ch*cell[1]-2 characters. See rooms.json and the char
   table in DESIGN-dungeon-runs.md §3.2. */
const DG_SOLID_PROP={P:'pillar',K:'crystal'};      // indestructible → obstacles circles
const DG_BREAK_PROP={X:'crate',O:'barrel'};        // destructible → S.en props on activation
const DG_DECOR={r:'rubble',T:'terminal',b:'brazier',A:'shrine'}; // baked into floor chunks
const DG_PROP_R=5;                                  // collision radius of a pillar/crystal
function dgCellTiles(){ return (DGN&&DGN.cell)||[20,12]; }
function dgTS(){ return (DGN&&DGN.tile)||16; }
function dgFootprint(fp){ return ((DGN&&DGN.footprints)||{})[fp]||{S:[2,2],M:[3,2],Mv:[2,3],L:[3,3],B:[4,4]}[fp]; }
function dgTemplateById(id){ return ROOMT.find(t=>t.id===id)||null; }
function dgNewTM(wT,hT,biome,seed,floor){
  return {w:wT,h:hT,ts:dgTS(),t:new Uint8Array(wT*hT),biome:biome|0,rooms:[],doors:[],
    seed:seed|0,floor:floor|0,locked:-1};
}
/* Stamp one room: outer ring → wall, interior → template chars (optionally
   mirrored), then record every marker in pixel space on the room record. */
function dgStampRoom(tm,room,tpl,mx,my){
  const [CW,CH]=dgCellTiles(), ts=tm.ts;
  const tx0=room.cx*CW, ty0=room.cy*CH, tw=room.cw*CW, th=room.ch*CH;
  Object.assign(room,{tpl:tpl.id,mx:mx?1:0,my:my?1:0,tx:tx0,ty:ty0,tw,th,
    x:tx0*ts,y:ty0*ts,w:tw*ts,h:th*ts,
    spawns:[],chests:[],shop:[],shrine:[],hatch:[],entry:[],solids:[],breakables:[],decor:[],npcSpots:[]});
  const W=tw-2, H=th-2;
  for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
    const tx=tx0+x, ty=ty0+y, idx=ty*tm.w+tx;
    if(x===0||y===0||x===tw-1||y===th-1){ tm.t[idx]=T_WALL; continue; }
    const ix=mx?(W-1-(x-1)):(x-1), iy=my?(H-1-(y-1)):(y-1);
    const c=tpl.rows[iy][ix];
    let v=T_FLOOR;
    if(c==='#')v=T_WALL; else if(c==='~')v=T_PIT; else if(c==='^')v=T_HAZ;
    tm.t[idx]=v;
    const px=(tx+.5)*ts, py=(ty+.5)*ts;
    if(c==='S')room.spawns.push([px,py]);
    else if(c==='C')room.chests.push([px,py]);
    else if(c==='$')room.shop.push([px,py]);
    else if(c==='H')room.hatch.push([px,py]);
    else if(c==='@')room.entry.push([px,py]);
    else if(c==='N')room.npcSpots.push([px,py]);   // NPC stands here (npcs.json placements)
    else if(DG_SOLID_PROP[c])room.solids.push({kind:DG_SOLID_PROP[c],x:px,y:py});
    else if(DG_BREAK_PROP[c])room.breakables.push({kind:DG_BREAK_PROP[c],x:px,y:py});
    else if(DG_DECOR[c]){ room.decor.push({kind:DG_DECOR[c],x:px,y:py}); if(c==='A')room.shrine.push([px,py]); }
  }
  return room;
}
/* Solid props become ordinary obstacle circles, so the existing circle
   collision, bullet blocking and drawObstacle() all just work. */
function dgObstacles(tm){
  const obs=[];
  for(const rm of tm.rooms)for(const s of rm.solids)obs.push({x:s.x,y:s.y,r:DG_PROP_R,kind:s.kind,hue:0});
  return obs;
}
/* Make `tm` the live map: TM, world size and obstacles all follow it.
   Used identically by host and clients. */
function dgInstall(tm){
  if(!tm.npcs)tm.npcs=tm.test?[]:dgPlaceNpcs(tm);
  TM=tm; WW=tm.w*tm.ts; WH=tm.h*tm.ts;
  obstacles=dgObstacles(tm);
  return tm;
}
/* Room whose rect contains the point (optionally inset), or -1. */
function dgRoomAt(x,y,inset){
  if(!TM)return -1;
  const k=inset||0;
  for(const rm of TM.rooms)
    if(x>=rm.x+k&&x<rm.x+rm.w-k&&y>=rm.y+k&&y<rm.y+rm.h-k)return rm.i;
  return -1;
}

/* Keep an entity inside a room: clamp into the interior, then let the tile
   collision move it off anything solid it landed on. Used for the training
   room and, during a fight, for anything that blinked/charged out of the
   locked room (warlock, reaper, titan…), which would otherwise soft-lock it. */
function dgContain(e,rm){
  const ts=TM.ts, pad=ts+(e.r||3)+1;
  e.x=clamp(e.x,rm.x+pad,rm.x+rm.w-pad); e.y=clamp(e.y,rm.y+pad,rm.y+rm.h-pad);
  collideTiles(e);
  if(dgRoomAt(e.x,e.y)!==rm.i){ // unstick found a tile in a neighbour — use a known-good spot
    const s=rm.entry[0]||rm.spawns[0]||[rm.x+rm.w/2,rm.y+rm.h/2]; e.x=s[0]; e.y=s[1]; collideTiles(e);
  }
}

/* ---------------- template validator ----------------
   Door SLOTS: on every cell edge, the middle 4 tiles × 2 deep must be floor.
   (The doorway itself is 3 wide; 4 is the smallest centred run that is still
   symmetric under X/Y mirroring on an even 20×12 cell, so a mirrored template
   always keeps floor behind every possible doorway.) Every walkable tile must
   be reachable from the slots, markers sit on floor by construction, combat
   and elite rooms need ≥4 spawns, boss rooms need an exit-hatch spot. */
const DG_TPL_SOLID='#~PK';          // blocks walking inside a template
function dgSlotCells(fp){
  const f=dgFootprint(fp), [CW,CH]=dgCellTiles(), W=f[0]*CW-2, H=f[1]*CH-2, out=[];
  for(let k=0;k<f[0];k++)for(let x=k*CW+CW/2-3;x<=k*CW+CW/2;x++)
    for(const y of [0,1,H-2,H-1])out.push([x,y]);
  for(let k=0;k<f[1];k++)for(let y=k*CH+CH/2-3;y<=k*CH+CH/2;y++)
    for(const x of [0,1,W-2,W-1])out.push([x,y]);
  return out;
}
function dgValidateTemplate(t){
  const err=[], f=dgFootprint(t.fp);
  if(!f)return ['unknown footprint '+t.fp];
  const [CW,CH]=dgCellTiles(), W=f[0]*CW-2, H=f[1]*CH-2, rows=t.rows||[];
  if(rows.length!==H||rows.some(r=>r.length!==W))
    return ['size: want '+W+'x'+H+', got '+(rows[0]||'').length+'x'+rows.length];
  const sl=dgSlotCells(t.fp);
  for(const [x,y] of sl) if(rows[y][x]!=='.'){ err.push('door slot '+x+','+y+" is '"+rows[y][x]+"'"); break; }
  const seen=new Uint8Array(W*H), q=[sl[0]]; seen[sl[0][1]*W+sl[0][0]]=1;
  while(q.length){ const [x,y]=q.pop();
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=x+dx, ny=y+dy;
      if(nx<0||ny<0||nx>=W||ny>=H||seen[ny*W+nx]||DG_TPL_SOLID.includes(rows[ny][nx]))continue;
      seen[ny*W+nx]=1; q.push([nx,ny]); } }
  outer: for(let y=0;y<H;y++)for(let x=0;x<W;x++)
    if(!DG_TPL_SOLID.includes(rows[y][x])&&!seen[y*W+x]){ err.push('unreachable floor at '+x+','+y); break outer; }
  const n=c=>rows.reduce((a,r)=>a+r.split(c).length-1,0);
  if((t.type==='combat'||t.type==='elite'||t.type==='boss')&&n('S')<4)err.push('needs ≥4 S spawns');
  if(t.type==='boss'&&n('H')<1)err.push('boss room needs an H hatch spot');
  if(t.type==='start'&&n('@')<1)err.push('start room needs an @ entry');
  if(t.type==='treasure'&&n('C')<1)err.push('treasure room needs a C chest spot');
  if(t.type==='shop'&&n('$')<1)err.push('shop room needs $ pedestals');
  return err;
}
function dgValidateAll(){
  const out={};
  for(const t of ROOMT){ const e=dgValidateTemplate(t); if(e.length)out[t.id]=e; }
  return out;
}

/* ---------------- floor generation ----------------
   Cell grid (dungeon.json grid, default 14×12 cells of 20×12 tiles). Start
   sits mid-grid; the main path grows room by room, each touching the one
   before it with ≥1 cell of shared edge (random side, random alignment,
   backtracking one room on a dead end). Branches hang off random main rooms
   that are neither start nor boss. 50 failures → restart with seed+1, which
   is still deterministic for a given seed. */
function dgShuffle(R,a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(R()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function dgCandidates(R,prev,type){
  const fps=dgShuffle(R,[...((DGN.typeFootprints||{})[type]||['S'])]), out=[];
  for(const fp of fps){ const [w,h]=dgFootprint(fp);
    const sides=dgShuffle(R,[0,1,2,3]);
    for(const s of sides){
      const al=[];
      if(s<2){ for(let o=prev.cy-h+1;o<=prev.cy+prev.ch-1;o++)al.push(o); }
      else   { for(let o=prev.cx-w+1;o<=prev.cx+prev.cw-1;o++)al.push(o); }
      for(const o of dgShuffle(R,al)){
        if(s===0)out.push({fp,cw:w,ch:h,cx:prev.cx+prev.cw,cy:o});       // right
        else if(s===1)out.push({fp,cw:w,ch:h,cx:prev.cx-w,cy:o});        // left
        else if(s===2)out.push({fp,cw:w,ch:h,cx:o,cy:prev.cy+prev.ch});  // below
        else out.push({fp,cw:w,ch:h,cx:o,cy:prev.cy-h});                 // above
      }
    }
  }
  return out;
}
function dgTryLayout(R,F,GW,GH){
  const occ=new Int16Array(GW*GH).fill(-1), rooms=[], edges=[];
  const fits=c=>{ if(c.cx<0||c.cy<0||c.cx+c.cw>GW||c.cy+c.ch>GH)return false;
    for(let y=c.cy;y<c.cy+c.ch;y++)for(let x=c.cx;x<c.cx+c.cw;x++)if(occ[y*GW+x]>=0)return false;
    return true; };
  const mark=(c,v)=>{ for(let y=c.cy;y<c.cy+c.ch;y++)for(let x=c.cx;x<c.cx+c.cw;x++)occ[y*GW+x]=v; };
  const [sw,sh]=dgFootprint('S');
  const start={i:0,type:'start',fp:'S',cw:sw,ch:sh,cx:Math.floor(GW/2)-1,cy:Math.floor(GH/2)-1};
  rooms.push(start); mark(start,0);
  let fails=0;
  const placeMain=k=>{
    if(k===F.main.length)return true;
    const type=F.main[k];
    for(const c of dgCandidates(R,rooms[k-1],type)){
      if(!fits(c))continue;
      const rm=Object.assign({i:k,type},c); rooms.push(rm); mark(rm,k);
      if(placeMain(k+1))return true;
      rooms.pop(); mark(rm,-1);
      if(++fails>50)return false;
    }
    fails++; return false;
  };
  if(!placeMain(1))return null;
  for(let k=1;k<F.main.length;k++)edges.push([k-1,k]);
  const hosts=rooms.filter(r=>r.type!=='start'&&r.type!=='boss');
  for(const type of (F.branches||[])){
    let placed=false;
    for(const host of dgShuffle(R,[...hosts])){
      for(const c of dgCandidates(R,host,type)){
        if(!fits(c))continue;
        const rm=Object.assign({i:rooms.length,type,branch:1},c);
        rooms.push(rm); mark(rm,rm.i); edges.push([host.i,rm.i]); placed=true; break;
      }
      if(placed)break;
    }
    if(!placed&&++fails>50)return null;
    if(!placed)return null;
  }
  return {rooms,edges};
}
/* Carve a 3-tile doorway through both rooms' walls, centred on the middle
   cell of their shared border. */
function dgCarveDoor(tm,a,b){
  const [CW,CH]=dgCellTiles(), tiles=[];
  let dir, lo, hi;
  if(a.cx+a.cw===b.cx||b.cx+b.cw===a.cx){             // side by side → vertical wall
    const L=a.cx<b.cx?a:b; dir='v';
    lo=Math.max(a.cy,b.cy); hi=Math.min(a.cy+a.ch,b.cy+b.ch);
    const m=lo+Math.floor((hi-lo-1)/2), x=(L.cx+L.cw)*CW;
    for(let ty=m*CH+CH/2-1;ty<=m*CH+CH/2+1;ty++) tiles.push(ty*tm.w+x-1, ty*tm.w+x);
  }else{                                                 // stacked → horizontal wall
    const T=a.cy<b.cy?a:b; dir='h';
    lo=Math.max(a.cx,b.cx); hi=Math.min(a.cx+a.cw,b.cx+b.cw);
    const m=lo+Math.floor((hi-lo-1)/2), y=(T.cy+T.ch)*CH;
    for(let tx=m*CW+CW/2-1;tx<=m*CW+CW/2+1;tx++) tiles.push((y-1)*tm.w+tx, y*tm.w+tx);
  }
  for(const i of tiles)tm.t[i]=T_DOOR;
  let sx=0,sy=0; for(const i of tiles){ sx+=(i%tm.w+.5)*tm.ts; sy+=(((i/tm.w)|0)+.5)*tm.ts; }
  const d={rooms:[a.i,b.i],tiles,dir,x:sx/tiles.length,y:sy/tiles.length};
  tm.doors.push(d);
  return d;
}
/* dgGenerate(seed, floorIdx) → TM (not installed). Pure function of its
   arguments: host and clients call it with the same numbers and get the
   same tiles, rooms and doors. */
function dgGenerate(seed,floorIdx){
  const F=DGN.floors[clamp(floorIdx|0,0,DGN.floors.length-1)];
  const [GW,GH]=DGN.grid, [CW,CH]=dgCellTiles();
  let lay=null, used=seed>>>0;
  for(let attempt=0;attempt<64&&!lay;attempt++){
    used=(seed+attempt)>>>0;
    lay=dgTryLayout(mulberry32(used),F,GW,GH);
  }
  if(!lay)throw new Error('dgGenerate: no layout for seed '+seed+' floor '+floorIdx);
  const R=mulberry32((used^0x9e3779b9)>>>0);           // template picks & mirroring
  const tm=dgNewTM(GW*CW,GH*CH,F.biome,seed,floorIdx);
  tm.genSeed=used; tm.name=F.name;
  for(const r of lay.rooms){
    const pool=ROOMT.filter(t=>t.type===r.type&&t.fp===r.fp);
    const any=pool.length?pool:ROOMT.filter(t=>t.fp===r.fp&&t.type==='combat');
    const tpl=any[Math.floor(R()*any.length)];
    const room=Object.assign({state:'idle',nb:[]},r);
    dgStampRoom(tm,room,tpl,R()<.5,R()<.5);
    tm.rooms.push(room);
  }
  for(const [a,b] of lay.edges){
    dgCarveDoor(tm,tm.rooms[a],tm.rooms[b]);
    tm.rooms[a].nb.push(b); tm.rooms[b].nb.push(a);
  }
  tm.start=0; tm.boss=tm.rooms.findIndex(r=>r.type==='boss');
  return tm;
}
/* Same call on host and clients: generate + install. */
function dgBuild(seed,floorIdx){ return dgInstall(dgGenerate(seed,floorIdx)); }
/* Cheap structural fingerprint — tests compare host/client builds with it. */
function dgHash(tm){
  let h=2166136261>>>0;
  const mix=v=>{ h^=v&255; h=Math.imul(h,16777619)>>>0; };
  for(let i=0;i<tm.t.length;i++)mix(tm.t[i]);
  for(const r of tm.rooms){ mix(r.cx); mix(r.cy); mix(r.cw); mix(r.ch); for(const c of r.tpl)mix(c.charCodeAt(0)); mix(r.mx); mix(r.my); }
  for(const d of tm.doors)for(const i of d.tiles){ mix(i); mix(i>>8); mix(i>>16); }
  return h>>>0;
}

/* ---------------- Training range: single test room ----------------
   One room from rooms.json (dungeon.json "testRoom"), stamped alone with a
   margin of void around it. Lets collision, pits, hazards, doors-as-walls and
   the flow field be checked by hand from the Training screen. */
function dgTestRoom(){
  const tpl=dgTemplateById((DGN&&DGN.testRoom)||'train_L')||ROOMT.find(t=>t.fp==='L')||ROOMT[0];
  const fp=dgFootprint(tpl.fp), [CW,CH]=dgCellTiles();
  const tm=dgNewTM((fp[0]+2)*CW,(fp[1]+2)*CH,0,0,0);
  const room={i:0,type:tpl.type,fp:tpl.fp,cx:1,cy:1,cw:fp[0],ch:fp[1],state:'cleared',nb:[]};
  dgStampRoom(tm,room,tpl,false,false);
  tm.rooms.push(room);
  tm.test=1;
  return dgInstall(tm);
}

/* ============================================================
   RUN LOOP (host only below, unless noted)
   S.dg = {runSeed, seed, floor, room, locked, depth, ...}. S.wave stays the
   scaling input every existing curve reads; Descent just drives it from
   depth instead of a wave counter.
   ============================================================ */
const DG_FIGHT={combat:1,elite:1,boss:1};
function dgFloorSeed(runSeed,floor){ return (Math.imul((runSeed^0x5bd1e995)>>>0,2654435761)+Math.imul(floor+1,40503))>>>0; }
function dgWaveFor(depth){ return Math.max(1,Math.round(depth*DGN.depthWaveMult)); }
function dgAlive(){ return [...S.players.values()].filter(p=>!p.dead); }
/* Start a Descent run. Replaces Survival progression for solo, co-op and
   "play again"; Battleground keeps newSim(). */
function newRunSim(playersInfo,opts){
  opts=opts||{};
  S=baseSim({});
  S.waveDone=true; S.miniSpawned=true;          // no open-field waves or guardian timer
  S.shops=[];
  const runSeed=(opts.seed!==undefined?opts.seed:Math.floor(Math.random()*2147483646)+1)>>>0;
  S.dg={runSeed,seed:0,floor:0,room:-1,locked:false,depth:0,tele:0,enc:null,flow:null,flowT:0,
        hatch:null,victoryT:0,disc:new Set()};
  playersInfo.forEach(pi=>{
    const p=mkPlayer(pi.id,pi.name,pi.sprites||pi.sprite,pi.cls);
    applyMetaObj(p, pi.id===myId?save.meta:pi.meta);
    S.players.set(pi.id,p);
  });
  dgEnterFloor(0);
  S.wave=dgWaveFor(0);
  return S;
}
/* Spot i of the start room's entry fan (so co-op players don't stack). */
function dgEntrySpot(i){
  const st=TM.rooms[TM.start||0], e=st.entry[0]||[st.x+st.w/2,st.y+st.h/2];
  if(!i)return [e[0],e[1]];
  const a=i*2.4; return [e[0]+Math.cos(a)*14,e[1]+Math.sin(a)*14];
}
/* Build floor f, wipe everything floor-local, and stand the party at the
   start room's entry. Remote players are told where by the caller. */
function dgEnterFloor(f){
  const D=S.dg;
  D.floor=f; D.seed=dgFloorSeed(D.runSeed,f);
  dgBuild(D.seed,f);
  D.room=-1; D.locked=false; D.tele=0; D.enc=null; D.flow=null; D.hatch=null; D.disc=new Set([TM.start]);
  S.en=[]; S.eb=[]; S.pb=[]; S.it=[]; S.zn=[]; S.mk=[]; S.pu=[]; S.ar=[]; S.spawnQ=[]; S.obj=null; S.shops=[];
  TM.rooms[TM.start].state='cleared';
  let i=0;
  for(const p of S.players.values()){
    const [x,y]=dgEntrySpot(i++);
    p.x=x; p.y=y; p.inv=Math.max(p.inv,DGN.floorInvulnSec||1);
    p.dgIgnoreInUntil=now()+900;              // stale 'in' packets still carry the old floor
    if(p.id===myId){ myPos.x=x; myPos.y=y; myPos.inv=Math.max(myPos.inv||0,DGN.floorInvulnSec||1); }
  }
  for(const dn of S.dr){ const o=S.players.get(dn.owner); if(o){dn.x=o.x; dn.y=o.y;} }
}
/* Door tiles are the lock. Idempotent, runs on host and clients alike. */
function dgSetLock(i,locked){
  if(!TM||i<0)return;
  if(locked)TM.locked=i; else if(TM.locked===i)TM.locked=-1;
  for(const d of TM.doors){
    if(d.rooms[0]!==i&&d.rooms[1]!==i)continue;
    const v=locked?T_DOORX:T_DOOR;
    for(const t of d.tiles)TM.t[t]=v;
  }
}
/* Client side: make the doors match what the host says, however many
   messages were missed — only ever one room is locked at a time. */
function dgSyncLock(room,locked){
  if(!TM)return;
  if(locked&&room>=0){ if(TM.locked!==room){ if(TM.locked>=0)dgSetLock(TM.locked,false); dgSetLock(room,true); } }
  else if(TM.locked>=0)dgSetLock(TM.locked,false);
}
/* A random walkable spot inside room ri, at least `margin` px from its walls
   and clear of prop circles. Runtime only (uses rnd), never generation. */
function dgRoomFloorPoint(ri,margin){
  const rm=TM.rooms[ri]; margin=margin||8;
  for(let t=0;t<80;t++){
    const x=rnd(rm.x+TM.ts+margin,rm.x+rm.w-TM.ts-margin), y=rnd(rm.y+TM.ts+margin,rm.y+rm.h-TM.ts-margin);
    const v=tileAt(x,y);
    if(v!==T_FLOOR&&v!==T_HAZ)continue;
    if(obstacles.some(o=>Math.hypot(o.x-x,o.y-y)<o.r+6))continue;
    return [x,y];
  }
  const s=rm.spawns[0]||rm.entry[0]||[rm.x+rm.w/2,rm.y+rm.h/2]; return [s[0],s[1]];
}
/* Where a Descent enemy appears: one of the locked room's S markers that is
   ≥ spawnMinDist from every living player, else any floor tile in the room
   that is, else anywhere in the room. null outside a fight. */
function dgSpawnPoint(){
  const D=S&&S.dg; if(!D||D.room<0||!TM)return null;
  const rm=TM.rooms[D.room], alive=dgAlive(), md=DGN.spawnMinDist||96;
  const ok=pt=>alive.every(p=>Math.hypot(p.x-pt[0],p.y-pt[1])>=md);
  const marks=rm.spawns.filter(ok);
  if(marks.length){ const m=marks[irnd(0,marks.length)]; return [m[0]+rnd(-5,5),m[1]+rnd(-5,5)]; }
  for(let t=0;t<30;t++){ const pt=dgRoomFloorPoint(D.room,10); if(ok(pt))return pt; }
  return dgRoomFloorPoint(D.room,10);
}
function dgPlaceSpawn(e){
  const pt=dgSpawnPoint(); if(!pt)return;
  e.x=pt[0]; e.y=pt[1];
  for(let i=0;i<8;i++){ const a=i/8*TAU; S.fx.push({x:e.x+Math.cos(a)*6,y:e.y+Math.sin(a)*6,
    vx:-Math.cos(a)*20,vy:-Math.sin(a)*20,l:.3,ci:'#b34fff'}); }
}

/* ---------------- flow field (active room only) ----------------
   Multi-source BFS over the locked room's rect + 1 tile, from every living
   player's tile inside it; 8-neighbour without corner cutting; walk-solid
   tiles blocked. Recomputed every flowRecalcSec. */
const DG_NX=[1,-1,0,0,1,1,-1,-1], DG_NY=[0,0,1,-1,1,-1,1,-1];
function dgFlowBuild(ri){
  const rm=TM.rooms[ri], TW=TM.w, T=TM.t;
  const x0=Math.max(0,rm.tx-1), y0=Math.max(0,rm.ty-1);
  const w=Math.min(TW,rm.tx+rm.tw+1)-x0, h=Math.min(TM.h,rm.ty+rm.th+1)-y0, N=w*h;
  // passability once up front, so the BFS inner loop is plain array reads
  const pass=new Uint8Array(N);
  for(let y=0;y<h;y++){ const row=(y+y0)*TW+x0, o=y*w;
    for(let x=0;x<w;x++){ const v=T[row+x];
      pass[o+x]=(v===T_FLOOR||v===T_DOOR||v===T_HAZ)?1:0; } }
  const dist=new Int16Array(N).fill(-1), q=new Int32Array(N);
  let qh=0, qt=0;
  for(const p of S.players.values()){ if(p.dead)continue;
    const tx=Math.floor(p.x/TM.ts)-x0, ty=Math.floor(p.y/TM.ts)-y0;
    if(tx<0||ty<0||tx>=w||ty>=h)continue;
    const k=ty*w+tx; if(dist[k]===0)continue;
    dist[k]=0; q[qt++]=k; }
  while(qh<qt){
    const k=q[qh++], x=k%w, y=(k-x)/w, nd=dist[k]+1;
    for(let i=0;i<8;i++){
      const dx=DG_NX[i], dy=DG_NY[i], nx=x+dx, ny=y+dy;
      if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const nk=k+dy*w+dx;
      if(!pass[nk]||dist[nk]>=0)continue;
      if(i>=4&&(!pass[k+dx]||!pass[k+dy*w]))continue;   // no corner cutting
      dist[nk]=nd; q[qt++]=nk;
    }
  }
  return {x0,y0,w,h,dist,room:ri};
}
/* Unit vector for an enemy chasing `t`: straight at it with a clear walking
   line, otherwise toward the lowest-distance neighbour tile. */
function dgSteer(e,t){
  const dx=t.x-e.x, dy=t.y-e.y, d=Math.hypot(dx,dy)||1;
  const F=S&&S.dg&&S.dg.flow;
  if(!F||losClear(e.x,e.y,t.x,t.y,true))return {x:dx/d,y:dy/d};
  const ts=TM.ts, tx=Math.floor(e.x/ts)-F.x0, ty=Math.floor(e.y/ts)-F.y0;
  if(tx<0||ty<0||tx>=F.w||ty>=F.h)return {x:dx/d,y:dy/d};
  let best=-1,bx=0,by=0;
  const at=(x,y)=>(x<0||y<0||x>=F.w||y>=F.h)?-1:F.dist[y*F.w+x];
  for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
    if(!ox&&!oy)continue;
    const nd=at(tx+ox,ty+oy); if(nd<0)continue;
    if(ox&&oy&&(at(tx+ox,ty)<0||at(tx,ty+oy)<0))continue;
    if(best<0||nd<best){best=nd;bx=tx+ox;by=ty+oy;}
  }
  if(best<0)return {x:dx/d,y:dy/d};
  const cx=(F.x0+bx+.5)*ts-e.x, cy=(F.y0+by+.5)*ts-e.y, cd=Math.hypot(cx,cy)||1;
  return {x:cx/cd,y:cy/cd};
}

/* ---------------- room state machine ----------------
   idle → active (locked) → cleared. start/treasure/shop clear on entry. */
function dgTick(dt){
  const D=S.dg; if(!D||!TM)return;
  // hazard grates burn players (enemies are immune)
  const hz=DGN.hazardDps||6;
  for(const p of S.players.values())
    if(!p.dead&&tileAt(p.x,p.y)===T_HAZ)hurt(p,hz*dt,undefined,true);
  if(D.victoryT>0){ D.victoryT-=dt; if(D.victoryT<=0&&!S.over)runOver({victory:true}); return; }
  // discovery (for the minimap): the room each player stands in, plus its neighbours
  for(const p of S.players.values()){ if(p.dead)continue;
    const ri=dgRoomAt(p.x,p.y); if(ri<0||D.disc.has(ri))continue;
    D.disc.add(ri); }
  if(D.room<0){
    const inset=DGN.triggerInset||24;
    for(const p of S.players.values()){ if(p.dead)continue;
      const ri=dgRoomAt(p.x,p.y,inset); if(ri<0)continue;
      const rm=TM.rooms[ri]; if(rm.state!=='idle')continue;
      if(DG_FIGHT[rm.type]){ dgActivate(ri,p); break; }
      dgEnterSafeRoom(ri);
    }
  }else dgFight(dt);
  if(D.hatch)dgHatchTick(dt);
  if(S.shops&&S.shops.length)dgShopTick(dt);
}
function dgEnterSafeRoom(ri){
  const rm=TM.rooms[ri]; rm.state='cleared';
  if(rm.type==='treasure')dgTreasure(rm);
  else if(rm.type==='shop')dgShopOpen(rm);
}
function dgActivate(ri,trig){
  const D=S.dg, rm=TM.rooms[ri];
  rm.state='active'; D.room=ri; D.locked=true; D.tele=DGN.telegraphSec||0.8; D.enc=null;
  dgSetLock(ri,true);
  // pull every other player (living or dead) that is outside the room in
  // next to whoever tripped it — Enter the Gungeon style
  const pad=DGN.pullInPad||12;
  for(const p of S.players.values()){
    if(p===trig)continue;
    if(dgRoomAt(p.x,p.y,TM.ts)===ri)continue;
    const spot={x:trig.x+rnd(-pad,pad),y:trig.y+rnd(-pad,pad),r:p.r||3};
    collideTiles(spot);
    if(dgRoomAt(spot.x,spot.y,TM.ts)!==ri){ spot.x=trig.x; spot.y=trig.y; }
    dgTeleport(p,spot.x,spot.y);
  }
  // the room wakes up: destructible props appear, portals open on every spawn
  for(const b of rm.breakables){
    const T=ET[ETI[b.kind]]; if(!T)continue;
    const e=mkE(b.kind); e.x=b.x; e.y=b.y; e.hp=e.maxhp=T.hp; e.prop=true; e.spd=0;
    S.en.push(e);
  }
  D.flow=dgFlowBuild(ri); D.flowT=0;
  sfxE('wave');
}
/* Move a player: the host's own through myPos, a remote one with 'tp'. */
function dgTeleport(p,x,y){
  p.x=x; p.y=y;
  if(p.id===myId){ myPos.x=x; myPos.y=y; }
  else{ p.dgTpT=now(); sendTo(p.id,{t:'tp',x:Math.round(x),y:Math.round(y)}); }
}
function dgStartEncounter(rm){
  const D=S.dg, w=S.wave;
  S.waveT=0; S.spawnQ=[]; S.spawnT=0;
  let q;
  if(rm.type==='boss'){
    const spec=DGN.floors[D.floor].boss;
    const kind=spec==='titan'?'titan':spec==='big'?'big':'boss';
    q=buildWaveQueue(w,{kind,interlude:false});
    D.enc={waves:0,first:q.length};
  }else if(rm.type==='elite'){
    const G=(DGN.eliteGuardians||['brute']).filter(k=>ETI[k]!==undefined);
    const g=mkE(G[irnd(0,G.length)]);
    q=[g,...buildWaveQueue(w,{kind:'horde',budgetMult:DGN.eliteEscortMult||0.6,interlude:false})];
    toastAll('⚠ A guardian stirs…'); sfxE('boss');
    D.enc={waves:0,first:q.length};
  }else{
    const mult=(DGN.roomBudgetMult||{})[rm.fp]||1;
    q=buildWaveQueue(w,{kind:'horde',budgetMult:mult,interlude:false});
    D.enc={waves:((DGN.wavesPerRoom||{})[rm.fp]||1)-1,first:q.length,mult};
    rollObjective(w);
  }
  S.spawnQ.push(...q);
}
function dgFight(dt){
  const D=S.dg, rm=TM.rooms[D.room];
  // flow field refresh
  D.flowT+=dt;
  if(D.flowT>=(DGN.flowRecalcSec||0.25)){ D.flowT=0; D.flow=dgFlowBuild(D.room); }
  // anything that blinked/charged out of the sealed room is put back in
  for(const e of S.en){ if(e.prop||e.hp<=0)continue;
    if(dgRoomAt(e.x,e.y)!==D.room)dgContain(e,rm); }
  if(D.tele>0){
    D.tele-=dt;
    if(Math.random()<dt*30)for(const s of rm.spawns){
      const a=rnd(0,TAU); S.fx.push({x:s[0]+Math.cos(a)*7,y:s[1]+Math.sin(a)*7,vx:-Math.cos(a)*18,vy:-Math.sin(a)*18,l:.35,ci:'#b34fff'}); }
    if(D.tele<=0)dgStartEncounter(rm);
    return;
  }
  const alive=S.en.filter(e=>!e.opt&&e.hp>0).length;
  // second wave once the first is mostly down
  if(D.enc&&D.enc.waves>0&&!S.spawnQ.length&&alive<=Math.floor((DGN.secondWaveAt||0.2)*D.enc.first)){
    D.enc.waves--;
    const q=buildWaveQueue(S.wave,{kind:'horde',budgetMult:D.enc.mult||1,interlude:false});
    D.enc.first=q.length; S.spawnQ.push(...q); sfxE('wave');
    return;
  }
  if(D.enc&&D.enc.waves<=0&&!S.spawnQ.length&&!alive)dgClear(rm);
}
function dgClear(rm){
  const D=S.dg;
  rm.state='cleared';
  D.locked=false; dgSetLock(rm.i,false); D.room=-1; D.flow=null; D.enc=null;
  S.eb.length=0;
  S.score+=S.wave*BAL.economy.waveClearScore;
  if(S.obj&&!S.obj.done){
    if(S.obj.ty==='speed')objDone(S.waveT<=S.obj.goal?1:-1);
    else if(S.obj.ty==='notouch')objDone(1);
    else objDone(-1);
  }
  reviveDead();
  // depth first, so a slot unlocked by this clear is already offered by its pick
  D.depth++;
  S.wave=dgWaveFor(D.depth);
  const lastFloor=D.floor>=DGN.floors.length-1;
  if(rm.type==='boss'){
    const B=DGN.bossDrops||{}, c=rm.hatch[0]||[rm.x+rm.w/2,rm.y+rm.h/2];
    for(let i=0;i<(B.chests||2);i++)S.it.push({k:2,x:c[0]+(i-.5)*26,y:c[1]+34});
    let i=0;
    for(const p of S.players.values()){
      for(let k=0;k<(B.heartsPerPlayer||1);k++)S.it.push({k:0,x:c[0]-40+(i++)*12,y:c[1]+52,v:B.heartValue||25});
      if(!p.dead){ p.hp=p.maxhp; p.shield=p.shieldMax||0; }
    }
    if(lastFloor){ D.victoryT=DGN.victoryDelaySec||2; toastAll('✦ THE CORE IS SILENT — DESCENT COMPLETE ✦'); sfxE('objwin'); return; }
    D.hatch={x:c[0],y:c[1],hold:0,shown:-1};
    toastAll('▼ The exit hatch opens — gather on it to descend');
  }
  for(const p of S.players.values())if(!p.dead)startPick(p);
  sfxE('objwin');
}
function dgHatchTick(dt){
  const D=S.dg, H=D.hatch, R=DGN.hatchRadius||40, need=DGN.hatchHoldSec||2;
  const alive=dgAlive();
  const all=alive.length>0&&alive.every(p=>Math.hypot(p.x-H.x,p.y-H.y)<=R);
  if(!all){ if(H.hold>0)H.hold=0; H.shown=-1; return; }
  H.hold+=dt;
  const left=Math.ceil(need-H.hold);
  if(left!==H.shown&&left>0){ H.shown=left; toastAll('▼ Descending in '+left+'…'); }
  if(H.hold>=need)dgNextFloor();
}
function dgNextFloor(){
  const D=S.dg, f=D.floor+1;
  dgEnterFloor(f);
  for(const p of S.players.values())
    if(p.id!==myId)sendTo(p.id,{t:'fl',seed:D.seed,floor:f,x:Math.round(p.x),y:Math.round(p.y)});
  toastAll('▼ FLOOR '+(f+1)+' — '+DGN.floors[f].name);
  sfxE('boss');
}

/* ---------------- props ---------------- */
function dgPropDeath(e,owner){
  if(e.k==='crate'){
    const C=DGN.crate||{};
    if(Math.random()<(C.shardChance||0.35)){ const v=C.shardValue||[4,10];
      S.it.push({k:1,x:e.x+rnd(-3,3),y:e.y+rnd(-3,3),v:irnd(v[0],v[1]+1)}); }
    if(Math.random()<(C.heartChance||0.1))S.it.push({k:0,x:e.x+rnd(-3,3),y:e.y+rnd(-3,3),v:C.heartValue||25});
    for(let i=0;i<8;i++)S.fx.push({x:e.x,y:e.y,vx:rnd(-40,40),vy:rnd(-40,40),l:.35,ci:'#ffd35c'});
  }else if(e.k==='barrel'){
    const B=DGN.barrel||{}, r=B.radius||70, dmg=B.damage||60;
    for(let i=0;i<22;i++){ const a=rnd(0,TAU), sp=rnd(40,140);
      S.fx.push({x:e.x,y:e.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,l:.45,ci:i%3?'#ff9d3c':'#ff5c47'}); }
    S.shake=Math.max(S.shake,.25); sfxE('boom',e.x,e.y);
    // enemies AND players, and it chains into other barrels (deadDone stops loops)
    for(const o of S.en) if(o!==e&&o.hp>0&&Math.hypot(o.x-e.x,o.y-e.y)<r+o.r) damageE(o,dmg,owner);
    for(const p of S.players.values()) if(!p.dead&&Math.hypot(p.x-e.x,p.y-e.y)<r+p.r) hurt(p,dmg);
  }
}

/* ---------------- treasure & shop rooms ---------------- */
function dgTreasure(rm){
  const n=rm.chests.length||1, extra=Math.max(0,S.players.size-1);
  for(let i=0;i<n;i++){ const c=rm.chests[i]||[rm.x+rm.w/2,rm.y+rm.h/2]; S.it.push({k:2,x:c[0],y:c[1]}); }
  const c0=rm.chests[0]||[rm.x+rm.w/2,rm.y+rm.h/2];
  for(let i=0;i<extra;i++)S.it.push({k:2,x:c0[0]+(i+1)*14,y:c0[1]+10});
  sfxE('chest');
}
// mend, cache, refine — the tail of moba.js's PAD_KINDS table. The fallback
// keeps dungeon.js loadable without moba.js (tools/dungeon-preview.html).
const DG_SHOP_KINDS=(typeof PAD_KINDS!=='undefined')?PAD_KINDS.slice(SHOP_KINDS.length):['mend','cache','refine'];
function dgShopOpen(rm){
  const f=Math.min(S.dg.floor,2), SH=DGN.shop||{};
  if(SH.mode==='npc')return;   // the room's merchant (npcs.json) sells instead — set "pads" to bring the pads back
  rm.shop.forEach((s,i)=>{
    const k=DG_SHOP_KINDS[i%DG_SHOP_KINDS.length], spec=SH[k]||{};
    const cost=Array.isArray(spec.cost)?spec.cost[Math.min(f,spec.cost.length-1)]:(spec.cost||50);
    S.shops.push({k,team:-1,cd:0,x:s[0],y:s[1],cost,used:[]});
  });
}
/* Stand on a pad with enough shards to buy. Single use per player. */
function dgShopTick(dt){
  const SH=DGN.shop||{}, R=SH.radius||20;
  for(const sh of S.shops){
    if(DG_SHOP_KINDS.indexOf(sh.k)<0)continue;
    for(const p of S.players.values()){
      if(p.dead||sh.used.includes(p.id))continue;
      if(Math.hypot(p.x-sh.x,p.y-sh.y)>R){ if(p.dgShopWarn===sh)p.dgShopWarn=null; continue; }
      if(p.shards<sh.cost){
        if(p.dgShopWarn!==sh){ p.dgShopWarn=sh; const m='Need ◆'+sh.cost;
          if(p.id===myId)toast(m); else sendTo(p.id,{t:'ts',m}); sfxE('denied'); }
        continue;
      }
      p.shards-=sh.cost; sh.used.push(p.id); sfxE('buy');
      if(sh.k==='mend'){ p.hp=Math.min(p.maxhp,p.hp+p.maxhp*((SH.mend&&SH.mend.heal)||0.4)); toastAll(p.name+' mended'); }
      else if(sh.k==='cache'){ S.it.push({k:2,x:sh.x,y:sh.y+18}); toastAll(p.name+' bought a cache'); }
      else if(sh.k==='refine'){ if(!p.pickOpts)startPick(p); toastAll(p.name+' refined their build'); }
    }
  }
}

/* ---------------- networking helpers (host + client) ---------------- */
/* What a client needs to rebuild the current floor: {seed, floor}, or null
   outside a Descent run (the client then clears any stale tilemap). */
function dgNetInfo(){ return (S&&S.dg)?{seed:S.dg.seed,floor:S.dg.floor}:null; }
/* Late join mid-run: inside the sealed room if a fight is on (they'd be
   pulled in anyway), else beside a living ally, else the start entry. */
function dgLateJoinSpot(){
  const D=S.dg;
  if(D.room>=0&&D.locked)return dgRoomFloorPoint(D.room,20);
  const a=dgAlive()[0];
  if(a){ const sp={x:a.x+rnd(-12,12),y:a.y+rnd(-12,12),r:3}; collideTiles(sp); return [sp.x,sp.y]; }
  return dgEntrySpot(S.players.size);
}
/* Host: should this client's reported position be taken? Not in the moment
   after a floor change/late join (packets still carry the old spot), and
   never from OUTSIDE a sealed room (anti-rubber-band) — that one gets its
   'tp' re-sent, at most every tpResendMs. */
function dgAcceptIn(p,d){
  if(p.dgIgnoreInUntil&&now()<p.dgIgnoreInUntil)return false;
  const D=S.dg;
  if(D.room>=0&&D.locked&&dgRoomAt(d.x,d.y)!==D.room){
    if(!p.dgTpT||now()-p.dgTpT>=(DGN.tpResendMs||500)){
      p.dgTpT=now(); sendTo(p.id,{t:'tp',x:Math.round(p.x),y:Math.round(p.y)}); }
    return false;
  }
  return true;
}

/* ============================================================
   NPCs — placement, stock and purchases (host-authoritative)
   SCAFFOLDING for the shop/dialog pass: the cast, lines and stock live in
   data/npcs.json; the panels that show them are js/panels.js (browser only).
   Placement is deterministic from the floor itself, so host and clients
   derive the identical NPC list from {seed, floor} — nothing extra to sync.
   An NPC instance: {uid, id, room, x, y}. uid embeds the floor, so the host's
   per-run purchase ledger (S.npcBuys) never mixes up two floors' merchants.
   ============================================================ */
function npcDef(id){ return (NPCD&&NPCD.npcs&&NPCD.npcs[id])||null; }
function npcTalkRadius(){ return (NPCD&&NPCD.talkRadius)||28; }
/* nearest free (walkable, non-hazard) tile centre to (x,y) inside room rm */
function dgFreeSpotNear(tm,rm,x,y){
  const ts=tm.ts, tx0=Math.floor(x/ts), ty0=Math.floor(y/ts);
  const ok=(tx,ty)=>{ if(tx<=rm.tx||ty<=rm.ty||tx>=rm.tx+rm.tw-1||ty>=rm.ty+rm.th-1)return false;
    const v=tm.t[ty*tm.w+tx]; return v===T_FLOOR; };
  const taken=[...rm.entry,...rm.shop,...rm.chests,...rm.hatch].map(m=>Math.floor(m[0]/ts)+','+Math.floor(m[1]/ts));
  for(let r=0;r<=12;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
    const tx=tx0+dx, ty=ty0+dy;
    if(ok(tx,ty)&&!taken.includes(tx+','+ty))return [(tx+.5)*ts,(ty+.5)*ts];
  }
  return [x,y];
}
function dgPlaceNpcs(tm){
  const out=[], P=(NPCD&&NPCD.placements)||[];
  for(const pl of P){
    if(!npcDef(pl.npc))continue;
    if(pl.floors&&!pl.floors.includes(tm.floor))continue;
    for(const rm of tm.rooms){
      if(rm.type!==pl.room)continue;
      const sp=rm.npcSpots&&rm.npcSpots.length?rm.npcSpots[0]
        :dgFreeSpotNear(tm,rm,rm.x+rm.w/2,rm.y+rm.h/2-(pl.room==='start'?tm.ts*3:0));
      out.push({uid:'f'+tm.floor+':r'+rm.i+':'+pl.npc,id:pl.npc,room:rm.i,x:sp[0],y:sp[1]});
    }
  }
  return out;
}
/* Training range: the merchant stands beside you so the panels can be tried
   without a dungeon run. Host/solo only (Training never networks). */
function npcTrainingSpawn(x,y){
  if(!S||!npcDef('merchant'))return;
  const n={uid:'train:merchant',id:'merchant',room:-1,x:x+56,y:y-24,r:4};
  collideObstacles(n);
  S.trainNpcs=[n];
}
/* Every NPC that exists right now, host or client. */
function npcList(){
  if(S&&S.training&&S.trainNpcs)return S.trainNpcs;
  return (TM&&TM.npcs)||[];
}
function npcByUid(uid){ return npcList().find(n=>n.uid===uid)||null; }
function npcFloor(){
  if(S&&S.dg)return S.dg.floor;
  if(V&&V.dg)return V.dg[3]||0;
  return 0;
}
function npcItemCost(item,floor){
  const c=item&&item.cost;
  if(Array.isArray(c))return c[Math.min(Math.max(0,floor|0),c.length-1)]||0;
  return c||0;
}
/* What the shop panel shows for one NPC: one row per stock slot. */
function npcStock(npc,floor){
  const def=npc&&npcDef(npc.id), st=(def&&def.shop&&def.shop.stock)||[];
  return st.map((iid,slot)=>{ const it=(NPCD.items||{})[iid]||{name:iid,glyph:'?',locked:true};
    return {slot,iid,name:it.name||iid,glyph:it.glyph||'?',desc:it.desc||'',cost:npcItemCost(it,floor),
      limit:it.limit||0,locked:!!it.locked||!it.fx}; });
}
/* Item effects. Each returns the toast line. Add new fx kinds here. */
const NPC_ITEM_FX={
  mend:(p,it)=>{ const got=healPlayer(p,p.maxhp*(it.arg||0.4)); return p.name+' mended (+'+Math.round(got)+' HP)'; },
  cache:(p,it,npc)=>{ S.it.push({k:2,x:npc.x,y:npc.y+30}); sfxE('chest'); return p.name+' bought a cache'; },
  refine:(p)=>{ if(!p.pickOpts)startPick(p); return p.name+' refined their build'; },
  status:(p,it)=>{ const st=applyStatus(p,it.arg); return st?(p.name+' gained '+((STATUS[it.arg]||{}).name||it.arg)):null; }
};
function npcBuysFor(uid,pid){
  if(!S.npcBuys)S.npcBuys={};
  const k=uid+'|'+pid;
  return S.npcBuys[k]||(S.npcBuys[k]={});
}
/* Host: player p wants slot `slot` from NPC `uid`. Validates everything the
   client could get wrong or fake (range, stock, limit, price) and applies it.
   Returns {ok, m, own:[bought count per slot]} — the client panel renders it. */
function npcBuy(p,uid,slot){
  const npc=npcByUid(uid), def=npc&&npcDef(npc.id);
  const own=()=>{ const b=npcBuysFor(uid,p.id); return ((def&&def.shop&&def.shop.stock)||[]).map((_,i)=>b[i]||0); };
  if(!npc||!def||!def.shop)return {ok:false,m:'Nobody to trade with',own:[]};
  if(p.dead)return {ok:false,m:'You are down',own:own()};
  if(Math.hypot(p.x-npc.x,p.y-npc.y)>npcTalkRadius()*1.8)return {ok:false,m:'Too far away',own:own()};
  const iid=def.shop.stock[slot], it=(NPCD.items||{})[iid];
  if(!it||it.locked||!it.fx||!NPC_ITEM_FX[it.fx])return {ok:false,m:'Not for sale',own:own()};
  const b=npcBuysFor(uid,p.id);
  if(it.limit&&(b[slot]||0)>=it.limit)return {ok:false,m:'Sold out',own:own()};
  const cost=npcItemCost(it,npcFloor());
  if(p.shards<cost){ sfxE('denied'); return {ok:false,m:'Need ◆'+cost,own:own()}; }
  const msg=NPC_ITEM_FX[it.fx](p,it,npc);
  if(msg===null)return {ok:false,m:'Nothing happened',own:own()};
  p.shards-=cost; b[slot]=(b[slot]||0)+1; sfxE('buy');
  if(msg)toastAll(msg);
  return {ok:true,m:it.name+' bought',own:own()};
}
/* Host: read-only ledger for one NPC (the panel asks on open). */
function npcOwn(p,uid){
  const npc=npcByUid(uid), def=npc&&npcDef(npc.id), b=npcBuysFor(uid,p.id);
  return ((def&&def.shop&&def.shop.stock)||[]).map((_,i)=>b[i]||0);
}
