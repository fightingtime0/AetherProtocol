"use strict";
/* ============================================================
   moba.js — NEXUS SIEGE: team-vs-team lane mode.

   STAGE 1 (teams) + STAGE 2 (static map) are implemented here.
   Creeps and bots are deliberately NOT here yet — see mobaUpdate().

   TEAM MODEL — the one rule everything else follows:
     team === undefined  → classic PvE enemy: hostile to every player,
                           hurt by every player bullet. Every existing
                           mode keeps this, so nothing outside a Nexus
                           Siege match changes behaviour at all.
     team === 0 | 1      → belongs to that side. Hostile to the other
                           side only, immune to friendly fire.
   Players carry .team too (always 0/1; it is simply ignored outside
   this mode because nothing checks it there).

   Layout, left to right (team 1 mirrors team 0 about the map centre):
     spawn · nexus · base guardian · lane turret ·· BATTLEGROUND ··
     lane turret · base guardian · nexus · spawn
   ============================================================ */

const TEAM_NEUTRAL=-1;

/* Is `a` allowed to damage `b`? Undefined team = classic PvE actor,
   which keeps the pre-MOBA rules exactly. */
function hostile(aTeam,bTeam){
  if(aTeam===undefined||bTeam===undefined)return true; // PvE: everything fights everything it used to
  if(aTeam===TEAM_NEUTRAL||bTeam===TEAM_NEUTRAL)return true;
  return aTeam!==bTeam;
}
function mobaActive(){ return !!(S&&S.moba); }
function teamName(t){ return (MOBA&&MOBA.teamNames[t])||('TEAM '+t); }
function teamColor(t){ return (MOBA&&MOBA.teamColors[t])||'#dfe6ff'; }

/* Nearest thing `e` is allowed to attack: players first, then hostile
   structures/creeps. Outside a match this is exactly nearestPlayer(). */
function nearestFoe(e){
  if(!mobaActive()||e.team===undefined)return nearestPlayer(e);
  let best=null,bd=1e9;
  for(const p of S.players.values()){
    if(p.dead||!hostile(e.team,p.team))continue;
    const d=(p.x-e.x)**2+(p.y-e.y)**2; if(d<bd){bd=d;best=p;}
  }
  for(const o of S.en){
    if(o===e||o.hp<=0||!hostile(e.team,o.team))continue;
    const d=(o.x-e.x)**2+(o.y-e.y)**2; if(d<bd){bd=d;best=o;}
  }
  return best;
}

/* ---------------- world ---------------- */
function genMobaWorld(){
  WW=MOBA.world.w; WH=MOBA.world.h;
  const obs=[];
  const laneY=WH/2, half=MOBA.laneHalfHeight;
  const cx=WW/2, cy=WH/2, clearR=(MOBA.worldBoss&&MOBA.worldBoss.hiveClearRadius)||140;
  // Cover hugs the lane edges: dense enough to fight around, but the
  // corridor itself and both bases stay clear so structures keep line of
  // sight and a push reads cleanly. The dead-centre is ALSO kept clear —
  // that's exactly where the mothership roots once it hits 100% hive
  // growth, and it needs to land as an unobstructed centrepiece.
  for(let i=0;i<MOBA.obstacles;i++){
    for(let tries=0;tries<14;tries++){
      const x=rnd(WW*0.15,WW*0.85), y=rnd(14,WH-14);
      if(Math.abs(y-laneY)<half*0.45)continue; // keep the lane itself walkable
      if(Math.hypot(x-cx,y-cy)<clearR)continue; // keep the hive's landing spot clear
      const r=rnd(MOBA.obstacleRadius[0],MOBA.obstacleRadius[1]);
      if(obs.some(o=>Math.hypot(o.x-x,o.y-y)<o.r+r+6))continue; // no fused blobs
      obs.push({x,y,r}); break;
    }
  }
  return obs;
}

/* A team entity is a normal S.en entity — it reuses damageE(), the bullet
   collision loops, the snapshot and the renderer. Only its AI is new. */
