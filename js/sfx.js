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
/* soft click on any UI button */
document.addEventListener('click',e=>{
  if(e.target&&e.target.closest&&e.target.closest('.pxbtn,.chip,.swatch,.dsc'))sfx('click');
},true);
/* M = mute toggle (ignored while typing in an input) */
addEventListener('keydown',e=>{
  if(e.code!=='KeyM'||(e.target&&e.target.tagName==='INPUT'))return;
  save.mute=!save.mute; persist();
  if(sfxGain)sfxGain.gain.value=save.mute?0:.5;
  toast(save.mute?'🔇 Sound muted':'🔊 Sound on');
});
