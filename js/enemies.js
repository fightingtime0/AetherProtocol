"use strict";
/* ============================================================
   enemies.js — spawning + AI behaviors.
   Each enemy in data/enemies.json names an "ai" implemented in
   the switch below. New enemies that reuse an existing ai key
   need zero engine changes (stats come from the JSON).
   ============================================================ */
let eidc=1;
let bidc=1;
/* team is undefined for classic PvE fire (hits players only, as always);
   MOBA structures pass their own team so friendly fire is impossible. */
function ebul(x,y,a,sp,ci,r=1.5,team,dmg){ sp*=DIFF().aggression||1;
  S.eb.push({id:bidc++,x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r,ci,ttl:5,team,dmg}); }

function mkE(k){
  const T=ET[ETI[k]];
  // spawn near a random player, outside their view
  const ps=[...(S?S.players.values():[])].filter(p=>!p.dead);
  const anchor=ps.length?ps[irnd(0,ps.length)]:{x:WW/2,y:WH/2};
  let x,y,tries=0;
  do{ const a=rnd(0,TAU), d=rnd(200,300);
    x=clamp(anchor.x+Math.cos(a)*d,12,WW-12); y=clamp(anchor.y+Math.sin(a)*d,12,WH-12);
  }while(tries++<8 && obstacles.some(o=>Math.hypot(o.x-x,o.y-y)<o.r+6));
  const D=DIFF(), WV=BAL.waves;
  const hpMul=(1+(S?S.wave:1)*WV.enemyHpPerWave*(0.7+(S?S.players.size:1)*0.3))*D.enemyHp;
  const base=T.boss?T.hp*D.enemyHp
    :(T.mini?T.hp*(1+(S?S.wave:1)*WV.miniHpPerWave)*D.enemyHp:T.hp*hpMul);
  return {id:eidc++,ti:ETI[k],k,ai:T.ai||k,x,y,r:T.r,hp:base,maxhp:base,scl:T.scl||1,
    spd:T.spd*(1+(S?S.wave:0)*.01),sc:T.sc,sh:T.sh,opt:!!T.opt,boss:!!T.boss,mini:!!T.mini,
    ph:rnd(0,TAU),cd:rnd(.8,1.8),flash:0,slowT:0,st:0,stT:0,ang:0,tpT:0,poisT:0,poisD:0};
}
function mkBoss(k,w,np){
  const e=mkE(k);
  e.hp=e.maxhp=ET[ETI[k]].hp*(1+w*BAL.waves.bossHpPerWave)*(0.6+np*0.4)*DIFF().enemyHp;
  return e;
}
/* ---- MOBA structure helpers ----
   Structures shoot CREEPS first and only switch to players once the lane
   is clear. That is what makes advancing behind a wave work: without it a
   turret ignores the wave and deletes whoever walks in first. */
function structFoe(e,range){
  let best=null,bd=range*range;
  for(const o of S.en){
    if(o===e||o.hp<=0||o.struct||!hostile(e.team,o.team))continue;
    const d=(o.x-e.x)**2+(o.y-e.y)**2; if(d<bd){bd=d;best=o;}
  }
  for(const dn of S.dr){ // servitors count as creeps for targeting purposes
    if(dn.hp<=0||!hostile(e.team,dn.team))continue;
    const d=(dn.x-e.x)**2+(dn.y-e.y)**2; if(d<bd){bd=d;best=dn;}
  }
  if(best)return best;                      // creeps/servitors take priority
  for(const q of S.players.values()){
    if(q.dead||!hostile(e.team,q.team))continue;
    const d=(q.x-e.x)**2+(q.y-e.y)**2; if(d<bd){bd=d;best=q;}
  }
  return best;
}
/* One entry point for "damage whatever structFoe handed back", since that
   can now be an entity, a player or a servitor and each takes damage a
   different way. */