function mkTeamEnt(kind,team,x,y,hpMul){
  const e=mkE(kind);          // stats/sprite/radius straight from enemies.json
  e.x=x; e.y=y; e.team=team;
  e.hp=e.maxhp=ET[ETI[kind]].hp*(hpMul||1); // ignores wave/difficulty scaling
  const cd=mobaChargeDmg(kind); if(cd)e.chargeDmg=cd;
  e.homeX=x; e.homeY=y; e.ph=rnd(0,TAU); e.cd=rnd(.2,1.0);
  return e;
}
function mkStruct(kind,team,x,y){
  const e=mkTeamEnt(kind,team,x,y); e.struct=true; return e;
}
/* per-unit charge damage, so a guardian's lunge hurts far more than a
   generic melee bump without inflating every charging enemy in the game */
function mobaChargeDmg(kind){
  if(kind==='basebss')return MOBA.baseboss.chargeDamage;
  if(kind==='siegelord'||kind==='wardsiege')return MOBA.siegeLord.chargeDamage;
  return 0;
}
function mobaSpawnStructures(){
  const P=MOBA.positions, laneY=WH/2;
  for(let team=0;team<2;team++){
    const at=f=>team===0?WW*f:WW*(1-f); // team 1 mirrors about the centre
    S.en.push(mkStruct('nexus',team,at(P.nexus),laneY));
    S.en.push(mkStruct('basebss',team,at(P.baseboss),laneY));
    // second guardian offset off the lane — offset is data-driven so it stays
    // inside the map however thin the corridor gets
    S.en.push(mkStruct('basebss',team,at(P.baseboss),laneY-(MOBA.guardianOffset||70)));
    S.en.push(mkStruct('laneturret',team,at(P.turret),laneY));
  }
}
function mobaSpawn(team){
  const f=MOBA.positions.spawn;
  return {x:team===0?WW*f:WW*(1-f), y:WH/2+rnd(-40,40)};
}

/* ---------------- match lifecycle ---------------- */
function newMobaSim(playersInfo){
  // A siege hides the difficulty chips, but diffKey would otherwise carry
  // over from the title screen and silently scale structure damage by up
  // to 3.4x. Pin it so siege balance means one thing.
  if(DIFFS[MOBA.difficulty||'normal'])diffKey=MOBA.difficulty||'normal';
  obstacles=genMobaWorld();
  eidc=1; bidc=1;
  S={players:new Map(),en:[],eb:[],pb:[],it:[],fx:[],dr:[],zn:[],mk:[],ar:[],pu:[],dnQ:[],obj:null,sx:[],
     wave:1,score:0,t:0,waveT:0,
     spawnQ:[],spawnT:0,waveDone:true,miniSpawned:true,over:false,shake:0,
     pvp:true,          // opposing players can shoot each other
     persistent:true,   // death respawns at base instead of ending the run
     moba:true, mobaOver:0, creepT:MOBA.creepInterval, kills:[0,0],
     worldBoss:0, wbWasHive:0, wbLastHitBy:undefined, wbX:0, wbY:0};
  playersInfo.forEach(pi=>{
    const p=mkPlayer(pi.id,pi.name,pi.sprites||pi.sprite,pi.cls);
    applyMetaObj(p, (pi.id===myId&&!pi.bot)?save.meta:pi.meta);
    p.team=(pi.team===1)?1:0;
    p.bot=!!pi.bot;
    p.lvl=1; p.xp=0;
    const sp=mobaSpawn(p.team); p.x=sp.x; p.y=sp.y;
    S.players.set(pi.id,p);
  });
  mobaSpawnStructures();
  mobaSpawnShops();
}
/* Respawn at your own base, keeping everything earned — a siege death
   costs you time, not progress. Deliberately does NOT go through
   respawnPersistent(): that rebuilds the player from scratch (correct for
   Battleground, where a fresh loadout is the point) and would throw away
   weapons, upgrades, level and XP every single death. */
function mobaRespawn(p){
  p.hp=p.maxhp;
  p.dead=false;
  p.shield=p.shieldMax||0;
  p.inv=(MOBA.respawnInvuln||3);
  p.respawnAt=0;
  p.lastHitBy=undefined;
  p.t=p.tMax; p.tLock=false;
  const sp=mobaSpawn(p.team||0);
  p.x=sp.x; p.y=sp.y;
  // hostUpdate() copies myPos over the local player every tick, so without
  // this the host would be yanked straight back to where it died
  if(p.id===myId){ myPos.x=p.x; myPos.y=p.y; myPos.dead=false; }
  return p;
}
function mobaNexus(team){ return S.en.find(e=>e.k==='nexus'&&e.team===team&&e.hp>0); }

