"use strict";
/* ============================================================
   hudfx.js — health-bar feel. Browser only (loaded after render.js,
   never by the headless tests or the Battleground server).

   Everything here is DERIVED from values the HUD already reads (hp, maxhp,
   shield, boss hp%, the synced status list), so it behaves the same on the
   host and on a client and needs nothing extra on the wire.

   BarFx   — one bar: drain ghost, heal lead + ease, damage chunks, shake,
             flash, threshold colours, regen shimmer.
   HpHud   — the player's HP bar: BarFx + status overlays (pending DoT,
             pending HoT, fortify/exposed frame, grievous hatch, max-HP
             grow/shrink) + the status chip row.
   WorldFx — canvas-side helpers render.js uses: tinted sprite silhouettes,
             per-entity bar ghosts, status particles, low-HP vignette.
   Tuning: data/hud.json (HUDC). Status look: data/status.json.
   ============================================================ */
const HFX={ t:0, dt:0 };                         // render clock, ticked once per frame
function hfxTick(){ const t=now()/1000; HFX.dt=HFX.t?Math.min(.05,t-HFX.t):0; HFX.t=t; }
const hcfg=(k)=>(HUDC&&HUDC[k])||{};

/* ---------------- colour helpers ---------------- */
function hexRgb(h){ const v=parseInt(h.slice(1),16); return [v>>16&255,v>>8&255,v&255]; }
function rgba(h,a){ const [r,g,b]=hexRgb(h); return 'rgba('+r+','+g+','+b+','+a+')'; }
function bandFor(frac,colors){
  if(!colors||!colors.length)return null;
  for(const c of colors) if(frac>c.above) return c;
  return colors[colors.length-1];
}

/* ---------------- BarFx ----------------
   wrap: the bar's frame element; fill: its existing fill element. The extra
   layers are created here, so index.html only ever declares wrap + fill. */