function hitTarget(t,dmg,srcId,dot){
  if(!t)return;
  if(t.drone){ t.hp-=dmg; return; }
  if(t.weapons){ hurt(t,dmg,srcId,dot); return; }
  damageE(t,dmg,srcId,dot);
}
/* Continuous lance shared by nexus / turret / guardian. Burns everything
   hostile along the line; lang/llen ride the snapshot so clients draw it. */
function structLaser(e,tgt,dt,cfg){
  const d=Math.hypot(tgt.x-e.x,tgt.y-e.y)||1;
  if(!cfg.laserDps||d>cfg.laserRange){
    e.laserOn=0; e.llen=0; e.laserTgt=undefined; e.laserHeat=0; return; }
  /* The beam winds up: it opens weak and bites harder the longer it stays
     locked on one target, and resets the moment it switches or breaks off.
     That makes stepping out of the beam meaningful instead of a flat tax. */
  const R=MOBA.laserRamp;
  const tid=(tgt.weapons?'p':tgt.drone?'d':'e')+(tgt.id!==undefined?tgt.id:'?');
  if(e.laserTgt!==tid){ e.laserTgt=tid; e.laserHeat=0; }
  e.laserHeat=Math.min(1,(e.laserHeat||0)+dt/R.time);
  const heat=R.from+(R.to-R.from)*e.laserHeat;
  const aim=Math.atan2(tgt.y-e.y,tgt.x-e.x);
  e.lang=aim; e.llen=Math.min(d,cfg.laserRange); e.laserOn=1;
  const lx=Math.cos(aim), ly=Math.sin(aim), w=cfg.laserWidth||4;
  const bite=o=>{
    const ex=o.x-e.x, ey=o.y-e.y, proj=ex*lx+ey*ly;
    if(proj<0||proj>cfg.laserRange+o.r)return false;
    return Math.abs(ex*ly-ey*lx)<w+o.r;
  };
  const span=dotReady(e,dt);   // shared DoT cadence — see dotReady()
  if(!span)return;
  const amt=cfg.laserDps*heat*span;
  for(const q of S.players.values()){
    if(q.dead||!hostile(e.team,q.team))continue;
    if(q.id!==myId&&!q.bot)continue;             // remote humans self-report
    if(bite(q))hurt(q,amt,undefined,true);       // dot: grants no i-frames
  }
  for(const o of S.en){
    if(o===e||o.hp<=0||!hostile(e.team,o.team))continue;
    if(bite(o))damageE(o,amt,undefined,true);
  }
  for(const dn of S.dr){ // servitors burn in the beam like anything else
    if(dn.hp<=0||!hostile(e.team,dn.team))continue;
    if(bite(dn))dn.hp-=amt;
  }
}
function nearestPlayer(e){
  let bp=null,bd=1e9;
  for(const p of S.players.values()){ if(p.dead)continue;
    const d=(p.x-e.x)**2+(p.y-e.y)**2; if(d<bd){bd=d;bp=p;} }
  return bp;
}

