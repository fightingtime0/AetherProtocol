"use strict";
/* ============================================================
   sfx.js — procedural WebAudio sound effects (no assets).
   sfx(name)  — play locally (UI feedback, own dash, etc.)
   sfxE(name) — host-side game event: plays locally AND queues
                into S.sx so the next snapshot carries it to
                clients (applySnap plays it there).
   M toggles mute (persisted in save.mute).
   ============================================================ */
let AC=null, sfxGain=null;
const sfxLast={}, sfxBLast={};

function audioInit(){
  if(AC)return;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    AC=new Ctx();
    sfxGain=AC.createGain();
    sfxGain.gain.value=save.mute?0:.5;
    sfxGain.connect(AC.destination);
  }catch(e){}
}
/* browsers only allow audio after a user gesture */
addEventListener('pointerdown',()=>{audioInit();if(AC&&AC.state==='suspended')AC.resume();},true);
addEventListener('keydown',()=>{audioInit();if(AC&&AC.state==='suspended')AC.resume();},true);

function tone(o){ // {f0,f1,d,v,w,delay}
  if(!AC)return;
  const t0=AC.currentTime+(o.delay||0), d=o.d||.1;
  const osc=AC.createOscillator(), g=AC.createGain();
  osc.type=o.w||'square';
  osc.frequency.setValueAtTime(o.f0,t0);
  if(o.f1)osc.frequency.exponentialRampToValueAtTime(Math.max(1,o.f1),t0+d);
  g.gain.setValueAtTime(o.v||.12,t0);
  g.gain.exponentialRampToValueAtTime(.0001,t0+d);
  osc.connect(g); g.connect(sfxGain);
  osc.start(t0); osc.stop(t0+d+.02);
}
function noise(o){ // {f0,f1,d,v,ft,delay} — filtered white noise
  if(!AC)return;
  const t0=AC.currentTime+(o.delay||0), d=o.d||.2;
  const len=Math.max(1,Math.floor(AC.sampleRate*d));
  const buf=AC.createBuffer(1,len,AC.sampleRate);
  const ch=buf.getChannelData(0);
  for(let i=0;i<len;i++)ch[i]=Math.random()*2-1;
  const src=AC.createBufferSource(); src.buffer=buf;
  const f=AC.createBiquadFilter(); f.type=o.ft||'lowpass';
  f.frequency.setValueAtTime(o.f0||1200,t0);
  if(o.f1)f.frequency.exponentialRampToValueAtTime(Math.max(10,o.f1),t0+d);
  const g=AC.createGain();
  g.gain.setValueAtTime(o.v||.1,t0);
  g.gain.exponentialRampToValueAtTime(.0001,t0+d);
  src.connect(f); f.connect(g); g.connect(sfxGain);
  src.start(t0);
}
function arp(notes,step,d,v,w){ notes.forEach((f,i)=>tone({f0:f,d,v,w:w||'square',delay:i*step})); }

