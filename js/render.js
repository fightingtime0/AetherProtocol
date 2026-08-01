"use strict";
/* ============================================================
   render.js — canvas rendering, minimap, HUD.
   ============================================================ */
const cv=document.getElementById('game'), ctx=cv.getContext('2d');
cv.width=VW; cv.height=VH;
function fit(){ const s=Math.min(innerWidth/VW, innerHeight/VH);
  cv.style.width=(VW*s)+'px'; cv.style.height=(VH*s)+'px'; }
addEventListener('resize',fit); fit();

const PB_COLS=['#ffd35c','#4ef0e8','#ff4fd8','#b3a6ff','#7cff6b','#ffffff'];
const EBCOLS=['#ffd35c','#4ef0e8','#ff4fd8','#b3a6ff','#7cff6b'];

function drawImgC(img,x,y,flashAmt,scl=1){
  const w=img.width*scl,h=img.height*scl;
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img, Math.round(x-w/2), Math.round(y-h/2), w, h);
  if(flashAmt>0){ ctx.globalAlpha=.75; ctx.fillStyle='#fff';
    ctx.fillRect(Math.round(x-w/2),Math.round(y-h/2),w,h);
    ctx.globalAlpha=1; }
}
function drawObstacle(o){
  const x=Math.round(o.x),y=Math.round(o.y),r=Math.round(o.r);
  if(o.kind==='crystal'){
    ctx.fillStyle=o.hue<.5?'#1e3d4a':'#3d1e40';
    ctx.beginPath();ctx.moveTo(x,y-r-3);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();ctx.fill();
    ctx.fillStyle=o.hue<.5?'#4ef0e8':'#ff4fd8';
    ctx.fillRect(x-1,y-r,2,r);ctx.fillRect(x-r+2,y-2,2,2);
  }else if(o.kind==='rock'){
    ctx.fillStyle='#232b45';ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
    ctx.fillStyle='#39415f';ctx.beginPath();ctx.arc(x-r*.25,y-r*.3,r*.6,0,TAU);ctx.fill();
    ctx.fillStyle='#141a2e';ctx.fillRect(x-2,y+1,4,2);
  }else if(o.kind==='pillar'){
    ctx.fillStyle='#1a2440';ctx.fillRect(x-4,y-r-6,8,r+8);
    ctx.fillStyle='#2a3352';ctx.fillRect(x-5,y-r-8,10,3);
    ctx.fillStyle='#ffd35c';ctx.fillRect(x-1,y-r,2,2);
    ctx.fillStyle='#0b0e1a';ctx.beginPath();ctx.ellipse(x,y+2,r,r*.4,0,0,TAU);ctx.fill();
  }else{ // scrap
    ctx.fillStyle='#2b2416';ctx.fillRect(x-r,y-r*.6,r*2,r*1.2);
    ctx.fillStyle='#4a3d22';ctx.fillRect(x-r+1,y-r*.6+1,r*2-2,2);
    ctx.strokeStyle='#6b7396';ctx.beginPath();ctx.moveTo(x+r-2,y-r*.6);ctx.lineTo(x+r+2,y-r-4);ctx.stroke();
    ctx.fillStyle='#7cff6b';ctx.fillRect(x+r+1,y-r-5,2,2);
  }
}
function drawItem(it){
  const x=Math.round(it[1]!==undefined?it[1]:it.x), y=Math.round(it[2]!==undefined?it[2]:it.y);
  const k=it[0]!==undefined?it[0]:it.k;
  const bob=Math.sin(now()/300+x)*1.5;
  if(k===0){ctx.fillStyle='#ff5c47';ctx.fillRect(x-2,y-2+bob,2,2);ctx.fillRect(x,y-2+bob,2,2);
    ctx.fillRect(x-2,y+bob,4,2);ctx.fillRect(x-1,y+2+bob,2,1);}
  else if(k===1){ctx.fillStyle='#ff4fd8';ctx.beginPath();
    ctx.moveTo(x,y-3+bob);ctx.lineTo(x+2,y+bob);ctx.lineTo(x,y+3+bob);ctx.lineTo(x-2,y+bob);ctx.closePath();ctx.fill();}
  else{ctx.fillStyle='#3d2b12';ctx.fillRect(x-4,y-3+bob,8,6);
    ctx.fillStyle='#ffd35c';ctx.fillRect(x-4,y-1+bob,8,1);ctx.fillRect(x-1,y-2+bob,2,3);}
}

