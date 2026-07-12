"use strict";
/* ============================================================
   net.js — PeerJS co-op: host snapshots, client view, lobby.
   NOTE: any new synced field must be added to BOTH snap() and
   applySnap() — they encode/decode the same positional arrays.
   ============================================================ */

/* ---------------- snapshots ---------------- */
function snap(){
  const pl=[]; for(const p of S.players.values())
    pl.push([p.id,Math.round(p.x),Math.round(p.y),Math.round(p.hp),p.maxhp,
      (p.inv>0?1:0)|(p.dead?2:0)|(now()<p.pickUntil?4:0)|(p.eLock?8:0),
      Math.round(p.st.spd),Math.round(p.st.dashCd*100),p.shards,
      Math.round(p.mana/p.manaMax*100),Math.round(p.energy/p.energyMax*100),
      p.orbN||0,p.sabN||0,
      Math.round(p.shield),Math.round(p.shieldMax)]);
  const en=S.en.map(e=>[e.id,e.ti,Math.round(e.x),Math.round(e.y),
    Math.round(e.hp/e.maxhp*100),e.flash>0?1:0,e.st===1?1:0,e.scl>1?e.scl:0]);
  const eb=S.eb.map(b=>[Math.round(b.x),Math.round(b.y),Math.round(b.vx),Math.round(b.vy),b.ci,b.r]);
  const pb=S.pb.map(b=>[Math.round(b.x),Math.round(b.y),Math.round(b.vx),Math.round(b.vy),b.ci]);
  const it=S.it.map(i=>[i.k,Math.round(i.x),Math.round(i.y)]);
  const dr=S.dr.map(d2=>[Math.round(d2.x),Math.round(d2.y),Math.round(d2.hp/d2.maxhp*100)]);
  const zn=S.zn.map(z=>[Math.round(z.x),Math.round(z.y),Math.round(z.r)]);
  let ob=0;
  if(S.obj)ob=[OBJ_TYS.indexOf(S.obj.ty),Math.round(S.obj.prog),Math.round(S.obj.goal),
    Math.max(0,Math.round(S.obj.tLeft)),S.obj.done,Math.round(S.obj.zx),Math.round(S.obj.zy),S.obj.zr];
  return {t:'st',w:S.wave,sc:S.score,pl,en,eb,pb,it,dr,zn,ob,ts:now()};
}
function bcast(m){ for(const c of conns){try{c.send(m)}catch(e){}} }
function sendTo(pid,m){ const c=conns.find(c=>c._pid===pid); if(c){try{c.send(m)}catch(e){}} }

/* ---------------- client view ---------------- */
function blankView(){return {players:new Map(),en:new Map(),eb:[],pb:[],it:[],dr:[],zn:[],obj:0,
  wave:1,score:0,snapT:0,snapDt:80};}
function applySnap(s){
  if(!V)V=blankView();
  const t=now();
  V.snapDt=clamp(t-V.snapT,40,200); V.snapT=t;
  V.wave=s.w; V.score=s.sc;
  const seenP=new Set();
  for(const a of s.pl){const [id,x,y,hp,mhp,fl,spd,dcd,sh,mn,en2,orbN,sabN,shd,shdMax]=a; seenP.add(id);
    let p=V.players.get(id);
    if(!p){p={id,dx:x,dy:y};V.players.set(id,p);}
    p.px=p.dx;p.py=p.dy;p.tx=x;p.ty=y;p.st=t;
    p.hp=hp;p.maxhp=mhp;p.inv=fl&1;p.dead=fl&2;p.picking=fl&4;p.eLock=!!(fl&8);p.shards=sh;
    p.mana=mn;p.energy=en2;p.orbN=orbN||0;p.sabN=sabN||0;
    p.shield=shd||0;p.shieldMax=shdMax||0;
    if(id===myId){myPos.spd=spd;myPos.dcd=dcd/100;myPos.dead=!!p.dead;}}
  for(const id of [...V.players.keys()]) if(!seenP.has(id))V.players.delete(id);
  const seenE=new Set();
  for(const a of s.en){const [id,ti,x,y,hpp,fl,tel,scl]=a; seenE.add(id);
    let e=V.en.get(id);
    if(!e){e={id,ti,dx:x,dy:y};V.en.set(id,e);}
    e.px=e.dx;e.py=e.dy;e.tx=x;e.ty=y;e.st=t;e.hpp=hpp;e.flash=fl;e.tel=tel;e.scl=scl||1;}
  for(const id of [...V.en.keys()]) if(!seenE.has(id))V.en.delete(id);
  V.eb=s.eb; V.pb=s.pb; V.it=s.it; V.dr=s.dr||[]; V.zn=s.zn||[]; V.obj=s.ob||0;
}
function lerpView(){
  const t=now();
  for(const p of V.players.values()){const k=clamp((t-p.st)/V.snapDt,0,1);
    p.dx=p.px+(p.tx-p.px)*k; p.dy=p.py+(p.ty-p.py)*k;}
  for(const e of V.en.values()){const k=clamp((t-e.st)/V.snapDt,0,1);
    e.dx=e.px+(e.tx-e.px)*k; e.dy=e.py+(e.ty-e.py)*k;}
}
/* unified objective view for HUD/render (host reads S, client reads V) */
function getObjView(){
  if(role!=='client'){
    if(S&&S.obj){const o=S.obj;
      return {tyI:OBJ_TYS.indexOf(o.ty),prog:o.prog,goal:o.goal,tLeft:o.tLeft,done:o.done,zx:o.zx,zy:o.zy,zr:o.zr};}
    return null;
  }
  if(V&&V.obj)return {tyI:V.obj[0],prog:V.obj[1],goal:V.obj[2],tLeft:V.obj[3],done:V.obj[4],zx:V.obj[5],zy:V.obj[6],zr:V.obj[7]};
  return null;
}
function objHudText(ov){
  const ty=OBJ_TYS[ov.tyI];
  const nm={slay:'SLAY',notouch:'UNSCATHED',zone:'HOLD THE CIRCLE',speed:'SPEED CLEAR',greed:'HARVEST'}[ty]||'OBJECTIVE';
  if(ov.done===1)return '◎ '+nm+' — COMPLETE';
  if(ov.done===-1)return '◎ '+nm+' — FAILED';
  if(ty==='slay'||ty==='greed')return `◎ ${nm} · ${Math.floor(ov.prog)}/${ov.goal} · ${Math.max(0,Math.ceil(ov.tLeft))}s`;
  if(ty==='zone')return `◎ ${nm} · ${Math.floor(ov.prog)}/${ov.goal}s · ${Math.max(0,Math.ceil(ov.tLeft))}s`;
  return `◎ ${nm} · ${Math.max(0,Math.ceil(ov.tLeft))}s`;
}