/* gap = min ms between plays of the same sound (throttles spam) */
const SFX={
  shoot:   {gap:60, f:()=>tone({f0:900,f1:240,d:.06,v:.035})},
  shootT:  {gap:70, f:()=>tone({f0:320,f1:110,d:.08,v:.045,w:'sawtooth'})},
  hit:     {gap:120,f:()=>tone({f0:230,f1:120,d:.05,v:.04})},
  kill:    {gap:80, f:()=>{tone({f0:440,f1:880,d:.07,v:.06});noise({f0:2200,f1:300,d:.09,v:.05,ft:'bandpass'});}},
  bosskill:{gap:400,f:()=>{noise({f0:1800,f1:60,d:.6,v:.25});arp([392,523,659,784,1047],.09,.22,.12);}},
  boom:    {gap:90, f:()=>{noise({f0:900,f1:60,d:.3,v:.18});tone({f0:120,f1:40,d:.25,v:.15,w:'triangle'});}},
  hurt:    {gap:150,f:()=>{tone({f0:200,f1:70,d:.18,v:.2,w:'sawtooth'});noise({f0:800,f1:120,d:.14,v:.1});}},
  shield:  {gap:120,f:()=>tone({f0:740,f1:420,d:.12,v:.09,w:'sine'})},
  down:    {gap:400,f:()=>arp([392,262,175,110],.11,.3,.16,'sawtooth')},
  heal:    {gap:150,f:()=>arp([523,784],.06,.12,.08,'sine')},
  shard:   {gap:70, f:()=>tone({f0:1046,f1:1568,d:.06,v:.05,w:'sine'})},
  chest:   {gap:250,f:()=>arp([523,659,784,1047],.07,.14,.09)},
  pick:    {gap:300,f:()=>arp([659,880],.08,.18,.09,'sine')},
  choose:  {gap:150,f:()=>arp([784,1175],.06,.12,.09)},
  dash:    {gap:180,f:()=>noise({f0:400,f1:2400,d:.14,v:.09,ft:'bandpass'})},
  deflect: {gap:110,f:()=>tone({f0:1300,f1:650,d:.05,v:.06})},
  surge:   {gap:250,f:()=>tone({f0:300,f1:1200,d:.2,v:.09,w:'sine'})},
  wave:    {gap:900,f:()=>arp([392,523,659],.09,.16,.09)},
  boss:    {gap:900,f:()=>{tone({f0:82,f1:55,d:.7,v:.22,w:'sawtooth'});tone({f0:110,f1:73,d:.7,v:.14,w:'square',delay:.12});}},
  objwin:  {gap:500,f:()=>arp([659,988],.09,.18,.1,'sine')},
  objfail: {gap:500,f:()=>arp([330,165],.11,.22,.1,'sawtooth')},
  gameover:{gap:900,f:()=>arp([220,165,110,55],.16,.4,.16,'sawtooth')},
  click:   {gap:60, f:()=>tone({f0:1000,f1:800,d:.035,v:.04,w:'sine'})},
};
function sfx(n){
  const s=SFX[n]; if(!s||!AC||save.mute)return;
  const t=now();
  if(t-(sfxLast[n]||0)<(s.gap||0))return;
  sfxLast[n]=t; s.f();
}
/* host game event: local playback + queue for clients (throttled) */
function sfxE(n){
  if(role==='client')return;
  sfx(n);
  if(S&&conns.length){
    const g=(SFX[n]&&SFX[n].gap)||0, t=now();
    if(t-(sfxBLast[n]||0)>=g&&S.sx.length<10){ sfxBLast[n]=t; S.sx.push(n); }
  }
}
/* ============================================================
   BGM — procedural, no assets, same synthesis approach as the SFX.
   A lookahead scheduler queues notes slightly ahead of the audio
   clock (setInterval alone is far too jittery for musical timing).
   Intensity rises with the wave and spikes for bosses: more layers,
   faster tempo, brighter lead. Runs on its own gain node so music
   and effects can be balanced (and muted) independently.
   ============================================================ */
let musGain=null, musTimer=0, musStep=0, musNext=0, musOn=false, musInt=0;
let musTrack=0, musTrackBars=0;
const MUS_VOL=.22;
/* A few tracks, cycled so a long match doesn't loop one four-bar phrase
   forever. Each is a root-per-bar progression plus the scale, timbre and
   tempo that give it its own character. Switches on a bar line, so the
   change lands musically instead of mid-phrase. */
const MUS_TRACKS=[
  { id:'descent', roots:[55,55,73.42,65.41],        // A1 A1 D2 C2 — the original
    scale:[0,3,5,7,10,12,15], bpm:96,  lead:'square',   bass:'sawtooth', arpEvery:2 },
  { id:'pursuit', roots:[61.74,61.74,82.41,73.42],  // B1 B1 E2 D2 — faster, brighter
    scale:[0,2,3,7,9,12,14],  bpm:116, lead:'square',   bass:'sawtooth', arpEvery:2 },
  { id:'vigil',   roots:[49,65.41,58.27,49],        // G1 C2 Bb1 G1 — slow, spacious
    scale:[0,3,7,10,12,15,19], bpm:84, lead:'triangle', bass:'triangle', arpEvery:4 },
  { id:'siege',   roots:[43.65,58.27,65.41,49],     // F1 Bb1 C2 G1 — dark, tense
    scale:[0,1,5,7,8,12,13],  bpm:104, lead:'sawtooth', bass:'sawtooth', arpEvery:2 },
];
const MUS_BARS_PER_TRACK=16;
const MUS=()=>MUS_TRACKS[musTrack%MUS_TRACKS.length];
const semi=(f,n)=>f*Math.pow(2,n/12);

