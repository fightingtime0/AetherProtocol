# AETHER//PROTOCOL

A pixel-art, peer-to-peer co-op **bullet-hell wave survival** game that runs entirely in the browser.
No build step, no backend — static files only, deployable straight to **Vercel** or GitHub Pages.

Play solo or share a 4-letter room code with friends (co-op is peer-to-peer via PeerJS; the host runs the simulation).

---

## Gameplay loop

1. **Title → START → pick a difficulty** → play solo, or host/join a co-op room.
2. **Survive waves.** Enemies spawn on a budget that grows each wave. Weapons auto-fire; your job is movement, dodging, and resource pacing.
3. **Clear a wave → Attune.** Time freezes and each living player picks 1 of 3 cards: a new weapon, a weapon upgrade, or a relic (passive). Weapon slots grow to 2 at wave 5 and 3 at wave 10.
4. **Every 5th wave is a boss** (with its own healthbar). Bosses rotate through a pool; some bosses send **unique minions** ahead of them in the two preceding waves.
5. **Random side objectives** (some waves): slay quotas, no-damage, hold-the-circle, speed clears, shard harvests — completing one pays every player bonus shards. The toast when one rolls always states the exact goal number, the time limit, and the fail condition in one line (see `objIntro()` in `sim.js`); the HUD banner then tracks live progress.
6. **Die.** Your shards bank permanently. Spend them in the **Sanctum** (permanent stat ranks) or the **Character Forge** (unlock new classes). Descend again, deeper.

## Mechanics

### Resources
- **Health (red/gold bar)** — the run ends when everyone is down. Downed allies revive at the next wave.
- **Shield (blue bar)** — sits *on top of* health and absorbs damage first. Only regenerates after you avoid damage for a few seconds (`balance.json → player.shield`). Granted by classes, relics, and Sanctum ranks — base kit has none.
- **Armor** — flat damage reduction applied to every hit before shields (each hit always deals at least 1). From classes, the Rune Plating relic, and Iron Plating Sanctum ranks.
- **T-charge (cyan bar)** — powers every non-melee weapon from a single reactor cell. Low capacity by default and does **not** regenerate while you still have some left: once it fully depletes, it locks and fast-recharges to full (bar shows hatched while locked). Burst → brief downtime → burst. Relics branch this three ways: **Capacitor Bank** (flat +max), **Flux Generator** (drops the hard lock for constant slow trickle regen instead), and **Redline Cell** (−50% max, 4× faster recharge once tripped, but leaks charge even while idle).
- **Melee/orbit weapons** (sabers, fangs) cost nothing.

### Skill expression
- **Dash** (SPACE) grants brief i-frames. Absorbing an enemy bolt with those i-frames triggers a **Phase Surge** — a temporary damage boost (`player.surge`).
- **Aether Saber** blades physically deflect enemy bullets in their sweep.
- **Chaos Servitors** are deployable drones that ram enemies and *soak enemy fire* — position them as mobile cover.

### Co-op
- Host picks difficulty in the lobby; everyone sees the room code + linked players.
- Co-op-only relics (marked `"mp": true` in `passives.json`) appear only with 2+ players: healing auras, damage auras, shard tithes.
- Late joiners drop straight into the running game.

### Difficulties
`normal` is tuned for casual play; `scenario` and `infinity` raise enemy budget, HP, damage, and bullet speed (aggression), and add BIG bosses / the world Titan. All knobs per difficulty live in `data/difficulties.json`.

### Battleground (persistent PvPvE)
A fourth mode alongside solo/host/join: a 24/7 free-for-all, `infinity`-tuned,
running on a real always-on server instead of a player's browser tab (see
`server/`) — enemies AND other players can hurt you. Die and you respawn at a
random spot with a clean slate (weapons back to level 1, no relics) and 10s
of invincibility. Enter a server address (`wss://...`) on the setup screen to
join one; see `server/README.md` to host your own.

### Fair hits in multiplayer
Each client detects when a bullet or enemy touches *its own* screen (same
position it's rendering, not the host's slightly-ahead simulation) and
reports that touch; the host still decides the consequence — i-frames,
armor, shield, Phase Surge — it just never judges a hit against a position a
player never actually saw land on their own client.

---

## Repository layout

```
index.html          markup shell + script tags (no game logic)
css/style.css       all styling
js/
  util.js           helpers, save file, shared state, world gen
  data.js           JSON loader → live registries, stat & scaling engine
  weapons.js        weapon behavior archetypes (see "type" below)
  enemies.js        enemy AI implementations (see "ai" below)
  sim.js            host-authoritative simulation (waves, damage, picks, objectives)
  net.js            PeerJS co-op: lobby, snapshots, client view
  render.js         canvas renderer, minimap, HUD
  ui.js             screens, menus, character editor, input
  main.js           boot + game loop
data/
  balance.json      every tuning number (regen rates, surge, drones, waves, objectives…)
  difficulties.json difficulty definitions
  classes.json      classes: cost, starting weapon, stat modifiers
  weapons.json      weapons: resource costs, damage/count/cooldown scaling
  enemies.json      enemies & bosses: stats, AI key, sprite, spawn-pool spec
  passives.json     relics offered during Attune picks
  meta.json         Sanctum permanent upgrades
  sprites.json      extra non-enemy sprites (e.g. the servitor drone)
legacy/             the original single-file version, kept for reference
server/             persistent Battleground server (Node + WebSockets) — see server/README.md
```