function mobaUpdate(dt){
  if(!mobaActive()||S.mobaOver)return;
  // decay first, then re-apply below — a player who walks out of the
  // field loses the buff within a frame or two instead of keeping it
  for(const p of S.players.values()) p.auraBuffT=Math.max(0,(p.auraBuffT||0)-dt);
  // Nexus aura: buffs damage and regenerates allies standing in its field.
  for(const e of S.en){
    if(e.k!=='nexus'||e.hp<=0)continue;
    const N=MOBA.nexus;
    for(const p of S.players.values()){
      if(p.dead||p.team!==e.team)continue;
      if(Math.hypot(p.x-e.x,p.y-e.y)<N.auraRadius){
        p.auraBuffT=.25;                                   // read by the damage math + HUD
        p.hp=Math.min(p.maxhp,p.hp+N.auraRegen*dt);
      }
    }
  }
  // Win check: a fallen nexus ends the match.
  for(let t=0;t<2;t++){
    if(!mobaNexus(t)){
      S.mobaOver=(t===0?2:1);   // the OTHER team won
      mobaEnd(S.mobaOver-1);
      return;
    }
  }
  mobaShopTick(dt);
  mobaWorldBossTick(dt);
  // creep waves
  S.creepT-=dt;
  if(S.creepT<=0){ S.creepT=MOBA.creepInterval; spawnCreepWave(); }
  // bots think here; their weapons already auto-fire with everyone else's
  for(const p of S.players.values()) if(p.bot)botUpdate(p,dt);
}

/* ---------------- experience & levels ----------------
   A siege has no waves, so upgrades are earned instead: XP from kills,
   and every level grants one pick. Killing an enemy PLAYER is worth far
   more than any creep, which is what makes fighting them worthwhile. */
function xpNeeded(lvl){ const X=MOBA.xp; return Math.round(X.base*Math.pow(X.growth,lvl-1)); }
function grantXp(p,amt){
  if(!p||!S.moba||amt<=0)return;
  p.lvl=p.lvl||1; p.xp=(p.xp||0)+amt;
  let guard=0;
  while(p.xp>=xpNeeded(p.lvl)&&guard++<20){
    p.xp-=xpNeeded(p.lvl);
    p.lvl++;
    if(!p.pickOpts)startPick(p);   // one upgrade per level
    if(p.id===myId)toast('LEVEL '+p.lvl);
    else sendTo(p.id,{t:'ts',m:'LEVEL '+p.lvl});
  }
}
/* XP for killing a unit — derived from its score so structures are worth
   far more than creeps without a second table to keep in sync. */
function mobaXpForEntity(e){
  return Math.max(MOBA.xp.minUnit,Math.round((e.sc||0)*MOBA.xp.scoreToXp));
}
function mobaOnPlayerKill(killer,victim){
  if(S.kills)S.kills[killer.team|0]=(S.kills[killer.team|0]||0)+1;
  grantXp(killer,MOBA.xp.playerKill);
  grantAssistXp(killer,MOBA.xp.playerKill,victim);
  killer.score=(killer.score||0)+1;
  toastAll(killer.name+' slew '+victim.name);
  sfxE('bosskill');
}
/* Everyone else on the killer's side gets a share of the XP, so a player
   who softened a target up (or is simply holding the lane) still climbs.
   Excludes the killer, who already got the full amount. */
function grantAssistXp(killer,fullXp,victim){
  // deliberately NOT rounded: a creep is worth ~4 XP, so Math.round(4*0.1)
  // is 0 and allies would earn nothing at all from ordinary kills. XP
  // accumulates fractionally and is only rounded for display/snapshot.
  const share=fullXp*(MOBA.xp.assistFrac||0);
  if(share<=0)return;
  for(const q of S.players.values()){
    if(q===killer||q===victim||q.dead)continue;
    if(killer&&q.team!==killer.team)continue;
    grantXp(q,share);
  }
}

