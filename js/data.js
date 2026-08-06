"use strict";
/* ============================================================
   data.js — loads /data JSON and builds live registries.
   Anything added to the JSON files is picked up automatically:
   weapons join the pick/chest pools, classes appear on the class
   select, enemies with a "pool" spec join wave spawns, bosses with
   "inRotation" join the boss cycle, passives/meta rows appear in
   picks and the Sanctum.
   ============================================================ */
let BAL=null;        // balance.json
let DIFFS={};        // difficulties.json
let MOBA=null;       // moba.json — Nexus Siege layout + structure tuning
let CLASSES=[];      // classes.json
let WPN={};          // weapons.json keyed by id (behavior attached)
let WKEYS=[];
let PASSIVES=[];     // passives.json
let META=[];         // meta.json
let ET=[];           // enemies.json (array)
let ETI={};          // enemy id -> index
let SPRC={};         // baked sprite canvases by id
let BOSS_POOL=[];    // rotation boss ids, in enemies.json order
let BOSS_MINION={};  // boss id -> unique minion id

const RARS={c:{n:'COMMON',max:3,dm:1},r:{n:'RARE',max:5,dm:1.15},e:{n:'EPIC',max:7,dm:1.35},l:{n:'LEGENDARY',max:9,dm:1.6}};

/* ---------------- scaling specs ----------------
   value spec {base, flat, perLvl}: (base + flat*(lvl-1)) * (1 + perLvl*(lvl-1))
   count spec {base, per}:          base + floor(per*(lvl-1))
   cd    spec {base, perLvl, min}:  max(min, base - perLvl*(lvl-1))          */
function scaleVal(spec,lvl){ if(!spec)return 0;
  return ((spec.base||0)+(spec.flat||0)*(lvl-1))*(1+(spec.perLvl||0)*(lvl-1)); }
function cnt(spec,lvl){ if(!spec)return 1;
  return Math.max(1,(spec.base||1)+Math.floor((spec.per||0)*(lvl-1))); }
function cdVal(spec,lvl){ if(!spec)return 1;
  return Math.max(spec.min||0.05,(spec.base||1)-(spec.perLvl||0)*(lvl-1)); }

/* ---------------- stat engine ----------------
   'add'  stats stack additively (value * ranks)
   'mult' stats stack multiplicatively (value ^ ranks)
   P_LEVEL stats live on the player object, the rest on p.st.     */
const STAT_KIND={
  maxhp:'add', armor:'add', shieldMax:'add', tMax:'add',
  crit:'add', regen:'add', mag:'add', auraRegen:'add', auraDmg:'add', tithe:'add', tRegen:'add',
  dmgM:'mult', cdM:'mult', spd:'mult', greed:'mult', dashCd:'mult', bspdM:'mult',
  tRchM:'mult', droneHpM:'mult', dmgTakenM:'mult', costM:'mult'
};
const P_LEVEL=new Set(['maxhp','armor','shieldMax','tMax']);
function applyStats(p,stats,ranks=1){
  if(!stats||ranks<=0)return;
  for(const k in stats){
    const v=stats[k], kind=STAT_KIND[k];
    if(!kind){ console.warn('unknown stat',k); continue; }
    const tgt=P_LEVEL.has(k)?p:p.st;
    if(kind==='add') tgt[k]=(tgt[k]||0)+v*ranks;
    else             tgt[k]=(tgt[k]||1)*Math.pow(v,ranks);
  }
}

/* human-readable stat lines — drives class select & Sanctum text */
const STAT_LABEL={
  maxhp:    v=>sign(v)+Math.abs(v)+' max HP',
  armor:    v=>sign(v)+Math.abs(v)+' armor',
  shieldMax:v=>sign(v)+Math.abs(v)+' shield',
  tMax:     v=>sign(v)+Math.abs(v)+' max T-charge',
  mag:      v=>sign(v)+Math.abs(v)+'px pickup radius',
  regen:    v=>sign(v)+Math.abs(v)+' HP/s regen',
  crit:     v=>pct(v)+' crit chance',
  auraDmg:  v=>pct(v)+' ally damage aura',
  auraRegen:v=>sign(v)+Math.abs(v)+' HP/s ally aura',
  tithe:    v=>pct(v)+' shard tithe to allies',
  dmgM:     v=>pctM(v)+' weapon power',
  spd:      v=>pctM(v)+' move speed',
  greed:    v=>pctM(v)+' shard yield',
  bspdM:    v=>pctM(v)+' projectile speed',
  tRchM:    v=>pctM(v)+' T-charge recharge rate',
  tRegen:   v=>sign(v)+Math.abs(v)+' T-charge/s regen',
  droneHpM: v=>pctM(v)+' servitor HP',
  dmgTakenM:v=>pctM(v)+' damage taken',
  costM:    v=>pctM(v)+' T-charge cost',
  cdM:      v=>pctM(1/v)+' fire rate',
  dashCd:   v=>'−'+Math.round((1-v)*100)+'% dash cooldown',
};
function sign(v){return v>=0?'+':'−';}
function pct(v){return (v>=0?'+':'−')+Math.round(Math.abs(v)*100)+'%';}
function pctM(v){return (v>=1?'+':'−')+Math.round(Math.abs(v-1)*100)+'%';}
function genStatDesc(stats){
  const parts=[];
  for(const k in stats||{}){ const f=STAT_LABEL[k]; if(f)parts.push(f(stats[k])); }
  return parts.join(', ');
}
function genClassDesc(c){
  const w=WPN[c.weapon];
  return c.theme+'. '+genStatDesc(c.stats)+'. Starts: '+(w?w.name:c.weapon)+'.';
}

