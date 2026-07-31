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
  hurtPlayersAt(x,y,r,dmg,owner); // PvP: explosions have to catch players too
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

// orbit deliberately absent: fangs are summoned around the player, so the
// weapon must fire even with nothing in range
const NEEDS_TARGET={aimed:1,lance:1,lob:1,chain:1,smite:1,zone:1,scatter:1,beam:1,wave:1,boomerang:1};
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
  /* Orbiting Fang — now an active summon: costs charge, the fangs orbit
     wide on their own, and each detonates on whatever it touches. They
     ride S.pb as bullets with an `orb` flag, so collision, explosion,
     snapshotting and rendering all come for free. */
  orbit(def,p,w){
    const OB=BAL.combat.orbit, n=cnt(def.blades,w.lvl), dmg=wDmg(def,w,p);
    const base=rnd(0,TAU);
    for(let i=0;i<n;i++){
      pbul({x:p.x,y:p.y,vx:0,vy:0,dmg,r:def.r||2,ci:def.ci||3,owner:p.id,
        ttl:OB.life,pierce:0,
        orb:1, orbA:base+i/n*TAU, orbR:OB.radius,
        boom:scaleVal(def.boom,w.lvl)||OB.boom,
        boomDmg:dmg*(OB.boomDmgFrac||.85)});
    }
  },
  /* Orbital Smite — marks a SPOT, shrinks a targeting ring onto it, then
     hits that spot. Deliberately does not track the target: dodging out
     of the circle is the counterplay. */
  smite(def,p,w,tg){
    const SB=BAL.combat.smite;
    S.mk.push({x:tg.x,y:tg.y,t:SB.markTime,tMax:SB.markTime,
      r0:SB.startRadius,r:scaleVal(def.boom,w.lvl),
      dmg:wDmg(def,w,p),owner:p.id});
  },
  chain(def,p,w,tg){
    // now travels as a bolt; the chain only fires where it lands (see S.pb)
    const a=Math.atan2(tg.y-p.y,tg.x-p.x), sp=def.speed||210;
    pbul({x:p.x,y:p.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
      dmg:wDmg(def,w,p),r:def.r||2,ci:def.ci||1,owner:p.id,ttl:1.6,pierce:0,
      chain:{hops:cnt(def.hops,w.lvl),range:def.range||85}});
  },
  zone(def,p,w,tg){
    S.zn.push({x:tg.x,y:tg.y,r:scaleVal(def.radius,w.lvl),
      dps:wDmg(def,w,p),ttl:def.duration||3,owner:p.id});
  },
  drone(def,p,w){
    const st2=droneStats(def,w.lvl,w.rar,p);
    // drone:1 + team make servitors first-class targets — creeps, structures
    // and siege lords can pick them, exactly like a creep
    S.dr.push({x:p.x+rnd(-6,6),y:p.y+rnd(-6,6),hp:st2.hp,maxhp:st2.hp,
      dmg:st2.dmg,owner:p.id,hitCd:0,r:3,drone:1,team:p.team,stuck:false});
  },
  beam(def,p,w,tg){ // continuous laser: hitscan tick that pierces everyone in the line
    const a=Math.atan2(tg.y-p.y,tg.x-p.x), range=def.range||220, dmg=wDmg(def,w,p);
    const dx=Math.cos(a), dy=Math.sin(a), width=def.width||3;
    for(const e of S.en){ if(e.hp<=0)continue;
      const ex=e.x-p.x, ey=e.y-p.y, proj=ex*dx+ey*dy;
      if(proj<0||proj>range+e.r)continue;
      const perp=Math.abs(ex*dy-ey*dx);
      if(perp<width+e.r) damageE(e,dmg,p.id,true); }
    // same hitscan line, against hostile players
    for(const q of foePlayers(p)){
      const ex=q.x-p.x, ey=q.y-p.y, proj=ex*dx+ey*dy;
      if(proj<0||proj>range+q.r)continue;
      if(Math.abs(ex*dy-ey*dx)<width+q.r) hurt(q,dmg,p.id,true); } // continuous beam: no i-frames
    p.beamOnT=0.12; p.beamAng=a; p.beamLen=range;
    if(Math.random()<.6)S.fx.push({x:p.x+dx*rnd(10,range*.9),y:p.y+dy*rnd(10,range*.9),
      vx:rnd(-8,8),vy:rnd(-8,8),l:.12,ci:'#ff4fd8'});
  },
  wave(def,p,w,tg){ // weird-trajectory shot: sine-weaves toward its target heading
    const a=Math.atan2(tg.y-p.y,tg.x-p.x), dmg=wDmg(def,w,p), n=cnt(def.count,w.lvl);
    for(let i=0;i<n;i++){
      const baseAng=a+(i-(n-1)/2)*(def.spreadStep||0), sp=def.speed*p.st.bspdM;
      pbul({x:p.x,y:p.y,vx:Math.cos(baseAng)*sp,vy:Math.sin(baseAng)*sp,
        dmg,ci:def.ci||3,r:def.r||1.5,owner:p.id,pierce:cnt(def.pierce,w.lvl),
        wob:1,baseAng,wx0:p.x,wy0:p.y,wspd:sp,wobT:0,
        wfreq:def.wobFreq||6,wamp:def.wobAmp||14});
    }
  },
  boomerang(def,p,w,tg){ // thrown blade: flies out, then curves back to whoever threw it
    const a=Math.atan2(tg.y-p.y,tg.x-p.x), dmg=wDmg(def,w,p), sp=def.speed*p.st.bspdM;
    pbul({x:p.x,y:p.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,dmg,ci:def.ci||4,
      r:def.r||2,owner:p.id,pierce:cnt(def.pierce,w.lvl)||20,ttl:def.ttl||3.2,
      rang:1,outT:def.outT||0.5,rspd:sp*1.15,rt:0,returning:false});
  },
};
/* Resolved from hostUpdate once a smite mark's timer expires. */
function smiteHit(m){
  boom(m.x,m.y,m.r,m.dmg,m.owner,'#ffd35c');
  sfxE('smiteHit');
}
/* Chain burst, fired where the Arc Discharge bolt lands. Every hop is
   recorded in S.ar so host and clients draw the arcs that actually hit. */
