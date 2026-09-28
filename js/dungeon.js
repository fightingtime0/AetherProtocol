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
    spawns:[],chests:[],shop:[],shrine:[],hatch:[],entry:[],solids:[],breakables:[],decor:[]});
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