/* weapon description: replaces {tokens} with computed level values */
function wpnDesc(def,lvl){
  const vals={
    count: cnt(def.count,lvl),
    blades:cnt(def.blades,lvl),
    pierce:cnt(def.pierce,lvl),
    hops:  cnt(def.hops,lvl),
    dmg:   Math.round(scaleVal(def.dmg,lvl)),
    boom:  Math.round(scaleVal(def.boom,lvl)),
    pois:  Math.round(scaleVal(def.pois,lvl)),
    dps:   Math.round(scaleVal(def.dmg,lvl)),
    radius:Math.round(scaleVal(def.radius,lvl)),
    hp:    Math.round(scaleVal(def.hp,lvl)),
  };
  return (def.desc||def.name).replace(/\{(\w+)\}/g,(_,k)=>vals[k]!==undefined?vals[k]:'?');
}

/* ---------------- sprite baking ---------------- */
/* Small HSL round-trip so team recoloring can shift HUE while leaving
   saturation/lightness alone — that's what keeps a recolored sprite reading
   as "the same shape, different team" instead of a flat color swap. */
function hexToHsl(hex){
  const r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0,s=0; const l=(max+min)/2;
  if(max!==min){
    const d=max-min;
    s=l>0.5?d/(2-max-min):d/(max+min);
    if(max===r)h=(g-b)/d+(g<b?6:0);
    else if(max===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;
  }
  return {h,s,l};
}
function hslToHex(h,s,l){
  h=((h%360)+360)%360;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r,g,b;
  if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
  const toHex=v=>Math.round((v+m)*255).toString(16).padStart(2,'0');
  return '#'+toHex(r)+toHex(g)+toHex(b);
}
/* Rotates a hex color's hue partway toward targetHue (shortest way round the
   wheel) rather than replacing it outright, so a sprite's several palette
   colors keep their relative contrast instead of all collapsing onto one
   hue. Near-grey colors (outlines, highlights) are left alone — there's no
   visible hue to shift when saturation is this low, and forcing one in just
   tints blacks/whites/greys with visible fringing. */
function teamTint(hex,targetHue,mix){
  const {h,s,l}=hexToHsl(hex);
  if(s<0.08)return hex;
  let diff=((targetHue-h+540)%360)-180;
  return hslToHex(h+diff*mix, Math.min(1,s*1.08), l);
}
function bakeSprite(id,spr){
  const rows=spr.rows, h=rows.length, w=Math.max(...rows.map(r=>r.length));
  const render=(key,recolor)=>{
    const oc=document.createElement('canvas'); oc.width=w; oc.height=h;
    const o=oc.getContext('2d');
    rows.forEach((r,y)=>{for(let x=0;x<r.length;x++){const c0=spr.pal[r[x]];
      if(c0){o.fillStyle=recolor?recolor(c0):c0;o.fillRect(x,y,1,1);}}});
    SPRC[key]={c:oc,w,h};
  };
  render(id,null);
  // AZURE/CRIMSON variants for team-owned entities (siege creeps, structures,
  // reinforcements…) — picked at render time by e.team, see render.js. Baked
  // for every sprite unconditionally; harmless and unused for anything that
  // never carries a team.
  const TH=(MOBA&&MOBA.teamColors)?MOBA.teamColors.map(c=>hexToHsl(c).h):[182,322];
  render(id+'_t0',c=>teamTint(c,TH[0],0.45));
  render(id+'_t1',c=>teamTint(c,TH[1],0.45));
}

/* Human-readable summary of what a relic actually does — the stat blocks are
   data, so this renders them rather than duplicating the text by hand. */
const STAT_WORDS={
  spd:'move speed', dmgM:'weapon power', cdM:'fire rate', crit:'crit chance',
  regen:'health regen', greed:'shard gain', dashCd:'dash cooldown',
  bspdM:'projectile speed', maxhp:'max HP', armor:'armor',
  shieldMax:'shield', tMax:'charge capacity', tRchM:'recharge rate', tRegen:'charge regen',
  droneHpM:'servitor HP', dmgTakenM:'damage taken', costM:'charge cost',
  auraRegen:'ally regen aura', auraDmg:'ally damage aura', tithe:'ally shard tithe',
  mag:'pickup radius'
};
function passiveText(ps){
  if(ps.desc)return ps.desc;
  const out=[];
  for(const k in (ps.stats||{})){
    const v=ps.stats[k], name=STAT_WORDS[k]||k;
    // multiplicative stats hover around 1, additive ones do not
    if(k==='cdM'||k==='dashCd'||k==='dmgTakenM')
      out.push((v<1?'−':'+')+Math.round(Math.abs(1-v)*100)+'% '+name);
    else if(Math.abs(v-1)<0.9&&['dmgM','spd','greed','bspdM','tRchM','droneHpM','costM'].includes(k))
      out.push((v>=1?'+':'−')+Math.round(Math.abs(v-1)*100)+'% '+name);
    else out.push((v>=0?'+':'')+v+' '+name);
  }
  if(ps.heal)out.push('heals '+ps.heal);
  return out.join(' · ')||'—';
}

/* ---------------- loader ---------------- */
async function fetchJson(path){
  const r=await fetch(path);
  if(!r.ok)throw new Error(path+' → HTTP '+r.status);
  return r.json();
}
async function loadData(){
  const [bal,diffs,classes,weapons,enemies,passives,meta,sprites,moba]=await Promise.all([
    fetchJson('data/balance.json'),   fetchJson('data/difficulties.json'),
    fetchJson('data/classes.json'),   fetchJson('data/weapons.json'),
    fetchJson('data/enemies.json'),   fetchJson('data/passives.json'),
    fetchJson('data/meta.json'),      fetchJson('data/sprites.json'),
    fetchJson('data/moba.json'),
  ]);
  BAL=bal; DIFFS=diffs; MOBA=moba;

  /* weapons: attach behavior + compat aliases */
  WPN={};
  for(const def of weapons){
    def.g=def.glyph; def.n=def.name; def.rt=def.resource||'none';
    def.cdSpec=def.cd; def.cd=w=>cdVal(def.cdSpec,w.lvl);
    def.d=lvl=>wpnDesc(def,lvl);
    attachBehavior(def);              // from weapons.js
    WPN[def.id]=def;
  }
  WKEYS=Object.keys(WPN);

  /* classes */
  CLASSES=classes;
  for(const c of CLASSES){ c.g=c.glyph; c.n=c.name; c.wpn=c.weapon; }

  /* passives: desc auto-generated from stats, or given verbatim for "special"
     entries whose behavior can't be expressed as a plain stat (see SPECIAL_PASSIVES
     in sim.js) — those set "desc" directly in passives.json instead of "stats". */
  PASSIVES=passives;
  for(const ps of PASSIVES){
    ps.g=ps.glyph; ps.n=ps.name;
    ps.d=(ps.mp?'CO-OP · ':'')+(ps.desc||(genStatDesc(ps.stats)+(ps.heal?(', heal '+ps.heal):'')));
    ps.f=p=>{ applyStats(p,ps.stats);
      if(ps.heal)p.hp=Math.min(p.maxhp,p.hp+ps.heal);
      if(ps.special&&SPECIAL_PASSIVES[ps.special])SPECIAL_PASSIVES[ps.special](p); };
  }

  /* meta shop: desc auto-generated from stats */
  META=meta;
  for(const m of META) m.desc=genStatDesc(m.stats)+' per rank';

  /* enemies: registry + sprites + boss rotation + minion links */
  ET=enemies; ETI={};
  BOSS_POOL=[]; BOSS_MINION={};
  ET.forEach((e,i)=>{
    ETI[e.id]=i;
    e.k=e.id; e.sc=e.score; e.sh=e.shards;
    e.bn=e.bossName; e.opt=!!e.optional; e.uniq=!!e.unique; e.scl=e.scale||1;
    bakeSprite(e.id,e.sprite);
    if(e.boss&&e.inRotation)BOSS_POOL.push(e.id);
    if(e.boss&&e.minion)BOSS_MINION[e.id]=e.minion;
  });
  for(const id in sprites) bakeSprite(id,sprites[id]);

  if(!BOSS_POOL.length)throw new Error('no rotation bosses defined in enemies.json');
}
const CLS=id=>CLASSES.find(c=>c.id===id)||CLASSES[0];
function bossKeyFor(bw){
  const every=BAL.waves.bossEvery;
  return BOSS_POOL[(Math.max(1,Math.floor(bw/every))-1)%BOSS_POOL.length];
}
const mlv=id=>save.meta[id]||0;
const metaCost=m=>Math.floor(m.base*Math.pow(BAL.economy.metaCostGrowth,mlv(m.id)));