function musNote(f,t0,d,v,w,dest){
  const osc=AC.createOscillator(), g=AC.createGain();
  osc.type=w; osc.frequency.setValueAtTime(f,t0);
  g.gain.setValueAtTime(0,t0);
  g.gain.linearRampToValueAtTime(v,t0+.012);   // tiny attack — avoids clicks
  g.gain.exponentialRampToValueAtTime(.0001,t0+d);
  osc.connect(g); g.connect(dest||musGain);
  osc.start(t0); osc.stop(t0+d+.02);
}
function musDrum(t0,v,f0,f1,d){
  const osc=AC.createOscillator(), g=AC.createGain();
  osc.type='sine';
  osc.frequency.setValueAtTime(f0,t0);
  osc.frequency.exponentialRampToValueAtTime(f1,t0+d);
  g.gain.setValueAtTime(v,t0);
  g.gain.exponentialRampToValueAtTime(.0001,t0+d);
  osc.connect(g); g.connect(musGain);
  osc.start(t0); osc.stop(t0+d+.02);
}
function musHat(t0,v){
  const n=AC.sampleRate*.03, buf=AC.createBuffer(1,n,AC.sampleRate), ch=buf.getChannelData(0);
  for(let i=0;i<n;i++)ch[i]=(Math.random()*2-1)*(1-i/n);
  const src=AC.createBufferSource(); src.buffer=buf;
  const f=AC.createBiquadFilter(); f.type='highpass'; f.frequency.value=6000;
  const g=AC.createGain(); g.gain.value=v;
  src.connect(f); f.connect(g); g.connect(musGain);
  src.start(t0);
}
/* one 16th-note step */
function musSchedule(step,t0){
  const T=MUS();
  const bar=Math.floor(step/16)%T.roots.length, root=T.roots[bar];
  const i=musInt; // 0..1
  const b=step%16;
  if(b%4===0) musDrum(t0,.5,150,45,.16);                    // kick on every beat
  if(i>.25&&b%8===4) musDrum(t0,.28,320,140,.10);           // snare-ish backbeat
  if(i>.45&&b%2===1) musHat(t0,.05+i*.05);                  // offbeat hats
  if(b%8===0) musNote(root,t0,.55,.16,T.bass);              // bass root
  if(i>.15&&b%8===6) musNote(semi(root,7),t0,.28,.10,T.bass);
  // arpeggio: denser and brighter as intensity climbs
  if(i>.3&&b%T.arpEvery===0){
    const deg=T.scale[(step*3+bar)%T.scale.length];
    musNote(semi(root*4,deg),t0,.16,.045+i*.03,T.lead);
  }
  if(i>.7&&b%4===2){ // high counter-line only when things are hectic
    const deg=T.scale[(step*5+1)%T.scale.length];
    musNote(semi(root*8,deg),t0,.10,.028,'triangle');
  }
}
function musTick(){
  if(!AC||!musOn||!musGain)return;
  const T=MUS();
  const stepDur=(60/(T.bpm+musInt*40))/4;   // tempo lifts with intensity, sixteenths
  while(musNext<AC.currentTime+.12){        // 120ms lookahead
    if(musNext<AC.currentTime)musNext=AC.currentTime+.02; // recover from a stalled tab
    musSchedule(musStep,musNext);
    musStep++; musNext+=stepDur;
    // advance to the next track on a bar line so the switch lands musically
    if(musStep%16===0){
      musTrackBars++;
      if(musTrackBars>=MUS_BARS_PER_TRACK){ musTrackBars=0; musTrack++; musStep=0; }
    }
  }
}
/* Intensity from the live sim: wave progress, plus a big lift for bosses.
   Host reads S, client reads its interpolated view V. */
function musUpdateIntensity(){
  let tgt=0;
  const w=(role==='client'?(V&&V.wave):(S&&S.wave))||0;
  tgt=Math.min(.75,w*.05);
  const boss=role==='client'
    ? !!(V&&[...V.en.values()].some(e=>ET[e.ti]&&ET[e.ti].boss))
    : !!(S&&S.en.some(e=>e.boss));
  if(boss)tgt=Math.min(1,tgt+.45);
  musInt+=(tgt-musInt)*.05; // ease, so a boss dying doesn't cut the music dead
}
function musicStart(){
  audioInit();
  if(!AC)return;
  if(!musGain){
    musGain=AC.createGain();
    musGain.gain.value=save.mute?0:MUS_VOL;
    musGain.connect(AC.destination);
  }
  if(musOn)return;
  // start somewhere different each run rather than always on track 0
  musTrack=Math.floor(Math.random()*MUS_TRACKS.length); musTrackBars=0;
  musOn=true; musStep=0; musInt=0; musNext=AC.currentTime+.1;
  clearInterval(musTimer);
  musTimer=setInterval(()=>{musUpdateIntensity();musTick();},25);
}
function musicStop(){
  musOn=false;
  clearInterval(musTimer); musTimer=0;
  if(musGain){ // fade out rather than cut, so returning to the title isn't jarring
    try{ const t=AC.currentTime;
      musGain.gain.cancelScheduledValues(t);
      musGain.gain.setValueAtTime(musGain.gain.value,t);
      musGain.gain.linearRampToValueAtTime(0,t+.35);
      setTimeout(()=>{if(!musOn&&musGain)musGain.gain.value=save.mute?0:MUS_VOL;},450);
    }catch(e){}
  }
}
/* soft click on any UI button */
document.addEventListener('click',e=>{
  if(e.target&&e.target.closest&&e.target.closest('.pxbtn,.chip,.swatch,.dsc'))sfx('click');
},true);
/* M = mute toggle (ignored while typing in an input) */
addEventListener('keydown',e=>{
  if(e.code!=='KeyM'||(e.target&&e.target.tagName==='INPUT'))return;
  save.mute=!save.mute; persist();
  if(sfxGain)sfxGain.gain.value=save.mute?0:.5;
  if(musGain)musGain.gain.value=save.mute?0:MUS_VOL;
  toast(save.mute?'🔇 Sound muted':'🔊 Sound on');
});