function render(){
  ctx.save();
  ctx.fillStyle='#0b0e1a'; ctx.fillRect(0,0,VW,VH);
  const shk=(role!=='client'&&S)?S.shake:0;
  // camera on own player (or ally if dead)
  let fx=myPos.x, fy=myPos.y;
  if(myPos.dead&&V){ for(const p of V.players.values())if(!p.dead){fx=p.dx;fy=p.dy;break;} }
  if(myPos.dead&&role!=='client'&&S){ for(const p of S.players.values())if(!p.dead){fx=p.x;fy=p.y;break;} }
  cam.x=clamp(fx-VW/2,0,WW-VW); cam.y=clamp(fy-VH/2,0,WH-VH);
  ctx.translate(-Math.round(cam.x)+(shk>0?rnd(-2,2):0), -Math.round(cam.y)+(shk>0?rnd(-2,2):0));
  // floor grid + border
  ctx.strokeStyle='rgba(42,51,82,.45)';ctx.lineWidth=1;
  const gx0=Math.floor(cam.x/32)*32, gy0=Math.floor(cam.y/32)*32;
  for(let x=gx0;x<=cam.x+VW;x+=32){ctx.beginPath();ctx.moveTo(x+.5,cam.y);ctx.lineTo(x+.5,cam.y+VH);ctx.stroke();}
  for(let y=gy0;y<=cam.y+VH;y+=32){ctx.beginPath();ctx.moveTo(cam.x,y+.5);ctx.lineTo(cam.x+VW,y+.5);ctx.stroke();}
  ctx.strokeStyle='#ff4fd8';ctx.lineWidth=2;ctx.strokeRect(1,1,WW-2,WH-2);
  // deterministic floor runes
  ctx.fillStyle='rgba(78,240,232,.09)';
  for(let i=0;i<40;i++){const rx=(i*337)%WW,ry=(i*211)%WH;
    if(rx>cam.x-4&&rx<cam.x+VW+4&&ry>cam.y-4&&ry<cam.y+VH+4)ctx.fillRect(rx,ry,3,3);}
  if(mode!=='play'||(!S&&!V)){ctx.restore();return;}
  // gather draw data
  const isHost=role!=='client';
  let en,eb,pb,it,players,fxList,drs,zns;
  if(isHost){ en=S.en; eb=S.eb; pb=S.pb; it=S.it; fxList=S.fx; drs=S.dr; zns=S.zn;
    players=[...S.players.values()];
  }else{ lerpView();
    en=[...V.en.values()]; eb=V.eb; pb=V.pb; it=V.it; fxList=[]; drs=V.dr||[]; zns=V.zn||[];
    players=[...V.players.values()];
  }
  for(const o of obstacles) if(vis(o.x,o.y,20)) drawObstacle(o);
  // void sigil zones
  for(const z of zns){
    const zx=isHost?z.x:z[0], zy=isHost?z.y:z[1], zr=isHost?z.r:z[2];
    if(!vis(zx,zy,zr+4))continue;
    // a zone may carry its own colour (the Nanite Virus cloud is green)
    const zc=isHost?(z.col||'#b34fff'):(z[3]||'#b34fff');
    ctx.globalAlpha=.12; ctx.fillStyle=zc;
    ctx.beginPath();ctx.arc(zx,zy,zr,0,TAU);ctx.fill();
    ctx.globalAlpha=.7; ctx.strokeStyle=zc; ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(zx,zy,zr,0,TAU);ctx.stroke();
    ctx.globalAlpha=1;
  }
  // objective circle
  const ovr=getObjView();
  if(ovr&&OBJ_TYS[ovr.tyI]==='zone'&&!ovr.done&&ovr.zr){
    const pulse=Math.sin(now()/180)*2;
    ctx.strokeStyle='rgba(255,211,92,.85)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(ovr.zx,ovr.zy,ovr.zr,0,TAU);ctx.stroke();
    ctx.strokeStyle='rgba(255,211,92,.3)';
    ctx.beginPath();ctx.arc(ovr.zx,ovr.zy,ovr.zr+3+pulse,0,TAU);ctx.stroke();
    ctx.fillStyle='rgba(255,211,92,.06)';
    ctx.beginPath();ctx.arc(ovr.zx,ovr.zy,ovr.zr,0,TAU);ctx.fill();
  }
  for(const i2 of it) drawItem(i2);
  if(isHost)for(const f of fxList){ctx.globalAlpha=Math.min(1,f.l*3);ctx.fillStyle=f.ci;
    ctx.fillRect(Math.round(f.x),Math.round(f.y),1,1);}
  ctx.globalAlpha=1;
  // shard pads (Nexus Siege): mercenary + cache purchase spots
  const shops=isHost?(S.shops||0):(V?V.shp:0);
  if(shops)for(const o of shops){
    const ox=isHost?o.x:o[0], oy=isHost?o.y:o[1];
    const oteam=isHost?o.team:o[2], merc=isHost?(o.k==='merc'):(o[3]===0);
    const ocd=isHost?o.cd:o[4];
    if(!vis(ox,oy,34))continue;
    const R=MOBA?MOBA.shop.radius:26;
    ctx.globalAlpha=ocd>0?.15:.32;
    ctx.strokeStyle=teamColor(oteam); ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(ox,oy,R,0,TAU);ctx.stroke();
    ctx.globalAlpha=ocd>0?.25:.85;
    ctx.textAlign='center';
    ctx.font='bold 8px monospace';
    ctx.fillStyle=teamColor(oteam);
    ctx.fillText(merc?'⚔':'▣',Math.round(ox),Math.round(oy)-1);
    // spell out what the pad does and what it costs
    ctx.font='bold 6px monospace';
    const label=merc?'HIRE MERCS':'OPEN CACHE';
    const cost=MOBA?(merc?MOBA.shop.creepCost:MOBA.shop.chestCost):0;
    ctx.fillStyle='#000';
    ctx.fillText(label,Math.round(ox)+1,Math.round(oy)+9);
    ctx.fillStyle=ocd>0?'#8f9ac2':'#e8ecff';
    ctx.fillText(label,Math.round(ox),Math.round(oy)+8);
    ctx.fillStyle=ocd>0?'#8f9ac2':'#ffd35c';
    ctx.fillText(ocd>0?('READY IN '+Math.ceil(ocd)+'s'):('◆ '+cost),Math.round(ox),Math.round(oy)+15);
    ctx.globalAlpha=1;
  }
  /* Velocity-aligned streak behind fast rounds. Derived from speed rather
     than a per-weapon flag, so it needs no protocol change and every fast
     weapon (rail, boomerang, erratic…) gets a trail automatically. */
  const TR=BAL.combat.trail;
  function streak(bx,by,vx,vy,col,wide){
    const sp=Math.hypot(vx,vy);
    if(sp<TR.minSpeed)return;
    const len=Math.min(TR.maxLen,sp*TR.scale), ux=vx/sp, uy=vy/sp;
    ctx.globalAlpha=wide?.5:.35; ctx.strokeStyle=col; ctx.lineWidth=wide?2:1;
    ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx-ux*len,by-uy*len); ctx.stroke();
    ctx.globalAlpha=1; ctx.lineWidth=1;
  }
  /* In team modes a bullet's COLOUR tells you whose side it belongs to, so
     the weapon it came from has to be readable some other way. The colour
     index becomes a SHAPE instead: square, diamond, round, bar, cross,
     hollow. Outside a team mode the old palettes are used unchanged. */
  function bulletMark(bx,by,ci,col,r,ang){
    ctx.fillStyle=col; ctx.strokeStyle=col;
    const x=Math.round(bx), y=Math.round(by), s=Math.max(1,r);
    switch(ci%6){
      case 0: ctx.fillRect(x-s,y-s,s*2,s*2); break;                       // block
      case 1: ctx.save(); ctx.translate(x,y); ctx.rotate(Math.PI/4);       // diamond
              ctx.fillRect(-s,-s,s*2,s*2); ctx.restore(); break;
      case 2: ctx.beginPath(); ctx.arc(x,y,s+.4,0,TAU); ctx.fill(); break; // orb
      case 3: ctx.save(); ctx.translate(x,y); ctx.rotate(ang||0);          // bar
              ctx.fillRect(-s*1.8,-s*.6,s*3.6,s*1.2); ctx.restore(); break;
      case 4: ctx.fillRect(x-s*1.8,y-.5,s*3.6,1);                          // cross
              ctx.fillRect(x-.5,y-s*1.8,1,s*3.6); break;
      default: ctx.lineWidth=1; ctx.beginPath();                            // hollow ring
              ctx.arc(x,y,s+.6,0,TAU); ctx.stroke(); break;
    }
  }
  // enemy bullets
  const bt=bulletLead(); // latency-compensated; identical to checkLocalHits()
  for(const b of eb){
    let bx,by,ci,br,bvx,bvy,btm;
    if(isHost){bx=b.x;by=b.y;ci=b.ci;br=b.r;bvx=b.vx;bvy=b.vy;btm=b.team;}
    else{bx=b[1]+b[3]*bt;by=b[2]+b[4]*bt;ci=b[5];br=b[6];bvx=b[3];bvy=b[4];
      btm=(b[7]===undefined||b[7]<0)?undefined:b[7];}
    if(!vis(bx,by,5))continue;
    const teamed=(btm!==undefined&&btm>=0);
    const col=teamed?teamColor(btm):(EBCOLS[ci]||'#fff');
    streak(bx,by,bvx,bvy,col);
    if(teamed)bulletMark(bx,by,ci,col,br,Math.atan2(bvy,bvx));
    else ctx.fillStyle=col,ctx.fillRect(Math.round(bx-br),Math.round(by-br),br*2,br*2);
    ctx.fillStyle='rgba(255,255,255,.85)';ctx.fillRect(Math.round(bx),Math.round(by),1,1);
  }
  // player bullets
  for(const b of pb){
    let bx,by,ci,bvx,bvy,own;
    if(isHost){bx=b.x;by=b.y;ci=b.ci;bvx=b.orb?0:b.vx;bvy=b.orb?0:b.vy;own=b.owner;}
    else{bx=b[1]+b[3]*bt;by=b[2]+b[4]*bt;ci=b[5];bvx=b[3];bvy=b[4];own=b[6];}
    if(!vis(bx,by,5))continue;
    // owner's team decides the colour; the shape still says which weapon
    const shooter=isHost?S.players.get(own):(V&&V.players.get(own));
    const ptm=shooter?shooter.team:undefined;
    const teamed=(ptm!==undefined&&ptm>=0);
    const col=teamed?teamColor(ptm):(PB_COLS[ci]||'#ffd35c');
    streak(bx,by,bvx,bvy,col,teamed);
    // summoned fangs read as spinning blades rather than bullets
    if(isHost&&b.orb){
      ctx.globalAlpha=.9; ctx.strokeStyle=col; ctx.lineWidth=1;
      const a=b.orbA*3, s=3;
      ctx.beginPath();
      ctx.moveTo(bx-Math.cos(a)*s,by-Math.sin(a)*s);
      ctx.lineTo(bx+Math.cos(a)*s,by+Math.sin(a)*s);
      ctx.stroke(); ctx.globalAlpha=1;
      continue;
    }
    // heavier rounds render bigger and throw sparks
    const br2=isHost?(b.r||1.5):1.5;
    const sparky=isHost&&b.spark;
    if(sparky&&Math.random()<(BAL.combat.spark.chance||.5)){
      const a2=rnd(0,TAU), sp=rnd(10,40);
      S.fx.push({x:bx,y:by,vx:Math.cos(a2)*sp,vy:Math.sin(a2)*sp,
        l:BAL.combat.spark.life||.22,ci:col});
    }
    if(isHost&&b.delay>0)continue;               // queued swing head, not out yet
    if(isHost&&b.shape==='square'){              // flail heads read as solid blocks
      ctx.fillStyle=col;
      ctx.fillRect(Math.round(bx-br2),Math.round(by-br2),br2*2,br2*2);
      ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=1;
      ctx.strokeRect(Math.round(bx-br2)+.5,Math.round(by-br2)+.5,br2*2-1,br2*2-1);
      continue;
    }
    if(teamed)bulletMark(bx,by,ci,col,Math.max(1.5,br2*0.8),Math.atan2(bvy,bvx));
    else if(br2>2){                              // chunky projectile
      ctx.fillStyle=col;
      ctx.beginPath();ctx.arc(Math.round(bx),Math.round(by),br2,0,TAU);ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.9)';
      ctx.fillRect(Math.round(bx)-1,Math.round(by)-1,2,2);
    }
    else{ ctx.fillStyle=col; ctx.fillRect(Math.round(bx-1),Math.round(by-1),3,2); }
  }
  // chain-lightning arcs — shows exactly what got zapped, and in what order
  const arcs=isHost?(S.ar||[]):(V&&V.ar||[]);
  for(const a of arcs){
    const x1=isHost?a.x1:a[0], y1=isHost?a.y1:a[1];
    const x2=isHost?a.x2:a[2], y2=isHost?a.y2:a[3];
    ctx.globalAlpha=isHost?Math.min(1,a.l*5):.9;
    ctx.strokeStyle='#4ef0e8'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x1,y1);
    // a couple of jagged midpoints so it reads as lightning, not a line
    const segs=3;
    for(let i=1;i<segs;i++){
      const t=i/segs;
      ctx.lineTo(x1+(x2-x1)*t+rnd(-3,3), y1+(y2-y1)*t+rnd(-3,3));
    }
    ctx.lineTo(x2,y2); ctx.stroke();
    ctx.globalAlpha=1;
  }
  // orbital smite: ring shrinks onto the marked spot, then it detonates
  const marks=isHost?(S.mk||[]):(V&&V.mk||[]);
  for(const m of marks){
    const mx=isHost?m.x:m[0], my=isHost?m.y:m[1];
    const rEnd=isHost?m.r:m[2], r0=isHost?m.r0:m[3];
    const t=isHost?m.t:(m[4]/100), tMax=isHost?m.tMax:(m[5]/100);
    if(!vis(mx,my,r0+6))continue;
    const k=tMax>0?clamp(t/tMax,0,1):0;
    const rr=rEnd+(r0-rEnd)*k;                 // shrinks toward the blast radius
    ctx.globalAlpha=.9-k*.45;
    ctx.strokeStyle='#ffd35c'; ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(mx,my,rr,0,TAU);ctx.stroke();
    ctx.globalAlpha=.25;
    ctx.beginPath();ctx.arc(mx,my,rEnd,0,TAU);ctx.stroke();  // the actual blast
    ctx.globalAlpha=1;
  }
  // enemies
  for(const e of en){
    const ex=isHost?e.x:e.dx, ey=isHost?e.y:e.dy;
    const scl=(isHost?(e.scl||1):(e.scl||1));
    if(!vis(ex,ey,16*scl+8))continue;
    const ti=isHost?ETI[e.k]:e.ti;
    const spr=SPRC[ET[ti].spr||ET[ti].id];
    const telegraphing=isHost?(e.st===1):e.tel;
    if(telegraphing){ctx.globalAlpha=.35;ctx.fillStyle='#ff5c47';
      ctx.beginPath();ctx.arc(ex,ey,10*scl,0,TAU);ctx.fill();ctx.globalAlpha=1;}
    drawImgC(spr.c,ex,ey,(isHost?e.flash>0:e.flash)?1:0,scl);
    if(e.shielded){ // multi-part boss core, guarded while a pylon still lives
      ctx.globalAlpha=.55+Math.sin(now()/140)*.15; ctx.strokeStyle='#4ef0e8'; ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(ex,ey,14*scl,0,TAU);ctx.stroke(); ctx.globalAlpha=1; ctx.lineWidth=1;
    }
    // lances — the Arbiter runs two at once, everything else runs one
    const beamCol=(e.team!==undefined&&e.team>=0)?teamColor(e.team):'#ff4fd8';
    const drawBeam=(on,ang,len)=>{
      if(!on||!(len>0))return;
      const gx=ex+Math.cos(ang)*len, gy=ey+Math.sin(ang)*len;
      ctx.globalAlpha=.25; ctx.strokeStyle=beamCol; ctx.lineWidth=5;
      ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(gx,gy);ctx.stroke();
      ctx.globalAlpha=.9; ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(gx,gy);ctx.stroke();
      ctx.globalAlpha=1;
    };
    drawBeam(e.laserOn,e.lang||0,e.llen||0);
    drawBeam(e.laser2On,e.lang2||0,e.llen2||0);
    // Nexus Siege: ring team-owned entities in their side's colour, so
    // you can tell your own turrets from the enemy's at a glance
    if(e.team!==undefined&&e.team>=0){
      ctx.globalAlpha=.5; ctx.strokeStyle=teamColor(e.team); ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(ex,ey,10*scl+3,0,TAU);ctx.stroke(); ctx.globalAlpha=1;
    }
    const hpp=isHost?e.hp/e.maxhp:e.hpp/100;
    // Objective structures always show their bar (you need to read a siege at
    // a glance); everything else only shows one once it has been damaged.
    const isObjective=(e.team!==undefined&&e.team>=0);
    if(hpp<1||isObjective){const bw=(ET[ti].boss?26:ET[ti].mini?18:10)*Math.max(1,scl*.8);
      ctx.fillStyle='#060810';ctx.fillRect(Math.round(ex-bw/2),Math.round(ey-spr.h*scl/2-4),bw,2);
      ctx.fillStyle=(e.team!==undefined&&e.team>=0)?teamColor(e.team)
        :ET[ti].boss?'#ff4fd8':ET[ti].opt?'#4ef0e8':'#7cff6b';
      ctx.fillRect(Math.round(ex-bw/2),Math.round(ey-spr.h*scl/2-4),Math.round(bw*hpp),2);}
  }
  // servitor drones
  for(const dn of drs){
    const dxx=isHost?dn.x:dn[0], dyy=isHost?dn.y:dn[1];
    const hpp=isHost?dn.hp/dn.maxhp:(dn[2]||0)/100;
    const stuck=isHost?dn.stuck:!!dn[3];
    const fuse=isHost?(dn.fuse||0):(dn[4]||0);
    const dtm=isHost?dn.team:((dn[5]===undefined||dn[5]<0)?undefined:dn[5]);
    if(!vis(dxx,dyy,10))continue;
    // tethered out of range: dimmed, ringed, and counting down to detonation
    if(stuck){ ctx.globalAlpha=.5;
      ctx.strokeStyle='#ff5c47'; ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(dxx,dyy,6,0,TAU);ctx.stroke(); }
    drawImgC(SPRC.drone.c,dxx,dyy,0);
    // servitors wear their owner's colours too, so you can tell whose swarm
    // is whose in a scrap
    if(dtm!==undefined&&dtm>=0){
      ctx.globalAlpha=.75; ctx.strokeStyle=teamColor(dtm); ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(dxx,dyy,4.5,0,TAU);ctx.stroke();
    }
    ctx.globalAlpha=1;
    if(stuck&&fuse>0){
      ctx.font='bold 8px monospace'; ctx.textAlign='center';
      ctx.fillStyle='#000'; ctx.fillText(fuse,Math.round(dxx)+1,Math.round(dyy)-6);
      ctx.fillStyle='#ff5c47'; ctx.fillText(fuse,Math.round(dxx),Math.round(dyy)-7);
    }
    ctx.fillStyle='#060810';ctx.fillRect(Math.round(dxx-4),Math.round(dyy-6),8,1);
    ctx.fillStyle='#4ef0e8';ctx.fillRect(Math.round(dxx-4),Math.round(dyy-6),Math.round(8*clamp(hpp,0,1)),1);
  }
  // players
  for(const p of players){
    const px=p.id===myId?myPos.x:(isHost?p.x:p.dx);
    const py=p.id===myId?myPos.y:(isHost?p.y:p.dy);
    if(p.dead){ctx.globalAlpha=.3;}
    const invF=(p.id===myId)?(myPos.inv>0):(isHost?p.inv>0:!!p.inv);
    const blink=invF&&Math.floor(now()/60)%2===0;
    if(!blink||p.dead){
      let img=null;
      if(isHost)img=p.img;
      else{const r=clientRoster.get(p.id);img=r?r.img:spriteToCanvas(DEFAULT_MAGE);}
      drawImgC(img,px,py,0);
    }
    // orbiting fangs
    const orbN=p.orbN||0, sabN=p.sabN||0;
    const OC=BAL.combat.orbit, SC=BAL.combat.saber;
    if(!p.dead&&orbN>0){
      const oa=isHost?(p.orbA||0):now()/1000*OC.spinSpeed;
      for(let i=0;i<orbN;i++){
        const a=oa+i/orbN*TAU, ox=px+Math.cos(a)*OC.radius, oy=py+Math.sin(a)*OC.radius;
        ctx.fillStyle='#4ef0e8';
        ctx.beginPath();ctx.moveTo(ox,oy-3);ctx.lineTo(ox+2,oy);ctx.lineTo(ox,oy+3);ctx.lineTo(ox-2,oy);ctx.closePath();ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.85)';ctx.fillRect(Math.round(ox),Math.round(oy)-1,1,1);
      }
    }
    // aether saber blades
    if(!p.dead&&sabN>0){
      const sa=isHost?(p.sabA||0):now()/1000*SC.spinSpeed;
      // dim while on cooldown / unlit — the blade is visibly inert, which is
      // the tell that it also isn't parrying right now
      const lit=isHost?!!p.sabLit:!!p.sabLit;
      for(let i=0;i<sabN;i++){
        const a=sa+i/sabN*TAU;
        const reach=lit?SC.reach-2:SC.reach*0.45;
        const x1=px+Math.cos(a)*7, y1=py+Math.sin(a)*7;
        const x2=px+Math.cos(a)*reach, y2=py+Math.sin(a)*reach;
        ctx.strokeStyle=lit?'rgba(124,255,107,.35)':'rgba(90,120,90,.18)';
        ctx.lineWidth=lit?3:2;
        ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
        ctx.strokeStyle=lit?'#e8ecff':'rgba(150,165,150,.5)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
      }
      ctx.lineWidth=1;
    }
    // continuous laser beam
    const beamOn=isHost?p.beamOnT>0:!!p.beamOn;
    if(!p.dead&&beamOn){
      const bx2=px+Math.cos(p.beamAng)*(p.beamLen||220), by2=py+Math.sin(p.beamAng)*(p.beamLen||220);
      ctx.strokeStyle='rgba(255,79,216,.3)';ctx.lineWidth=4;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(bx2,by2);ctx.stroke();
      ctx.strokeStyle='#ffe8fa';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(bx2,by2);ctx.stroke();
      ctx.lineWidth=1;
    }
    // shield shimmer
    const shOn=(p.shield||0)>0;
    if(!p.dead&&shOn){ctx.globalAlpha=.25;ctx.strokeStyle='#4ef0e8';
      ctx.beginPath();ctx.arc(px,py,8,0,TAU);ctx.stroke();ctx.globalAlpha=1;}
    const isPicking=(p.id===myId)?(pickDeadline>now()):(isHost?now()<p.pickUntil:!!p.picking);
    if(isPicking){ctx.globalAlpha=.5;ctx.strokeStyle='#ffd35c';
      ctx.beginPath();ctx.arc(px,py,9,0,TAU);ctx.stroke();ctx.globalAlpha=1;}
    if(p.id!==myId&&!p.dead){
      let nm=isHost?p.name:(clientRoster.get(p.id)||{}).name||'ALLY';
      if(p.lvl)nm+=' [ '+p.lvl+' ]'; // siege level tag: "voramus [ 2 ]"
      ctx.font='bold 7px monospace';ctx.textAlign='center';
      ctx.fillStyle='#000';ctx.fillText(nm,Math.round(px)+1,Math.round(py-8)+1);
      // enemies read in their team colour so you can pick targets at a glance
      ctx.fillStyle=(p.team!==undefined&&p.team>=0)?teamColor(p.team):'#e8ecff';
      ctx.fillText(nm,Math.round(px),Math.round(py-8));
    }
    ctx.globalAlpha=1;
  }
  // dash pip
  if(!myPos.dead){ctx.fillStyle=myPos.dashT<=0?'#ffd35c':'#39415f';
    ctx.fillRect(Math.round(myPos.x-1),Math.round(myPos.y+8),3,1);}
  ctx.restore();
  drawMinimap(en,players,isHost);
}
function vis(x,y,pad){return x>cam.x-pad&&x<cam.x+VW+pad&&y>cam.y-pad&&y<cam.y+VH+pad;}
function drawMinimap(en,players,isHost){
  const mw=64,mh=36,mx=VW-mw-6,my=6;
  ctx.globalAlpha=.75;
  ctx.fillStyle='#060810';ctx.fillRect(mx,my,mw,mh);
  ctx.strokeStyle='#2a3352';ctx.strokeRect(mx+.5,my+.5,mw-1,mh-1);
  const sx=mw/WW,sy=mh/WH;
  ctx.fillStyle='#ff4fd8';
  for(const e of en){const ex=isHost?e.x:e.dx,ey=isHost?e.y:e.dy;
    ctx.fillRect(mx+Math.round(ex*sx),my+Math.round(ey*sy),1,1);}
  for(const p of players){ if(p.dead)continue;
    const px=p.id===myId?myPos.x:(isHost?p.x:p.dx);
    const py=p.id===myId?myPos.y:(isHost?p.y:p.dy);
    ctx.fillStyle=p.id===myId?'#ffd35c':'#4ef0e8';
    ctx.fillRect(mx+Math.round(px*sx)-1,my+Math.round(py*sy)-1,2,2);}
  ctx.strokeStyle='rgba(107,115,150,.6)';
  ctx.strokeRect(mx+cam.x*sx,my+cam.y*sy,VW*sx,VH*sy);
  ctx.globalAlpha=1;
}

