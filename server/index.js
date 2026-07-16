"use strict";
/* ============================================================
   server/index.js — bootstrap for the persistent "Battleground" server.

   Loads the SAME game files the browser loads as <script> tags
   (js/util.js, sfx.js, data.js, weapons.js, enemies.js, sim.js, net.js)
   into one shared vm context — exactly the shared-global-scope model
   index.html already relies on, just running headlessly under Node
   instead of in a browser tab, so the session survives independent
   of any one player's connection.

   IMPORTANT: top-level `let`/`const` bindings inside a vm context are
   NOT reachable as properties from outside it (only `var`/function
   declarations are) — so all the actual orchestration (WebSocket
   server, tick loop, connection handling) lives in serverMain.js and
   runs INSIDE this same context, referencing S/conns/role/mode/etc.
   as bare identifiers. This file only sets up the sandbox shims and
   loads scripts into it; it never reaches back into `context.*` for
   game state.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..'); // contains js/ and data/
const PORT = Number(process.env.PORT) || 8080;

/* ---- minimal DOM/browser shim ----
   Just enough that util.js/sfx.js/data.js/net.js don't throw when they
   touch document/addEventListener at load time, or when shared logic
   calls a UI helper (toast, updatePeerList) that has no UI to update
   here. None of it renders anything — this process never draws a frame. */
function fakeCanvasCtx(){
  return { fillRect(){}, strokeRect(){}, beginPath(){}, arc(){}, fill(){}, stroke(){},
    set fillStyle(v){}, get fillStyle(){return '';}, set strokeStyle(v){}, get strokeStyle(){return '';} };
}
const fakeDocument = {
  createElement: () => ({ width: 0, height: 0, getContext: () => fakeCanvasCtx() }),
  getElementById: () => null,
  addEventListener(){},
};

const context = vm.createContext({
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance,
  document: fakeDocument,
  addEventListener(){}, removeEventListener(){},
  require, // resolves relative to THIS file (server/), so require('ws') finds server/node_modules/ws
  SERVER_PORT: PORT,
  // data.js's fetchJson() does `await fetch(path).json()` — serve data/*.json straight off disk
  fetch: async (p) => {
    const text = fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  },
});

const GAME_FILES = ['util.js', 'sfx.js', 'data.js', 'weapons.js', 'enemies.js', 'sim.js', 'net.js'];
for (const f of GAME_FILES) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'js', f), 'utf8');
  vm.runInContext(src, context, { filename: f });
}

const mainSrc = fs.readFileSync(path.join(__dirname, 'serverMain.js'), 'utf8');
vm.runInContext(mainSrc, context, { filename: 'serverMain.js' });
