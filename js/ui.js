"use strict";
/* ============================================================
   ui.js — screens, menus, pick UI, character editor, input.
   ============================================================ */

/* ---------------- input & local movement ---------------- */
addEventListener('keydown',e=>{keys[e.code]=true;
  if(e.code==='Space'){e.preventDefault(); if(mode==='play')tryDash();}});
addEventListener('keyup',e=>keys[e.code]=false);

function tryDash(){
  if(myPos.dashT>0||myPos.dead)return;
  myPos.dashT=myPos.dcd; myPos.dashing=BAL.player.dashDuration; myPos.inv=BAL.player.dashInvuln;
  sfx('dash');
}
function moveLocal(dt){
  if(myPos.dead)return;
  let mx=0,my=0;
  if(keys['KeyW']||keys['ArrowUp'])my--; if(keys['KeyS']||keys['ArrowDown'])my++;
  if(keys['KeyA']||keys['ArrowLeft'])mx--; if(keys['KeyD']||keys['ArrowRight'])mx++;
  if(touch.active){mx=touch.dx;my=touch.dy;}
  const ml=Math.hypot(mx,my); if(ml>1){mx/=ml;my/=ml;}
  const sp=myPos.spd*(myPos.dashing>0?BAL.player.dashSpeedMult:1);
  myPos.x+=mx*sp*dt; myPos.y+=my*sp*dt;
  collideObstacles(myPos);
  myPos.dashT=Math.max(0,myPos.dashT-dt);
  myPos.dashing=Math.max(0,myPos.dashing-dt);
  myPos.inv=Math.max(0,myPos.inv-dt);
}

/* ---------------- pick UI ---------------- */
let pickDeadline=0;
function showPickUI(views,dl,owned){
  pickDeadline=dl; sfx('pick');
  const el=$('pickCards'); el.innerHTML='';
  views.forEach((v,i)=>{
    const c=document.createElement('button'); c.className='card rar-'+(v.rar||'c');
    c.innerHTML=`<div class="ctag">${v.tag}</div><div class="glyph">${v.g}</div>`+
      `<div class="cname">${v.n}</div><div class="cdesc">${v.d}</div>`;
    c.onclick=()=>{
      sfx('choose');
      if(role==='client'){conns[0]&&conns[0].send({t:'ck',i});}
      else{const p=S.players.get(myId);resolvePick(p,i);}
    };
    el.appendChild(c);
  });
  const ow=$('pickOwned'); ow.innerHTML='';
  (owned||[]).forEach((w,i)=>{
    const d=document.createElement('div'); d.className='ownw';
    d.innerHTML=`<span style="color:var(--r${w.rar})">${w.g}</span>`+
      `<span>${w.n} <span style="color:var(--dim)">Lv${w.lvl}</span></span>`;
    if((owned||[]).length>1){
      const b=document.createElement('button'); b.className='dsc'; b.textContent='✕ DISCARD';
      b.onclick=()=>{
        if(role==='client'){conns[0]&&conns[0].send({t:'dw',i});}
        else{const p=S.players.get(myId);discardWeapon(p,i);}
      };
      d.appendChild(b);
    }
    ow.appendChild(d);
  });
  $('scrPick').classList.remove('hidden');
}
function hidePickUI(){ $('scrPick').classList.add('hidden'); }