function enemyAct(e,dt){
  // nearestFoe() is identical to nearestPlayer() outside a Nexus Siege
  // match, so every existing enemy behaves exactly as it did before.
  const p=nearestFoe(e); if(!p)return;
  const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy)||1,aim=Math.atan2(dy,dx);
  const sm=e.slowT>0?0.45:1; e.slowT=Math.max(0,e.slowT-dt);
  e.cd-=dt;
  const mv=(sx,sy,m=1)=>{e.x+=sx*e.spd*sm*m*dt; e.y+=sy*e.spd*sm*m*dt;};
  switch(e.ai){
   default:
   case 'imp': mv(dx/d,dy/d);
     if(e.cd<=0){e.cd=rnd(1.7,2.5); ebul(e.x,e.y,aim,58,2);} break;
   case 'skull': if(d>70)mv(dx/d,dy/d);
     if(e.cd<=0){e.cd=rnd(2.3,3.1);const n=8+Math.min(8,Math.floor(S.wave/2));
       for(let i=0;i<n;i++)ebul(e.x,e.y,e.ph+i/n*TAU,40,1); e.ph+=.4;} break;
   case 'turret':
     if(e.cd<=0){e.cd=Math.max(.1,.2-S.wave*.003);
       ebul(e.x,e.y,e.ph,48,2); ebul(e.x,e.y,e.ph+Math.PI,48,1); e.ph+=.5;} break;
   case 'wisp':{const orb=aim+Math.PI/2; mv(dx/d*.7+Math.cos(orb)*.5, dy/d*.7+Math.sin(orb)*.5);
     if(e.cd<=0){e.cd=rnd(1.5,2.2);for(let i=-1;i<=1;i++)ebul(e.x,e.y,aim+i*.22,66,3);}} break;
   case 'slash': // melee: chase, windup, lunge
     if(e.st===0){ mv(dx/d,dy/d);
       if(d<32){e.st=1;e.stT=.35;e.ang=aim;} }
     else if(e.st===1){ e.flash=.05; e.stT-=dt;
       if(e.stT<=0){e.st=2;e.stT=.28;} }
     else{ e.x+=Math.cos(e.ang)*250*sm*dt; e.y+=Math.sin(e.ang)*250*sm*dt;
       e.stT-=dt; if(e.stT<=0)e.st=0; }
     break;
   case 'charge': // telegraph then line charge
     if(e.st===0){ mv(dx/d,dy/d,.7);
       if(d<170&&e.cd<=0){e.st=1;e.stT=.6;e.ang=aim;} }
     else if(e.st===1){ e.flash=.05; e.stT-=dt;
       if(e.stT<=0){e.st=2;e.stT=1.0;} }
     else if(e.st===2){ const ox=e.x,oy=e.y;
       e.x+=Math.cos(e.ang)*265*sm*dt; e.y+=Math.sin(e.ang)*265*sm*dt;
       e.stT-=dt;
       let hitObs=obstacles.some(o=>Math.hypot(o.x-e.x,o.y-e.y)<o.r+e.r);
       if(e.stT<=0||hitObs||e.x<8||e.x>WW-8||e.y<8||e.y>WH-8){e.st=3;e.stT=.8;e.cd=2.2;if(hitObs){e.x=ox;e.y=oy;}} }
     else{ e.stT-=dt; if(e.stT<=0)e.st=0; }
     break;
   case 'brute': mv(dx/d,dy/d);
     if(e.cd<=0){e.cd=3.0;
       for(let i=0;i<10;i++)ebul(e.x,e.y,i/10*TAU,52,2,2);
       for(const q of S.players.values())
         if(!q.dead&&Math.hypot(q.x-e.x,q.y-e.y)<34) hurt(q,20);
       S.shake=.3; }
     break;
   case 'warlock':
     e.tpT-=dt;
     if(e.tpT<=0){ e.tpT=3.6;
       const a=rnd(0,TAU),dd=rnd(80,130);
       e.x=clamp(p.x+Math.cos(a)*dd,12,WW-12); e.y=clamp(p.y+Math.sin(a)*dd,12,WH-12);
       e.cd=.4; e.st=2; }
     if(e.st>0&&e.cd<=0){ e.st--; e.cd=.3;
       const na=Math.atan2(p.y-e.y,p.x-e.x);
       for(let i=-4;i<=4;i++)ebul(e.x,e.y,na+i*.13,76,2); }
     break;
   case 'obelisk':
     if(e.cd<=0){e.cd=.5;
       for(let i=0;i<6;i++)ebul(e.x,e.y,e.ph+i/6*TAU,30,1); e.ph+=.3;}
     break;
   /* ---- unique minions ---- */
   case 'sporeling': // suicide spore — bursts on contact
     mv(dx/d,dy/d,1.15);
     if(d<9){ e.hp=0; e.deadDone=true;
       hurt(p,14);
       for(let i=0;i<6;i++)ebul(e.x,e.y,i/6*TAU,46,3);
       for(let i=0;i<10;i++)S.fx.push({x:e.x,y:e.y,vx:rnd(-60,60),vy:rnd(-60,60),l:.35,ci:'#7cff6b'}); }
     break;
   case 'wraith': // phasing ghost
     e.tpT-=dt;
     if(e.tpT<=0){ e.tpT=2.6; const a2=rnd(0,TAU),dd=rnd(50,90);
       e.x=clamp(p.x+Math.cos(a2)*dd,12,WW-12); e.y=clamp(p.y+Math.sin(a2)*dd,12,WH-12); e.cd=.3; }
     else mv(dx/d,dy/d,.5);
     if(e.cd<=0){ e.cd=1.6; for(let i=-1;i<=1;i++)ebul(e.x,e.y,aim+i*.2,70,3); }
     break;
   case 'weldbot': // battlefield mechanic — repairs nearby foes
     mv(dx/d,dy/d,.6);
     e.tpT-=dt;
     if(e.tpT<=0){ e.tpT=.6;
       for(const e2 of S.en) if(e2!==e&&e2.hp>0&&e2.hp<e2.maxhp&&Math.hypot(e2.x-e.x,e2.y-e.y)<42){
         e2.hp=Math.min(e2.maxhp,e2.hp+7);
         S.fx.push({x:e2.x,y:e2.y,vx:0,vy:-18,l:.3,ci:'#7cff6b'}); } }
     if(e.cd<=0){ e.cd=1.8; ebul(e.x,e.y,aim,62,2); }
     break;
   case 'creep':{ const C=MOBA.creep;
     // Sweeps the area around it rather than only reacting at weapon range:
     // anything hostile inside chaseRadius gets pursued, and once locked on
     // it keeps chasing out to dropRadius (hysteresis) so a player sitting
     // just past the edge is still hunted instead of ignored.
     const ranged=!!ET[ETI[e.k]].ranged;
     // bought mercenaries never stop to skirmish — they only ever charge
     const lock=e.merc?0:(e.aggro?C.dropRadius:C.chaseRadius);
     const tg=lock?structFoe(e,lock):null;
     e.aggro=!!tg;
     if(tg){
       const ta=Math.atan2(tg.y-e.y,tg.x-e.x), td=Math.hypot(tg.x-e.x,tg.y-e.y);
       const stop=ranged?C.attackRange:C.meleeRange;
       if(td>stop){ e.x+=Math.cos(ta)*e.spd*sm*dt; e.y+=Math.sin(ta)*e.spd*sm*dt; }
       if(ranged){ if(td<C.attackRange+8&&e.cd<=0){ e.cd=C.shotInterval;
           ebul(e.x,e.y,ta,C.bulletSpeed,2,1.5,e.team); } }
       else if(td<=C.meleeRange+2&&e.cd<=0){ // melee creeps jab at point blank
         e.cd=C.shotInterval*.6; ebul(e.x,e.y,ta,120,3,1.5,e.team); }
     }else{
       const gx=e.goalX-e.x, gy=e.goalY-e.y, gd=Math.hypot(gx,gy)||1;
       e.x+=gx/gd*e.spd*sm*dt; e.y+=gy/gd*e.spd*sm*dt;
     }
     break; }
   case 'siegelord':{ const L=MOBA.siegeLord;
     // Boss-wave miniboss: the guardian's volley + telegraphed lunge, but it
     // MARCHES the lane like a creep instead of holding a post, and has no
     // laser. st: 0 advance · 1 windup · 2 lunge · 3 recovery.
     e.laserOn=0; e.llen=0;
     e.tpT-=dt;
     if(e.st===1){ e.flash=.05; e.stT-=dt; if(e.stT<=0){ e.st=2; e.stT=L.chargeTime; } }
     else if(e.st===2){ const ox=e.x, oy=e.y;
       e.x+=Math.cos(e.ang)*L.chargeSpeed*sm*dt; e.y+=Math.sin(e.ang)*L.chargeSpeed*sm*dt;
       e.stT-=dt;
       const hitObs=obstacles.some(o=>Math.hypot(o.x-e.x,o.y-e.y)<o.r+e.r);
       if(e.stT<=0||hitObs||e.x<8||e.x>WW-8||e.y<8||e.y>WH-8){
         e.st=3; e.stT=.6; e.tpT=L.chargeCooldown; if(hitObs){e.x=ox;e.y=oy;} } }
     else if(e.st===3){ e.stT-=dt; if(e.stT<=0)e.st=0; }
     else{
       // same sweep-and-hold behaviour as creeps: wide pull-in, wider let-go
       const lockR=e.aggro?(L.dropRadius||L.aggroRadius):L.aggroRadius;
       const tg=structFoe(e,lockR);                // creeps first, then players
       e.aggro=!!tg;
       if(tg){
         const ta=Math.atan2(tg.y-e.y,tg.x-e.x), td=Math.hypot(tg.x-e.x,tg.y-e.y);
         if(td>L.standoff){ e.x+=Math.cos(ta)*e.spd*sm*dt; e.y+=Math.sin(ta)*e.spd*sm*dt; }
         if(td<L.chargeRange&&e.tpT<=0){ e.st=1; e.stT=L.chargeWindup; e.ang=ta; }
         else if(td<L.range&&e.cd<=0){ e.cd=L.shotInterval;
           for(let i=-2;i<=2;i++)ebul(e.x,e.y,ta+i*.14,74,3,1.5,e.team,L.damage); }
       }else{ // nothing to fight — push toward the enemy nexus
         const gx=e.goalX-e.x, gy=e.goalY-e.y, gd=Math.hypot(gx,gy)||1;
         e.x+=gx/gd*e.spd*sm*dt; e.y+=gy/gd*e.spd*sm*dt;
       }
     }
     break; }
   /* ---- MOBA structures (see moba.js) ----
      All three are team-owned and fire team-tagged bolts, so they can
      never damage their own side. `p` here is whatever nearestFoe()
      picked — a hostile player, creep or structure. */
   case 'nexus':{ const N=MOBA.nexus;
     const tg=structFoe(e,Math.max(N.range,N.laserRange));
     if(!tg){ e.laserOn=0; e.llen=0; break; }
     structLaser(e,tg,dt,N);
     const ta=Math.atan2(tg.y-e.y,tg.x-e.x), td=Math.hypot(tg.x-e.x,tg.y-e.y);
     if(td<N.range&&e.cd<=0){ e.cd=N.shotInterval;
       for(let i=-1;i<=1;i++)ebul(e.x,e.y,ta+i*.18,70,4,2,e.team,N.shotDamage); }
     break; }
   case 'laneturret':{ const T=MOBA.turret;
     const tg=structFoe(e,Math.max(T.range,T.laserRange||0));
     if(!tg){ e.laserOn=0; e.llen=0; break; }
     structLaser(e,tg,dt,T);
     const ta=Math.atan2(tg.y-e.y,tg.x-e.x), td=Math.hypot(tg.x-e.x,tg.y-e.y);
     if(td<T.range&&e.cd<=0){ e.cd=T.shotInterval;
       ebul(e.x,e.y,ta,T.bulletSpeed,2,2,e.team,T.damage); }
     break; }
   case 'guardian':{ const G=MOBA.baseboss;
     // Shoots continuously AND periodically telegraphs a lunge.
     // st: 0 idle (patrol/chase) · 1 windup · 2 charging · 3 recovery.
     // Contact damage while charging comes from the shared meleeDash path,
     // exactly like the other charging enemies (see contactDamage).
     e.tpT-=dt;
     if(e.st===1){ e.flash=.05; e.stT-=dt; if(e.stT<=0){ e.st=2; e.stT=G.chargeTime; } }
     else if(e.st===2){ const ox=e.x, oy=e.y;
       e.x+=Math.cos(e.ang)*G.chargeSpeed*sm*dt; e.y+=Math.sin(e.ang)*G.chargeSpeed*sm*dt;
       e.stT-=dt;
       const hitObs=obstacles.some(o=>Math.hypot(o.x-e.x,o.y-e.y)<o.r+e.r);
       if(e.stT<=0||hitObs||e.x<8||e.x>WW-8||e.y<8||e.y>WH-8){
         e.st=3; e.stT=.6; e.tpT=G.chargeCooldown; if(hitObs){e.x=ox;e.y=oy;} } }
     else if(e.st===3){ e.stT-=dt; if(e.stT<=0)e.st=0; }
     else{
       const hd=Math.hypot(e.homeX-e.x,e.homeY-e.y)||1;
       if(hd>G.leashRadius*1.6){ // dragged too far from its post — walk back
         e.x+=(e.homeX-e.x)/hd*e.spd*dt; e.y+=(e.homeY-e.y)/hd*e.spd*dt;
       }else if(d<G.leashRadius){ if(d>50)mv(dx/d,dy/d); } // intruder inside the base — chase
       else{ // otherwise orbit the post; runs from a standing start too
         e.ph+=dt*G.patrolSpeed;
         const tx=e.homeX+Math.cos(e.ph)*G.patrolRadius, ty=e.homeY+Math.sin(e.ph)*G.patrolRadius;
         const ddx=tx-e.x, ddy=ty-e.y, dd=Math.hypot(ddx,ddy)||1;
         e.x+=ddx/dd*e.spd*sm*dt; e.y+=ddy/dd*e.spd*sm*dt;
       }
       if(d<G.chargeRange&&e.tpT<=0){ e.st=1; e.stT=G.chargeWindup; e.ang=aim; }
     }
     // guardians also use creep-first targeting for their gun and lance
     const gt=structFoe(e,Math.max(G.range,G.laserRange||0));
     if(gt&&e.st!==2)structLaser(e,gt,dt,G); else { e.laserOn=0; e.llen=0; }
     if(gt&&e.st!==2&&e.cd<=0){                             // keeps firing unless mid-lunge
       const ga=Math.atan2(gt.y-e.y,gt.x-e.x), gd=Math.hypot(gt.x-e.x,gt.y-e.y);
       if(gd<G.range){ e.cd=G.shotInterval;
         for(let i=-2;i<=2;i++)ebul(e.x,e.y,ga+i*.14,74,3,1.5,e.team,G.damage); } }
     break; }
   /* ---- bosses ---- */
   case 'herald':
     if(d>52)mv(dx/d,dy/d);
     e.ph+=dt;
     if(e.cd<=0){const phase=Math.floor(e.ph)%3;
       if(phase===0){e.cd=.13;ebul(e.x,e.y,e.ph*2.6,56,2,2);ebul(e.x,e.y,-e.ph*2.6+Math.PI,56,1,2);}
       else if(phase===1){e.cd=.8;for(let i=0;i<16;i++)ebul(e.x,e.y,i/16*TAU+e.ph,42,0);}
       else{e.cd=.5;for(let i=-2;i<=2;i++)ebul(e.x,e.y,aim+i*.14,78,2);}}
     break;
   case 'colossus':
     e.ph+=dt;
     if(e.st===0){ mv(dx/d,dy/d);
       if(e.cd<=0){e.st=1;e.stT=.7;e.ang=aim;} }
     else if(e.st===1){e.flash=.05;e.stT-=dt;if(e.stT<=0){e.st=2;e.stT=1.1;}}
     else if(e.st===2){ e.x+=Math.cos(e.ang)*230*dt; e.y+=Math.sin(e.ang)*230*dt;
       e.stT-=dt;
       if(e.stT<=0||e.x<10||e.x>WW-10||e.y<10||e.y>WH-10){
         e.st=0;e.cd=2.4;S.shake=.35;
         for(let i=0;i<14;i++)ebul(e.x,e.y,i/14*TAU,58,4,2);
         for(const q of S.players.values())
           if(!q.dead&&Math.hypot(q.x-e.x,q.y-e.y)<40) hurt(q,26);
         if(Math.random()<.5&&S.en.length<40){S.en.push(mkE('slash'));S.en.push(mkE('slash'));}
       } }
     break;
   case 'seraph': // rotating quad beams / aimed fans at every player
     if(d>80)mv(dx/d,dy/d);
     e.ph+=dt;
     if(e.cd<=0){ const phase=Math.floor(e.ph/5)%2;
       if(phase===0){ e.cd=.08; for(let i=0;i<4;i++)ebul(e.x,e.y,e.ph*1.9+i*Math.PI/2,66,0); }
       else{ e.cd=.7;
         for(const q of S.players.values()){ if(q.dead)continue;
           const na=Math.atan2(q.y-e.y,q.x-e.x);
           for(let i=-2;i<=2;i++)ebul(e.x,e.y,na+i*.09,88,4); } } }
     break;
   case 'hive': // keeps distance, pulsing rings, births its minion
     if(d<120)mv(-dx/d,-dy/d,.8); else if(d>200)mv(dx/d,dy/d,.6);
     e.ph+=dt;
     if(e.cd<=0){ e.cd=1.4;
       for(let i=0;i<12;i++)ebul(e.x,e.y,i/12*TAU+e.ph,36,3,2.5);
       const mn=BOSS_MINION[e.k];
       if(mn&&S.en.length<45&&Math.random()<.7)S.en.push(mkE(mn)); }
     break;
   case 'reaper': // teleports, crescent volleys, calls its minion
     e.tpT-=dt;
     if(e.tpT<=0){ e.tpT=3.2;
       const a2=rnd(0,TAU),dd=rnd(60,110);
       e.x=clamp(p.x+Math.cos(a2)*dd,12,WW-12); e.y=clamp(p.y+Math.sin(a2)*dd,12,WH-12);
       e.st=3; e.cd=.25;
       const mn=BOSS_MINION[e.k];
       if(mn&&S.en.length<42&&Math.random()<.4)S.en.push(mkE(mn)); }
     if(e.st>0&&e.cd<=0){ e.st--; e.cd=.22;
       const na=Math.atan2(p.y-e.y,p.x-e.x);
       for(let i=-3;i<=3;i++)ebul(e.x,e.y,na+i*.22,72,1,2); }
     if(d>40&&e.tpT>1)mv(dx/d,dy/d,.6);
     break;
   case 'forge': // slow furnace — helix spray, deploys turrets & its minion
     mv(dx/d,dy/d,.5);
     e.ph+=dt; e.tpT-=dt;
     if(e.cd<=0){ e.cd=.12;
       ebul(e.x,e.y,e.ph*2.2,52,2,2); ebul(e.x,e.y,e.ph*2.2+Math.PI,52,1,2); }
     if(e.tpT<=0){ e.tpT=6;
       if(S.en.length<42){ S.en.push(mkE('turret'));
         const mn=BOSS_MINION[e.k];
         if(mn&&Math.random()<.6)S.en.push(mkE(mn)); } }
     break;
   case 'serpent': // blistering dashes that shed a bullet trail
     e.ph+=dt;
     if(e.st===0){ mv(dx/d,dy/d,1.4); if(e.cd<=0&&d<200){e.st=1;e.stT=.45;e.ang=aim;} }
     else if(e.st===1){ e.flash=.05; e.stT-=dt; if(e.stT<=0){e.st=2;e.stT=.9;} }
     else if(e.st===2){
       e.x+=Math.cos(e.ang)*320*sm*dt; e.y+=Math.sin(e.ang)*320*sm*dt; e.stT-=dt;
       if(Math.random()<dt*22)ebul(e.x,e.y,e.ang+Math.PI+rnd(-.5,.5),24,3);
       if(e.stT<=0||e.x<10||e.x>WW-10||e.y<10||e.y>WH-10){e.st=3;e.stT=.7;e.cd=1.2;} }
     else{ e.stT-=dt; if(e.stT<=0)e.st=0; }
     break;
   case 'monarch': // storm king — rotating cross barrage, rings, aimed strikes
     e.ph+=dt;
     if(d>90)mv(dx/d,dy/d,.7);
     if(e.cd<=0){ const phase=Math.floor(e.ph/4)%3;
       if(phase===0){ e.cd=.6;
         for(let k2=0;k2<4;k2++)for(let j=0;j<3;j++)ebul(e.x,e.y,e.ph*.7+k2*Math.PI/2,50+j*22,4,2); }
       else if(phase===1){ e.cd=1.0; for(let i=0;i<22;i++)ebul(e.x,e.y,i/22*TAU+e.ph,44,0); }
       else{ e.cd=.35; for(let i=-1;i<=1;i++)ebul(e.x,e.y,aim+i*.3,92,2); } }
     break;
   case 'pylon': // multi-part boss part: orbits its linked core, shields it while alive
     { const core=S.en.find(c=>c.id===e.core);
       if(core&&core.hp>0){
         e.ph=(e.ph||0)+dt*BAL.combat.pylon.orbitSpeed;
         const orbR=BAL.combat.pylon.orbitR, ang=e.ph+(e.orbIdx||0)*Math.PI;
         const tx=core.x+Math.cos(ang)*orbR, ty=core.y+Math.sin(ang)*orbR;
         const ddx=tx-e.x, ddy=ty-e.y, dd=Math.hypot(ddx,ddy)||1;
         e.x+=ddx/dd*Math.min(dd*6,e.spd)*dt; e.y+=ddy/dd*Math.min(dd*6,e.spd)*dt;
       } else mv(dx/d,dy/d,.6); // core already destroyed — fall back to a normal chaser
       if(e.cd<=0){e.cd=1.3; ebul(e.x,e.y,aim,64,2);} }
     break;
   case 'dreadnought': // multi-part boss core: near-immune while any pylon lives (see damageE)
     e.ph+=dt;
     if(e.shielded){
       if(d>140)mv(dx/d,dy/d,.5);
       if(e.cd<=0){e.cd=1.6; for(let i=0;i<10;i++)ebul(e.x,e.y,i/10*TAU+e.ph,40,3);}
     }else{
       if(d>160)mv(dx/d,dy/d,.9);
       if(e.cd<=0){ const phase=Math.floor(e.ph/3)%2;
         if(phase===0){e.cd=.12; ebul(e.x,e.y,e.ph*2.4,60,2,2); ebul(e.x,e.y,-e.ph*2.4+Math.PI,60,4,2);}
         else{e.cd=.5; for(let i=-3;i<=3;i++)ebul(e.x,e.y,aim+i*.16,86,0);} }
     }
     break;
   case 'titan':
     e.ph+=dt; e.tpT-=dt;
     if(d>110) mv(dx/d,dy/d);
     if(e.tpT<=0){ // blink onto a random player + shock ring
       e.tpT=9;
       const ps2=[...S.players.values()].filter(q=>!q.dead);
       const tgt=ps2.length?ps2[irnd(0,ps2.length)]:p;
       const a2=rnd(0,TAU);
       e.x=clamp(tgt.x+Math.cos(a2)*90,20,WW-20); e.y=clamp(tgt.y+Math.sin(a2)*90,20,WH-20);
       S.shake=.45;
       for(let i=0;i<20;i++)ebul(e.x,e.y,i/20*TAU,64,3,2);
     }
     if(e.cd<=0){ const phase=Math.floor(e.ph/4)%3;
       if(phase===0){ // twin spiral barrage
         e.cd=.09;
         ebul(e.x,e.y,e.ph*3.1,58,2,2); ebul(e.x,e.y,-e.ph*3.1+Math.PI,58,1,2);
       }else if(phase===1){ // aimed fans at every player
         e.cd=.75;
         for(const q of S.players.values()){ if(q.dead)continue;
           const na=Math.atan2(q.y-e.y,q.x-e.x);
           for(let i=-3;i<=3;i++)ebul(e.x,e.y,na+i*.11,82,4); }
       }else{ // slow heavy ring + summon
         e.cd=1.1;
         for(let i=0;i<26;i++)ebul(e.x,e.y,i/26*TAU+e.ph,40,0,2);
         if(S.en.length<45){S.en.push(mkE('wisp'));S.en.push(mkE('imp'));}
       } }
     break;
  }
  if(e.spd>0||e.st===2) collideObstacles(e);
}
