"use strict";
/* ============================================================
   server/serverMain.js — runs INSIDE the shared vm context set up by
   index.js, so it can reference S, conns, lobby, role, mode, diffKey,
   hostOnData, hostUpdate, newSim, bcast, snap, pruneStalePeers,
   bcastRoster, now(), toast — the same globals sim.js/net.js already
   use — as bare identifiers, not context.* properties (see the note
   in index.js for why that split exists).

   Every connection here is a network client — there is no "local
   host player." That's not a special case: it's the same trust model
   the browser co-op host already extends to remote allies (client
   reports its own position and, since the hit-detection change, its
   own hits), just with EVERY player on that path instead of one.
   ============================================================ */
const { WebSocketServer } = require('ws');

toast = () => {};          // no local UI to show these on a headless server —
updatePeerList = () => {}; // real messages still reach real players via bcast()/sendTo()

async function startBattleground(port) {
  await loadData();
  diffKey = 'infinity';  // Battleground is infinity-tuned
  role = 'host';         // satisfies every `role!=='client'` check; pruneStalePeers() requires this exact value
  mode = 'play';         // so hostOnData's late-join branch (mode==='play'&&S) fires for every new connection
  newSim([], { pvp: true, persistent: true });

  const wss = new WebSocketServer({ port });
  console.log('[battleground] listening on ws://0.0.0.0:' + port);

  wss.on('connection', (ws) => {
    const conn = {
      _pid: undefined,
      _lastIn: now(),
      send: (obj) => {
        if (ws.readyState === ws.OPEN) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
      },
    };
    ws.on('message', (raw) => {
      let d;
      try { d = JSON.parse(raw); } catch (e) { return; }
      try { hostOnData(conn, d); } catch (e) { console.error('[battleground] hostOnData error', e); }
    });
    const drop = () => {
      conns = conns.filter((c) => c !== conn);
      lobby.players = lobby.players.filter((p) => p.id !== conn._pid);
      if (S) S.players.delete(conn._pid);
      bcastRoster();
    };
    ws.on('close', drop);
    ws.on('error', drop);
  });

  let last = now();
  setInterval(() => {
    const t = now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (S && !S.over) hostUpdate(dt);
  }, 1000 / 30);

  setInterval(() => {
    if (conns.length) bcast(snap());
  }, 1000 / 20);

  setInterval(() => { pruneStalePeers(); }, 2000);
}

startBattleground(SERVER_PORT).catch((e) => {
  console.error('[battleground] fatal', e);
  process.exit(1);
});
