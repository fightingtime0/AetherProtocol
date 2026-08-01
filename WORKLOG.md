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

## <2026-08-01 07:20 / session 1 / update #12> - flail swing, dodge-at-end, energy styles, training range

**Changed**
- **Flail**: square heads that appear **one at a time** across the arc (a swing,
  not a row of blocks), and its dodge area now lands **when the dash ends**.
- **Dodge-at-end phase**: `onDodgeEnd()` resolves weapons flagged `dodgeAtEnd`,
  so the payoff lands where the dodge *put* you. Quake now leaves a **delayed**
  stomp there.
- **Saber dodge** replaced: the blades **hold still** through the dash, then
  snap through one fast full revolution as a finisher. (The afterimage trail
  from #11 is gone.)
- **Arc Tendril** (was Leech): shorter reach, **no lifesteal**.
- **Beam** is short-range now; its dodge fires the long-range shot instead.
- **Energy**: below 1 charge it **always** reloads, whatever the regen relic.
  Charge relics carry exclusive `style` tags — take one and the entire family
  stops appearing.
- **Nanite Coil → Nanite Virus**, its dodge cloud is green.
- **Training range**: pick any weapon, level, rarity and relics, then fight
  respawning dummies. Press **T** in the range to rebuild. Nothing is saved.

**Why / root causes**
- **Servitors stuck on defence**: the seeker's `rally` dodge called
  `advanceServitors()` a *second* time, so a Swarmherd's dodge advanced the
  posture twice and landed straight back on guard.
- Training revival is done in `hostUpdate`, not only in `hurt()`, so nothing
  can strand you dead in a sandbox that has no respawn timer.

**Risk**
- The training range is new UI with no browser testing at all.
- Exclusive relic styles change build variety significantly — worth checking
  the pick pool doesn't feel thin once a style is committed.

---

## <2026-08-01 06:30 / session 1 / update #11> - saber fixes, universal dodge, new weapons, bigger FOV

**Changed**
- Saber: no longer parries friendly fire; burn now **lingers 0.35s** after the
  blade sweeps past (dps 16 → 26, arc 0.5 → 0.62); dodge leaves **afterimages
  printed along the whole dash** instead of a few scattered blades.
- Servitors: postures now advance **on dodge** (a command, not ambient drift),
  and player bullets can finally hit them.
- Orbiting Fang renamed **Orbit Drones**; **every** weapon now has a dodge
  reaction (17 distinct ones).
- Five genuinely new archetypes — `flail`, `prism`, `mortar`, `leech`, `quake`
  — replacing the reskinned classes, which now use them. Every class carries a
  prepared `size` field (nothing reads it yet; slower classes are larger).
- Field of view 480×270 → **672×378**.
- Mobile: the pick screen sits above the touch stick and hides it while open.

**Why / root causes**
- **The saber ate friendly bullets** because the enemy-bolt deflect loop had no
  team check at all — only the player-bullet parry did. Team-tagged creep and
  turret fire from your own side counted as deflectable.
- **Servitors seemed to take damage "sometimes"** because player bullets never
  collided with them at all; only enemy bolts and lasers did.
- The stuttering saber damage was **not** an optimisation: the arc is narrow and
  the blade sweeps ~1.1 rev/s, so contact is genuinely intermittent. The linger
  is what makes it read as continuous.
- FOV was raised rather than shrinking weapon ranges, which would have punished
  the long-range weapons. Kept 16:9; a square viewport is a one-line change in
  `util.js` if wanted.

**Risk**
- The five new weapons and 17 dodge reactions are all untested by feel; only
  that they fire, dodge and don't throw.
- 672×378 is a 1.4× view — worth checking it doesn't make the game feel zoomed
  out or hurt performance with the larger draw area.

---

## <2026-08-01 05:40 / session 1 / update #10> - the Arbiter, dodge reactions, servitor overhaul

**Changed**
- **THE ARBITER** — neutral third faction (`TEAM_WILD=2`). Sweeps corner to
  corner after creep wave 15, multi-part with four orbiting shards that shield
  its core. Ignored for 15s it **roots into a hive**: stops moving, spawns its
  own brood, and becomes a third nexus — killing it in that state ends the
  match as a double win. Twin independent lances. Drops 6 chests (12 as a hive)
  and grants XP to the killing team.
- Gravity well: lower start (0.5) and overall damage, slow softened 0.55 → 0.90
  but now **stacks** multiplicatively with a floor so it can never fully root.
- Saber: blades **dim when the charge cell runs dry** and cost charge to
  relight; a dim blade cannot parry (the PvP half of the request).
- Dodge reactions: dashing **hurls** orbiting fangs at the nearest foe, and
  leaves short-lived **ghost blades** that each land one modest hit.
- Servitors: full posture cycle (guard → hunt → guard → roam), attack hostile
  players and rival servitors, fire projectiles while roaming, and contribute
  **no** contact damage once tethered out — only the detonation counts.
- 5 new classes (12 total), mercenary model + miniboss size, siege lord drops a
  cache, ranged creeps hit harder, charges move faster, Sanctum pays 45%
  outside a siege, heavier weapons get chunkier rounds and spark particles.

**Why**
- Two of the requests conflicted: dimming the saber on its *swing* cooldown
  suppressed the contact burn added in #9 entirely, since the cooldown starts
  the instant a burst lands. Dimming is now a **charge** event, not a cadence
  event — the blade goes out when the cell empties, which is also what makes
  "it takes energy to relight" mean something.
- The Arbiter is r=20 against ~8px cover and pinned itself on rocks mid-sweep,
  so `wild` entities skip obstacle collision.

**Risk**
- The Arbiter is a large, entirely unplayed system: sweep pacing, hive timing,
  double-win flow and reward sizes are all first guesses.
- Servitor posture timings (3s each) and the guard stand-off distance are
  untuned; a servitor now spends half its cycle near its owner rather than
  attacking, which may feel passive.

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
