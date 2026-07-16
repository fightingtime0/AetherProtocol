"use strict";
/* ============================================================
   main.js — boot sequence + game loop.
   Loads all data/*.json registries, then initializes the UI.
   ============================================================ */
let last=now(), sendAcc=0, snapAcc=0, pruneAcc=0;
function loop(){
  const t=now(); const dt=Math.min(.033,(t-last)/1000); last=t;
  if(mode==='play'){
    moveLocal(dt);
    if(role!=='client'&&S&&!S.over){ hostUpdate(dt);
      snapAcc+=dt; if(snapAcc>=.05&&conns.length){snapAcc=0;bcast(snap());} // 20Hz snapshots
      pruneAcc+=dt; if(pruneAcc>=2){pruneAcc=0;pruneStalePeers();} }
    if(role==='client'){ sendAcc+=dt;
      checkLocalHits(); // per-frame: did a bullet/enemy touch ME on MY screen?
      if(sendAcc>=.033&&conns[0]&&conns[0].open){sendAcc=0;                 // 30Hz input
        conns[0].send({t:'in',x:Math.round(myPos.x),y:Math.round(myPos.y),inv:myPos.inv>0?1:0});}}
    updateHUD();
  }
  render();
  requestAnimationFrame(loop);
}

async function boot(){
  await loadData();
  // validate save against loaded data
  if(!DIFFS[save.diff])save.diff=Object.keys(DIFFS)[0];
  diffKey=save.diff;
  save.unlocked=save.unlocked.filter(id=>CLASSES.some(c=>c.id===id));
  for(const c of CLASSES)if(c.cost===0&&!save.unlocked.includes(c.id))save.unlocked.push(c.id);
  if(!save.unlocked.includes(save.cls))save.cls=save.unlocked[0]||CLASSES[0].id;
  initUI();
  requestAnimationFrame(loop);
}
boot().catch(e=>{
  console.error(e);
  document.body.innerHTML='<div style="color:#ff5c47;font-family:monospace;padding:24px">'+
    '<h2>AETHER//PROTOCOL failed to load</h2><p>'+String(e).replace(/</g,'&lt;')+'</p>'+
    '<p>Game data could not be fetched — if you opened index.html directly from disk, serve it instead '+
    '(e.g. <code>npx serve</code>) or deploy to Vercel/GitHub Pages.</p></div>';
});
