"use strict";
/* ============================================================
   net.js — PeerJS co-op: host snapshots, client view, lobby.
   NOTE: any new synced field must be added to BOTH snap() and
   applySnap() — they encode/decode the same positional arrays.
   ============================================================ */

/* ---- WebRTC config: several STUN servers + a free TURN relay.
   Without TURN, two players behind strict NATs (different networks,
   mobile data) resolve the room code but the data link never opens —
   the most common "multiplayer doesn't start" failure. ---- */
const PEER_OPTS={
  debug:1,
  config:{iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
    {urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'}
  ]}
};

/* ---- link watchdog -------------------------------------------------
   A TURN-relayed handshake is much slower than a direct one, so a lobby
   that is still negotiating looks identical to one that has hung. Two
   staged timers give feedback and, eventually, a way out:
     3s  → say we're falling back to the relay
     15s → give up with a real error + a retry button
   Both timers re-check "is it open?" before firing and are cleared the
   moment a link opens, so a peer that connected and merely went quiet is
   never failed here — silence on an OPEN link is pruneStalePeers' job. */
const LINK_SOFT_MS=3000, LINK_HARD_MS=15000;
let linkSoftT=0, linkHardT=0;
function clearLinkWatch(){
  if(linkSoftT)clearTimeout(linkSoftT);
  if(linkHardT)clearTimeout(linkHardT);
  linkSoftT=linkHardT=0;
  const b=$('btnNetRetry'); if(b){b.classList.add('hidden'); b.onclick=null;}
}
function offerRetry(onRetry){
  const b=$('btnNetRetry');
  if(b){ b.classList.remove('hidden'); b.onclick=()=>{ clearLinkWatch(); onRetry(); }; }
}
function startLinkWatch(isOpen,failMsg,onRetry){
  clearLinkWatch(); // never stack watches from an earlier attempt
  linkSoftT=setTimeout(()=>{ linkSoftT=0; if(!isOpen())setStatus('Establishing relay…'); },LINK_SOFT_MS);
  linkHardT=setTimeout(()=>{
    linkHardT=0;
    if(isOpen())return; // connected in the meantime — nothing to fail
    setStatus(failMsg);
    offerRetry(onRetry);
  },LINK_HARD_MS);
}
/* Which ICE path actually won: host = same LAN, srflx = direct through
   STUN, relay = routed via TURN (slower, but the only thing that works
   behind symmetric NAT). Logged once per link, for debugging only. */
function logIcePath(c,label){
  const pc=c&&c.peerConnection;
  if(!pc||!pc.getStats)return;
  pc.getStats().then(st=>{
    const cand=new Map(); let sel=null,ok=null;
    st.forEach(r=>{
      if(r.type==='local-candidate'||r.type==='remote-candidate')cand.set(r.id,r);
      else if(r.type==='candidate-pair'){
        if(r.selected||r.nominated&&r.state==='succeeded')sel=r;
        else if(r.state==='succeeded')ok=ok||r;
      }
    });
    const pair=sel||ok;
    if(!pair){console.log('[net] '+label+': no selected ICE pair reported');return;}
    const lt=(cand.get(pair.localCandidateId)||{}).candidateType||'?';
    const rt=(cand.get(pair.remoteCandidateId)||{}).candidateType||'?';
    console.log('[net] '+label+' ICE pair: local='+lt+' remote='+rt+
      ' → '+(lt==='relay'||rt==='relay'?'TURN RELAY':'DIRECT'));
  }).catch(()=>{});
}