/* ---------------- character editor ---------------- */
const ed={cv:$('edGrid'),cell:24,painting:false,color:'#4ef0e8',showHB:true,px:null};
const EDCOLORS=['#4ef0e8','#ff4fd8','#ffd35c','#ff5c47','#7a5cff','#e8ecff','#c9cfe8','#6b7396','#2b1f4e','#141a2e','#7cff6b','#ff9d3c','#ffffff','#000000'];
function edInit(){
  renderClassRow();
  ed.px=save.sprite.map(r=>r.slice());
  const pal=$('edPal'); pal.innerHTML='';
  EDCOLORS.forEach(c=>{const s=document.createElement('div');s.className='swatch';
    s.style.background=c; s.onclick=()=>{ed.color=c;selSwatch(s);}; pal.appendChild(s);});
  const er=document.createElement('div');er.className='swatch erase';
  er.onclick=()=>{ed.color=null;selSwatch(er);};pal.appendChild(er);
  selSwatch(pal.firstChild); ed.color=EDCOLORS[0];
  edDraw();
}
function selSwatch(s){[...$('edPal').children].forEach(x=>x.classList.remove('sel'));s.classList.add('sel');}
function edDraw(){
  const c=ed.cv.getContext('2d'),cs=ed.cell;
  c.fillStyle='#0a0d18';c.fillRect(0,0,264,264);
  for(let y=0;y<11;y++)for(let x=0;x<11;x++){
    const col=ed.px[y][x];
    if(col){c.fillStyle=col;c.fillRect(x*cs,y*cs,cs,cs);}
    c.strokeStyle='rgba(42,51,82,.6)';c.strokeRect(x*cs+.5,y*cs+.5,cs-1,cs-1);
  }
  if(ed.showHB){
    c.strokeStyle='rgba(255,92,71,.95)';c.lineWidth=2;
    c.beginPath();c.arc(5.5*cs,5.5*cs,3*cs,0,TAU);c.stroke();
    c.fillStyle='rgba(255,92,71,.12)';
    c.beginPath();c.arc(5.5*cs,5.5*cs,3*cs,0,TAU);c.fill();
    c.lineWidth=1;
    c.fillStyle='#ff5c47';c.font='10px monospace';c.textAlign='center';
    c.fillText('HITBOX',5.5*cs,5.5*cs+3);
  }
}
function edPaint(e){
  const r=ed.cv.getBoundingClientRect();
  const scale=264/r.width;
  const x=Math.floor((e.clientX-r.left)*scale/ed.cell);
  const y=Math.floor((e.clientY-r.top)*scale/ed.cell);
  if(x>=0&&x<11&&y>=0&&y<11){ed.px[y][x]=ed.color;edDraw();}
}
ed.cv.addEventListener('pointerdown',e=>{ed.painting=true;edPaint(e);e.preventDefault();});
ed.cv.addEventListener('pointermove',e=>{if(ed.painting)edPaint(e);});
addEventListener('pointerup',()=>ed.painting=false);
$('btnEdHitbox').onclick=()=>{ed.showHB=!ed.showHB;
  $('btnEdHitbox').textContent='Hitbox: '+(ed.showHB?'ON':'OFF');edDraw();};
$('btnEdReset').onclick=()=>{ed.px=DEFAULT_MAGE.map(r=>r.slice());edDraw();};
$('btnEdSave').onclick=()=>{save.sprite=ed.px.map(r=>r.slice());persist();toast('Sprite saved');show('scrTitle');};
$('btnEdBack').onclick=()=>show('scrTitle');

/* ---------------- touch ---------------- */
const isTouch='ontouchstart' in window;
if(isTouch)$('touchui').style.display='block';
const base=$('stickbase'),nub=$('sticknub');
addEventListener('touchstart',e=>{
  if(mode!=='play')return;
  for(const t of e.changedTouches){
    if(t.target.id==='dashbtn')continue;
    if(t.clientX<innerWidth*.55&&!touch.active){
      touch.active=true;touch.id=t.identifier;touch.ox=t.clientX;touch.oy=t.clientY;
      touch.dx=0;touch.dy=0;
      base.style.display=nub.style.display='block';
      base.style.left=(t.clientX-55)+'px';base.style.top=(t.clientY-55)+'px';
      nub.style.left=(t.clientX-23)+'px';nub.style.top=(t.clientY-23)+'px';
      e.preventDefault();}}
},{passive:false});
addEventListener('touchmove',e=>{
  for(const t of e.changedTouches){
    if(touch.active&&t.identifier===touch.id){
      let dx=t.clientX-touch.ox,dy=t.clientY-touch.oy;
      const l=Math.hypot(dx,dy),max=44;
      if(l>max){dx=dx/l*max;dy=dy/l*max;}
      touch.dx=dx/max;touch.dy=dy/max;
      nub.style.left=(touch.ox+dx-23)+'px';nub.style.top=(touch.oy+dy-23)+'px';
      e.preventDefault();}}
},{passive:false});
addEventListener('touchend',e=>{
  for(const t of e.changedTouches){
    if(touch.active&&t.identifier===touch.id){
      touch.active=false;touch.dx=touch.dy=0;
      base.style.display=nub.style.display='none';}}});
