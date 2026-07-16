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
ssh opc@<your-vm-public-ip>          # 'opc' is the default user on Oracle Linux images
sudo mkdir -p /opt/aether && sudo chown $USER /opt/aether
cd /opt/aether
git clone <your repo url> .          # or: scp -r the AetherProtocol folder up
cd AetherProtocol/server
```

Install Node (18+; the code uses global `fetch`/`performance`, both built in
since Node 18) if it's not already there — NodeSource's RPM setup script
works on RHEL/Oracle Linux with `yum`:

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
node -v   # sanity check
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

**b) OS firewall on the VM itself (firewalld — RHEL/Oracle Linux default):**

```bash
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports   # confirm 80/tcp and 443/tcp are listed
```

Oracle Linux images also frequently ship with `iptables` rules loaded
**on top of** firewalld that reject everything but SSH by default — a
well-known Oracle-specific gotcha, separate from firewalld and separate from
the OCI console rule above. Check:

```bash
sudo iptables -L INPUT -n --line-numbers
```

If you see `REJECT` rules ahead of where 80/443 would be evaluated, add
matching ACCEPT rules above them (order matters — insert, don't just append):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo service iptables save
```

(The `-I INPUT 6` position matches Oracle's stock rule set, which usually
puts its REJECT-all rule around line 7-8; run the `-L --line-numbers`
command above first and adjust the number so your ACCEPT rules land
*before* that REJECT.)

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
sudo yum install -y yum-plugin-copr
sudo yum copr enable -y @caddy/caddy
sudo yum install -y caddy
```

(If `yum copr enable` isn't available on your image, install the plugin
first with `sudo yum install -y 'dnf-command(copr)'` — some Oracle Linux
releases alias `yum`→`dnf` and want the dnf-style plugin name instead.)

Edit `/etc/caddy/Caddyfile` — copy `server/Caddyfile` from this repo and
replace `yourname.duckdns.org` with your real DuckDNS name:

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will request its own Let's Encrypt certificate the first time it sees
a request for that hostname on port 80 — no manual cert steps needed.

## 5. Run the Node server as a systemd service (so it survives reboots/SSH logout)

The shipped unit runs as `User=opc` (or whichever user actually owns the
checkout) rather than a separate dedicated system account. That's
deliberate: if your checkout lives under a home directory (e.g.
`/home/opc/...`, which is what `git clone`-ing into your own account gives
you), home directories are normally mode `700` — a *different* system user
can't even `cd` into it to find `server/`, regardless of who owns the
`AetherProtocol` folder itself. Systemd surfaces that specific failure as
`status=200/CHDIR`. Using your own account sidesteps the whole class of
problem; only bother with a separate locked-down system user if you
deliberately deploy the checkout somewhere outside any home directory (e.g.
`/opt/aether/...`), where that friction doesn't exist.

```bash
# stamp your ACTUAL current directory and current user into the unit file
sed -e "s|^WorkingDirectory=.*|WorkingDirectory=$(pwd)|" \
    -e "s|^User=.*|User=$(whoami)|" \
    aether-battleground.service | sudo tee /etc/systemd/system/aether-battleground.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now aether-battleground
sudo systemctl status aether-battleground   # should show "active (running)"
journalctl -u aether-battleground -f        # live logs, confirm "listening on ws://0.0.0.0:8080"
```

## 6. Play

In the game's setup screen, paste `wss://yourname.duckdns.org` into the
Battleground address field and hit **⚔ Enter Battleground**. It's saved
locally so you only type it once.

## Updating the game later

```bash
cd <wherever you cloned it>/AetherProtocol
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