function chainBurst(b){
  const p=S.players.get(b.owner);
  const hops=b.chain.hops, dmg=b.dmg, range=b.chain.range;
  let cur={x:b.x,y:b.y,id:-1};
  const hit=new Set();
  const foes=p?foePlayers(p):[];
  for(let i=0;i<hops&&cur;i++){
    if(cur.id!==-1){ // the seed point is where the bolt landed, not a target
      hit.add((cur.weapons?'p':'e')+cur.id);
      if(cur.weapons)hurt(cur,dmg,b.owner); else damageE(cur,dmg,b.owner);
    }
    let nx=null,bd=range*range;
    for(const e of S.en) if(!hit.has('e'+e.id)&&e.hp>0){
      if(p&&!hostile(p.team,e.team))continue;
      const d=(e.x-cur.x)**2+(e.y-cur.y)**2; if(d<bd){bd=d;nx=e;} }
    for(const q of foes) if(!hit.has('p'+q.id)&&!q.dead){
      const d=(q.x-cur.x)**2+(q.y-cur.y)**2; if(d<bd){bd=d;nx=q;} }
    if(nx){
      S.ar.push({x1:cur.x,y1:cur.y,x2:nx.x,y2:nx.y,l:BAL.combat.chainArc.life});
      for(let j=0;j<4;j++)S.fx.push({x:nx.x,y:nx.y,vx:rnd(-45,45),vy:rnd(-45,45),l:.25,ci:'#4ef0e8'});
    }
    cur=nx;
  }
}
function attachBehavior(def){
  // orbit is no longer a passive aura — it is an active summon that costs
  // charge, so it goes through the normal fire path like everything else
  if(def.type==='saber'){ def.passiveSaber=1; def.needT=0; def.fire=()=>{}; return; }
  const b=BEHAVIORS[def.type];
  if(!b)throw new Error('unknown weapon type "'+def.type+'" on '+def.id);
  def.needT=NEEDS_TARGET[def.type]||0;
  def.drone=def.type==='drone'?1:0;
  def.fire=(p,w,tg)=>b(def,p,w,tg);
}