$('dashbtn').addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();if(mode==='play')tryDash();},{passive:false});
$('dashbtn').addEventListener('click',()=>{if(mode==='play')tryDash();});

/* ---------------- screens & wiring ---------------- */
function show(id){['scrTitle','scrSetup','scrShop','scrBoard','scrPick','scrDeath','scrEditor','scrLobby'].forEach(s=>$(s).classList.add('hidden'));
  if(id)$(id).classList.remove('hidden');}
function saveName(){const n=$('nameInput').value.trim().toUpperCase().slice(0,12);
  save.name=n||'MAGE-'+irnd(10,99);persist();return save.name;}
function refreshTitle(){ $('tBest').textContent=save.best||'—'; $('tShards').textContent=save.shards; }

function beginSolo(){
  saveName(); resetNet(); role='solo'; myId=0;
  show(null); $('hud').classList.remove('hidden');
  newSim([{id:0,name:save.name,sprite:save.sprite,meta:save.meta,cls:save.cls}]);
  const me=S.players.get(0);
  myPos={x:WW/2,y:WH/2,inv:0,dashT:0,dashing:0,spd:me.st.spd,dcd:me.st.dashCd,dead:false};
  V=null; mode='play';
}

function renderShop(){
  $('shopShards').textContent=save.shards;
  const el=$('shopList');el.innerHTML='';
  META.forEach(m=>{
    const lv=mlv(m.id),cost=metaCost(m),maxed=lv>=m.max;
    const row=document.createElement('div');row.className='shoprow';
    row.innerHTML=`<div class="si">${m.icon}</div><div class="sn"><div>${m.name}</div><div>${m.desc}</div></div>`+
      `<div class="lvl">${lv}/${m.max}</div>`;
    const b=document.createElement('button');b.className='pxbtn';
    b.style.cssText='padding:8px 10px;font-size:11px;margin:0';
    b.textContent=maxed?'MAX':'◆'+cost;
    b.disabled=maxed||save.shards<cost;
    b.onclick=()=>{if(save.shards>=cost&&!maxed){save.shards-=cost;
      save.meta[m.id]=lv+1;persist();renderShop();refreshTitle();}};
    row.appendChild(b);el.appendChild(row);
  });
}
function renderBoard(){
  const el=$('lbList');el.innerHTML='';
  const recs=save.records||[];
  if(!recs.length){el.innerHTML='<div class="statline">No descents recorded yet.</div>';return;}
  recs.forEach((r,i)=>{const d=document.createElement('div');d.className='lbrow';
    d.innerHTML=`<span class="rk">${i+1}</span><span class="nm">${(r.n||'?').replace(/</g,'&lt;')}</span>`+
      `<span class="cyanc">w${r.w}</span><span class="sc">${r.s}</span>`;
    el.appendChild(d);});
}
/* class chips: locked classes purchasable with banked shards;
   descriptions are generated live from classes.json stats */
