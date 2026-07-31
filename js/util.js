"use strict";
/* ============================================================
   util.js — constants, helpers, persistent save, shared state
   ============================================================ */
const VW=480, VH=270;          // internal render size
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
  ent.x=clamp(ent.x,6,WW-6); ent.y=clamp(ent.y,6,WH-6);
}
function bulletHitsObstacle(b){
  for(const o of obstacles) if(Math.hypot(b.x-o.x,b.y-o.y)<o.r) return true;
  return b.x<0||b.x>WW||b.y<0||b.y>WH;
}
