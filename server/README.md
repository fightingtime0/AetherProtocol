# Battleground server — deploy to an Oracle Cloud Free Tier VM

This runs the **same** host-authoritative sim the browser co-op host runs
(`js/util.js`, `sfx.js`, `data.js`, `weapons.js`, `enemies.js`, `sim.js`, `net.js`),
loaded into Node instead of a browser tab, so the game keeps running whether
anyone's connected or not. Transport is plain WebSockets, not PeerJS/WebRTC —
a real always-on server doesn't need NAT traversal.

Every player is a network client here — there's no "local host player" the
way a browser co-op host has one. Damage is resolved through the same
client-self-report path already used for remote co-op allies (each client
detects hits against what it renders, the server owns the consequence:
i-frames, armor, phase surge, PvP damage). That's an existing trust model,
not something new introduced for the server — a client that never reports a
hit against itself simply never takes that hit. Fine for friends; know the
limit if you open this to strangers.

## 1. Get the code on the VM

You need the **whole** `AetherProtocol` folder on the VM (`server/index.js`
reads `../js/*.js` and `../data/*.json` relative to itself) — not just
`server/`.

```bash
ssh ubuntu@<your-vm-public-ip>
sudo mkdir -p /opt/aether && sudo chown $USER /opt/aether
cd /opt/aether
git clone <your repo url> .          # or: scp -r the AetherProtocol folder up
cd AetherProtocol/server
```

Install Node (18+; the code uses global `fetch`/`performance`, both built in
since Node 18) if it's not already there:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Then install the server's one dependency:

```bash
npm install
```

Sanity-check it runs (Ctrl+C after you see the listening line):

```bash
PORT=8080 node index.js
```

## 2. Open the port — TWO firewalls, both required

Oracle Cloud VMs sit behind an OCI-level **Security List / Network Security
Group** *in addition to* the OS firewall. Missing either one is the #1 reason
"it works locally but not from the internet" on Oracle Free Tier.

**a) OCI console:** your instance's subnet → Security Lists (or the NSG
attached to the VM) → Add Ingress Rules:
- Source CIDR `0.0.0.0/0`, protocol TCP, destination port **80**
- Source CIDR `0.0.0.0/0`, protocol TCP, destination port **443**

**b) OS firewall on the VM itself:**

Ubuntu (ufw):
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Oracle Linux (firewalld) — Oracle's default images often also have an
`iptables`/`netfilter` rule set pre-loaded that blocks everything but SSH;
check `sudo iptables -L INPUT -n --line-numbers` if firewalld alone doesn't
seem to be enough:
```bash
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

You do **not** need to open 8080 publicly — Caddy is the only thing that
talks to the internet; it reverse-proxies to Node over localhost.

## 3. Free hostname (DuckDNS)

Browsers refuse to open a plain `ws://` socket from an `https://` page
(mixed content), and the static game is deployed over HTTPS (Vercel/GitHub
Pages) — so the Battleground connection has to be `wss://`, which needs a
real hostname for Let's Encrypt to issue a cert against (an IP address alone
won't work).

1. Go to https://www.duckdns.org, sign in, create a subdomain, e.g.
   `yourname.duckdns.org`, and point it at your VM's public IP.
2. Oracle Free Tier's public IP for a running instance is stable as long as
   you don't stop/terminate it, but if you ever recreate the instance, come
   back and update the DuckDNS IP (or set up their cron-based updater).

## 4. Caddy (automatic HTTPS)

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Edit `/etc/caddy/Caddyfile` — copy `server/Caddyfile` from this repo and
replace `yourname.duckdns.org` with your real DuckDNS name:

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will request its own Let's Encrypt certificate the first time it sees
a request for that hostname on port 80 — no manual cert steps needed.

## 5. Run the Node server as a systemd service (so it survives reboots/SSH logout)

```bash
sudo useradd --system --no-create-home aether || true
sudo chown -R aether:aether /opt/aether
sudo cp aether-battleground.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aether-battleground
sudo systemctl status aether-battleground   # should show "active (running)"
journalctl -u aether-battleground -f        # live logs
```

If your checkout isn't at `/opt/aether/AetherProtocol/server`, edit
`WorkingDirectory` in `aether-battleground.service` first.

## 6. Play

In the game's setup screen, paste `wss://yourname.duckdns.org` into the
Battleground address field and hit **⚔ Enter Battleground**. It's saved
locally so you only type it once.

## Updating the game later

```bash
cd /opt/aether/AetherProtocol
git pull
sudo systemctl restart aether-battleground
```

Anyone connected gets dropped and reconnects into a fresh session (in-memory
sim state doesn't persist across a restart — shard totals are per-session
here, this isn't the same "banked shards" save as solo/co-op runs).

## Known limits of this v1

- **PvP damage is bullets only** — orbit blades and saber sweeps don't hurt
  other players yet.
- **No anti-cheat backstop** — hit detection trusts each client's own report;
  a modified client could ignore hits. Fine among friends, not something to
  expose to the public internet unsupervised.
- **In-memory state** — a server restart/crash resets the Battleground (wave,
  players, everything). There's no database/persistence layer here, "24/7"
  means the process stays up, not that progress is durable across restarts.
