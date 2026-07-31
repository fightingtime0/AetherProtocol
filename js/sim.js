"use strict";
/* ============================================================
   sim.js — host-authoritative game simulation:
   players, waves, objectives, damage, picks, chests.
   All tuning numbers come from data/balance.json (BAL).
   ============================================================ */

/* ---------------- players ---------------- */
function mkPlayer(id,name,sprite,cls){
  const c=CLS(cls), PB=BAL.player;
  const p={id,name,sprite,img:spriteToCanvas(sprite),
    x:WW/2+rnd(-30,30),y:WH/2+rnd(-30,30),r:PB.hitboxRadius,
    hp:PB.hp,maxhp:PB.hp,inv:0,dead:false,shards:0,pickUntil:0,pickInvUntil:0,pickOpts:null,cls:c.id,
    t:PB.t.start,tMax:PB.t.start,tLock:false,
    tGenerator:false,tOverclock:false,tLeak:0,tKillRefund:0,tFreeChance:0,tMoveRegen:0,
    beamOnT:0,beamAng:0,beamLen:0,
    armor:0,shield:0,shieldMax:0,shieldCd:0,
    surgeT:0,dmgBoost:1,auraR:0,orbN:0,sabN:0,orbA:rnd(0,TAU),sabA:rnd(0,TAU),
    st:{spd:PB.speed,dmgM:1,cdM:1,crit:0,regen:0,greed:1,dashCd:PB.dashCooldown,bspdM:1,
        mag:PB.pickupRadius,tRchM:1,
        auraRegen:0,auraDmg:0,tithe:0,droneHpM:1,dmgTakenM:1},
    weapons:[{id:c.wpn,lvl:1,rar:'c',cd:0}]};
  return p;
}
/* custom relic effects that can't be expressed as a plain additive/multiplicative
   stat — hooked from data.js's ps.f() via passives.json's "special" field, and
   read every tick from hostUpdate()'s T-charge section / damageE(). */
const SPECIAL_PASSIVES={
  fluxGenerator:p=>{ p.tGenerator=true; p.tLock=false; },
  overclockCell:p=>{ p.tMax=Math.max(6,Math.round(p.tMax*0.5)); p.t=Math.min(p.t,p.tMax);
    p.tOverclock=true; p.tLeak+=2; },
  ventCapacitor:p=>{ p.tKillRefund+=2; },
  ghostRounds:p=>{ p.tFreeChance=Math.min(.6,p.tFreeChance+.15); },
  kineticBattery:p=>{ p.tMoveRegen+=10; },
};
function applyMetaObj(p,m){
  m=m||{};
  p.metaObj=m; // stashed so a persistent-mode respawn can rebuild this player from scratch
  for(const def of META) applyStats(p,def.stats,m[def.id]||0); // Sanctum ranks
  applyStats(p,CLS(p.cls).stats);                              // class after meta
  p.maxhp=Math.max(BAL.player.minMaxHp,p.maxhp);
  p.hp=p.maxhp; p.t=p.tMax; p.shield=p.shieldMax;
  // Baseline for the upgrade readout: everything AFTER meta + class is what
  // the player actually earned this run, which is what they want to see.
  p.base={spd:p.st.spd,dmgM:p.st.dmgM,cdM:p.st.cdM,crit:p.st.crit,
    regen:p.st.regen,greed:p.st.greed,bspdM:p.st.bspdM,dashCd:p.st.dashCd,
    maxhp:p.maxhp,armor:p.armor||0,shieldMax:p.shieldMax||0,tMax:p.tMax};
}
/* Compact "what have my cards actually done" readout. Only non-zero deltas
   are returned, each already formatted, so the HUD just prints them. */
function statSummary(p){
  if(!p||!p.base)return [];
  const out=[], b=p.base, st=p.st;
  const pct=(cur,base)=>Math.round((cur/base-1)*100);
  const add=(glyph,txt)=>out.push(glyph+' '+txt);
  if(b.dmgM&&pct(st.dmgM,b.dmgM)!==0)   add('☄','+'+pct(st.dmgM,b.dmgM)+'% dmg');
  if(b.spd&&pct(st.spd,b.spd)!==0)      add('➤','+'+pct(st.spd,b.spd)+'% move');
  if(b.cdM&&pct(b.cdM,st.cdM)!==0)      add('⚡','+'+pct(b.cdM,st.cdM)+'% rate'); // lower cdM = faster
  if(b.bspdM&&pct(st.bspdM,b.bspdM)!==0)add('»','+'+pct(st.bspdM,b.bspdM)+'% velocity');
  if(st.crit-b.crit>0.001)              add('✸','+'+Math.round((st.crit-b.crit)*100)+'% crit');
  if(p.maxhp-b.maxhp!==0)               add('❤','+'+Math.round(p.maxhp-b.maxhp)+' hp');
  if((p.armor||0)-b.armor>0)            add('▤','+'+Math.round((p.armor||0)-b.armor)+' armor');
  if((p.shieldMax||0)-b.shieldMax>0)    add('⛨','+'+Math.round((p.shieldMax||0)-b.shieldMax)+' shield');
  if(st.regen-b.regen>0.01)             add('✚','+'+(st.regen-b.regen).toFixed(1)+'/s regen');
  if(b.dashCd&&pct(b.dashCd,st.dashCd)!==0) add('✧','+'+pct(b.dashCd,st.dashCd)+'% dash');
  if(b.greed&&pct(st.greed,b.greed)!==0)add('◆','+'+pct(st.greed,b.greed)+'% shards');
  if(p.tMax-b.tMax!==0)                 add('▣',(p.tMax-b.tMax>0?'+':'')+Math.round(p.tMax-b.tMax)+' charge');
  return out;
}
// Battleground (persistent PvPvE) respawn: brand-new player object built the same
// way a fresh join is (0 upgrades, base stats), not the old one patched in place —
// applyStats() only ever adds on top of the current value, so reusing the live
// object would double-apply class/Sanctum bonuses on every death.
function respawnPersistent(p){
  const shards=p.shards;
  const np=mkPlayer(p.id,p.name,p.sprite,p.cls);
  applyMetaObj(np,p.metaObj);
  np.x=rnd(20,WW-20); np.y=rnd(20,WH-20); // infinity/Battleground has no obstacles to dodge
  np.shards=shards;
  np.team=p.team; // mkPlayer() has no concept of teams — without this a
                  // respawned siege player turns neutral and can shoot its own base
  np.bot=p.bot;   // ...and a respawned bot would stop thinking entirely
  np.lvl=p.lvl; np.xp=p.xp; // dying must not cost you your level
  np.inv=(BAL.battleground&&BAL.battleground.respawnInvuln)||10;
  S.players.set(p.id,np);
}
function newSim(playersInfo,opts){
  obstacles=genWorld();
  eidc=1; bidc=1;
  S={players:new Map(),en:[],eb:[],pb:[],it:[],fx:[],dr:[],zn:[],mk:[],ar:[],obj:null,sx:[],
     wave:0,score:0,t:0,waveT:0,
     spawnQ:[],spawnT:0,waveDone:false,miniSpawned:false,over:false,shake:0,
     // Battleground mode only: pvp = player bullets can hurt other players;
     // persistent = deaths respawn (fresh loadout, random spot) instead of
     // ending the run — see hurt() and respawnPersistent().
     pvp:!!(opts&&opts.pvp), persistent:!!(opts&&opts.persistent)};
  playersInfo.forEach(pi=>{
    const p=mkPlayer(pi.id,pi.name,pi.sprite,pi.cls);
    applyMetaObj(p, pi.id===myId?save.meta:pi.meta);
    S.players.set(pi.id,p);
  });
  nextWave();
  scatterItems(3);
}
function scatterItems(n){
  for(let i=0;i<n;i++){
    const kind=Math.random()<.5?0:1; // heart, shards
    S.it.push({k:kind,x:rnd(40,WW-40),y:rnd(40,WH-40),v:kind===1?irnd(6,16):25});
  }
}