/* ---------------- snapshots ---------------- */
function snap(){
  const pl=[]; for(const p of S.players.values())
    pl.push([p.id,Math.round(p.x),Math.round(p.y),Math.round(p.hp),p.maxhp,
      (p.inv>0?1:0)|(p.dead?2:0)|(now()<p.pickUntil?4:0)|(p.tLock?8:0)|(p.beamOnT>0?16:0),
      Math.round(p.st.spd),Math.round(p.st.dashCd*100),p.shards,
      Math.round(p.t/p.tMax*100),
      p.orbN||0,p.sabN||0,
      Math.round(p.shield),Math.round(p.shieldMax),
      Math.round((p.beamAng||0)*100),Math.round(p.beamLen||0)]);
  const en=S.en.map(e=>[e.id,e.ti,Math.round(e.x),Math.round(e.y),
    Math.round(e.hp/e.maxhp*100),e.flash>0?1:0,e.st===1?1:0,e.scl>1?e.scl:0,e.shielded?1:0]);
  const eb=S.eb.map(b=>[b.id,Math.round(b.x),Math.round(b.y),Math.round(b.vx),Math.round(b.vy),b.ci,b.r]);
  const pb=S.pb.map(b=>[b.id,Math.round(b.x),Math.round(b.y),Math.round(b.vx),Math.round(b.vy),b.ci,b.owner]);
  const it=S.it.map(i=>[i.k,Math.round(i.x),Math.round(i.y)]);
  const dr=S.dr.map(d2=>[Math.round(d2.x),Math.round(d2.y),Math.round(d2.hp/d2.maxhp*100)]);
  const zn=S.zn.map(z=>[Math.round(z.x),Math.round(z.y),Math.round(z.r)]);
  let ob=0;
  if(S.obj)ob=[OBJ_TYS.indexOf(S.obj.ty),Math.round(S.obj.prog),Math.round(S.obj.goal),
    Math.max(0,Math.round(S.obj.tLeft)),S.obj.done,Math.round(S.obj.zx),Math.round(S.obj.zy),S.obj.zr];
  const sx=S.sx.splice(0,10); // queued sound events ride along
  return {t:'st',w:S.wave,sc:S.score,pl,en,eb,pb,it,dr,zn,ob,sx,pvp:S.pvp?1:0,ts:now()};
}
function bcast(m){ for(const c of conns){try{c.send(m)}catch(e){}} }
function sendTo(pid,m){ const c=conns.find(c=>c._pid===pid); if(c){try{c.send(m)}catch(e){}} }

/* ---------------- client view ---------------- */
function blankView(){return {players:new Map(),en:new Map(),eb:[],pb:[],it:[],dr:[],zn:[],obj:0,
  wave:1,score:0,snapT:0,snapDt:80,pvp:false};}