/* ---------------- shard shop ----------------
   Five capture-style pads sit at each team's OWN nexus: stand on one with
   enough shards and it spends them.
     UP (a cluster of three) — reinforcements: Reinforcements (buffed
       charging creeps), Amplifier (backline support: aura buffs + heal
       pulses), Payload (charges the enemy nexus, detonates on death).
     DOWN — weapon roll: a new weapon, or once you're at the siege weapon
       cap, rerolls one of the two you're carrying (see maxSlots() in sim.js).
     BEHIND (toward your own spawn) — cache: a chest with weapon or stat loot.
   All five go on cooldown afterwards so they can't be spammed. */
// single source of truth for the shop's network kind-code (net.js snap()
// encodes a shop pad's .k as this array's index; render.js decodes it back)
const SHOP_KINDS=['reinf','amp','payload','wpn','chest'];
const SHOP_COST={reinf:'creepCost',amp:'ampCost',payload:'payloadCost',wpn:'wpnCost',chest:'chestCost'};
const SHOP_COOLDOWN={reinf:'creepCooldown',amp:'ampCooldown',payload:'payloadCooldown',wpn:'wpnCooldown',chest:'chestCooldown'};
function mobaSpawnShops(){
  const SH=MOBA.shop, P=MOBA.positions, laneY=WH/2;
  S.shops=[];
  for(let team=0;team<2;team++){
    const nx=team===0?WW*P.nexus:WW*(1-P.nexus);
    const behindDir=team===0?-1:1;
    const sp=SH.reinfSpacing||26, upY=laneY-(SH.padOffsetY||60), downY=laneY+(SH.padOffsetY||60);
    S.shops.push({k:'reinf',  team, cd:0, x:nx-sp, y:upY});
    S.shops.push({k:'amp',    team, cd:0, x:nx,    y:upY});
    S.shops.push({k:'payload',team, cd:0, x:nx+sp, y:upY});
    S.shops.push({k:'wpn',    team, cd:0, x:nx,    y:downY});
    S.shops.push({k:'chest',  team, cd:0, x:nx+behindDir*(SH.padOffsetX||70), y:laneY});
  }
}
function mobaShopTick(dt){
  const SH=MOBA.shop;
  for(const sh of S.shops){
    sh.cd=Math.max(0,sh.cd-dt);
    if(sh.cd>0)continue;
    const R=sh.k==='reinf'||sh.k==='amp'||sh.k==='payload'?(SH.reinfRadius||15):(SH.radius||22);
    for(const p of S.players.values()){
      if(p.dead||p.team!==sh.team)continue;
      if(Math.hypot(p.x-sh.x,p.y-sh.y)>R)continue;
      const cost=SH[SHOP_COST[sh.k]];
      if(p.shards<cost){
        if(p.id===myId&&!p.shopWarn){ p.shopWarn=1; toast('Need ◆'+cost); sfxE('denied'); }
        continue;
      }
      p.shards-=cost;
      sh.cd=SH[SHOP_COOLDOWN[sh.k]];
      sfxE('buy');
      if(sh.k==='reinf'){ mobaBuyMercs(p.team); toastAll(p.name+' called in reinforcements!'); }
      else if(sh.k==='amp'){ mobaBuyAmplifier(p.team); toastAll(p.name+' deployed an amplifier!'); }
      else if(sh.k==='payload'){ mobaBuyPayload(p.team); toastAll(p.name+' launched a payload!'); }
      else if(sh.k==='wpn'){ mobaBuyWeaponRoll(p); }
      else{ S.it.push({k:2,x:sh.x,y:sh.y}); toastAll(p.name+' cracked a cache!'); }
      break;
    }
  }
  for(const p of S.players.values())p.shopWarn=0;
}
/* Weapon roll: fills an empty siege slot with a random unowned weapon, or —
   once at the cap — replaces a random held weapon with a different one.
   Rarity first, then a level anywhere from 1 up to THAT rarity's own max —
   right-skewed (Math.random()**1.6) so a fresh Lv-max legendary is a real
   possibility, not the expected outcome, but "it can hit max" like a good
   roll should. */