/* ---------------- waves ---------------- */
function nextWave(){
  S.wave++;
  // a persistent Battleground session never ends, so cap the wave number that
  // feeds the difficulty math — otherwise budget/HP scaling runs away after
  // enough real-world uptime and the wave becomes unplayable (or unspawnable).
  if(S.persistent){ const cap=(BAL.battleground&&BAL.battleground.waveCap)||60;
    if(S.wave>cap)S.wave=cap; }
  S.waveDone=false; S.waveT=0; S.miniSpawned=false;
  S.spawnQ=[]; S.spawnT=0;
  const w=S.wave, np=S.players.size, D=DIFF(), WV=BAL.waves;
  // revive dead players (Battleground/persistent handles its own respawn timer instead)
  if(!S.persistent)
    for(const p of S.players.values()) if(p.dead){ p.dead=false; p.hp=p.maxhp*BAL.player.reviveHpFrac; p.inv=2;
      const alive=[...S.players.values()].find(q=>!q.dead&&q!==p);
      if(alive){p.x=alive.x+rnd(-20,20);p.y=alive.y+rnd(-20,20);} }
  sfxE('wave');
  if(D.titanEvery&&w%D.titanEvery===0&&ETI.titan!==undefined){
    const t=mkBoss('titan',w,np);
    S.spawnQ.push(t);
    for(let i=0;i<4+np;i++) S.spawnQ.push(mkE('wisp'));
    toastAll('⚠⚠ THE TITAN AWAKENS ⚠⚠'); sfxE('boss');
  }else if(w%WV.bossEvery===0){
    const bk=bossKeyFor(w);
    const b=mkBoss(bk,w,np);
    if(D.bigBossEvery&&w%D.bigBossEvery===0){ // BIG boss variant
      b.hp*=2.2; b.maxhp*=2.2; b.scl=2; b.r*=1.8; b.spd*=.85;
      toastAll('⚠ A BIG BOSS descends!');
    }
    S.spawnQ.push(b); sfxE('boss');
    const partsSpec=ET[ETI[bk]].parts; // multi-part boss: spawn its linked parts alongside it
    if(partsSpec)partsSpec.forEach((pid,idx)=>{
      const pt=mkE(pid); pt.core=b.id; pt.orbIdx=idx; pt.x=b.x; pt.y=b.y; pt.ph=idx*Math.PI;
      // scale like a boss (not a generic mob) so parts stay proportional to their
      // core at every wave instead of out-scaling it via the steeper mob curve
      pt.hp=pt.maxhp=ET[ETI[pid]].hp*(1+w*WV.bossHpPerWave)*(0.6+np*0.4)*D.enemyHp;
      S.spawnQ.push(pt);
    });
    const mn=BOSS_MINION[bk];
    if(mn) for(let i=0;i<2+np;i++) S.spawnQ.push(mkE(mn)); // boss escort
    for(let i=0;i<Math.min(6,Math.floor(w/WV.bossEvery)*2+np);i++) S.spawnQ.push(mkE('imp'));
  }else{
    let budget=Math.floor((WV.budgetBase+w*WV.budgetPerWave)*(WV.playerBase+np*WV.playerFactor)*D.budget);
    // weighted pool straight from enemies.json "pool" specs
    const pool=[];
    for(const T of ET){ if(!T.pool||w<T.pool.minWave)continue;
      for(let i=0;i<(T.pool.weight||1);i++)pool.push(T.id); }
    // the incoming boss sends its unique heralds ahead of it
    const nmn=BOSS_MINION[bossKeyFor(Math.ceil(w/WV.bossEvery)*WV.bossEvery)];
    if(nmn&&w%WV.bossEvery>=WV.bossEvery-2) pool.push(nmn,nmn);
    const costOf=id=>{const T=ET[ETI[id]];return (T.pool&&T.pool.cost)||T.cost||1;};
    const cheap=pool.reduce((a,b)=>costOf(a)<=costOf(b)?a:b,pool[0]||'imp');
    while(budget>0&&pool.length){
      const t=pool[irnd(0,pool.length)];
      const cost=costOf(t);
      if(cost>budget&&budget<3){S.spawnQ.push(mkE(cheap));budget-=costOf(cheap);continue;}
      S.spawnQ.push(mkE(t)); budget-=cost;
    }
  }
  // interlude enemies (e.g. obelisk) every few waves
  if(w%WV.interludeEvery===0&&w>1){
    const inter=ET.filter(T=>T.interlude);
    if(inter.length)S.spawnQ.push(mkE(inter[irnd(0,inter.length)].id));
  }
  scatterItems(irnd(1,3));
  rollObjective(w);
}

/* ---------------- random side objectives ---------------- */
const OBJ_TYS=['slay','notouch','zone','speed','greed'];
function objLabel(ty){return {slay:'Slay the horde',notouch:'Take no damage',zone:'Hold the circle',
  speed:'Clear the wave fast',greed:'Harvest shards'}[ty];}
// one-line goal + fail condition, shown once when the objective rolls — the ongoing
// HUD banner (objHudText, net.js) stays compact and just tracks live progress
function objIntro(o){
  const t=Math.ceil(o.tLeft);
  return {
    slay:`◎ SLAY THE HORDE — kill ${o.goal} enemies within ${t}s. Fails if the timer runs out first.`,
    notouch:`◎ STAY UNSCATHED — take zero hits for ${t}s straight. Fails the instant you're hit.`,
    zone:`◎ HOLD THE CIRCLE — stand inside the marked ring for ${o.goal}s total (${t}s to do it). Fails if time runs out first.`,
    speed:`◎ SPEED CLEAR — finish this wave within ${o.goal}s. Fails if the wave runs long.`,
    greed:`◎ HARVEST — collect ${o.goal} shards within ${t}s. Fails if the timer runs out first.`,
  }[o.ty];
}
function rollObjective(w){
  const OB=BAL.objectives;
  S.obj=null;
  if(w<OB.minWave||w%BAL.waves.bossEvery===0||Math.random()>OB.chance)return;
  const ty=OBJ_TYS[irnd(0,OBJ_TYS.length)];
  const o={ty,prog:0,done:0,rew:Math.round((OB.rewardBase+w*OB.rewardPerWave)*DIFF().shardMult),
    zx:0,zy:0,zr:0,goal:0,tLeft:0};
  if(ty==='slay'){o.goal=OB.slay.goalBase+Math.floor(w*OB.slay.goalPerWave);o.tLeft=OB.slay.time;}
  else if(ty==='notouch'){o.tLeft=OB.notouch.time;}
  else if(ty==='zone'){o.goal=OB.zone.holdSeconds;o.tLeft=OB.zone.time;o.zr=OB.zone.radius;
    let t2=0;do{o.zx=rnd(80,WW-80);o.zy=rnd(80,WH-80);}
    while(t2++<20&&obstacles.some(ob2=>Math.hypot(ob2.x-o.zx,ob2.y-o.zy)<ob2.r+20));}
  else if(ty==='speed'){o.goal=OB.speed.clearSeconds;o.tLeft=OB.speed.clearSeconds;}
  else{o.goal=OB.greed.goalBase+OB.greed.goalPerWave*w;o.tLeft=OB.greed.time;}
  S.obj=o;
  toastAll(objIntro(o));
}
function objDone(v){
  const o=S.obj; if(!o||o.done)return;
  o.done=v;
  if(v===1){ for(const p of S.players.values())p.shards+=o.rew;
    toastAll('◎ OBJECTIVE COMPLETE · +◆'+o.rew+' each'); sfxE('objwin'); }
  else{ toastAll('◎ objective failed'); sfxE('objfail'); }
}

