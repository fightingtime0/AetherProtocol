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