**Content is data-driven.** The engine builds all registries from `data/*.json` at boot — adding an entry is enough for it to appear in the game. No JS changes needed unless you want a brand-new *behavior* (weapon type / enemy AI).

---

## Adding & editing content

### Weapons (`data/weapons.json`)
Add an object with a unique `id` and a `type` from:
`aimed`, `radial`, `lance`, `scatter`, `lob`, `chain`, `smite`, `zone`, `drone`, `orbit`, `saber`,
`beam` (continuous laser — ticks fast, drains T-charge per tick, hits everything along the line),
`wave` (sine-weaves toward its target, snaking through a cluster), `boomerang` (flies out, then
curves back to whoever threw it, hitting on both legs).
It automatically joins the Attune pick pool and chest drops.

- `resource`: `"t"` (T-charge — every non-melee weapon shares the one pool) or `"none"`; `cost` = per shot (per *tick* for `beam`).
- Scaling specs (level 1 always equals `base`):
  - value `{base, flat, perLvl}` → `(base + flat·(lvl−1)) · (1 + perLvl·(lvl−1))`
  - count `{base, per}` → `base + floor(per·(lvl−1))`
  - cooldown `{base, perLvl, min}` → `max(min, base − perLvl·(lvl−1))`
- `desc` supports tokens that render with live values: `{count} {dmg} {pierce} {boom} {hops} {pois} {dps} {radius} {hp} {blades}`.

### Classes (`data/classes.json`)
A class is: `id`, `glyph`, `name`, `cost` (0 = unlocked from the start; >0 = shard price in the Character Forge), `theme`, `weapon` (starting weapon id), and `stats`.
**The class-select description is generated from `stats`** — edit a number and the UI text updates itself. Available stat keys:

| additive | multiplicative |
|---|---|
| `maxhp`, `armor`, `shieldMax`, `tMax`, `crit`, `regen`, `mag` (pickup px), `auraRegen`, `auraDmg`, `tithe` | `dmgM`, `cdM` (lower = faster), `spd`, `greed`, `dashCd` (lower = shorter), `bspdM`, `tRchM` (T-charge recharge rate), `droneHpM`, `dmgTakenM` |

Relics that can't be expressed as a plain stat (Flux Generator, Redline Cell, Vent Capacitor, Ghost Rounds, Kinetic Battery) use a `"special"` id instead of `"stats"` in `passives.json`, resolved through `SPECIAL_PASSIVES` in `sim.js`.

The same keys work in `passives.json` (per pick) and `meta.json` (per Sanctum rank; multiplicative stats compound per rank).

### Enemies & bosses (`data/enemies.json`)
Each entry has stats, an inline pixel `sprite` (`pal` + `rows`), and an `ai` key implemented in `js/enemies.js`
(`imp, skull, turret, wisp, slash, charge, brute, warlock, obelisk, sporeling, wraith, weldbot, herald, colossus, seraph, hive, reaper, forge, serpent, monarch, pylon, dreadnought, titan`). Reuse any `ai` for a new enemy — new stats + sprite, zero code.

- `pool: {minWave, weight, cost}` → joins normal wave spawns automatically.
- `mini: true` → becomes a "guardian" that can ambush long waves.
- `interlude: true` → spawns periodically as an optional bonus target (obelisk-style).
- `boss: true` + `bossName` → gets the big healthbar; add `inRotation: true` to join the every-5-waves rotation (order in the file = fight order); add `minion: "<enemy id>"` and that minion escorts the boss **and infiltrates the two waves before it**.
- `unique: true` marks boss-bound minions (excluded from generic pools).
- **Multi-part bosses**: give a boss entry `"parts": ["<enemy id>", ...]` (repeat an id for multiple copies, e.g. two `pylon`s). Each listed part spawns alongside the boss, tagged with `core` = the boss's runtime id. While *any* part is still alive the core takes only `combat.shieldedDmgFrac` of incoming damage (see `damageE()` in `sim.js`) and the HUD boss bar shows `⛨ SHIELDED`; killing the last part flips a one-time "CORE EXPOSED" toast. Parts mark themselves `"partOf": true` (documentation only — they're excluded from generic spawn pools simply by having no `pool` spec) and get their own `ai` in `enemies.js`. See `dreadnought`/`pylon` for the reference implementation: the pylons orbit the core (`balance.json → combat.pylon`) and must be shot down before the core itself takes real damage.

### Balance (`data/balance.json`)
One file, every knob: base HP/speed, **T-charge** (`player.t.start/rechargeRate/genRate`), shield delay/rate, dash & Phase Surge, drone/orbit/saber/pylon combat shapes, wave budget math, objective goals & rewards, meta price growth. Change a number, refresh, done.

---

## Development

```bash
npx serve          # or: python -m http.server
```
Open the printed localhost URL. (Opening `index.html` from disk won't work — the game fetches `data/*.json`, which requires HTTP.)

**Deploy:** push to GitHub and import into Vercel as a static project (no framework, no build command, output dir = repo root). Co-op needs HTTPS hosting (PeerJS), which Vercel provides out of the box.

**Multiplayer protocol note:** any new field synced to clients must be added to *both* `snap()` and `applySnap()` in `js/net.js` — they encode/decode the same positional arrays.
