"use strict";
/* ============================================================
   panels.js — NPC dialog + shop panels. Browser only (after hudfx.js).

   SCAFFOLDING: the flow is complete (approach → prompt → talk → choices →
   shop → buy → host validates → result), the content is placeholder —
   cast, lines and stock live in data/npcs.json; the buy rules and item
   effects in dungeon.js (npcBuy / NPC_ITEM_FX).

   Panels never pause the game (co-op can't pause, and solo stays consistent
   with it): your character just stops taking movement/dash input while one
   is open. They close themselves if you get pulled away, go down, start an
   attunement pick, change floor or leave the run.

   Input: E / Enter = talk · advance · buy, W/S or ↑/↓ = choose, Esc = back/close,
   1-9 = pick a choice directly. Touch: the TALK button + tapping the panel.
   ============================================================ */
const Panels={
  open:false, view:null, npc:null, def:null, node:null, sel:0, own:[], pending:false,
  near:null, met:new Set(), typed:0, full:'', typeT:0, msgT:0, floorKey:'',

  init(){
    if(this._init||!$('npcPanel'))return; this._init=true;
    $('npcClose').onclick=()=>this.close();
    $('npcBack').onclick=()=>this.toDialog();
    $('npcBuy').onclick=()=>this.buy(this.sel);
    $('npcText').onclick=()=>this.skipType();
    const tb=$('talkbtn');
    if(tb){ const go=e=>{ e.preventDefault(); e.stopPropagation(); if(this.near&&!this.open)this.talk(this.near); };
      tb.addEventListener('touchstart',go,{passive:false}); tb.addEventListener('click',go); }
  },
  /* ---- per frame (main.js loop) ---- */
  update(dt){
    this.init();
    const playing=mode==='play'&&(S||V);
    // nearest NPC in talk range
    let best=null,bd=1e9;
    if(playing&&!myPos.dead&&typeof npcList==='function'){
      const R=npcTalkRadius();
      for(const n of npcList()){ const d=Math.hypot(myPos.x-n.x,myPos.y-n.y); if(d<R&&d<bd){bd=d;best=n;} }
    }
    this.near=best;
    const tb=$('talkbtn'); if(tb)tb.style.display=(best&&!this.open&&isTouch)?'block':'none';
    if(!this.open)return;
    // self-close rules
    const fk=TM?TM.seed+':'+TM.floor:'';
    const far=!this.npc||Math.hypot(myPos.x-this.npc.x,myPos.y-this.npc.y)>npcTalkRadius()*2;
    if(!playing||myPos.dead||far||pickDeadline>now()||fk!==this.floorKey||
       (typeof npcByUid==='function'&&!npcByUid(this.npc.uid))){ this.close(); return; }
    // typewriter
    if(this.view==='dialog'&&this.typed<this.full.length){
      this.typeT+=dt*((NPCD&&NPCD.textSpeed)||70);
      const n=Math.min(this.full.length,Math.floor(this.typeT));
      if(n!==this.typed){ this.typed=n; $('npcText').textContent=this.full.slice(0,n);
        if(n>=this.full.length)this.renderChoices(); }
    }
    if(this.view==='shop'){
      $('npcShards').textContent=myShards();
      if(this.msgT>0){ this.msgT-=dt; if(this.msgT<=0)$('npcMsg').textContent=''; }
      this.renderStockState();
    }
  },
  /* ---- open / close ---- */
  talk(npc){
    const def=npcDef(npc.id); if(!def)return;
    this.npc=npc; this.def=def; this.open=true; this.pending=false;
    this.floorKey=TM?TM.seed+':'+TM.floor:'';
    $('npcPanel').classList.remove('hidden');
    $('npcName').textContent=def.name; $('npcName').style.color=def.color||'';
    $('npcTitle').textContent=def.title||'';
    this.portrait(npc.id,def);
    const d=def.dialog||{};
    const first=!this.met.has(npc.uid); this.met.add(npc.uid);
    const start=(!first&&d.repeat)?'repeat':'start';
    if(d[start])this.say(start); else if(def.shop)this.openShop(); else this.close();
    sfx('pick');
  },
  close(){
    if(!this.open)return;
    this.open=false; this.view=null; this.npc=null; this.pending=false;
    $('npcPanel').classList.add('hidden');
    $('npcPanel').classList.remove('vDialog','vShop');
  },
  portrait(id,def){
    const c=$('npcPortrait'), o=c.getContext('2d'); o.imageSmoothingEnabled=false;
    o.clearRect(0,0,c.width,c.height);
    o.fillStyle='#0b0e1a'; o.fillRect(0,0,c.width,c.height);
    o.fillStyle=rgba(def.color||'#4ef0e8',.12); o.fillRect(0,c.height*.55,c.width,c.height*.45);
    const s=SPRC['npc_'+id]; if(!s)return;
    const k=Math.floor(Math.min(c.width/s.w,c.height/s.h)*.9);
    o.drawImage(s.c,Math.round((c.width-s.w*k)/2),Math.round(c.height-s.h*k-2),s.w*k,s.h*k);
  },
  /* ---- dialog ---- */
  say(nodeId){
    const node=(this.def.dialog||{})[nodeId]; if(!node){ this.close(); return; }
    this.view='dialog'; this.node=nodeId; this.sel=0;
    $('npcPanel').classList.add('vDialog'); $('npcPanel').classList.remove('vShop');
    $('npcDialog').classList.remove('hidden'); $('npcShop').classList.add('hidden');
    this.full=node.text||''; this.typed=0; this.typeT=0;
    $('npcText').textContent=''; $('npcChoices').innerHTML='';
  },
  skipType(){ if(this.view==='dialog'&&this.typed<this.full.length){ this.typed=this.full.length;
    $('npcText').textContent=this.full; this.renderChoices(); return true; } return false; },
  choices(){ return ((this.def.dialog||{})[this.node]||{}).choices||[{label:'Leave',close:true}]; },
  renderChoices(){
    const el=$('npcChoices'); el.innerHTML='';
    this.choices().forEach((ch,i)=>{ const b=document.createElement('button');
      b.className='npcChoice'+(i===this.sel?' sel':'');
      b.innerHTML='<span class="k">'+(i+1)+'</span>'+ch.label;
      b.onclick=()=>this.choose(i); b.onmousemove=()=>{ if(this.sel!==i){ this.sel=i; this.markSel(); } };
      el.appendChild(b); });
  },
  markSel(){ const kids=$(this.view==='shop'?'npcStock':'npcChoices').children;
    for(let i=0;i<kids.length;i++)kids[i].classList.toggle('sel',i===this.sel);
    if(this.view==='shop')this.renderDetail(); },
  choose(i){
    const ch=this.choices()[i]; if(!ch)return;
    sfx('pick');
    if(ch.close)this.close();
    else if(ch.open==='shop')this.openShop();
    else if(ch.go)this.say(ch.go);
  },
  toDialog(){ const d=this.def.dialog||{}; if(d.repeat||d.start)this.say(d.repeat?'repeat':'start'); else this.close(); },
  /* ---- shop ---- */
  openShop(){
    if(!this.def.shop){ this.close(); return; }
    this.view='shop'; this.sel=0; this.own=[]; this.msgT=0;
    $('npcPanel').classList.add('vShop'); $('npcPanel').classList.remove('vDialog');
    $('npcDialog').classList.add('hidden'); $('npcShop').classList.remove('hidden');
    $('npcShopTitle').textContent=this.def.shop.title||'WARES';
    $('npcMsg').textContent='';
    $('npcBack').style.display=this.def.dialog?'':'none';
    this.stock=npcStock(this.npc,npcFloor());
    const el=$('npcStock'); el.innerHTML='';
    this.stock.forEach((it,i)=>{ const r=document.createElement('button');
      r.className='npcItem'+(it.locked?' locked':'');
      r.innerHTML='<span class="g">'+it.glyph+'</span><span class="nm">'+it.name+'</span>'+
        '<span class="c">'+(it.locked?'—':'◆'+it.cost)+'</span>';
      r.onclick=()=>{ if(this.sel===i)this.buy(i); else{ this.sel=i; this.markSel(); } };
      r.onmousemove=()=>{ if(this.sel!==i){ this.sel=i; this.markSel(); } };
      el.appendChild(r); });
    this.markSel();
    this.request({t:'nq',u:this.npc.uid});
  },
  itemState(i){
    const it=this.stock&&this.stock[i]; if(!it)return 'none';
    if(it.locked)return 'locked';
    if(it.limit&&(this.own[i]||0)>=it.limit)return 'sold';
    if(myShards()<it.cost)return 'poor';
    return 'ok';
  },
  renderStockState(){
    const kids=$('npcStock').children;
    for(let i=0;i<kids.length;i++){ const st=this.itemState(i);
      kids[i].classList.toggle('sold',st==='sold'); kids[i].classList.toggle('poor',st==='poor'); }
    const st=this.itemState(this.sel), b=$('npcBuy');
    b.disabled=st!=='ok'||this.pending;
    b.textContent=this.pending?'…':st==='sold'?'SOLD OUT':st==='locked'?'SEALED':st==='poor'?'NOT ENOUGH ◆':'BUY';
  },
  renderDetail(){
    const it=this.stock&&this.stock[this.sel]; if(!it)return;
    $('npcItGlyph').textContent=it.glyph; $('npcItName').textContent=it.name;
    $('npcItDesc').textContent=it.desc;
    $('npcItCost').innerHTML=it.locked?'':'◆ <b>'+it.cost+'</b>'+(it.limit?' · '+it.limit+' per visit':'');
    this.renderStockState();
  },
  buy(i){
    if(this.view!=='shop'||this.pending)return;
    if(this.itemState(i)!=='ok'){ sfx('denied'); return; }
    this.pending=true; this.renderStockState();
    this.request({t:'nb',u:this.npc.uid,s:i});
  },
  /* host/solo resolve locally, a client asks the host (net.js 'nb'/'nq') */
  request(m){
    if(role==='client'){ if(conns[0]&&conns[0].open){ try{conns[0].send(m);}catch(e){ this.pending=false; } } else this.pending=false; return; }
    const p=S&&S.players.get(myId); if(!p){ this.pending=false; return; }
    const r=m.t==='nb'?npcBuy(p,m.u,m.s):{ok:true,q:1,own:npcOwn(p,m.u)};
    this.onShopResult({u:m.u,s:m.s|0,ok:r.ok?1:0,q:r.q||0,m:r.m||'',own:r.own});
  },
  onShopResult(d){
    if(!this.open||!this.npc||d.u!==this.npc.uid)return;
    if(Array.isArray(d.own))this.own=d.own;
    if(d.q){ this.renderStockState(); return; }
    this.pending=false;
    $('npcMsg').textContent=d.m||''; $('npcMsg').className=d.ok?'ok':'bad'; this.msgT=2.2;
    if(d.ok){ const row=$('npcStock').children[d.s]; if(row){ row.classList.remove('bought'); void row.offsetWidth; row.classList.add('bought'); } }
    else sfx('denied');
    this.renderStockState();
  },
  /* ---- keyboard (ui.js keydown). Returns true when it ate the key. ---- */
  key(e){
    const c=e.code;
    if(!this.open){
      if(c==='KeyE'&&this.near&&mode==='play'&&!(pickDeadline>now())){ this.talk(this.near); return true; }
      return false;
    }
    const n=this.view==='shop'?(this.stock||[]).length:this.choices().length;
    if(c==='Escape'){ if(this.view==='shop'&&this.def.dialog)this.toDialog(); else this.close(); return true; }
    if(this.view==='dialog'&&(c==='KeyE'||c==='Enter'||c==='Space')&&this.skipType())return true;
    if(c==='KeyW'||c==='ArrowUp'){ this.sel=(this.sel-1+n)%n; this.markSel(); return true; }
    if(c==='KeyS'||c==='ArrowDown'){ this.sel=(this.sel+1)%n; this.markSel(); return true; }
    if(/^Digit[1-9]$/.test(c)){ const i=+c.slice(5)-1; if(i<n){ this.sel=i; this.markSel();
      if(this.view==='dialog'&&this.typed>=this.full.length)this.choose(i); } return true; }
    if(c==='KeyE'||c==='Enter'||c==='Space'){
      if(this.view==='dialog'){ if(this.typed>=this.full.length)this.choose(this.sel); }
      else this.buy(this.sel);
      return true; }
    // eat movement keys so the pilot doesn't wander off mid-conversation
    return ['KeyA','KeyD','ArrowLeft','ArrowRight'].includes(c);
  }
};
function myShards(){
  if(role!=='client'&&S){ const p=S.players.get(myId); return p?p.shards:0; }
  if(V){ const p=V.players.get(myId); return p?p.shards||0:0; }
  return 0;
}