function applySnap(s){
  if(!V)V=blankView();
  const t=now();
  // EMA-smoothed snapshot interval: raw deltas jitter with the network
  // and make interpolation speed pulse — smooth it instead
  const raw=clamp(t-V.snapT,25,250);
  V.snapDt=V.snapT?V.snapDt*.7+raw*.3:80; V.snapT=t;
  V.wave=s.w; V.score=s.sc; V.pvp=!!s.pvp;
  if(s.sx)for(const k of s.sx)sfx(k);
  const seenP=new Set();
  for(const a of s.pl){const [id,x,y,hp,mhp,fl,spd,dcd,sh,tp,orbN,sabN,shd,shdMax,bAng,bLen]=a; seenP.add(id);
    let p=V.players.get(id);
    if(!p){p={id,dx:x,dy:y};V.players.set(id,p);}
    p.px=p.dx;p.py=p.dy;
    // big jump = respawn/teleport — snap instead of gliding across the map
    if(Math.hypot(x-p.px,y-p.py)>90){p.px=x;p.py=y;}
    p.tx=x;p.ty=y;p.st=t;
    p.hp=hp;p.maxhp=mhp;p.inv=fl&1;p.dead=fl&2;p.picking=fl&4;p.tLock=!!(fl&8);p.beamOn=!!(fl&16);p.shards=sh;
    p.t=tp;p.orbN=orbN||0;p.sabN=sabN||0;
    p.shield=shd||0;p.shieldMax=shdMax||0;
    p.beamAng=(bAng||0)/100;p.beamLen=bLen||0;
    if(id===myId){myPos.spd=spd;myPos.dcd=dcd/100;myPos.dead=!!p.dead;}}
  for(const id of [...V.players.keys()]) if(!seenP.has(id))V.players.delete(id);
  const seenE=new Set();
  for(const a of s.en){const [id,ti,x,y,hpp,fl,tel,scl,shd]=a; seenE.add(id);
    let e=V.en.get(id);
    if(!e){e={id,ti,dx:x,dy:y};V.en.set(id,e);}
    e.px=e.dx;e.py=e.dy;
    if(Math.hypot(x-e.px,y-e.py)>60){e.px=x;e.py=y;} // warlock/reaper/titan blinks
    e.tx=x;e.ty=y;e.st=t;e.hpp=hpp;e.flash=fl;e.tel=tel;e.scl=scl||1;e.shielded=!!shd;}
  for(const id of [...V.en.keys()]) if(!seenE.has(id))V.en.delete(id);
  V.eb=s.eb; V.pb=s.pb; V.it=s.it; V.dr=s.dr||[]; V.zn=s.zn||[]; V.obj=s.ob||0;
}
function lerpView(){
  // k≤1 interpolates toward the latest snapshot; k up to 1.6 keeps
  // extrapolating along the same velocity when the next snapshot is
  // late, so entities coast instead of freezing then jumping.
  const t=now();
  for(const p of V.players.values()){const k=clamp((t-p.st)/V.snapDt,0,1.6);
    p.dx=p.px+(p.tx-p.px)*k; p.dy=p.py+(p.ty-p.py)*k;}
  for(const e of V.en.values()){const k=clamp((t-e.st)/V.snapDt,0,1.6);
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
let nextPid=1; // never reused — reusing lobby.players.length collided after a mid-game disconnect
function pidNext(){return nextPid++;}
function setStatus(s){$('mpStatus').textContent=s;}
function updatePeerList(){
  $('peerList').textContent='Linked: '+lobby.players.map(p=>p.name).join(', ');
  $('hPeers').textContent=lobby.players.length>1?lobby.players.map(p=>p.name).join(' · '):'';
}
function startHost(){
  resetNet(); // kill any stale peer left over from a previous host/join
  role='host'; roomCode=mkCode();
  $('hostBits').classList.remove('hidden'); $('joinBits').classList.add('hidden');
  $('roomCode').textContent=roomCode;
  $('lobbyTitle').textContent='HOSTING';
  $('lobbySub').textContent='share the code · same URL';
  $('lobbyDiffBits').classList.remove('hidden'); $('lobbyDiffShow').textContent='';
  renderDiffChips('lobbyDiffRow','lobbyDiffDesc',()=>bcastRoster());
  setStatus('Opening circuit…');
  conns=[]; nextPid=1;
  lobby.players=[{id:0,name:save.name,sprite:save.sprite,meta:save.meta,cls:save.cls}];
  myId=0; updatePeerList();
  openHostPeer();
}
function openHostPeer(){
  try{
    peer=new Peer('aeproto-'+roomCode,PEER_OPTS);
    const myPeer=peer; // a retry/id-roll replaces peer — late events from myPeer are stale
    startLinkWatch(()=>!!(peer&&peer.open),
      'Could not open the circuit — the signaling server may be blocked on this network.',
      ()=>{ setStatus('Opening circuit…'); try{peer.destroy()}catch(e){} openHostPeer(); });
    peer.on('open',()=>{ if(peer!==myPeer)return;
      clearLinkWatch();setStatus('Circuit open. Waiting for allies…');$('btnMpStart').classList.remove('hidden');});
    peer.on('disconnected',()=>{ // lost the signaling broker — relink so new allies can still find us
      if(peer!==myPeer)return;
      setStatus('Signal lost — relinking…');
      try{peer.reconnect()}catch(e){} });
    peer.on('error',e=>{
      if(peer!==myPeer)return;
      if(e.type==='unavailable-id'){ // zombie session owns this code: roll a fresh one
        roomCode=mkCode(); $('roomCode').textContent=roomCode;
        try{peer.destroy()}catch(e2){}
        openHostPeer(); return;
      }
      // a real error is more informative than the generic timeout text —
      // stop the watch so it can't overwrite this, but keep a way back
      clearLinkWatch();
      setStatus('Peer error: '+e.type+(e.type==='network'?' — check your connection':''));
      offerRetry(()=>{ setStatus('Opening circuit…'); try{peer.destroy()}catch(e2){} openHostPeer(); });
    });
    peer.on('connection',c=>{
      if(peer!==myPeer){try{c.close()}catch(e){} return;} // ally reached a peer we've already replaced
      if(c.open)logIcePath(c,'ally link');
      else c.on('open',()=>logIcePath(c,'ally link'));
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
  // client self-reports a hit it saw on its own screen (bullet 'b' / enemy contact 'm') —
  // host stays authoritative over the CONSEQUENCE (damage/i-frames/surge), the client
  // only supplies the DETECTION, so nobody gets hit by something they didn't see land.
  else if(d.t==='hit'){ const p=S&&S.players.get(c._pid); if(p)applyClientHit(p,d.k,d.id); }
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
  if(peer){try{peer.destroy()}catch(e){}} // clean retry with a new code
  setStatus('Linking…');
  try{
    peer=new Peer(PEER_OPTS);
    // one watch covers the whole join: broker handshake AND data channel.
    // dc stays null until peer.on('open') hands us the connection.
    // p!==peer means a retry replaced this peer — ignore its late events.
    const p=peer; let dc=null;
    startLinkWatch(()=>!!(dc&&dc.open),
      'Link timed out — the relay could not be reached. Retry, or try another network/hotspot for one of you.',
      ()=>connectTo(code));
    peer.on('error',e=>{
      if(peer!==p)return;
      clearLinkWatch(); // show the specific cause, not the generic timeout
      if(e.type==='peer-unavailable')setStatus('No room "'+code+'" found — check the code (host must be in the lobby).');
      else{ setStatus('Error: '+e.type+(e.type==='network'?' — check your connection':''));
        offerRetry(()=>connectTo(code)); }
    });
    peer.on('disconnected',()=>{ if(peer!==p)return; try{peer.reconnect()}catch(e){} });
    peer.on('open',()=>{
      if(peer!==p)return;
      const c=peer.connect('aeproto-'+code,{reliable:true});
      dc=c; conns=[c];
      c.on('open',()=>{ clearLinkWatch(); logIcePath(c,'host link');
        setStatus('Linked! Waiting for host to start…');
        c.send({t:'hi',name:save.name,sprite:save.sprite,meta:save.meta,cls:save.cls}); });
      c.on('data',d=>clientOnData(c,d));
      // conns[0]!==c means a retry already replaced this connection — a
      // late event from the discarded one must not clear the new watch
      c.on('close',()=>{ if(conns[0]!==c)return;
        clearLinkWatch(); setStatus('Link severed.'); toast('Disconnected from host');
        if(mode==='play'){mode='title';show('scrTitle');$('hud').classList.add('hidden');} });
      c.on('error',()=>{ if(conns[0]!==c)return;
        clearLinkWatch(); setStatus('Link error — try again.');
        offerRetry(()=>connectTo(code)); });
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
  clearLinkWatch(); // no timer may outlive the peer it was watching
  if(peer){try{peer.destroy()}catch(e){}}
  if(conns[0]&&conns[0].socket){try{conns[0].socket.close()}catch(e){}} // Battleground's raw WebSocket, if any
  peer=null; conns=[]; lobby.players=[]; clientRoster.clear();
  $('hPeers').textContent='';
}

/* ---------------- Battleground: persistent PvPvE (plain WebSocket) ----------------
   Not PeerJS/WebRTC — this connects to a real always-on server (see server/), so
   there's no NAT traversal to do. The wrapper below gives `conn` the same
   {send(obj), open} shape a PeerJS DataConnection has, so every existing
   client-side code path (clientOnData, checkLocalHits, the pick-UI 'ck'/'dw'
   sends, main.js's input loop) works completely unchanged. */
function startBattleground(url){
  resetNet();
  role='client';
  $('hostBits').classList.add('hidden'); $('joinBits').classList.add('hidden');
  $('lobbyDiffBits').classList.add('hidden'); $('lobbyDiffShow').textContent='';
  $('lobbyTitle').textContent='BATTLEGROUND';
  $('lobbySub').textContent='linking to the persistent front…';
  setStatus('Linking…');
  try{
    const sock=new WebSocket(url);
    const conn={socket:sock,open:false,
      send:(obj)=>{ if(sock.readyState===WebSocket.OPEN){try{sock.send(JSON.stringify(obj))}catch(e){}} }};
    conns=[conn];
    sock.onopen=()=>{ conn.open=true; setStatus('Linked! Dropping into the Battleground…');
      conn.send({t:'hi',name:save.name,sprite:save.sprite,meta:save.meta,cls:save.cls}); };
    sock.onmessage=(ev)=>{ let d; try{d=JSON.parse(ev.data);}catch(e){return;} clientOnData(conn,d); };
    sock.onclose=()=>{ conn.open=false; setStatus('Link severed.'); toast('Disconnected from the Battleground');
      if(mode==='play'){mode='title';show('scrTitle');$('hud').classList.add('hidden');} };
    sock.onerror=()=>{ setStatus('Connection error — check the server address.'); };
  }catch(e){ setStatus('Could not connect: '+e.message); }
}