function renderClassRow(){
  const el=$('classRow'); el.innerHTML='';
  $('edShards').textContent=save.shards;
  CLASSES.forEach(c=>{
    const locked=!save.unlocked.includes(c.id);
    const b=document.createElement('button');
    b.className='chip'+(save.cls===c.id?' selc':'')+(locked?' lock':'');
    b.innerHTML=locked?('🔒 '+c.n+' <span class="cost">◆'+c.cost+'</span>'):(c.g+' '+c.n);
    b.onclick=()=>{
      if(locked){
        if(save.shards>=c.cost){
          save.shards-=c.cost; save.unlocked.push(c.id); save.cls=c.id; persist();
          toast(c.n+' unlocked!'); renderClassRow(); refreshTitle();
        }else toast('Need ◆'+c.cost+' — bank more shards');
        return;
      }
      save.cls=c.id; persist(); renderClassRow();
    };
    b.onmouseenter=()=>{$('classDesc').textContent=genClassDesc(c);};
    el.appendChild(b);
  });
  $('classDesc').textContent=genClassDesc(CLS(save.cls));
}
function renderDiffChips(rowId,descId,onChange){
  const el=$(rowId); el.innerHTML='';
  Object.keys(DIFFS).forEach(k=>{
    const D=DIFFS[k];
    const b=document.createElement('button'); b.className='chip'+(diffKey===k?' sel':'');
    b.textContent=D.name;
    b.onclick=()=>{diffKey=k;save.diff=k;persist();renderDiffChips(rowId,descId,onChange);if(onChange)onChange();};
    b.onmouseenter=()=>{$(descId).textContent=D.desc;};
    el.appendChild(b);
  });
  $(descId).textContent=DIFF().desc;
}

function initUI(){
  $('nameInput').value=save.name||'';
  $('btnStart').onclick=()=>{saveName();renderDiffChips('diffRow','diffDesc');show('scrSetup');};
  $('btnSetupBack').onclick=()=>{show('scrTitle');refreshTitle();};
  $('btnSolo').onclick=beginSolo;
  $('btnHost').onclick=()=>{saveName();show('scrLobby');startHost();};
  $('btnJoin').onclick=()=>{saveName();show('scrLobby');startJoin();};
  $('btnConnect').onclick=()=>{const c=$('codeInput').value.trim().toUpperCase();if(c.length===4)connectTo(c);};
  $('codeInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnConnect').onclick();});
  $('btnCopyCode').onclick=()=>{try{navigator.clipboard.writeText(roomCode);toast('Code copied');}catch(e){}};
  $('btnLobbyBack').onclick=()=>{ resetNet(); role='solo'; show('scrTitle'); };
  $('btnMpStart').onclick=()=>{
    role='host';
    show(null); $('hud').classList.remove('hidden');
    newSim(lobby.players);
    const me=S.players.get(myId);
    myPos={x:WW/2,y:WH/2,inv:0,dashT:0,dashing:0,spd:me.st.spd,dcd:me.st.dashCd,dead:false};
    bcastRoster();
    bcast({t:'begin',obstacles,ww:WW,wh:WH,diff:diffKey});
    mode='play';
  };
  $('btnEditor').onclick=()=>{edInit();show('scrEditor');};
  $('btnShop').onclick=()=>{renderShop();show('scrShop');};
  $('btnShopBack').onclick=()=>{show('scrTitle');refreshTitle();};
  $('btnBoard').onclick=()=>{renderBoard();show('scrBoard');};
  $('btnBoardBack').onclick=()=>show('scrTitle');
  $('btnAgain').onclick=()=>{
    $('scrDeath').classList.add('hidden');
    conns=conns.filter(c=>c.open);
    lobby.players=lobby.players.filter(p=>p.id===myId||conns.some(c=>c._pid===p.id));
    if(role==='host'&&conns.length){
      newSim(lobby.players);
      const me=S.players.get(myId);
      myPos={x:WW/2,y:WH/2,inv:0,dashT:0,dashing:0,spd:me.st.spd,dcd:me.st.dashCd,dead:false};
      bcast({t:'rs',obstacles,ww:WW,wh:WH,diff:diffKey});
      mode='play';$('hud').classList.remove('hidden');
    }else beginSolo();
  };
  $('btnDeathShop').onclick=()=>{renderShop();show('scrShop');};
  $('btnDeathTitle').onclick=()=>{refreshTitle();show('scrTitle');resetNet();role='solo';};
  renderDiffChips('diffRow','diffDesc');
  refreshTitle();
}
