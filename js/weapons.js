"use strict";
/* ============================================================
   weapons.js — weapon behavior archetypes.
   A weapon in data/weapons.json picks one of these via "type";
   all numbers come from the JSON. New weapons that reuse an
   existing type need zero engine changes.
   Types: aimed, radial, lance, scatter, lob, chain, smite,
          zone, drone, orbit (passive), saber (passive)
   ============================================================ */
function pbul(o){ S.pb.push(Object.assign({id:bidc++,r:1.5,ttl:2.4,pierce:0,ci:0,home:0,slow:0},o)); }
function boom(x,y,r,dmg,owner,col){
  for(const e of S.en) if(e.hp>0&&Math.hypot(e.x-x,e.y-y)<r+e.r) damageE(e,dmg,owner);
  for(let i=0;i<16;i++){const a=rnd(0,TAU),sp=rnd(30,95);
    S.fx.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,l:.35,ci:col||'#ff9d3c'});}
  S.shake=Math.max(S.shake,.12); sfxE('boom');
}

function wDmg(def,w,p){ return scaleVal(def.dmg,w.lvl)*RARS[w.rar].dm*p.st.dmgM; }
function orbCount(w){ return cnt(WPN[w.id].blades,w.lvl); }
function orbDmg(p,w){ return wDmg(WPN[w.id],w,p); }
function sabCountW(w){ return cnt(WPN[w.id].blades,w.lvl); }
function droneStats(def,lvl,rar,p){
  const dm=RARS[rar||'c'].dm;
  return { hp:Math.round(scaleVal(def.hp,lvl)*dm*(p?p.st.droneHpM:1)),
           dmg:scaleVal(def.dmg,lvl)*dm*(p?p.st.dmgM:1) };
}

const NEEDS_TARGET={aimed:1,lance:1,lob:1,chain:1,smite:1,zone:1,scatter:1};
const BEHAVIORS={
  aimed(def,p,w,tg){
    const a=Math.atan2(tg.y-p.y,tg.x-p.x), n=cnt(def.count,w.lvl);
    const dmg=wDmg(def,w,p);
    const pois=def.pois?scaleVal(def.pois,w.lvl)*RARS[w.rar].dm*p.st.dmgM:0;
    for(let i=0;i<n;i++){
      const off=(i-(n-1)/2)*(def.spreadStep||.13);
      const crit=def.canCrit&&Math.random()<p.st.crit;
      const sp=def.speed*p.st.bspdM;
      pbul({x:p.x,y:p.y,vx:Math.cos(a+off)*sp,vy:Math.sin(a+off)*sp,
        dmg:dmg*(crit?BAL.combat.critMult:1),ci:crit?5:(def.ci||0),
        r:def.r||1.5, slow:def.slow?1:0, pois, owner:p.id,
        boom:def.boom?scaleVal(def.boom,w.lvl):0,
        boomDmg:def.boom?dmg*(def.boomDmgFrac||1):0});
    }
  },
  radial(def,p,w){
    const n=cnt(def.count,w.lvl), dmg=wDmg(def,w,p);
    for(let i=0;i<n;i++){const sp=def.speed*p.st.bspdM;
      pbul({x:p.x,y:p.y,vx:Math.cos(i/n*TAU)*sp,vy:Math.sin(i/n*TAU)*sp,dmg,ci:def.ci||0,owner:p.id});}
  },
  lance(def,p,w,tg){
    const a=Math.atan2(tg.y-p.y,tg.x-p.x), sp=def.speed*p.st.bspdM;
    pbul({x:p.x,y:p.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,dmg:wDmg(def,w,p),
      pierce:cnt(def.pierce,w.lvl),ci:def.ci||0,r:def.r||1.5,owner:p.id});
  },
  scatter(def,p,w,tg){
    const a=Math.atan2(tg.y-p.y,tg.x-p.x), n=cnt(def.count,w.lvl), dmg=wDmg(def,w,p);
    for(let i=0;i<n;i++){
      const off=rnd(-def.spread,def.spread), sp=rnd(def.speedMin,def.speedMax)*p.st.bspdM;
      pbul({x:p.x,y:p.y,vx:Math.cos(a+off)*sp,vy:Math.sin(a+off)*sp,dmg,ttl:def.ttl,ci:def.ci||0,owner:p.id});
    }
  },
  lob(def,p,w,tg){
    const a=Math.atan2(tg.y-p.y,tg.x-p.x);
    const d2=Math.max(24,Math.min(Math.hypot(tg.x-p.x,tg.y-p.y),def.maxRange));
    const sp=def.speed*p.st.bspdM, dmg=wDmg(def,w,p);
    pbul({x:p.x,y:p.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
      dmg:dmg*(def.impactFrac||.3),r:def.r||2.5,ci:def.ci||5,
      ttl:d2/sp,boom:scaleVal(def.boom,w.lvl),boomDmg:dmg,owner:p.id});
  },
  chain(def,p,w,tg){
    const hops=cnt(def.hops,w.lvl), dmg=wDmg(def,w,p);
    let cur=tg; const hit=new Set();
    for(let i=0;i<hops&&cur;i++){ hit.add(cur.id); damageE(cur,dmg,p.id);
      for(let j=0;j<5;j++)S.fx.push({x:cur.x,y:cur.y,vx:rnd(-45,45),vy:rnd(-45,45),l:.25,ci:'#4ef0e8'});
      let nx=null,bd=def.range*def.range;
      for(const e of S.en) if(!hit.has(e.id)&&e.hp>0){
        const d=(e.x-cur.x)**2+(e.y-cur.y)**2; if(d<bd){bd=d;nx=e;} }
      cur=nx; }
  },
  smite(def,p,w,tg){
    boom(tg.x,tg.y,scaleVal(def.boom,w.lvl),wDmg(def,w,p),p.id,'#ffd35c');
  },
  zone(def,p,w,tg){
    S.zn.push({x:tg.x,y:tg.y,r:scaleVal(def.radius,w.lvl),
      dps:wDmg(def,w,p),ttl:def.duration||3,owner:p.id});
  },
  drone(def,p,w){
    const st2=droneStats(def,w.lvl,w.rar,p);
    S.dr.push({x:p.x+rnd(-6,6),y:p.y+rnd(-6,6),hp:st2.hp,maxhp:st2.hp,
      dmg:st2.dmg,owner:p.id,hitCd:0,r:3});
  },
};
function attachBehavior(def){
  if(def.type==='orbit'){ def.passiveOrbit=1; def.needT=0; def.fire=()=>{}; return; }
  if(def.type==='saber'){ def.passiveSaber=1; def.needT=0; def.fire=()=>{}; return; }
  const b=BEHAVIORS[def.type];
  if(!b)throw new Error('unknown weapon type "'+def.type+'" on '+def.id);
  def.needT=NEEDS_TARGET[def.type]||0;
  def.drone=def.type==='drone'?1:0;
  def.fire=(p,w,tg)=>b(def,p,w,tg);
}