/* ---------------- damage ---------------- */
/* ---------------- PvP damage against PLAYERS ----------------
   Every weapon path except plain projectiles only ever iterated S.en, so
   explosions, beams, zones, drones and the orbit/saber sweeps passed
   straight through enemy players. These helpers give them a target list.

   Bullet hits keep the existing split (a remote client detects its own
   and reports it), but there is no client-side detection for an explosion
   or a beam — the receiving client never simulates them — so the host
   resolves those outright for everyone. */
/* ---------------- damage-over-time cadence ----------------
   Every DoT source used to apply a sliver of damage on every single
   frame. That reads as mush, floods the fx buffer and makes tuning
   opaque. They now accumulate and release on one shared interval, so
   total dps is unchanged but the feedback lands in readable chunks.
   `holder` is whatever owns the timer (a zone, a structure, a drone,
   the firing player) so each source keeps its own cadence. */
function dotReady(holder,dt){
  holder.dotT=(holder.dotT||0)+dt;
  if(holder.dotT<BAL.combat.dotTick)return 0;
  const span=holder.dotT; holder.dotT=0;
  return span;                       // seconds of damage to release now
}
/* A player's CURRENT movement speed, including any drag from standing in a
   gravity well. Everything that needs to know how fast someone actually
   moves goes through here — the snapshot, and the host's own myPos — so a
   slow can't be applied in one place and forgotten in another. */
function effSpeed(p){
  const Z=BAL.combat.zoneSlow;
  return p.st.spd*((p.slowT>0&&Z)?Z.mult:1);
}
const NO_FOES=[];
function foePlayers(src){
  if(!S.pvp||!src)return NO_FOES;
  const out=[];
  for(const q of S.players.values()){
    if(q===src||q.dead||!hostile(src.team,q.team))continue;
    out.push(q);
  }
  return out;
}
function foePlayersOf(ownerId){ return foePlayers(S.players.get(ownerId)); }
function hurtPlayersAt(x,y,r,dmg,ownerId,dot){
  for(const q of foePlayersOf(ownerId))
    if(Math.hypot(q.x-x,q.y-y)<r+q.r) hurt(q,dmg,ownerId,dot);
}
/* srcId lets a kill be credited for XP — see grantXp()/mobaOnPlayerKill().
   dot marks CONTINUOUS damage (lasers, beams, zones, blade sweeps, drone
   contact). Those tick every frame, and a normal hit grants 0.9s of
   i-frames — so without this flag standing in a laser re-armed invulner-
   ability every tick and left the victim immune to everything. A DoT is
   still BLOCKED by existing i-frames (a dash should save you); it just
   never grants new ones. */
function hurt(p,amt,srcId,dot){
  if(p.inv>0||p.dead||now()<p.pickInvUntil)return;
  if(srcId!==undefined&&srcId!==p.id)p.lastHitBy=srcId;
  if(dot){
    // Continuous damage arrives ~60x/second in fractional amounts. The
    // integer rounding and the 1-damage floor below would promote every
    // sub-1 tick to a full point, pinning ANY damage-over-time source at
    // roughly 60 dps no matter how it is tuned — which is exactly why
    // halving the laser's configured dps changed almost nothing.
    // Armour is a per-HIT flat reduction and is deliberately not applied
    // per tick; doing so would cancel a DoT outright.
    amt=amt*(DIFF().enemyDamage||1)*(p.st.dmgTakenM||1);
    if(amt<=0)return;
  }else{
    amt=Math.round(amt*(DIFF().enemyDamage||1)*(p.st.dmgTakenM||1)); // difficulty + glass-cannon scaling
    amt=Math.max(1,amt-(p.armor||0));            // armor: flat reduction per hit
  }
  p.shieldCd=BAL.player.shield.regenDelay;       // any hit delays shield regen
  if(!dot){ p.inv=.9; if(p.id===myId)S.shake=.28; } // continuous damage grants no i-frames
  if(S.obj&&!S.obj.done&&S.obj.ty==='notouch')objDone(-1);
  if(p.shield>0){                                // shield soaks before HP
    const abs=Math.min(p.shield,amt); p.shield-=abs; amt-=abs;
    if(!dot||Math.random()<.15)                  // DoT ticks every frame — don't flood the fx buffer
      for(let i=0;i<6;i++)S.fx.push({x:p.x,y:p.y,vx:rnd(-45,45),vy:rnd(-45,45),l:.3,ci:'#4ef0e8'});
    sfxE('shield');
    if(amt<=0)return;
  }
  p.hp-=amt; sfxE('hurt',p.x,p.y);
  if(!dot||Math.random()<.15)
    for(let i=0;i<8;i++)S.fx.push({x:p.x,y:p.y,vx:rnd(-50,50),vy:rnd(-50,50),l:.4,ci:'#ff5c47'});
  if(p.hp<=0){ p.hp=0; p.dead=true; sfxE('down');
    const killer=S.players.get(p.lastHitBy);
    if(S.moba&&killer&&killer!==p) mobaOnPlayerKill(killer,p);
    else toastAll(p.name+' is down!');
    p.lastHitBy=undefined;
    if(S.moba) p.respawnAt=now()+(MOBA.respawnDelay||6)*1000;
    else if(S.persistent) p.respawnAt=now()+((BAL.battleground&&BAL.battleground.respawnDelay)||3)*1000;
    else if([...S.players.values()].every(q=>q.dead)) runOver(); }
}
// a remote client's own screen decided this bullet/enemy touched them — host
// still owns the CONSEQUENCE (i-frames, phase surge, armor/shield math all
// live inside hurt()), it just replays the same rules the automatic host-side
// checks use for the local player, keyed off whatever the client saw land.
function applyClientHit(p,kind,id){
  if(!p||p.dead)return;
  const PB=BAL.player, CB=BAL.combat;
  if(kind==='b'){
    const b=S.eb.find(b2=>b2.id===id&&!b2.dead);
    if(!b)return;
    if(!hostile(b.team,p.team))return; // a client can't be hit by its own side
    b.dead=true;
    if(p.inv>0){ p.surgeT=PB.surge.duration; sfxE('surge');
      for(let i=0;i<5;i++)S.fx.push({x:b.x,y:b.y,vx:rnd(-40,40),vy:rnd(-40,40),l:.3,ci:'#ffd35c'});
    }else hurt(p,b.dmg||CB.enemyBulletDamage);
  }else if(kind==='m'){
    const e=S.en.find(e2=>e2.id===id&&e2.hp>0);
    if(!e)return;
    const melee=ET[ETI[e.k]].meleeDash&&e.st===2;
    const CD=CB.contactDamage;
    hurt(p,melee?(e.chargeDmg||CD.meleeDash):e.boss?CD.boss:e.mini?CD.mini:CD.base);
  }else if(kind==='p'){ // Battleground PvP: another player's bullet touched me
    if(!S.pvp)return;
    const b=S.pb.find(b2=>b2.id===id&&!b2.dead&&b2.owner!==p.id);
    if(!b)return;
    const shooter=S.players.get(b.owner);
    if(shooter&&!hostile(shooter.team,p.team))return; // no friendly fire between allies
    b.dead=true;
    hurt(p,b.dmg*((BAL.battleground&&BAL.battleground.pvpDamageMult)||1));
  }
}
function toastAll(m){ toast(m); bcast({t:'ts',m}); }
function damageE(e,dmg,owner,quiet){
  // Friendly fire is blocked HERE, at the one choke point every damage
  // source funnels through — bullets, booms, beams, chain lightning,
  // orbiting fangs, sabers, drones, zones and poison ticks all land in
  // this function. Checking at the call sites instead missed eight of
  // them, which is how a player could melt their own nexus.
  if(owner!==undefined&&e.team!==undefined){
    const src=S.players.get(owner);
    if(src&&!hostile(src.team,e.team))return;
  }
  if(e.shielded)dmg*=BAL.combat.shieldedDmgFrac; // multi-part boss: core barely scratched while any part still lives
  e.hp-=dmg; if(!quiet){e.flash=.08;sfxE('hit',e.x,e.y);}
  if(e.hp<=0&&!e.deadDone){ e.deadDone=true;
    S.score+=e.sc; sfxE(e.boss?'bosskill':'kill',e.x,e.y);
    const p=S.players.get(owner);
    if(S.moba&&p){ const xp=mobaXpForEntity(e);
      grantXp(p,xp);                 // siege upgrades are earned by killing
      grantAssistXp(p,xp,null); }    // ...and allies share a cut
    if(p&&e.core!==undefined) toastAll(p.name+' downed a pylon!'); // multi-part boss part died
    if(p&&p.tKillRefund>0) p.t=Math.min(p.tMax,p.t+p.tKillRefund);
    const sh=Math.round(e.sh*(p?p.st.greed:1)*DIFF().shardMult);
    if(p&&sh>0){
      // drop a collectible shard orb instead of an instant credit — anyone can walk over it
      S.it.push({k:1,x:e.x+rnd(-4,4),y:e.y+rnd(-4,4),v:sh});
      if(p.st.tithe>0){ const bonus=Math.round(sh*p.st.tithe);
        if(bonus>0)for(const q of S.players.values())if(q!==p)q.shards+=bonus; }
    }
    if(S.obj&&!S.obj.done){
      if(S.obj.ty==='slay')S.obj.prog++;
      else if(S.obj.ty==='greed')S.obj.prog+=sh;
    }
    for(let i=0;i<12;i++)S.fx.push({x:e.x,y:e.y,vx:rnd(-60,60),vy:rnd(-60,60),l:.5,ci:e.boss?'#ffd35c':'#ff4fd8'});
    if(ET[ETI[e.k]].interlude){ S.it.push({k:2,x:e.x,y:e.y}); S.it.push({k:1,x:e.x+10,y:e.y,v:20});
      toastAll('Obelisk shattered — chest dropped!'); }
    if(e.boss){ S.it.push({k:2,x:e.x,y:e.y});
      if(e.k==='titan'){ S.it.push({k:2,x:e.x+14,y:e.y}); S.it.push({k:1,x:e.x-14,y:e.y,v:60}); } }
  }
}