/* ---------------- PeerJS lobby ---------------- */
const CODE_CHARS='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function mkCode(){let s='';for(let i=0;i<4;i++)s+=CODE_CHARS[irnd(0,CODE_CHARS.length)];return s;}
let roomCode='';
let lobby={players:[]};
function pidNext(){return lobby.players.length;}
function setStatus(s){$('mpStatus').textContent=s;}
function updatePeerList(){
  $('peerList').textContent='Linked: '+lobby.players.map(p=>p.name).join(', ');
  $('hPeers').textContent=lobby.players.length>1?lobby.players.map(p=>p.name).join(' · '):'';
}
function startHost(){
  role='host'; roomCode=mkCode();
  $('hostBits').classList.remove('hidden'); $('joinBits').classList.add('hidden');
  $('roomCode').textContent=roomCode;
  $('lobbyTitle').textContent='HOSTING';
  $('lobbySub').textContent='share the code · same URL';
  $('lobbyDiffBits').classList.remove('hidden'); $('lobbyDiffShow').textContent='';
  renderDiffChips('lobbyDiffRow','lobbyDiffDesc',()=>bcastRoster());
  setStatus('Opening circuit…');
  conns=[];
  lobby.players=[{id:0,name:save.name,sprite:save.sprite,meta:save.meta,cls:save.cls}];
  myId=0; updatePeerList();
  try{
    peer=new Peer('aeproto-'+roomCode);
    peer.on('open',()=>{setStatus('Circuit open. Waiting for allies…');$('btnMpStart').classList.remove('hidden');});
    peer.on('error',e=>setStatus('Peer error: '+e.type));
    peer.on('connection',c=>{
      c.on('data',d=>hostOnData(c,d));
      c.on('close',()=>{ conns=conns.filter(x=>x!==c);
        lobby.players=lobby.players.filter(p=>p.id!==c._pid);
        updatePeerList(); toast('An ally disconnected');
        if(S)S.players.delete(c._pid); bcastRoster(); });
      c.on('error',()=>{ conns=conns.filter(x=>x!==c);
        lobby.players=lobby.players.filter(p=>p.id!==c._pid);
        if(S)S.players.delete(c._pid); updatePeerList(); });
    });
  }catch(e){ setStatus('PeerJS unavailable here — deploy to Vercel/GitHub Pages for co-op.'); }
}
function hostOnData(c,d){
  c._lastIn=now();
  if(d.t==='hi'){
    c._pid=pidNext();
    lobby.players.push({id:c._pid,name:d.name,sprite:d.sprite,meta:d.meta||{},cls:d.cls||CLASSES[0].id});
    conns.push(c);
    c.send({t:'wl',id:c._pid,obstacles,ww:WW,wh:WH,diff:diffKey,inGame:mode==='play'});
    updatePeerList(); toast(d.name+' linked in');
    bcastRoster();
    if(mode==='play'&&S){ // late join
      const pi=lobby.players.find(p=>p.id===c._pid);
      const p=mkPlayer(pi.id,pi.name,pi.sprite,pi.cls);
      applyMetaObj(p,pi.meta);
      S.players.set(p.id,p);
      c.send({t:'begin',obstacles,ww:WW,wh:WH,diff:diffKey});
    }
  }else if(d.t==='in'){ const p=S&&S.players.get(c._pid);
    if(p&&!p.dead){p.x=clamp(d.x,6,WW-6);p.y=clamp(d.y,6,WH-6);if(d.inv)p.inv=Math.max(p.inv,.1);}}
  else if(d.t==='ck'){ const p=S&&S.players.get(c._pid); if(p)resolvePick(p,d.i); }
  else if(d.t==='dw'){ const p=S&&S.players.get(c._pid); if(p)discardWeapon(p,d.i); }
}
/* GHOST FIX: WebRTC 'close' doesn't always fire — kick silent peers after 8s */
function pruneStalePeers(){
  if(role!=='host'||mode!=='play')return;
  const t=now();
  for(const c of [...conns]){
    if(c._lastIn && t-c._lastIn>8000){
      try{c.close()}catch(e){}
      conns=conns.filter(x=>x!==c);
      lobby.players=lobby.players.filter(p=>p.id!==c._pid);
      if(S)S.players.delete(c._pid);
      updatePeerList(); toast('An ally timed out'); bcastRoster();
    }
  }
}
function bcastRoster(){ bcast({t:'ros',players:lobby.players.map(p=>({id:p.id,name:p.name,sprite:p.sprite})),diff:DIFF().name}); }
function startJoin(){
  role='client';
  $('hostBits').classList.add('hidden'); $('joinBits').classList.remove('hidden');
  $('lobbyDiffBits').classList.add('hidden'); $('lobbyDiffShow').textContent='';
  $('lobbyTitle').textContent='JOINING';
  $('lobbySub').textContent='enter your ally\'s code';
  setStatus('');
}
let clientRoster=new Map(); // id -> {name, img}
function connectTo(code){
  setStatus('Linking…');
  try{
    peer=new Peer();
    peer.on('error',e=>setStatus('Error: '+e.type+(e.type==='peer-unavailable'?' — check the code':'')));
    peer.on('open',()=>{
      const c=peer.connect('aeproto-'+code,{reliable:true});
      conns=[c];
      c.on('open',()=>{ setStatus('Linked! Waiting for host to start…');
        c.send({t:'hi',name:save.name,sprite:save.sprite,meta:save.meta,cls:save.cls}); });
      c.on('data',d=>clientOnData(c,d));
      c.on('close',()=>{ setStatus('Link severed.'); toast('Disconnected from host');
        if(mode==='play'){mode='title';show('scrTitle');$('hud').classList.add('hidden');} });
    });
  }catch(e){ setStatus('PeerJS unavailable here — deploy to Vercel/GitHub Pages for co-op.'); }
}
function clientOnData(c,d){
  switch(d.t){
    case 'wl': myId=d.id; obstacles=d.obstacles;
      if(d.ww){WW=d.ww;WH=d.wh;}
      if(d.diff&&DIFFS[d.diff])diffKey=d.diff;
      setStatus('Linked as ally #'+d.id+'. Waiting for host…');
      if(d.inGame){enterPlayClient();} break;
    case 'ros': clientRoster.clear();
      d.players.forEach(p=>clientRoster.set(p.id,{name:p.name,img:spriteToCanvas(p.sprite)}));
      if(d.diff)$('lobbyDiffShow').textContent='Difficulty: '+d.diff;
      $('peerList').textContent='Linked: '+d.players.map(p=>p.name).join(', ');
      break;
    case 'begin': obstacles=d.obstacles; if(d.ww){WW=d.ww;WH=d.wh;}
      if(d.diff&&DIFFS[d.diff])diffKey=d.diff; enterPlayClient(); break;
    case 'st': applySnap(d); break;
    case 'pk': showPickUI(d.opts,d.dl,d.own); break;
    case 'pkend': hidePickUI(); break;
    case 'ts': toast(d.m); break;
    case 'go': finishRun(d.wave,d.score,d.shards); break;
    case 'rs': obstacles=d.obstacles; if(d.ww){WW=d.ww;WH=d.wh;}
      if(d.diff&&DIFFS[d.diff])diffKey=d.diff;
      $('scrDeath').classList.add('hidden'); enterPlayClient(); break;
  }
}
function enterPlayClient(){
  V=blankView(); mode='play';
  myPos={x:WW/2,y:WH/2,inv:0,dashT:0,dashing:0,spd:BAL.player.speed,dcd:BAL.player.dashCooldown,dead:false};
  show(null); $('hud').classList.remove('hidden');
}
function resetNet(){ // hard-reset all multiplayer state
  if(peer){try{peer.destroy()}catch(e){}}
  peer=null; conns=[]; lobby.players=[]; clientRoster.clear();
  $('hPeers').textContent='';
}