class BarFx{
  constructor(wrap,fill,cfg,opt){
    this.wrap=wrap; this.fill=fill; this.c=Object.assign({
      drainDelay:.4,drainRate:.55,drainAccel:2.2,healEaseSec:.45,healBurstMin:.02,
      chunkMin:.04,chunkSec:.65,shakePx:6,shakeDecay:9,flashSec:.2,regenWindowSec:.6},cfg||{});
    this.o=Object.assign({chunks:true,heal:true,shakeEl:wrap,flashDmg:'#ffffff',flashHeal:'#7cff6b'},opt||{});
    wrap.classList.add('bfx');
    const mk=(cls,before)=>{ const d=document.createElement('div'); d.className=cls;
      before?wrap.insertBefore(d,fill):wrap.appendChild(d); return d; };
    this.gEl=mk('bfGhost',true);     // drain ghost, behind the fill
    this.lEl=mk('bfLead',true);      // heal target, behind the fill
    fill.classList.add('bfFill');
    this.shEl=mk('bfShimmer');       // regen sweep, clipped to the fill
    this.fEl=mk('bfFlash');          // whole-bar flash
    this.cEl=mk('bfChunks');         // falling chunks (overflow visible)
    this.reset();
  }
  reset(){ this.init=false; this.shake=0; this.flashT=0; this.regenT=0; this.events=[]; }
  /* v/max: current value; returns events [{k:'dmg'|'heal', amt, frac}] this frame */
  update(v,max,dt){
    const c=this.c; this.events.length=0;
    max=Math.max(1e-6,max); v=clamp(v,0,max);
    const frac=v/max;
    if(!this.init){ this.init=true; this.v=v; this.max=max; this.shown=frac; this.ghost=frac; this.lead=frac;
      this.hold=0; this.dv=c.drainRate; this.paint(frac); return this.events; }
    // a max change alone (vigor/wither, upgrades) is not damage or healing:
    // rescale the drawn fractions and only judge the HP change itself
    if(max!==this.max){ const k=this.max/max; this.shown=Math.min(1,this.shown*k); this.ghost=Math.min(1,this.ghost*k); this.lead=Math.min(1,this.lead*k); this.max=max; }
    const d=(v-this.v)/max; this.v=v;
    if(d<-1e-4){                                        // ---- damage
      const prev=this.shown, loss=-d, trailing=this.ghost>prev+1e-4;
      if(this.ghost<prev)this.ghost=prev;
      this.shown=frac; this.lead=Math.min(this.lead,frac);
      // a real hit restarts the hold; DoT ticks only start one when nothing is
      // trailing yet — otherwise a steady poison would pin the ghost forever
      if(loss>=c.chunkMin*.5||!trailing){ this.hold=c.drainDelay; this.dv=c.drainRate; }
      if(loss>=c.chunkMin){
        if(this.o.chunks)this.chunk(frac,prev);
        this.shake=Math.max(this.shake,c.shakePx*Math.min(1,.35+loss*4));
        this.flash(this.o.flashDmg,1);
      }else if(loss>=.01)this.flash(this.o.flashDmg,.35);
      this.events.push({k:'dmg',amt:loss*max,frac:loss});
    }else if(d>1e-4){                                   // ---- healing
      if(this.o.heal&&d>=c.healBurstMin){
        this.lead=Math.max(this.lead,frac); this.flash(this.o.flashHeal,.8);
        this.events.push({k:'heal',amt:d*max,frac:d});
      }else{ this.shown=Math.max(this.shown,frac); this.regenT=c.regenWindowSec; }
    }
    // heal ease: the fill climbs to the lead
    if(this.shown<frac){ const k=1-Math.exp(-dt*(3/Math.max(.05,c.healEaseSec)));
      this.shown+=(frac-this.shown)*k; if(frac-this.shown<.002)this.shown=frac; }
    if(this.shown>frac)this.shown=frac;
    if(this.lead<this.shown)this.lead=this.shown;
    if(this.lead>frac)this.lead=frac;
    // drain ghost: hold, then accelerate down to the fill
    if(this.ghost>this.shown){
      if(this.hold>0)this.hold-=dt;
      else{ this.ghost-=this.dv*dt; this.dv+=c.drainAccel*dt; }
      if(this.ghost<this.shown)this.ghost=this.shown;
    }else this.ghost=this.shown;
    this.shake*=Math.exp(-c.shakeDecay*dt); if(this.shake<.15)this.shake=0;
    this.flashT=Math.max(0,this.flashT-dt);
    this.regenT=Math.max(0,this.regenT-dt);
    this.paint(frac);
    return this.events;
  }
  flash(col,str){ this.flashCol=col; this.flashStr=str; this.flashT=this.c.flashSec; }
  chunk(lo,hi){
    const w=Math.max(.004,hi-lo), d=document.createElement('div');
    d.className='bfChunk';
    d.style.left=(lo*100)+'%'; d.style.width=(w*100)+'%';
    d.style.background=this.fill.style.background||'#fff';
    d.style.setProperty('--rot',(Math.random()*24-12).toFixed(1)+'deg');
    d.style.setProperty('--dx',(Math.random()*10-2).toFixed(1)+'px');
    d.style.animationDuration=this.c.chunkSec+'s';
    this.cEl.appendChild(d);
    setTimeout(()=>d.remove(),this.c.chunkSec*1000+50);
  }
  paint(){
    this.fill.style.width=(this.shown*100)+'%';
    this.gEl.style.width=(this.ghost*100)+'%';
    this.lEl.style.width=(this.lead*100)+'%';
    this.shEl.style.width=(this.shown*100)+'%';
    this.shEl.classList.toggle('on',this.regenT>0);
    if(this.flashT>0){ this.fEl.style.background=this.flashCol;
      this.fEl.style.opacity=(this.flashT/this.c.flashSec*this.flashStr).toFixed(3); }
    else this.fEl.style.opacity=0;
    const el=this.o.shakeEl;
    if(el)el.style.transform=this.shake>0
      ?'translate('+(Math.random()*2-1)*this.shake+'px,'+(Math.random()*2-1)*this.shake*.6+'px)'
      :(this.o.baseTransform||'');
  }
}