/* ---------------- picks ---------------- */
const maxSlots=w=>{ const sw=BAL.waves.slotWaves; return w>=sw[1]?3:w>=sw[0]?2:1; };
function genOpts(p){
  const opts=[];
  const owned=p.weapons;
  const upgradable=owned.filter(w=>w.lvl<RARS[w.rar].max);
  const canNew=owned.length<maxSlots(S.wave);
  const pool=[];
  upgradable.forEach(w=>pool.push({t:'up',w}));
  if(canNew){
    const notOwned=WKEYS.filter(k=>!owned.some(w=>w.id===k));
    for(let i=0;i<2&&notOwned.length;i++){
      const k=notOwned[irnd(0,notOwned.length)];
      const r=Math.random(); const rar=r<.5?'c':r<.8?'r':r<.95?'e':'l';
      pool.push({t:'new',k,rar});
    }
  }
  PASSIVES.forEach(ps=>{ if(ps.mp&&S.players.size<2)return;
    // bots never even see the T-charge specials or Glass Reactor, so a roll
    // of three unsafe passives can't force one on them
    if(p.bot&&!botSafePassive(ps))return;
    pool.push({t:'pas',ps}); });
  pool.sort(()=>Math.random()-.5);
  const seen=new Set();
  for(const o of pool){
    const key=o.t+(o.w?o.w.id:o.k||o.ps.id);
    if(seen.has(key))continue; seen.add(key);
    opts.push(o); if(opts.length===3)break;
  }
  const solo=PASSIVES.filter(ps=>!ps.mp||S.players.size>1);
  while(opts.length<3)opts.push({t:'pas',ps:solo[irnd(0,solo.length)]});
  return opts;
}
function optView(o){
  if(o.t==='up'){const w=o.w,def=WPN[w.id];
    return {g:def.g,n:def.n+' +',d:`Lv ${w.lvl}→${w.lvl+1}: ${def.d(w.lvl+1)}`,rar:w.rar,tag:RARS[w.rar].n};}
  if(o.t==='new'){const def=WPN[o.k];
    return {g:def.g,n:def.n,d:'NEW WEAPON — '+def.d(1),rar:o.rar,tag:RARS[o.rar].n};}
  return {g:o.ps.g,n:o.ps.n,d:o.ps.d,rar:'c',tag:'RELIC'};
}
function applyOpt(p,o){
  if(o.t==='up')o.w.lvl++;
  else if(o.t==='new')p.weapons.push({id:o.k,lvl:1,rar:o.rar,cd:0});
  else o.ps.f(p);
}
function ownedView(p){return p.weapons.map(w=>({g:WPN[w.id].g,n:WPN[w.id].n,lvl:w.lvl,rar:w.rar}));}
function startPick(p,keepDeadline){
  p.pickOpts=genOpts(p);
  // Bots decide instantly, so they must return BEFORE the pick window's
  // timers are set — pickInvUntil would otherwise hand every bot 10
  // seconds of invulnerability on every single level-up.
  if(p.bot){ botPick(p); return; }
  if(!keepDeadline) p.pickUntil=now()+BAL.waves.pickSeconds*1000;
  // invincibility + weapon-pause only lasts 10s, not the whole decision window —
  // player keeps moving and the rest of the battle keeps running around them
  p.pickInvUntil=now()+10000;
  if(p.id===myId) showPickUI(p.pickOpts.map(optView),p.pickUntil,ownedView(p));
  else sendTo(p.id,{t:'pk',opts:p.pickOpts.map(optView),dl:p.pickUntil,own:ownedView(p)});
}
function resolvePick(p,i){
  if(!p.pickOpts)return;
  applyOpt(p,p.pickOpts[clamp(i,0,p.pickOpts.length-1)]);
  p.pickOpts=null; p.pickUntil=0;
  if(p.bot)return;
  // push the refreshed stat readout to whoever owns this player
  const sum=statSummary(p);
  if(p.id===myId){ myUpgrades=sum; hidePickUI(); }
  else sendTo(p.id,{t:'pkend',ups:sum});
}
function discardWeapon(p,i){ // full discard, upgrades lost; only during pick window
  if(!p.pickOpts||p.weapons.length<=1)return;
  const w=p.weapons[i]; if(!w)return;
  p.weapons.splice(i,1);
  toastAll(p.name+' discarded '+WPN[w.id].n);
  startPick(p,true);
}
function openChest(p){
  const canNew=p.weapons.length<maxSlots(S.wave);
  if(canNew){
    const notOwned=WKEYS.filter(k=>!p.weapons.some(w=>w.id===k));
    if(notOwned.length){const k=notOwned[irnd(0,notOwned.length)];
      const r=Math.random();const rar=r<.35?'r':r<.75?'e':'l';
      p.weapons.push({id:k,lvl:1,rar,cd:0});
      toastAll(p.name+' found '+RARS[rar].n+' '+WPN[k].n+'!'); return;}
  }
  const up=p.weapons.filter(w=>w.lvl<RARS[w.rar].max);
  if(up.length){const w=up[irnd(0,up.length)];w.lvl++;
    toastAll(p.name+': '+WPN[w.id].n+' → Lv'+w.lvl); return;}
  p.shards+=50; toastAll(p.name+' +50 ◆');
}

