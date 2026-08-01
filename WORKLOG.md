# AETHER//PROTOCOL — work log

Running record of what changed and why. **Newest entry at the top.**

## Convention

One entry per update, headed:

```
<YYYY-MM-DD HH:MM / session N / update #M> - short summary
```

Then, briefly:

- **Changed** — what was actually done
- **Why** — the reasoning, especially any root cause found
- **Risk** — what is untested or uncertain

Keep root causes in here. The bug is cheap to re-fix; working out *why* it
happened is the expensive part, and that is what gets lost between sessions.

Deeper background, the forward plan and the operational gotchas live in
`../../AETHER-PROTOCOL-WORKLOG.md` (outside the repo). Test suites live in
`../../tests/` — run `node run-all.js`.

---

## <2026-08-01 04:40 / session 1 / update #9> - saber rework, fang speed, HUD de-overlap

**Changed**
- Saber: cadence 0.55s → **0.72s** (slower). Now deals damage two ways —
  **entering** the blades is a burst carrying all banked parry damage,
  **staying** in them is a damage-over-time tick (16 dps) on the shared DoT
  cadence.
- Saber no longer destroys friendly bullets: it only parries fire from a
  *known hostile* shooter. An unknown owner is left alone too.
- Orbiting Fang spin 2.2 → **3.2** rad/s (faster sweep).
- HUD: top-centre now shows **kills only**. Nexus integrity moved to two
  coloured bars **below the play area**. The classic boss bar is suppressed
  during a siege.

**Why**
- The siege bar and `#bossWrap` were both `top:8px; left:50%` — they stacked.
- Worse, `nexus`/`basebss` are flagged `boss:true` in `enemies.json`, so the
  classic boss bar was also latching onto siege structures and rendering a
  third overlapping element.

**Risk**
- Saber burst-vs-tick split is new logic; the entry burst is gated on the swing
  cooldown so skimming the arc can't re-trigger it, but that interaction is
  untested by feel.
- All HUD positioning is unverified in a browser.

---

## <2026-08-01 03:50 / session 1 / update #8> - laser ramp, charge damage, team bullet colour

**Changed** Structure lasers ramp 0.35→1.75 over 2.2s and reset on target
switch. Charge damage 16→44 global, 70 guardians / 55 siege lords. Bullets are
team-coloured with shape-coded weapon identity (6 shapes). Saber parries hostile
player bullets. Gravity well trades damage for a 45% slow.

**Why / root causes found**
- **Host movement speed was frozen at run start** — `myPos.spd` captured once
  and never refreshed, so speed upgrades never applied to the host at all.
  Pre-existing, unrelated to the siege. Now recomputed each tick via
  `effSpeed()`, which is also how the slow reaches host and snapshot alike.
- The gravity well mired its own caster; it now skips the caster and their side,
  and only affects players in PvP modes.

---

## <2026-08-01 02:55 / session 1 / update #7> - DoT cadence, positional audio, HUD additions

**Changed** One shared 0.22s DoT cadence across zones/lasers/poison/servitors.
Gravity well ramps 1→peak. Positional sound falloff. Servitor 3-2-1 self-destruct
fuse. Siege scoreboard, upgrade readout, always-on structure HP bars, shop pad
labels.

**Why / root causes found**
- **Servitors suicided on a loop**: they chased the nearest hostile *anywhere*,
  walked out of tether, detonated, repeated. They now only hunt inside tether.
- **Assist XP rounded to zero** — `Math.round(4 × 0.10)` = 0, so creep kills gave
  allies nothing. XP now accumulates fractionally.

---

## <2026-08-01 01:30 / session 1 / update #6> - weapon reworks, shard shop

**Changed** Orbiting Fang → charge-cost summon that orbits wide and detonates.
Saber → discrete strikes fed by parries. Smite → shrinking telegraph that locks a
spot. Chain → travelling bolt with drawn arcs. Servitors targetable + tethered.
Creeps sweep a wider area. Shard shop pads. 17 per-weapon sounds. Speed-derived
bullet trails.

**Why / root causes found**
- **Orbiting Fang gave 1 blade at level 2**: `cnt()` floors `per*(lvl-1)`, so
  `per:0.5` yields `floor(0.5)=0`. Changed to `per:1`.
- **Bots were invulnerable for 10s after every level-up** — `startPick` set
  `pickInvUntil` before the bot branch returned.
- **A bot could be forced into an unsafe passive** when all three rolls were
  T-charge specials; bots now never see them.

---

## <2026-08-01 00:40 / session 1 / update #5> - boss wave, thinner lane, music tracks

**Changed** Siege lord miniboss every 3rd creep wave. Map 620→400 tall. Four
cycling BGM tracks. Laser dps softened.

**Why** The laser retune mattered far more than the number suggested — see #4.

---

## <2026-08-01 00:05 / session 1 / update #4> - energy deadlock, laser immunity, tankier structures

**Changed** Structures ~10× HP with creep-first targeting. Lasers on all three
structure types. Servitor team filter.

**Why / root causes found**
- **DoT rounding floor**: `hurt()` rounded damage and enforced a 1-damage
  minimum, so *any* per-frame DoT was pinned at ~60 dps regardless of tuning.
  This is why halving the laser's dps "did nothing", and it silently affected
  every continuous weapon in the game.
- **Laser granted i-frames every tick** → standing in a beam made you immune to
  everything. DoT now grants no i-frames but is still blocked by them.
- **T-charge deadlock**: Redline Cell's leak and Kinetic Battery's standing
  bleed kept draining *while locked*, so charge never reached `tMax` and the
  player was stranded at zero energy permanently. Drains now suspend while
  locked, `tMax` has a floor, plus a 12s watchdog.

---

## <2026-07-31 23:10 / session 1 / update #3> - PvP damage paths

**Why / root causes found**
- **Non-projectile weapons could not touch players at all** — booms, beams,
  chains, orbits, sabers, drones and zones all iterated `S.en` only.
- **`needT` weapons could not target players**, so aimed weapons could never
  lock onto an enemy player. Likely the main cause of "I can't attack them".
- **The host was bulletproof**: player-bullet-vs-player was resolved only for
  remote clients, and **bots were resolved by nobody**.
- **`respawnPersistent` wiped `team`**, so after one death a siege player turned
  neutral and could shoot their own nexus.

---

## <2026-07-31 21:30 / session 1 / update #2> - Nexus Siege stages 1 & 2

**Changed** Team model, lane map, nexus/guardians/turrets, win condition, lobby
team select, creeps, bots.

**Why** The team model is deliberately additive: `team === undefined` means
"classic PvE actor" and `hostile()` returns true for it in every direction, so
every pre-existing mode is untouched *by construction* rather than by patching.

---

## <2026-07-31 19:00 / session 1 / update #1> - NAT traversal fixed

**Changed** ExpressTurn credentials, staged link watchdog, ICE path logging,
latency compensation, procedural BGM.

**Why** The Open Relay TURN servers are **dead** — verified by sending real STUN
Binding and TURN Allocate packets; they answer nothing on any port while Google
STUN replies instantly. The widely-copied `openrelayproject` credentials point at
nothing.

**Note for future** Never change TURN config without running
`../../tests/diag-turn-auth.js` first. A bad TURN setup fails *silently* on the
same-network path you test on and only breaks for players you cannot reproduce.