/* ---------------- the player's HP bar + status row ---------------- */
const HpHud={
  bar:null, shield:null, boss:null, dotEl:null, hotEl:null, chips:null, sig:'', baseW:150,
  lastMe:null,
  ensure(){
    if(this.bar||!$('hpwrap'))return;
    const C=hcfg('hpBar');
    this.bar=new BarFx($('hpwrap'),$('hpbar'),C,{shakeEl:$('hpRow')});
    this.baseW=$('hpwrap').getBoundingClientRect().width||150;
    // status overlays live inside the HP frame, above the fill
    const mk=cls=>{ const d=document.createElement('div'); d.className=cls; $('hpwrap').insertBefore(d,this.bar.fEl); return d; };
    this.hotEl=mk('bfHot'); this.dotEl=mk('bfDot');
    this.chips=$('hpStatus');
    const SC=Object.assign({},hcfg('hpBar'),hcfg('shieldBar'));
    if($('shwrap'))this.shield=new BarFx($('shwrap'),$('shbar'),SC,{chunks:false,heal:false,flashDmg:'#bfe6ff'});
    const BC=Object.assign({},hcfg('hpBar'),hcfg('bossBar'));
    if($('bossBarO'))this.boss=new BarFx($('bossBarO'),$('bossBar'),BC,{heal:false,shakeEl:$('bossBarO')});
  },
  /* me: {hp,maxhp,shield,shieldMax,sx,dead} — host player object or client view */
  update(me){
    this.ensure(); if(!this.bar)return;
    const dt=HFX.dt||1/60, C=hcfg('hpBar');
    if(me!==this.lastMe){ this.bar.reset(); if(this.shield)this.shield.reset(); this.lastMe=me; }
    const sx=me.sx||[];
    // max-HP statuses literally stretch/shrink the frame
    let mhpM=1; for(const s of sx){ const D=STATUS[s.id]; if(D&&D.maxhpM)mhpM*=D.maxhpM; }
    const sc=clamp(mhpM,C.maxhpScaleMin||.6,C.maxhpScaleMax||1.6);
    $('hpwrap').style.width=Math.round(this.baseW*sc)+'px';
    const ev=this.bar.update(me.hp,me.maxhp,dt);
    for(const e of ev){
      if(e.k==='dmg'&&e.frac>=(C.chunkMin||.04))WorldFx.kick(Math.min(4,1.5+e.frac*12));
    }
    // threshold colours + low/critical pulse
    const frac=me.maxhp>0?me.hp/me.maxhp:0;
    const band=bandFor(frac,C.colors);
    if(band){ const bg='linear-gradient(90deg,'+band.from+','+band.to+')';
      if(this.bar.fill.style.background!==bg)this.bar.fill.style.background=bg; }
    const w=$('hpwrap');
    w.classList.toggle('low',!me.dead&&frac<=(C.lowHp||.3)&&frac>(C.criticalHp||.15));
    w.classList.toggle('critical',!me.dead&&frac<=(C.criticalHp||.15));
    // status overlays: what the active DoTs/HoTs will still do
    let dmgM=1,healM=1,lo=1,hi=1,hlo=1,pendLoss=0,pendGain=0,dotCol=null,hotCol=null;
    for(const s of sx){ const D=STATUS[s.id]; if(!D)continue;
      if(D.dmgTakenM){ if(D.dmgTakenM<lo)lo=D.dmgTakenM; if(D.dmgTakenM>hi)hi=D.dmgTakenM; }
      if(D.healM&&D.healM<hlo)hlo=D.healM;
      if(D.hps<0){ pendLoss+=-D.hps*s.n*s.t; dotCol=dotCol||D.color; }
      if(D.hps>0){ pendGain+=D.hps*s.n*s.t; hotCol=hotCol||D.color; } }
    dmgM=lo*hi; healM=hlo; pendGain*=healM;
    const sh=this.bar.shown, mx=Math.max(1,me.maxhp);
    const pl=Math.min(sh,pendLoss/mx), pg=Math.min(1-sh,pendGain/mx);
    this.dotEl.style.display=pl>0.002?'block':'none';
    if(pl>0.002){ this.dotEl.style.left=((sh-pl)*100)+'%'; this.dotEl.style.width=(pl*100)+'%';
      this.dotEl.style.setProperty('--sc',dotCol); }
    this.hotEl.style.display=pg>0.002?'block':'none';
    if(pg>0.002){ this.hotEl.style.left=(sh*100)+'%'; this.hotEl.style.width=(pg*100)+'%';
      this.hotEl.style.setProperty('--sc',hotCol); }
    if(pendGain>0)this.bar.regenT=Math.max(this.bar.regenT,.1);
    w.classList.toggle('fortified',dmgM<0.999);
    w.classList.toggle('exposed',dmgM>1.001);
    w.classList.toggle('grievous',healM<0.999);
    w.classList.toggle('vigor',mhpM>1.001);
    w.classList.toggle('wither',mhpM<0.999);
    // shield bar
    if(this.shield&&(me.shieldMax||0)>0)this.shield.update(me.shield||0,me.shieldMax,dt);
    this.renderChips(sx);
  },
  renderChips(sx){
    const el=this.chips; if(!el)return;
    const sig=sx.map(s=>s.id+':'+s.n).join(',');
    if(sig!==this.sig){ this.sig=sig; el.innerHTML='';
      for(const s of sx){ const D=STATUS[s.id]; if(!D)continue;
        const c=document.createElement('div');
        c.className='sxChip '+(D.type==='buff'?'buff':'debuff');
        c.style.setProperty('--sc',D.color||'#e8ecff');
        c.title=D.name+(s.n>1?' ×'+s.n:'')+' — '+(D.desc||'');
        c.innerHTML='<span class="g">'+D.glyph+'</span>'+(s.n>1?'<span class="n">'+s.n+'</span>':'')+'<i></i>';
        c.dataset.id=s.id; el.appendChild(c); } }
    for(const c of el.children){ const s=sx.find(x=>x.id===c.dataset.id); if(!s)continue;
      c.querySelector('i').style.width=clamp(s.t/(s.tMax||s.t||1),0,1)*100+'%';
      c.classList.toggle('ending',s.t<1.5); }
  },
  /* boss bar: called with the 0..1 fraction updateHUD already computed */
  updateBoss(frac,on,key){
    this.ensure(); if(!this.boss)return;
    if(!on){ this.boss.reset(); this.bossKey=null; return; }
    if(key!==this.bossKey){ this.boss.reset(); this.bossKey=key; }
    this.boss.update(frac*1000,1000,HFX.dt||1/60);
  }
};