function mobaRollRarityLevel(){
  const r=Math.random(); const rar=r<.5?'c':r<.8?'r':r<.95?'e':'l';
  const maxLvl=RARS[rar].max;
  const lvl=clamp(Math.ceil(Math.pow(Math.random(),1.6)*maxLvl),1,maxLvl);
  return {rar,lvl};
}
function mobaBuyWeaponRoll(p){
  const canNew=p.weapons.length<maxSlots(S.wave);
  const notOwned=WKEYS.filter(k=>!p.weapons.some(w=>w.id===k));
  if(canNew&&notOwned.length){
    const k=notOwned[irnd(0,notOwned.length)];
    const {rar,lvl}=mobaRollRarityLevel();
    p.weapons.push({id:k,lvl,rar,cd:0});
    toastAll(p.name+' rolled '+RARS[rar].n+' '+WPN[k].n+' Lv'+lvl+'!');
    return;
  }
  if(p.weapons.length&&notOwned.length){
    const i=irnd(0,p.weapons.length), old=p.weapons[i];
    const pool=notOwned.filter(k=>k!==old.id);
    const k=(pool.length?pool:notOwned)[irnd(0,(pool.length?pool:notOwned).length)];
    const {rar,lvl}=mobaRollRarityLevel();
    p.weapons[i]={id:k,lvl,rar,cd:0};
    toastAll(p.name+' rerolled '+WPN[old.id].n+' → '+RARS[rar].n+' '+WPN[k].n+' Lv'+lvl+'!');
  }
}
/* Bought mercenaries: tougher than a line creep, weaker than a siege lord,
   and they only ever charge — straight down the lane at the enemy nexus. */
function mobaBuyMercs(team){
  const SH=MOBA.shop;
  const sp=mobaSpawn(team);
  const goalX=team===0?WW*(1-MOBA.positions.nexus):WW*MOBA.positions.nexus;
  for(let i=0;i<SH.mercCount;i++){
    const e=mkTeamEnt(SH.mercKind||'creep',team,sp.x+rnd(-20,20),sp.y+rnd(-30,30),SH.mercHpMul);
    e.goalX=goalX; e.goalY=WH/2;
    e.merc=1;
    e.spd*=1.25;
    S.en.push(e);
  }
}
/* Amplifier: a ranged support creep. It holds a standoff distance rather
   than charging in (see the 'ampcreep' AI in enemies.js), buffs nearby
   allies' move speed + fire rate, and pulses an AoE heal. */
function mobaBuyAmplifier(team){
  const sp=mobaSpawn(team);
  const goalX=team===0?WW*(1-MOBA.positions.nexus):WW*MOBA.positions.nexus;
  const e=mkTeamEnt('amplifier',team,sp.x+rnd(-20,20),sp.y+rnd(-20,20));
  e.goalX=goalX; e.goalY=WH/2;
  S.en.push(e);
}
/* Payload: charges straight for the enemy nexus like a reinforcement (never
   stops to skirmish), but self-destructs the instant it gets close enough
   to a hostile nexus (selfDestructNearNexus, see the 'creep' AI) — and
   EITHER way it dies, detonateOnDeath (see damageE() in sim.js) fires a big
   radial burst plus a lingering % -damage zone. */
function mobaBuyPayload(team){
  const sp=mobaSpawn(team);
  const goalX=team===0?WW*(1-MOBA.positions.nexus):WW*MOBA.positions.nexus;
  const e=mkTeamEnt('payload',team,sp.x+rnd(-20,20),sp.y+rnd(-30,30));
  e.goalX=goalX; e.goalY=WH/2;
  e.merc=1;
  S.en.push(e);
}

/* ---------------- INFECTED MOTHERSHIP (neutral world boss) ----------------
   A third faction. TEAM_WILD is neither side, and hostile() already returns
   true for any mismatched pair, so it fights — and is fought by — everything
   on the map with no special cases.

   It roams the middle of the battleground, away from either base, growing
   toward a HIVE NEXUS the whole time (see hiveGrow / mobaWorldBossPoked) —
   once rooted it stops moving and starts sending assault waves down both
   lanes (see mobaHiveAssaultTick). Killing it in that state ends the match
   as a double win over both sides. It also drifts an ever-growing handful of
   weak escort spores while unrooted — see mobaSpawnSwarmling(). */
const TEAM_WILD=2;
/* A random point inside the roam box centred on the map — the mothership's
   whole patrol stays away from both bases by construction. */