/* ---------------- HUD ---------------- */
/* host-side nexus integrity for the scoreboard */
function nexusPct(team){
  if(!S)return 0;
  const n=S.en.find(e=>e.k==='nexus'&&e.team===team&&e.hp>0);
  return n?Math.round(n.hp/n.maxhp*100):0;
}
function updateHUD(){
  let me=null,shards=0,wave=1,score=0;
  if(role!=='client'&&S){me=S.players.get(myId);wave=S.wave;score=S.score;shards=me?me.shards:0;}
  else if(V){me=V.players.get(myId);wave=V.wave;score=V.score;shards=me?me.shards:0;}
  if(me){$('hpbar').style.width=Math.max(0,me.hp/me.maxhp*100)+'%';
    const tp=role!=='client'?me.t/me.tMax*100:(me.t||0);
    $('tbar').style.width=clamp(tp,0,100)+'%';
    $('tbar').classList.toggle('lock',!!me.tLock);
    // shield bar only shows if you have any shield capacity
    const shMax=me.shieldMax||0;
    $('shwrap').style.display=shMax>0?'block':'none';
    if(shMax>0)$('shbar').style.width=clamp((me.shield||0)/shMax*100,0,100)+'%';
  }
  // Nexus Siege: the wave counter is meaningless, so the slot shows your
  // level instead and the XP bar appears under the T-charge bar.
  const siege=(role!=='client'?!!(S&&S.moba):!!(V&&V.mb));
  $('xpwrap').style.display=siege?'block':'none';
  $('hWaveLabel').textContent=siege?'LEVEL':'WAVE';
  if(siege&&me){
    const lv=me.lvl||1;
    const need=(role!=='client')?xpNeeded(lv):(me.xpNeed||0);
    $('xpbar').style.width=(need>0?clamp((me.xp||0)/need*100,0,100):0)+'%';
    $('hWave').textContent=lv;
  }else $('hWave').textContent=wave;
  $('hScore').textContent=score; $('hShards').textContent=shards;
  // upgrade readout — what the picked cards add up to
  const ups=myUpgrades||[];
  $('hUpgrades').innerHTML=ups.length?ups.map(u=>'<span>'+u+'</span>').join(''):'';
  // Nexus Siege scoreboard: kills + nexus integrity per side
  const mb=(role!=='client')
    ? (S&&S.moba?[nexusPct(0),nexusPct(1),S.mobaOver||0,(S.kills&&S.kills[0])||0,(S.kills&&S.kills[1])||0]:0)
    : (V&&V.mb);
  const siegeOn=!!mb;
  $('siegeBar').classList.toggle('hidden',!siegeOn);
  $('siegeNexus').classList.toggle('hidden',!siegeOn);
  if(siegeOn){
    for(let t=0;t<2;t++){
      $('sgName'+t).textContent=teamName(t);
      $('sgName'+t).style.color=teamColor(t);
      $('sgKills'+t).textContent=mb[3+t]||0;
      $('sgKills'+t).style.color=teamColor(t);
      const bar=$('sgBar'+t);
      bar.style.width=clamp(mb[t],0,100)+'%';
      bar.style.background=teamColor(t);
    }
  }
  // Boss healthbar. Suppressed entirely in a siege: nexuses and guardians are
  // flagged boss:true in the data, so this used to latch onto a structure and
  // stack on top of the siege HUD at top-centre. The nexus bars below the play
  // area cover that role there.
  let bnm='',bhp=0,hasBoss=false;
  if(!siegeOn){
    if(role!=='client'&&S){
      for(const e of S.en) if(e.boss&&e.hp>0){hasBoss=true;
        bnm=(ET[ETI[e.k]].bn||'BOSS')+(e.shielded?' ⛨ SHIELDED':'');bhp=e.hp/e.maxhp;break;}
    }else if(V){
      for(const e of V.en.values()) if(ET[e.ti]&&ET[e.ti].boss){hasBoss=true;
        bnm=(ET[e.ti].bn||'BOSS')+(e.shielded?' ⛨ SHIELDED':'');bhp=(e.hpp||0)/100;break;}
    }
  }
  $('bossWrap').classList.toggle('hidden',!hasBoss);
  if(hasBoss){$('bossName').textContent=bnm;$('bossBar').style.width=Math.max(0,bhp*100)+'%';}
  // objective banner
  const ov=getObjView();
  if(ov){const el=$('objBanner');
    el.classList.remove('hidden');
    el.textContent=objHudText(ov);
    el.classList.toggle('ok',ov.done===1);
    el.classList.toggle('bad',ov.done===-1);
  }else $('objBanner').classList.add('hidden');
  // weapon bar (host-side detail)
  if(role!=='client'&&S&&me){
    const wb=$('wpnbar');
    if(wb.childElementCount!==me.weapons.length||wb._sig!==me.weapons.map(w=>w.id+w.lvl).join()){
      wb._sig=me.weapons.map(w=>w.id+w.lvl).join();
      wb.innerHTML='';
      me.weapons.forEach(w=>{const d=document.createElement('div');
        d.className='wslot rar-'+w.rar; d.innerHTML=WPN[w.id].g+'<span>'+w.lvl+'</span>';
        wb.appendChild(d);});
    }
  }
  // pick timer
  if(pickDeadline>now()){
    $('pickTimer').textContent=Math.ceil((pickDeadline-now())/1000);
  }
}