/* ---------------- canvas-side helpers (render.js) ---------------- */
const WorldFx={
  shakeAmt:0, parts:[], silCache:new WeakMap(),
  kick(px){ this.shakeAmt=Math.max(this.shakeAmt,px); },
  camShake(){ const s=this.shakeAmt; this.shakeAmt*=Math.exp(-14*(HFX.dt||1/60)); if(this.shakeAmt<.2)this.shakeAmt=0; return s; },
  /* a sprite's silhouette filled with one colour, cached per image+colour */
  sil(img,col){
    let m=this.silCache.get(img); if(!m){ m=new Map(); this.silCache.set(img,m); }
    let c=m.get(col);
    if(!c){ c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const o=c.getContext('2d'); o.drawImage(img,0,0); o.globalCompositeOperation='source-in';
      o.fillStyle=col; o.fillRect(0,0,c.width,c.height); m.set(col,c); }
    return c;
  },
  drawSil(img,x,y,col,alpha,scl=1){
    if(!(alpha>0))return;
    const w=img.width*scl,h=img.height*scl;
    ctx.globalAlpha=Math.min(1,alpha);
    ctx.drawImage(this.sil(img,col),Math.round(x-w/2),Math.round(y-h/2),w,h);
    ctx.globalAlpha=1;
  },
  /* hit/heal reaction for any entity with an hp value: o._fx holds state.
     Returns {hurt: 0..1, heal: 0..1} intensities for this frame. */
  react(o,hp,max){
    const SP=hcfg('sprite'), f=o._fx||(o._fx={hp,max,hurtT:0,healT:0});
    const d=hp-f.hp;
    if(max===f.max){
      if(d<-.5)f.hurtT=SP.hurtFlashSec||.12;
      else if(d>Math.max(1.5,max*.02)){ f.healT=SP.healTintSec||.35; f.healAmt=d; }
    }
    f.hp=hp; f.max=max;
    const dt=HFX.dt||1/60;
    f.hurtT=Math.max(0,f.hurtT-dt); f.healT=Math.max(0,f.healT-dt);
    const out={hurt:f.hurtT/(SP.hurtFlashSec||.12),heal:f.healT/(SP.healTintSec||.35),healAmt:0};
    if(f.healAmt){ out.healAmt=f.healAmt; f.healAmt=0; }
    return out;
  },
  /* small world bar with a drain ghost. frac 0..1; o._wb holds state. */
  bar(o,x,y,w,h,frac,col,bg){
    const W=hcfg('worldBars'), g=o._wb||(o._wb={g:frac,last:frac,hold:0});
    const dt=HFX.dt||1/60;
    if(frac<g.last){ if(g.g<g.last)g.g=Math.max(g.g,g.last); g.hold=W.drainDelay||.3; }
    g.last=frac;
    if(g.g>frac){ if(g.hold>0)g.hold-=dt; else g.g=Math.max(frac,g.g-(W.drainRate||.8)*dt); } else g.g=frac;
    x=Math.round(x); y=Math.round(y);
    ctx.fillStyle=bg||'#060810'; ctx.fillRect(x,y,w,h);
    if(g.g>frac){ ctx.fillStyle='#fff4e0'; ctx.globalAlpha=.85; ctx.fillRect(x,y,Math.round(w*g.g),h); ctx.globalAlpha=1; }
    ctx.fillStyle=col; ctx.fillRect(x,y,Math.round(w*clamp(frac,0,1)),h);
  },
  /* status visuals on a player in the world: rings for multipliers,
     particles for over-time effects. sx = [{id,n,t}] */
  status(px,py,sx,scale){
    if(!sx||!sx.length)return;
    const t=HFX.t, dt=HFX.dt||1/60;
    for(const s of sx){ const D=STATUS[s.id]; if(!D)continue; const col=D.color||'#fff';
      if(D.dmgTakenM){ // ring: solid gold for fortify, broken red for exposed
        ctx.strokeStyle=col; ctx.lineWidth=1; ctx.globalAlpha=.55+.25*Math.sin(t*6);
        if(D.dmgTakenM<1){ ctx.beginPath(); ctx.arc(px,py,10,0,TAU); ctx.stroke(); }
        else for(let k=0;k<6;k++){ const a=t*1.5+k*TAU/6; ctx.beginPath(); ctx.arc(px,py,10,a,a+.6); ctx.stroke(); }
        ctx.globalAlpha=1;
      }
      if(D.maxhpM){ ctx.fillStyle=col; ctx.globalAlpha=.18+.1*Math.sin(t*4);
        ctx.beginPath(); ctx.arc(px,py,7+(D.maxhpM>1?2:-1),0,TAU); ctx.fill(); ctx.globalAlpha=1; }
      // particle emission: rate scales with stacks
      const rate=(D.hps?6:D.healM?3:D.maxhpM?2.5:0)*(s.n||1)*(scale||1);
      if(rate>0&&Math.random()<rate*dt){
        const up=!(D.maxhpM&&D.maxhpM<1);
        this.parts.push({x:px+rnd(-5,5),y:py+rnd(-3,4),vx:rnd(-4,4),vy:up?rnd(-18,-10):rnd(6,12),
          l:.7,l0:.7,col,shape:D.hps>0?'plus':D.healM?'x':D.id==='burn'?'ember':'dot'});
      }
    }
  },
  drawParts(){
    const dt=HFX.dt||1/60;
    for(let i=this.parts.length-1;i>=0;i--){ const p=this.parts[i];
      p.l-=dt; if(p.l<=0){ this.parts.splice(i,1); continue; }
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      ctx.globalAlpha=Math.min(1,p.l/p.l0*1.4); ctx.fillStyle=p.col;
      const x=Math.round(p.x), y=Math.round(p.y);
      if(p.shape==='plus'){ ctx.fillRect(x-1,y,3,1); ctx.fillRect(x,y-1,1,3); }
      else if(p.shape==='x'){ ctx.fillRect(x-1,y-1,1,1); ctx.fillRect(x+1,y+1,1,1); ctx.fillRect(x,y,1,1); ctx.fillRect(x+1,y-1,1,1); ctx.fillRect(x-1,y+1,1,1); }
      else if(p.shape==='ember'){ ctx.fillRect(x,y,1,2); }
      else ctx.fillRect(x,y,1,1);
    }
    ctx.globalAlpha=1;
    if(this.parts.length>300)this.parts.splice(0,this.parts.length-300);
  },
  /* red edge pulse when the local player is low (screen space) */
  vignette(frac,dead){
    const V0=hcfg('vignette'), low=V0.lowHp||.3;
    if(dead||!(frac<low))return;
    const k=1-frac/low, pulse=.6+.4*Math.sin(now()/(V0.pulseMs||520)*TAU);
    const a=(V0.alpha||.42)*k*pulse;
    const g=ctx.createRadialGradient(VW/2,VH/2,VH*.32,VW/2,VH/2,VW*.62);
    g.addColorStop(0,'rgba(255,40,60,0)'); g.addColorStop(1,'rgba(255,40,60,'+a.toFixed(3)+')');
    ctx.fillStyle=g; ctx.fillRect(0,0,VW,VH);
  }
};