function mobaWorldBossRoamPoint(){
  const WB=MOBA.worldBoss, cx=WW/2, cy=WH/2;
  const rw=(WB.roamW||900)/2, rh=(WB.roamH||260)/2;
  return {x:rnd(cx-rw,cx+rw), y:rnd(cy-rh,cy+rh)};
}
function mobaSpawnWorldBoss(){
  const WB=MOBA.worldBoss;
  const start=mobaWorldBossRoamPoint();
  const boss=mkTeamEnt('warden',TEAM_WILD,start.x,start.y);
  boss.wbTo=mobaWorldBossRoamPoint(); boss.hiveGrow=0; boss.hive=0; boss.wild=1;
  S.en.push(boss);
  S.worldBoss=boss.id;
  // orbiting shards: the existing multi-part shield logic keys off e.core
  const parts=(ET[ETI.warden].parts)||[];
  parts.forEach((pid,i)=>{
    const sh=mkTeamEnt(pid,TEAM_WILD,start.x,start.y);
    sh.core=boss.id; sh.orbIdx=i; sh.ph=i/parts.length*TAU; sh.wild=1;
    S.en.push(sh);
  });
  toastAll('⚠⚠ THE INFECTED MOTHERSHIP ENTERS THE FIELD ⚠⚠');
  sfxE('boss',boss.x,boss.y);
}
/* A few weak spores drift near the mothership and give chase to anything
   that strays close — the same soak-a-hit role as a player's servitor, just
   neutral and disposable. escortOf (NOT core) is what links them, so they
   never count toward the core's damage shield. */
function mobaSpawnSwarmling(boss){
  const WB=MOBA.worldBoss, a=rnd(0,TAU), r=WB.swarmRoamRadius||70;
  const sp=mkTeamEnt('spore',TEAM_WILD,boss.x+Math.cos(a)*r,boss.y+Math.sin(a)*r);
  sp.wild=1; sp.escortOf=boss.id; sp.ph=a;
  S.en.push(sp);
}
function mobaWorldBossTick(dt){
  const WB=MOBA.worldBoss;
  if(!S.worldBoss){
    if((S.creepWave||0)>=WB.afterCreepWave)mobaSpawnWorldBoss();
    return;
  }
  const boss=S.en.find(e=>e.id===S.worldBoss);
  if(!boss){                                   // it died
    mobaWorldBossDefeated();
    return;
  }
  // The hive meter always rises; mobaWorldBossPoked() knocks it back
  // whenever the core (or a shard) takes damage. At 100 it roots.
  if(!boss.hive){
    boss.hiveGrow=Math.min(100,(boss.hiveGrow||0)+100/(WB.hiveGrowTime||50)*dt);
    if(boss.hiveGrow>=100){
      boss.hive=1; boss.spd=0; boss.hiveGrow=100;
      boss.hp=boss.maxhp=boss.maxhp*1.5;         // rooted, but far harder to remove
      // it becomes the map's centrepiece — dead centre, where genMobaWorld()
      // already kept a hiveClearRadius of obstacles clear for exactly this
      boss.x=WW/2; boss.y=WH/2;
      toastAll('☠ THE INFECTED MOTHERSHIP HAS ROOTED INTO A HIVE NEXUS — destroy it to end this');
      sfxE('boss',boss.x,boss.y);
    }
  }
  if(boss.hive) mobaHiveAssaultTick(boss,dt);
  else{
    // standing escort of weak spores grows without limit the longer it's
    // left alone — more spores in the way makes it harder to get chip
    // damage onto the core, which is what feeds the hive meter above
    boss.swarmT=(boss.swarmT||0)-dt;
    if(boss.swarmT<=0){
      boss.swarmT=WB.swarmEvery||10;
      for(let i=0;i<(WB.swarmBurst||4);i++) mobaSpawnSwarmling(boss);
    }
  }
}
/* Once rooted, the hive sends assault waves down BOTH lanes at once — one
   batch marching toward each team's nexus — on a faster cadence than the
   normal team creepInterval. Each wave is chase drones + a summoner creep
   that spawns its own escort as it marches; every siegeCreepEvery-th wave
   also sends a hive siege creep. */
