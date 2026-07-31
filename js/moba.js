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
  // Cover is kept OUT of the lane corridor and out of both bases, so
  // structures always have line of sight and pushes stay readable.
  for(let i=0;i<MOBA.obstacles;i++){
    for(let tries=0;tries<12;tries++){
      const x=rnd(WW*0.22,WW*0.78), y=rnd(20,WH-20);
      if(Math.abs(y-laneY)<half*0.55)continue; // keep the lane itself clear
      const r=rnd(MOBA.obstacleRadius[0],MOBA.obstacleRadius[1]);
      obs.push({x,y,r}); break;
    }
  }
  return obs;
}

/* A structure is a normal S.en entity — it reuses damageE(), the bullet
   collision loops, the snapshot and the renderer. Only its AI is new. */
function mkStruct(kind,team,x,y){
  const e=mkE(kind);          // stats/sprite/radius straight from enemies.json
  e.x=x; e.y=y; e.team=team; e.struct=true;
  e.hp=e.maxhp=ET[ETI[kind]].hp;  // structures ignore wave/difficulty scaling
  e.homeX=x; e.homeY=y; e.ph=rnd(0,TAU); e.cd=rnd(.2,1.0);
  return e;
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
    applyMetaObj(p, pi.id===myId?save.meta:pi.meta);
    p.team=(pi.team===1)?1:0;
    const sp=mobaSpawn(p.team); p.x=sp.x; p.y=sp.y;
    S.players.set(pi.id,p);
  });
  mobaSpawnStructures();
}
/* Respawn at your own base rather than a random spot. */
function mobaRespawn(p){
  respawnPersistent(p);
  const sp=mobaSpawn(p.team||0); p.x=sp.x; p.y=sp.y;
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
  // STAGE 3 will drive creep waves from here:
  //   S.creepT-=dt; if(S.creepT<=0){S.creepT=MOBA.creepInterval; spawnCreepWave();}
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