/* ---------------- host tick ---------------- */
function hostUpdate(dt){
  // NOTE: attuning no longer freezes the world — the picking player gets a
  // capped invincibility+weapon-pause window (pickInvUntil) instead, and
  // everyone/everything else keeps moving. See "picks timeout" below for
  // the deadline auto-resolve.
  S.t+=dt; S.waveT+=dt;
  const PB=BAL.player, CB=BAL.combat;
  // local player position
  const me=S.players.get(myId);
  if(me&&!me.dead){ me.x=myPos.x; me.y=myPos.y;
    // keep the host's own movement speed live: it was captured once at run
    // start, so speed upgrades (and now gravity-well drag) never reached it
    myPos.spd=effSpeed(me); myPos.dcd=me.st.dashCd;
    if(myPos.inv>0)me.inv=Math.max(me.inv,.1); }
  for(const p of S.players.values()){
    if(S.persistent&&p.dead&&p.respawnAt&&now()>=p.respawnAt){
      if(S.moba)mobaRespawn(p); else respawnPersistent(p); continue; }
    p.inv=Math.max(0,p.inv-dt);
    p.surgeT=Math.max(0,p.surgeT-dt);
    p.slowT=Math.max(0,(p.slowT||0)-dt);   // gravity-well drag decays
    // co-op support auras from nearby allies
    let aR=0,aD=0;
    for(const q of S.players.values()){ if(q===p||q.dead)continue;
      if(Math.hypot(q.x-p.x,q.y-p.y)<PB.auraRadius){aR+=q.st.auraRegen;aD+=q.st.auraDmg;} }
    p.auraR=aR;
    p.dmgBoost=(1+aD)*(p.surgeT>0?PB.surge.mult:1);
    if(!p.dead)p.hp=Math.min(p.maxhp,p.hp+(p.st.regen+aR)*dt);
    // T-charge: default behavior is "reload after empty" — fire freely while
    // charge remains, then once it hits 0 it locks and recharges to full.
    // Flux Generator swaps that for constant trickle regen (see SPECIAL_PASSIVES).
    // Overclocked Cell (also there) keeps the lock but adds a fast recharge
    // multiplier + a passive leak that drains charge even while idle.
    /* DEADLOCK GUARD. The lock only releases when charge reaches tMax, so
       any drain that outpaces the recharge strands a player at zero charge
       and they can never fire again. Three ways that happened:
         · Redline Cell's leak (tLeak) kept draining while locked
         · Kinetic Battery bled charge while standing still, also locked
         · relics stacking tMax down to <=0 made `p.t<=0` permanently true
       So: drains are suspended while locked (recharge is then strictly
       monotonic), tMax can never fall below a floor, and a watchdog breaks
       any lock that somehow still outlives its worst-case duration. */
    const TMIN=PB.t.min||6, TMAXLOCK=PB.t.maxLockSec||12;
    if(!(p.tMax>=TMIN))p.tMax=TMIN;
    if(!(p.t>=0))p.t=0;                       // NaN guard
    if(p.tLeak>0&&!p.tLock) p.t=Math.max(0,p.t-p.tLeak*dt);
    if(p.tGenerator){
      p.t=Math.min(p.tMax,p.t+PB.t.genRate*p.st.tRchM*dt); p.tLock=false;
    }else if(p.tLock){
      const rchMult=p.tOverclock?4:1;
      p.t+=Math.max(PB.t.rechargeRate*rchMult*p.st.tRchM,TMIN*.25)*dt; // always makes progress
      if(p.t>=p.tMax){p.t=p.tMax;p.tLock=false;}
    }
    if(p.tLock){
      p.tLockT=(p.tLockT||0)+dt;
      if(p.tLockT>TMAXLOCK){ p.t=p.tMax; p.tLock=false; p.tLockT=0;
        if(p.id===myId)toast('⚡ Charge cell reset'); }
    }else p.tLockT=0;
    p.beamOnT=Math.max(0,(p.beamOnT||0)-dt);
    // Kinetic Battery: charge builds while you're moving, bleeds while you camp
    if(p.tMoveRegen>0&&!p.tLock){ // never bleed while locked — see the deadlock guard above
      const moved=Math.hypot(p.x-(p.prevX??p.x),p.y-(p.prevY??p.y));
      p.t=moved>0.15?Math.min(p.tMax,p.t+p.tMoveRegen*dt):Math.max(0,p.t-p.tMoveRegen*.4*dt);
    }
    p.prevX=p.x; p.prevY=p.y;
    // shield: regenerates after not being hit for a while
    if(p.shieldMax>0){
      p.shieldCd=Math.max(0,p.shieldCd-dt);
      if(p.shieldCd<=0&&p.shield<p.shieldMax)
        p.shield=Math.min(p.shieldMax,p.shield+PB.shield.regenRate*dt);
    }
  }
  // spawn trickle
  if(S.spawnQ.length){S.spawnT-=dt;
    if(S.spawnT<=0){S.spawnT=BAL.waves.spawnTrickleSec;S.en.push(S.spawnQ.shift());}}
  // guardian miniboss on timer
  if(!S.miniSpawned&&S.waveT>BAL.waves.guardianAfterSec&&S.wave>=BAL.waves.guardianMinWave&&!S.waveDone){
    S.miniSpawned=true;
    const minis=ET.filter(T=>T.mini);
    if(minis.length){ S.en.push(mkE(minis[irnd(0,minis.length)].id));
      toastAll('⚠ A guardian stirs…'); sfxE('boss'); }
  }
  // weapons fire (all players)
  for(const p of S.players.values()){
    // orbN used to drive the passive blade ring; fangs are real projectiles
    // now, so only the saber still needs a rendered blade count
    p.orbN=0;p.sabN=0;
    for(const w of p.weapons){
      if(WPN[w.id].passiveSaber)p.sabN+=sabCountW(w);
    }
    if(p.dead||now()<p.pickUntil)continue;
    for(const w of p.weapons){
      const def=WPN[w.id];
      if(def.passiveSaber)continue;
      w.cd-=dt;
      if(w.cd<=0){
        if(def.rt==='t'&&(p.tLock||p.t<=0))continue; // charge empty & recharging
        if(def.drone&&S.dr.filter(d2=>d2.owner===p.id).length>=CB.drones.maxPerPlayer)continue;
        let tg=null;
        if(def.needT){let bd=1e9;
          for(const e of S.en){ if(!hostile(p.team,e.team))continue; // don't lock onto your own base
            const d=(e.x-p.x)**2+(e.y-p.y)**2;
            if(d<bd&&d<320*320){bd=d;tg=e;}}
          // In PvP modes hostile PLAYERS are valid targets too. Without this
          // an aimed weapon can only ever lock onto an S.en entity, so you
          // simply cannot shoot at an enemy player — you just hit whatever
          // creep happens to be nearby.
          if(S.pvp)for(const q of S.players.values()){
            if(q===p||q.dead||!hostile(p.team,q.team))continue;
            const d=(q.x-p.x)**2+(q.y-p.y)**2;
            if(d<bd&&d<320*320){bd=d;tg=q;}}
          if(!tg)continue;}
        w.cd=def.cd(w)*p.st.cdM;
        if(def.rt==='t'&&!(p.tFreeChance>0&&Math.random()<p.tFreeChance)){
          p.t-=def.cost;
          if(p.t<=0){p.t=0;p.tLock=true;}
        }
        const od=p.st.dmgM; p.st.dmgM=od*p.dmgBoost;
        def.fire(p,w,tg);
        p.st.dmgM=od;
        sfxE(def.sfx||(def.rt==='t'?'shootT':'shoot'),p.x,p.y); // per-weapon voice
      }
    }
    p.sabA=(p.sabA||0)+dt*CB.saber.spinSpeed;
    /* AETHER SABER — discrete strikes, not a continuous grind.
       Every tickInterval the blades land one real hit on each target in
       their arc, each hit costing charge. Bolts the blades deflect feed
       p.sabCharge, which is added to (and consumed by) the next strike,
       up to a cap — so parrying a barrage sets up a big swing. */
    p.sabTick=Math.max(0,(p.sabTick||0)-dt);
    for(const w of p.weapons){ if(!WPN[w.id].passiveSaber)continue;
      if(p.sabTick>0)break;
      const n=sabCountW(w);
      const bonus=Math.min(p.sabCharge||0,CB.saber.maxDeflectBonus);
      const dmg=(wDmg(WPN[w.id],w,p)+bonus)*p.dmgBoost;
      const inArc=(ox,oy,orad)=>{
        const dd=Math.hypot(ox-p.x,oy-p.y);
        if(dd>CB.saber.reach+orad)return false;
        const ea=Math.atan2(oy-p.y,ox-p.x);
        for(let i=0;i<n;i++){ let da=ea-(p.sabA+i/n*TAU);
          da=((da%TAU)+TAU)%TAU; if(da>Math.PI)da-=TAU;
          if(Math.abs(da)<CB.saber.arc)return true; }
        return false;
      };
      let struck=false;
      for(const e of S.en){ if(e.hp<=0)continue;
        if(inArc(e.x,e.y,e.r)){ damageE(e,dmg,p.id); struck=true; } }
      for(const q of foePlayers(p))
        if(inArc(q.x,q.y,q.r)){ hurt(q,dmg,p.id); struck=true; }
      if(struck){
        p.sabTick=CB.saber.tickInterval;
        p.sabCharge=0;                       // the stored parry damage is spent
        p.t=Math.max(0,p.t-CB.saber.energyPerHit);
        if(p.t<=0){p.t=0;p.tLock=true;}
        sfxE('wSaber');
      }
    }
  }
  // servitor drones: seek & ram foes, soak enemy fire
  const DR=CB.drones;
  for(const dn of S.dr){
    let tg=null,bd=1e9;
    const dOwner=S.players.get(dn.owner);
    // Only hunt inside the tether. Without this a servitor locks onto the
    // nearest hostile ANYWHERE — on a siege map that's a structure across
    // the field — walks itself out of range and suicides on repeat.
    const reach=DR.maxRange*DR.maxRange;
    for(const e of S.en){ if(e.hp<=0)continue;
      if(dOwner&&!hostile(dOwner.team,e.team))continue; // servitors ignored team and chased friendly creeps
      if(dOwner&&((e.x-dOwner.x)**2+(e.y-dOwner.y)**2)>reach)continue;
      const dd=(e.x-dn.x)**2+(e.y-dn.y)**2; if(dd<bd){bd=dd;tg=e;} }
    // Servitors are tethered: past maxRange from their owner they stop dead
    // rather than chasing across the map, and only move again once the owner
    // comes back within reach. dn.stuck drives the rendering cue.
    const owner=S.players.get(dn.owner);
    const ownDist=owner?Math.hypot(owner.x-dn.x,owner.y-dn.y):1e9;
    dn.stuck=ownDist>DR.maxRange;
    if(dn.stuck){
      // out of tether: holds position and burns a 3-second fuse, then
      // detonates. dn.fuse drives the countdown drawn over it.
      dn.stuckT=(dn.stuckT||0)+dt;
      dn.fuse=Math.max(0,Math.ceil((DR.stuckFuse||3)-dn.stuckT));
      if(dn.stuckT>=(DR.stuckFuse||3)){
        boom(dn.x,dn.y,DR.selfBoomRadius||16,dn.dmg*(DR.selfBoomMult||2),dn.owner,'#4ef0e8');
        dn.hp=0;
      }
    }else{ dn.stuckT=0; dn.fuse=0; }
    if(dn.stuck){ /* tethered out — holds position */ }
    else if(tg){ const a=Math.atan2(tg.y-dn.y,tg.x-dn.x);
      dn.x+=Math.cos(a)*DR.speed*dt; dn.y+=Math.sin(a)*DR.speed*dt; }
    else{ const o=owner;
      if(o&&!o.dead&&Math.hypot(o.x-dn.x,o.y-dn.y)>DR.leashDist){
        const a=Math.atan2(o.y-dn.y,o.x-dn.x);
        dn.x+=Math.cos(a)*DR.returnSpeed*dt; dn.y+=Math.sin(a)*DR.returnSpeed*dt; } }
    collideObstacles(dn);
    dn.hitCd=Math.max(0,dn.hitCd-dt);
    const dspan=dotReady(dn,dt);   // shared DoT cadence
    if(dspan){
      const ram=dn.dmg*dspan*DR.contactTick;
      for(const e of S.en){ if(e.hp<=0)continue;
        if(dOwner&&!hostile(dOwner.team,e.team))continue;
        if(Math.hypot(e.x-dn.x,e.y-dn.y)<e.r+3){
          damageE(e,ram,dn.owner);
          if(dn.hitCd<=0){dn.hitCd=DR.clawCooldown;dn.hp-=DR.clawDamage;} } }
      // PvP: servitors ram hostile players too
      hurtPlayersAt(dn.x,dn.y,3,ram,dn.owner,true);
    }
    if(dn.hp<=0)for(let i=0;i<8;i++)S.fx.push({x:dn.x,y:dn.y,vx:rnd(-50,50),vy:rnd(-50,50),l:.35,ci:'#4ef0e8'});
  }
  S.dr=S.dr.filter(d2=>d2.hp>0);
  // void sigil zones
  for(const z of S.zn){ z.ttl-=dt;
    // ramp: 1 dps at the moment it lands, climbing to z.dps by the end
    const age=Math.max(0,(z.dur||3)-z.ttl), k=clamp(age/(z.dur||3),0,1);
    z.cur=1+(Math.max(1,z.dps)-1)*k;
    // drag: everything inside the well is slowed while it stands in it
    const Z=BAL.combat.zoneSlow;
    for(const e of S.en) if(e.hp>0&&Math.hypot(e.x-z.x,e.y-z.y)<z.r+e.r)
      e.slowT=Math.max(e.slowT||0,Z.linger);
    // Players are only mired in modes where players are enemies, and never
    // the caster or their own side — otherwise your own well is a trap you
    // walk into, and in co-op it would drag your teammates down.
    if(S.pvp)for(const q of S.players.values()){
      if(q.dead||q.id===z.owner)continue;
      const src=S.players.get(z.owner);
      if(src&&!hostile(src.team,q.team))continue;
      if(Math.hypot(q.x-z.x,q.y-z.y)<z.r+q.r) q.slowT=Math.max(q.slowT||0,Z.linger);
    }
    const span=dotReady(z,dt);
    if(span){
      for(const e of S.en) if(e.hp>0&&Math.hypot(e.x-z.x,e.y-z.y)<z.r+e.r)
        damageE(e,z.cur*span,z.owner,true);
      hurtPlayersAt(z.x,z.y,z.r,z.cur*span,z.owner,true); // PvP: sigils burn players standing in them
    }
    if(Math.random()<dt*18)S.fx.push({x:z.x+rnd(-z.r,z.r),y:z.y+rnd(-z.r,z.r),vx:0,vy:-10,l:.3,ci:'#b34fff'});
  }
  S.zn=S.zn.filter(z=>z.ttl>0);
  // multi-part bosses: core is shielded (near-immune, see damageE) while any linked part survives
  for(const e of S.en){ if(e.hp<=0||!ET[ETI[e.k]].parts)continue;
    const nowShielded=S.en.some(pt=>pt.core===e.id&&pt.hp>0);
    if(e.shielded&&!nowShielded)toastAll('⚠ '+(ET[ETI[e.k]].bn||'BOSS')+' CORE EXPOSED — pylons down!');
    e.shielded=nowShielded; }
  // enemies
  for(const e of S.en){ enemyAct(e,dt); e.flash=Math.max(0,e.flash-dt);
    if(e.poisT>0){ e.poisT-=dt;
      const pspan=dotReady(e,dt); if(pspan)damageE(e,e.poisD*pspan,e.poisBy,true);
      if(Math.random()<dt*8)S.fx.push({x:e.x+rnd(-3,3),y:e.y+rnd(-3,3),vx:0,vy:-14,l:.4,ci:'#7cff6b'}); }
    // contact damage: only auto-applied to the host's own local player — remote
    // players self-report contact from their own screen (see applyClientHit)
    // so nobody takes a hit that hadn't reached them yet on their own client.
    for(const p of S.players.values()){ if(p.dead||p.id!==myId)continue;
      if(!hostile(e.team,p.team))continue; // MOBA: don't body-check your own structures
      const d=Math.hypot(e.x-p.x,e.y-p.y);
      if(d<e.r+p.r+1){
        const melee=ET[ETI[e.k]].meleeDash&&e.st===2;
        const CD=CB.contactDamage;
        // a telegraphed charge hits far harder than a bump; siege units
        // override the global with their own number
        hurt(p,melee?(e.chargeDmg||CD.meleeDash):e.boss?CD.boss:e.mini?CD.mini:CD.base,undefined);
      } } }
  // player bullets
  for(const b of S.pb){
    if(b.home){ let bt=null,bd=1e9;
      const homeOwner=S.players.get(b.owner);
      for(const e of S.en){ if(homeOwner&&!hostile(homeOwner.team,e.team))continue; // homing must not chase allies
        const d=(e.x-b.x)**2+(e.y-b.y)**2;if(d<bd){bd=d;bt=e;}}
      if(bt){const ta=Math.atan2(bt.y-b.y,bt.x-b.x),ca=Math.atan2(b.vy,b.vx);
        let da=ta-ca; while(da>Math.PI)da-=TAU; while(da<-Math.PI)da+=TAU;
        const na=ca+clamp(da,-4.2*dt,4.2*dt),sp=Math.hypot(b.vx,b.vy)*1.01;
        b.vx=Math.cos(na)*Math.min(sp,190);b.vy=Math.sin(na)*Math.min(sp,190);}}
    if(b.wob){ // weird-trajectory weapon: sine-weaves along its base heading
      b.wobT+=dt;
      const fx=b.wx0+Math.cos(b.baseAng)*b.wspd*b.wobT, fy=b.wy0+Math.sin(b.baseAng)*b.wspd*b.wobT;
      const px2=Math.cos(b.baseAng+Math.PI/2), py2=Math.sin(b.baseAng+Math.PI/2);
      const off=Math.sin(b.wobT*b.wfreq)*b.wamp;
      b.x=fx+px2*off; b.y=fy+py2*off;
    }else if(b.rang){ // boomerang weapon: flies out, then curves back to its owner
      b.rt=(b.rt||0)+dt;
      if(!b.returning){ b.x+=b.vx*dt; b.y+=b.vy*dt; if(b.rt>=b.outT)b.returning=true; }
      else{ const owner=S.players.get(b.owner); const tx=owner?owner.x:b.x, ty=owner?owner.y:b.y;
        const ddx=tx-b.x, ddy=ty-b.y, dd=Math.hypot(ddx,ddy)||1;
        b.x+=ddx/dd*b.rspd*dt; b.y+=ddy/dd*b.rspd*dt;
        if(dd<8)b.dead=true; }
    }else if(b.orb){ // summoned fang: rides a wide circle around its owner
      const o=S.players.get(b.owner);
      if(!o||o.dead){ b.dead=true; }
      else{ b.orbA+=BAL.combat.orbit.spinSpeed*dt;
        b.x=o.x+Math.cos(b.orbA)*b.orbR; b.y=o.y+Math.sin(b.orbA)*b.orbR; }
    }else{ b.x+=b.vx*dt; b.y+=b.vy*dt; }
    b.ttl-=dt;
    // a player's bolts inherit their team, so they pass through friendly
    // structures instead of shredding their own base
    const bOwner=S.players.get(b.owner), bTeam=bOwner?bOwner.team:undefined;
    for(const e of S.en){if(b.dead)break;
      if(!hostile(bTeam,e.team))continue;
      if(e.hp>0&&Math.hypot(e.x-b.x,e.y-b.y)<e.r+b.r+1){
        // nexus aura damage buff, if the owner is standing in their field
        damageE(e,b.dmg*((bOwner&&bOwner.auraBuffT>0)?1+MOBA.nexus.auraDamage:1),b.owner);
        if(b.slow)e.slowT=1.2;
        if(b.pois){e.poisT=3;e.poisD=Math.max(e.poisD||0,b.pois);e.poisBy=b.owner;}
        if(b.pierce>0)b.pierce--;else b.dead=true;}}
    // PvP bullets against players the host owns outright: its own player
    // and every bot. Remote humans still self-report ("only get hit by
    // what you saw"), but nobody reports for a bot, so bot-vs-bot and
    // player-vs-bot fire previously hit nothing at all.
    if(!b.dead&&S.pvp)for(const q of S.players.values()){
      if(q.dead||q.id===b.owner)continue;
      if(q.id!==myId&&!q.bot)continue;              // remote humans report their own hits
      if(!hostile(bTeam,q.team))continue;
      if(Math.hypot(b.x-q.x,b.y-q.y)<3+q.r){
        b.dead=true;
        hurt(q,b.dmg*((S.moba?MOBA.pvpDamageMult:0)||(BAL.battleground&&BAL.battleground.pvpDamageMult)||1),b.owner);
        break;
      }
    }
    if(b.ttl<=0||(!b.orb&&bulletHitsObstacle(b)))b.dead=true; // fangs sweep over cover
    if(b.dead&&b.chain&&!b.chained){b.chained=1;chainBurst(b);} // arc where the bolt stopped
    if(b.dead&&b.boom&&!b.boomed){b.boomed=1;boom(b.x,b.y,b.boom,b.boomDmg,b.owner);
      if(b.orb)sfxE('orbPop');}
  }
  S.pb=S.pb.filter(b=>!b.dead);
  /* Saber parry vs PLAYER bullets. The blades already swat enemy bolts;
     in PvP they must also cut down incoming fire from hostile players,
     otherwise the defensive half of the weapon simply doesn't exist
     against the people you're actually fighting. */
  if(S.pvp)for(const b of S.pb){
    if(b.dead||b.orb)continue;                       // your own fangs aren't incoming fire
    const shooter=S.players.get(b.owner);
    for(const p of S.players.values()){
      if(p.dead||!p.sabN||p.id===b.owner)continue;
      if(shooter&&!hostile(shooter.team,p.team))continue;
      const dd=Math.hypot(b.x-p.x,b.y-p.y);
      if(dd<=CB.saber.deflectMin||dd>=CB.saber.reach)continue;
      const ba=Math.atan2(b.y-p.y,b.x-p.x);
      for(let i=0;i<p.sabN;i++){ let da=ba-(p.sabA+i/p.sabN*TAU);
        da=((da%TAU)+TAU)%TAU; if(da>Math.PI)da-=TAU;
        if(Math.abs(da)<CB.saber.deflectArc){
          b.dead=true; sfxE('deflect',b.x,b.y);
          p.sabCharge=Math.min(CB.saber.maxDeflectBonus,(p.sabCharge||0)+CB.saber.deflectBonus);
          S.fx.push({x:b.x,y:b.y,vx:rnd(-30,30),vy:rnd(-30,30),l:.2,ci:'#7cff6b'});
          break; } }
      if(b.dead)break;
    }
  }
  S.pb=S.pb.filter(b=>!b.dead);
  // enemy bullets
  for(const b of S.eb){b.x+=b.vx*dt;b.y+=b.vy*dt;b.ttl-=dt;
    // saber blades deflect bolts
    for(const p of S.players.values()){ if(p.dead||!p.sabN)continue;
      const dd=Math.hypot(b.x-p.x,b.y-p.y);
      if(dd>CB.saber.deflectMin&&dd<CB.saber.reach){ const ba=Math.atan2(b.y-p.y,b.x-p.x);
        for(let i=0;i<p.sabN;i++){ let da=ba-(p.sabA+i/p.sabN*TAU);
          da=((da%TAU)+TAU)%TAU; if(da>Math.PI)da-=TAU;
          if(Math.abs(da)<CB.saber.deflectArc){ b.dead=true; sfxE('deflect');
            // every parried bolt feeds the next saber strike, up to the cap
            p.sabCharge=Math.min(CB.saber.maxDeflectBonus,(p.sabCharge||0)+CB.saber.deflectBonus);
            sfxE('sabCharge');
            S.fx.push({x:b.x,y:b.y,vx:rnd(-30,30),vy:rnd(-30,30),l:.2,ci:'#7cff6b'}); break; } } }
      if(b.dead)break; }
    // servitors soak enemy fire
    if(!b.dead)for(const dn of S.dr){
      if(Math.hypot(b.x-dn.x,b.y-dn.y)<b.r+3){ b.dead=true; dn.hp-=DR.bulletDamage;
        S.fx.push({x:dn.x,y:dn.y,vx:rnd(-25,25),vy:rnd(-25,25),l:.25,ci:'#4ef0e8'}); break; } }
    // same self-report split as contact damage above: host only auto-resolves
    // bullet hits against its own local player; remote players' clients detect
    // the overlap against what THEY render (see checkLocalHits/'hit' message)
    // and report it, which is what applyClientHit() replays below.
    // MOBA: team-tagged bolts also damage hostile structures/creeps. This
    // is the only place entity-vs-entity fire resolves, and it is skipped
    // entirely for classic PvE bullets (team === undefined).
    if(!b.dead&&b.team!==undefined)for(const e of S.en){
      if(e.hp<=0||!hostile(b.team,e.team))continue;
      if(Math.hypot(b.x-e.x,b.y-e.y)<e.r+b.r+1){
        b.dead=true; damageE(e,b.dmg||CB.enemyBulletDamage,undefined,true); break; }
    }
    if(!b.dead)for(const p of S.players.values()){if(p.dead||p.id!==myId)continue;
      if(!hostile(b.team,p.team))continue; // friendly fire is off in a match
      if(Math.hypot(b.x-p.x,b.y-p.y)<b.r+p.r){b.dead=true;
        if(p.inv>0){ p.surgeT=PB.surge.duration; sfxE('surge'); // phase surge: absorb a bolt with i-frames
          for(let i=0;i<5;i++)S.fx.push({x:b.x,y:b.y,vx:rnd(-40,40),vy:rnd(-40,40),l:.3,ci:'#ffd35c'}); }
        else hurt(p,b.dmg||CB.enemyBulletDamage); // structures carry their own damage
        break;}}
    if(b.ttl<=0||bulletHitsObstacle(b))b.dead=true;}
  S.eb=S.eb.filter(b=>!b.dead);
  // items pickup
  for(const it of S.it){
    for(const p of S.players.values()){if(p.dead)continue;
      if(Math.hypot(it.x-p.x,it.y-p.y)<(p.st.mag||7)){
        it.dead=true;
        if(it.k===0){p.hp=Math.min(p.maxhp,p.hp+it.v);sfxE('heal');if(p.id===myId)toast('+'+it.v+' HP');else sendTo(p.id,{t:'ts',m:'+'+it.v+' HP'});}
        else if(it.k===1){p.shards+=it.v;sfxE('shard');}
        else if(it.k===2){openChest(p);sfxE('chest');}
        break;}}}
  S.it=S.it.filter(i=>!i.dead);
  // orbital smite marks: a shrinking ring that then detonates where it was
  // planted — it does NOT follow the target, so stepping out is the counter
  for(const m of S.mk){ m.t-=dt;
    if(m.t<=0&&!m.done){ m.done=1; smiteHit(m); } }
  S.mk=S.mk.filter(m=>!m.done);
  // chain-lightning arc segments (visual only, host + clients)
  for(const a of S.ar)a.l-=dt;
  S.ar=S.ar.filter(a=>a.l>0);
  // fx
  for(const f of S.fx){f.x+=f.vx*dt;f.y+=f.vy*dt;f.l-=dt;}
  S.fx=S.fx.filter(f=>f.l>0);
  S.en=S.en.filter(e=>e.hp>0);
  S.shake=Math.max(0,S.shake-dt);
  mobaUpdate(dt); // no-op unless this is a Nexus Siege match
  // side objective progress
  if(S.obj&&!S.obj.done){ const o=S.obj;
    o.tLeft-=dt;
    if(o.ty==='zone'){
      for(const p of S.players.values())
        if(!p.dead&&Math.hypot(p.x-o.zx,p.y-o.zy)<o.zr){o.prog+=dt;break;}
      if(o.prog>=o.goal)objDone(1);
    }
    else if(o.ty==='slay'&&o.prog>=o.goal)objDone(1);
    else if(o.ty==='greed'&&o.prog>=o.goal)objDone(1);
    else if(o.ty==='notouch'&&o.tLeft<=0)objDone(1);
    if(!o.done&&o.tLeft<=0&&o.ty!=='speed')objDone(-1);
  }
  // picks timeout
  for(const p of S.players.values())
    if(p.pickOpts&&now()>=p.pickUntil) resolvePick(p,0);
  // wave clear (optional enemies don't block)
  if(!S.waveDone&&!S.spawnQ.length&&!S.en.some(e=>!e.opt)){
    S.waveDone=true; S.eb.length=0;
    S.score+=S.wave*BAL.economy.waveClearScore;
    if(S.obj&&!S.obj.done){
      if(S.obj.ty==='speed')objDone(S.waveT<=S.obj.goal?1:-1);
      else if(S.obj.ty==='notouch')objDone(1);
      else objDone(-1);
    }
    for(const p of S.players.values())if(!p.dead)startPick(p);
    setTimeout(()=>{if(S&&!S.over)nextWave();},600);
  }
}
function runOver(){
  S.over=true;
  const me=S.players.get(myId);
  finishRun(S.wave,S.score,me?me.shards:0);
  for(const c of conns){ const p=S.players.get(c._pid);
    c.send({t:'go',wave:S.wave,score:S.score,shards:p?p.shards:0}); }
}
function finishRun(wave,score,shards){
  mode='dead'; musicStop(); sfx('gameover');
  save.shards+=shards;
  if(wave>save.best)save.best=wave;
  save.records=save.records||[];
  save.records.push({n:save.name,w:wave,s:score,t:Date.now()});
  save.records.sort((a,b)=>b.s-a.s); save.records=save.records.slice(0,10);
  persist();
  $('dWave').textContent=wave; $('dScore').textContent=score;
  $('dShards').textContent='◆ '+shards;
  $('dWait').classList.toggle('hidden',role!=='client');
  $('btnAgain').classList.toggle('hidden',role==='client');
  hidePickUI();
  $('scrDeath').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('bossWrap').classList.add('hidden');
  $('objBanner').classList.add('hidden');
}