function mobaHiveAssaultTick(boss,dt){
  const HA=MOBA.worldBoss.hiveAssault; if(!HA)return;
  boss.assaultT=(boss.assaultT||HA.interval)-dt;
  if(boss.assaultT>0)return;
  boss.assaultT=HA.interval;
  boss.assaultWave=(boss.assaultWave||0)+1;
  for(let side=0;side<2;side++){
    const goalX=side===0?WW*MOBA.positions.nexus:WW*(1-MOBA.positions.nexus), goalY=WH/2;
    for(let i=0;i<(HA.chaseDronesPerWave||3);i++){
      const sp=mkTeamEnt('spore',TEAM_WILD,boss.x+rnd(-20,20),boss.y+rnd(-20,20));
      sp.wild=1; sp.goalX=goalX; sp.goalY=goalY; sp.ph=rnd(0,TAU);
      S.en.push(sp);
    }
    for(let i=0;i<(HA.summonerPerWave||1);i++){
      const su=mkTeamEnt('wardsummoner',TEAM_WILD,boss.x+rnd(-20,20),boss.y+rnd(-20,20));
      su.wild=1; su.goalX=goalX; su.goalY=goalY;
      S.en.push(su);
    }
    if(boss.assaultWave%(HA.siegeCreepEvery||3)===0){
      const sg=mkTeamEnt('wardsiege',TEAM_WILD,boss.x+rnd(-20,20),boss.y+rnd(-20,20));
      sg.wild=1; sg.goalX=goalX; sg.goalY=goalY;
      S.en.push(sg);
    }
  }
  toastAll('☠ the hive sends an assault down both lanes');
}
/* Any damage on the core (or a linked shard) knocks the hive meter back,
   proportional to how much of the core's max HP it represents — so it takes
   sustained chip damage, not one big hit, to hold it off indefinitely. */
function mobaWorldBossPoked(e,dmg){
  if(!S.moba||!S.worldBoss)return;
  const boss=S.en.find(b=>b.id===S.worldBoss);
  if(!boss||boss.hive)return;
  if(e.id===boss.id||e.core===boss.id){
    const WB=MOBA.worldBoss;
    const pct=(dmg||0)/boss.maxhp*100*(WB.hiveGrowDmgMult||1);
    boss.hiveGrow=Math.max(0,(boss.hiveGrow||0)-pct);
  }
}
function mobaWorldBossDefeated(){
  const WB=MOBA.worldBoss;
  const wasHive=S.wbWasHive;
  S.worldBoss=0;
  // clear its retinue
  for(const e of S.en) if(e.wild&&e.hp>0)e.hp=0;
  const killer=S.players.get(S.wbLastHitBy);
  const team=killer?killer.team:undefined;
  const chests=wasHive?WB.hiveChestsOnDeath:WB.chestsOnDeath;
  for(let i=0;i<chests;i++)
    S.it.push({k:2,x:clamp(S.wbX+rnd(-60,60),20,WW-20),y:clamp(S.wbY+rnd(-40,40),20,WH-20)});
  const xp=wasHive?WB.hiveXpReward:WB.xpReward;
  if(team!==undefined)
    for(const q of S.players.values()) if(q.team===team)grantXp(q,xp);
  toastAll(wasHive
    ? (teamName(team||0)+' TORE DOWN THE HIVE NEXUS — double victory!')
    : (teamName(team||0)+' purged THE INFECTED MOTHERSHIP!'));
  sfxE('bosskill',S.wbX,S.wbY);
  // a rooted hive is a third nexus: bringing it down ends the match outright
  if(wasHive&&!S.mobaOver){ S.mobaOver=(team===undefined?1:team+1); mobaEnd(team||0,true); }
  S.wbWasHive=0;
}

/* ---------------- creeps ---------------- */
function spawnCreepWave(){
  const C=MOBA.creep;
  S.creepWave=(S.creepWave||0)+1;
  // waves get slightly larger and tougher the longer the match runs, so a
  // stalemate eventually breaks instead of grinding forever
  const extra=Math.floor(S.creepWave/C.extraPerWaves);
  const hpMul=1+S.creepWave*C.hpPerWave;
  // every Nth wave both sides also send a miniboss down the lane
  const bossWave=(S.creepWave%MOBA.siegeLord.everyNWaves===0);
  for(let team=0;team<2;team++){
    const alive=S.en.filter(e=>e.team===team&&!e.struct).length;
    if(alive>=C.maxAlivePerTeam)continue;   // keep entity counts (and snapshots) bounded
    const sp=mobaSpawn(team);
    const goalX=team===0?WW*(1-MOBA.positions.nexus):WW*MOBA.positions.nexus;
    const add=(kind,n)=>{ for(let i=0;i<n;i++){
      const e=mkTeamEnt(kind,team,sp.x+rnd(-24,24),sp.y+rnd(-40,40),hpMul);
      e.goalX=goalX; e.goalY=WH/2;
      S.en.push(e); } };
    add('creep',C.meleePerWave+extra);
    add('creepr',C.rangedPerWave+extra);
    if(bossWave)add('siegelord',1);
  }
  sfxE('boss');
  toastAll(bossWave?'⚠ BOSS WAVE — siege lords advancing!'
                   :'Creep wave '+S.creepWave+' marching out');
}

