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
  // Cover hugs the lane edges: dense enough to fight around, but the
  // corridor itself and both bases stay clear so structures keep line of
  // sight and a push reads cleanly.
  for(let i=0;i<MOBA.obstacles;i++){
    for(let tries=0;tries<14;tries++){
      const x=rnd(WW*0.15,WW*0.85), y=rnd(14,WH-14);
      if(Math.abs(y-laneY)<half*0.45)continue; // keep the lane itself walkable
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
  e.homeX=x; e.homeY=y; e.ph=rnd(0,TAU); e.cd=rnd(.2,1.0);
  return e;
}
function mkStruct(kind,team,x,y){
  const e=mkTeamEnt(kind,team,x,y); e.struct=true; return e;
}
function mobaSpawnStructures(){
  const P=MOBA.positions, laneY=WH/2;
  for(let team=0;team<2;team++){
    const at=f=>team===0?WW*f:WW*(1-f); // team 1 mirrors about the centre
    S.en.push(mkStruct('nexus',team,at(P.nexus),laneY));
    S.en.push(mkStruct('basebss',team,at(P.baseboss),laneY));
    // two guardians per base, offset above and below the lane
    S.en.push(mkStruct('basebss',team,at(P.baseboss),laneY-110));
    S.en.push(mkStruct('laneturret',team,at(P.turret),laneY));
  }
}
function mobaSpawn(team){
  const f=MOBA.positions.spawn;
  return {x:team===0?WW*f:WW*(1-f), y:WH/2+rnd(-40,40)};
}

/* ---------------- match lifecycle ---------------- */
function newMobaSim(playersInfo){
  obstacles=genMobaWorld();
  eidc=1; bidc=1;
  S={players:new Map(),en:[],eb:[],pb:[],it:[],fx:[],dr:[],zn:[],obj:null,sx:[],
     wave:1,score:0,t:0,waveT:0,
     spawnQ:[],spawnT:0,waveDone:true,miniSpawned:true,over:false,shake:0,
     pvp:true,          // opposing players can shoot each other
     persistent:true,   // death respawns at base instead of ending the run
     moba:true, mobaOver:0, creepT:MOBA.creepInterval};
  playersInfo.forEach(pi=>{
    const p=mkPlayer(pi.id,pi.name,pi.sprite,pi.cls);
    applyMetaObj(p, (pi.id===myId&&!pi.bot)?save.meta:pi.meta);
    p.team=(pi.team===1)?1:0;
    p.bot=!!pi.bot;
    p.lvl=1; p.xp=0;
    const sp=mobaSpawn(p.team); p.x=sp.x; p.y=sp.y;
    S.players.set(pi.id,p);
  });
  mobaSpawnStructures();
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
  grantXp(killer,MOBA.xp.playerKill);
  killer.score=(killer.score||0)+1;
  toastAll(killer.name+' slew '+victim.name);
  sfxE('bosskill');
}

/* ---------------- creeps ---------------- */
function spawnCreepWave(){
  const C=MOBA.creep;
  S.creepWave=(S.creepWave||0)+1;
  // waves get slightly larger and tougher the longer the match runs, so a
  // stalemate eventually breaks instead of grinding forever
  const extra=Math.floor(S.creepWave/C.extraPerWaves);
  const hpMul=1+S.creepWave*C.hpPerWave;
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
  }
  sfxE('boss');
  toastAll('Creep wave '+S.creepWave+' marching out');
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
function mobaEnd(winner){
  S.over=true;
  toastAll(teamName(winner)+' destroyed the enemy nexus!');
  const me=S.players.get(myId);
  finishRun(S.wave,S.score,me?me.shards:0);
  for(const c of conns){ const p=S.players.get(c._pid);
    c.send({t:'go',wave:S.wave,score:S.score,shards:p?p.shards:0}); }
}

/* ---------------- bots (STAGE 4 stub) ----------------
   Bots will be ordinary player objects driven by a synthetic input
   source, so weapons.js and every stat path work unchanged. The one
   piece worth locking in now is the upgrade filter, because it is the
   part with a concrete rule: bots take plain stat passives only and
   never the ones that rewrite the T-charge economy (every such passive
   is flagged `special` in passives.json) nor Glass Reactor. */
function botSafePassive(ps){ return !ps.special && ps.id!=='glass'; }