/* ---------------- bots ----------------
   A bot IS an ordinary player object: it lives in S.players, so weapons
   auto-fire, stats, upgrades, shields, death and respawn all work with
   no special-casing. The only thing it needs is somewhere to walk. */
function botUpdate(p,dt){
  if(p.dead)return;
  const enemyNexusX=p.team===0?WW*(1-MOBA.positions.nexus):WW*MOBA.positions.nexus;
  // nearest hostile thing worth approaching
  let tgt=null,bd=1e9;
  for(const o of S.en){ if(o.hp<=0||!hostile(p.team,o.team))continue;
    const d=(o.x-p.x)**2+(o.y-p.y)**2; if(d<bd){bd=d;tgt=o;} }
  for(const q of S.players.values()){ if(q===p||q.dead||!hostile(p.team,q.team))continue;
    const d=(q.x-p.x)**2+(q.y-p.y)**2; if(d<bd){bd=d;tgt=q;} }
  const B=MOBA.bot;
  const dist=Math.sqrt(bd);
  let tx,ty;
  if(tgt&&dist<B.engageRadius){
    // hold at weapon range rather than walking into melee; retreat when hurt
    const hurtBadly=p.hp<p.maxhp*B.retreatHpFrac;
    const want=hurtBadly?B.retreatRange:B.standoffRange;
    const ang=Math.atan2(p.y-tgt.y,p.x-tgt.x);
    tx=tgt.x+Math.cos(ang)*want; ty=tgt.y+Math.sin(ang)*want;
  }else{ // nothing near — push the lane
    tx=enemyNexusX; ty=WH/2+Math.sin((now()/1000+p.id)*.5)*60;
  }
  const dx=tx-p.x, dy=ty-p.y, d=Math.hypot(dx,dy);
  if(d>4){ const sp=p.st.spd*B.speedFrac;
    p.x=clamp(p.x+dx/d*sp*dt,6,WW-6);
    p.y=clamp(p.y+dy/d*sp*dt,6,WH-6);
    collideObstacles(p);
  }
}
/* Bots resolve their own upgrade picks immediately — a bot must never
   block the pick window. Weapon upgrades first (always safe), then plain
   stat passives; never the T-charge specials or Glass Reactor. */
function botPick(p){
  const opts=p.pickOpts||[];
  let best=-1;
  for(let i=0;i<opts.length;i++){ const o=opts[i];
    if(o.t==='up'){ best=i; break; }                       // upgrading a held weapon: always fine
    if(o.t==='pas'&&botSafePassive(o.ps)&&best<0)best=i;
    if(o.t==='new'&&best<0)best=i;
  }
  resolvePick(p,best<0?0:best);
}
function mobaEnd(winner,doubleWin){
  S.over=true;
  if(doubleWin)toastAll('DOUBLE VICTORY — the hive fell');
  toastAll(teamName(winner)+' destroyed the enemy nexus!');
  const me=S.players.get(myId);
  finishRun(S.wave,S.score,sanctumShards(me?me.shards:0));
  for(const c of conns){ const p=S.players.get(c._pid);
    c.send({t:'go',wave:S.wave,score:S.score,shards:sanctumShards(p?p.shards:0)}); }
}

/* ---------------- bots (STAGE 4 stub) ----------------
   Bots will be ordinary player objects driven by a synthetic input
   source, so weapons.js and every stat path work unchanged. The one
   piece worth locking in now is the upgrade filter, because it is the
   part with a concrete rule: bots take plain stat passives only and
   never the ones that rewrite the T-charge economy (every such passive
   is flagged `special` in passives.json) nor Glass Reactor. */
function botSafePassive(ps){ return !ps.special && ps.id!=='glass'; }
