# Moving Rack to its own server (Dell OptiPlex 9020 USFF)

Rack is only for you, so this sets up one small always-on box that you (and your iPhone) reach
privately over Tailscale. Nothing is opened to the internet. You'll end up with:

- **Ubuntu Server** on the OptiPlex (no desktop, nothing extra running);
- **Docker** running Rack's three containers (database, API, worker), started automatically on
  boot;
- **Tailscale** giving it the same private HTTPS address Rack uses today, so the iPhone app,
  your bookmarks and your login keep working;
- a **nightly backup** of the database and your photos.

Allow an evening: about an hour of hands-on work plus waiting for downloads and the first build.
Commands in grey boxes are typed exactly as shown; replace anything in `<angle brackets>`.

**Words used below.** *Gaming PC* = the Windows PC Rack runs on today. *Server* = the OptiPlex.
*Terminal* = PowerShell on the gaming PC, or the server's own screen / an SSH window.

---

## 0. What you need

- The OptiPlex with its power supply, plugged into your router with an **ethernet cable**
  (more reliable than Wi-Fi; USFF models usually have no Wi-Fi anyway).
- For the install only: a monitor (DisplayPort, or an adapter), a USB keyboard, and a **USB stick
  of 8 GB or more** that can be wiped.
- Your Tailscale login (the same account the gaming PC and iPhone use).
- On the gaming PC: Docker Desktop running, so the old copy of Rack can be backed up.

---

## 1. Prepare the OptiPlex (BIOS settings)

1. Plug in the monitor, keyboard and ethernet. Turn it on and tap **F2** to open the BIOS setup.
2. **Update the BIOS first** if it's old (the version shows on the first page). On another
   computer, find "OptiPlex 9020 BIOS" on dell.com/support, put the `.exe` on a USB stick, and use
   **F12 > BIOS Flash Update**. The latest version helps with stability and newer CPUs (section 11).
3. In the BIOS, set:
   - **Power Management > AC Recovery: Power On.** After a power cut it switches itself back on,
     and Rack starts with it.
   - **System Configuration > SATA Operation: AHCI** (usually already set).
   - **Virtualization Support > Virtualization: on** (not strictly needed on Linux, harmless).
   - Leave Secure Boot as it is: Ubuntu works with it.
4. **Apply / Save** and exit.

---

## 2. Make the Ubuntu installer USB (on the gaming PC)

1. Download **Ubuntu Server 26.04 LTS** (24.04 LTS works just as well) from
   `ubuntu.com/download/server`. It's one `.iso` file, about 3 GB.
2. Download **balenaEtcher** (or Rufus) and use it to write the `.iso` to the USB stick. This
   erases the stick.

---

## 3. Install Ubuntu Server

1. Put the USB stick in the OptiPlex, turn it on and tap **F12**. Choose the USB stick.
2. Choose **Try or Install Ubuntu Server**, then work through the screens:
   - **Language and keyboard:** English (UK) / your keyboard.
   - **Type of install:** Ubuntu Server (not "minimized").
   - **Network:** the ethernet connection should show an address (for example `192.168.1.40`).
     Leave it on automatic (DHCP).
   - **Proxy / mirror:** leave as they are.
   - **Storage:** *Use an entire disk* (the 500 GB SSD), with *Set up this disk as an LVM group*
     ticked. On the summary screen, **check the size of `ubuntu-lv`**. The installer often gives
     it only ~100 GB of the disk: select it, choose **Edit**, set the size to the **maximum**
     shown, and save. (Otherwise Rack would run out of space with 360 GB unused.)
     **This wipes the SSD**, including the Windows 11 that's on it now.
   - **Profile:** your name; server name **`rack-server`**; a username (for example `outis`) and
     a strong password. Write the password down: you'll need it for `sudo`.
   - **Ubuntu Pro:** skip.
   - **SSH:** tick **Install OpenSSH server**.
   - **Featured server snaps:** tick **nothing** (Docker is installed properly below, not as a
     snap).
3. Wait for it to finish, choose **Reboot now**, and pull out the USB stick when told.
4. Log in at the prompt with your username and password.

### First updates

```bash
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone Europe/London
sudo reboot
```

Security updates then install themselves every day (Ubuntu's *unattended-upgrades* is on by
default).

---

## 4. Install Tailscale

Tailscale makes the server reachable from your gaming PC and iPhone anywhere, without opening
ports on your router.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

`tailscale up` prints a link. Open it on any device, log in with **your** Tailscale account and
approve the server. `--ssh` turns on **Tailscale SSH**: from any of your devices,
`ssh <username>@rack-server` works with no passwords or keys to manage. Only your tailnet can
use it.

In the Tailscale **admin console** (login.tailscale.com/admin):

1. **Machines > rack-server > ⋯ > Disable key expiry.** Otherwise the server drops off your
   tailnet every few months until you log in again.
2. **DNS:** make sure **MagicDNS** and **HTTPS Certificates** are enabled (they already are if
   `https://outis.tail2b624f.ts.net` works today).

From now on you can do the rest from the gaming PC. Open PowerShell and:

```powershell
ssh <username>@rack-server
```

You can unplug the monitor and keyboard from the server.

---

## 5. Install Docker

These are Docker's official steps for Ubuntu. Paste them one block at a time into the SSH
window.

```bash
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out (`exit`) and SSH in again so the last line takes effect, then check:

```bash
docker run --rm hello-world
docker compose version
```

Docker starts by itself on every boot, and so does Rack (its containers are set to
`restart: unless-stopped`).

---

## 6. Get Rack's code

```bash
git clone https://github.com/ImOutis1669/Rack.git ~/rack
mkdir -p ~/rack/backups
```

The code is public; your secrets and data are not in it. They come next.

---

## 7. Copy everything private over from the gaming PC

Four things live only on the gaming PC: the **settings files** (`.env`, `.env.api`,
`.env.worker`), the **licensed font and icons** (`frontend/private/`), the **database**, and the
**photos** (wardrobe photos and your profile picture, in Docker's `rack_data` volume).

### 7a. Freeze and back up the old Rack (PowerShell on the gaming PC)

```powershell
cd C:\dev\rack
docker compose stop worker api
docker compose exec db pg_dump -U rack -Fc -f /tmp/move.dump rack
docker compose cp db:/tmp/move.dump backups/move.dump
docker run --rm -v rack_rack_data:/data -v ${PWD}/backups:/backup alpine tar czf /backup/rack-data.tgz --exclude=./hf -C /data .
```

Stopping the API and worker first means nothing changes after the backup is taken. (`pg_dump`
writes inside the container and `docker compose cp` copies the file out, because PowerShell's `>`
would damage a binary file.) The CLIP model (`hf`) is left out: the server downloads its own.

### 7b. Send it all to the server (still in PowerShell)

```powershell
scp .env .env.api .env.worker backups/move.dump backups/rack-data.tgz <username>@rack-server:~/rack/
scp -r frontend/private/fonts frontend/private/basil.json <username>@rack-server:~/rack/frontend/private/
```

### 7c. Lock the settings files down (SSH window on the server)

```bash
cd ~/rack
chmod 600 .env .env.api .env.worker
mv move.dump rack-data.tgz backups/
```

They hold your password hash, session secret and marketplace keys: only your user can read them.

---

## 8. Restore your data and start Rack (on the server)

```bash
cd ~/rack
docker compose up -d db
docker compose ps        # wait until db shows "healthy" (a few seconds)
```

Restore the database:

```bash
docker compose cp backups/move.dump db:/tmp/move.dump
docker compose exec db pg_restore -U rack -d rack --no-owner --clean --if-exists /tmp/move.dump
```

Restore the photos into Rack's data volume (the containers run as user 1000, hence the `chown`):

```bash
docker compose up --no-start
docker run --rm -v rack_rack_data:/data -v ~/rack/backups/rack-data.tgz:/backup.tgz:ro alpine \
  sh -c "tar xzf /backup.tgz -C /data && chown -R 1000:1000 /data"
```

Build and start everything:

```bash
docker compose up -d --build
```

The first build takes **15-30 minutes** on this CPU (it builds the web app and installs PyTorch).
Later updates are quicker. When it's done:

```bash
docker compose ps                     # api "healthy", worker and db "running"
curl -s http://127.0.0.1:8000/api/health
docker compose logs -f worker         # Ctrl+C to stop watching
```

The worker downloads the CLIP model once (~600 MB), then logs `worker started`. Within a couple
of minutes you should see `rescored … listings for user 1`.

---

## 9. Switch the address over to the server

Rack's address today is `https://outis.tail2b624f.ts.net`: the Tailscale name of the gaming PC.
Giving that name to the server instead means the iPhone app, your bookmarks and your login carry
on working with nothing to change.

1. **Gaming PC, PowerShell:** stop serving Rack, and take Rack down (its data stays as a spare):

   ```powershell
   tailscale serve reset
   cd C:\dev\rack
   docker compose down
   ```

2. **Tailscale admin console:** rename the gaming PC to `outis-pc` (Machines > the PC > ⋯ >
   Edit machine name), then rename `rack-server` to **`outis`**.

3. **Server:** serve Rack on that address over HTTPS:

   ```bash
   sudo tailscale serve --bg 8000
   tailscale serve status    # shows https://outis.tail2b624f.ts.net -> http://127.0.0.1:8000
   ```

   The first visit can take a few seconds while Tailscale fetches the certificate.

4. Open `https://outis.tail2b624f.ts.net` on your iPhone. You should still be logged in, with
   your feed, Saved and wardrobe photos. If anything looks wrong, section 13 has the way back.

From the gaming PC, `ssh <username>@outis.tail2b624f.ts.net` now reaches the server. Use the full name: the gaming PC is itself called "Outis" in Windows, so a bare `outis` points back at the PC.

Rack's port 8000 only listens on the server itself (`127.0.0.1`), so Tailscale is the only way
in: nothing on your home network or the internet can reach Rack directly.

---

## 10. Nightly backups

`scripts/server-backup.sh` (in the repo) saves the database every night, the photos every
Sunday, and deletes copies older than 14 days.

```bash
chmod +x ~/rack/scripts/server-backup.sh
~/rack/scripts/server-backup.sh          # try it once
ls -lh ~/rack/backups
crontab -e                               # pick nano if asked
```

Add this line at the bottom, then save (Ctrl+O, Enter, Ctrl+X):

```
30 3 * * * /home/<username>/rack/scripts/server-backup.sh >> /home/<username>/rack/backups/backup.log 2>&1
```

A backup on the same disk doesn't survive the disk dying. Now and then, copy the newest one to
the gaming PC (PowerShell):

```powershell
scp <username>@outis.tail2b624f.ts.net:~/rack/backups/rack-*.dump C:\dev\rack\backups\
```

---

## 11. Updating Rack later

When there are new changes on GitHub:

```bash
cd ~/rack
./scripts/server-backup.sh
git pull
docker compose up -d --build
```

Migrations run by themselves when the API starts. I (Claude) can do this for you from the gaming
PC over Tailscale SSH (`ssh <username>@outis.tail2b624f.ts.net "cd ~/rack && git pull && docker compose up -d --build"`)
once the server is set up.

Every month or two, free space taken by old builds:

```bash
docker system prune -f
df -h /
```

---

## 12. Day-to-day

**Rack at a glance.** Add these lines to the end of `~/.bashrc` on the server (`nano ~/.bashrc`):

```bash
# Rack shortcuts (docs/server-setup.md section 12)
alias rack-status="~/rack/scripts/rack-status.sh"
alias rack-live="~/rack/scripts/rack-live.sh"
# a Rack summary under the welcome text when you log in over SSH
if [[ $- == *i* && -n ${SSH_TTY:-} && -z ${TMUX:-} ]]; then ~/rack/scripts/rack-status.sh; fi
```

Every SSH login then shows whether Rack is running, how many listings it has (and how many came
in today and in the last hour), the last search and what each site returned, each site's health,
when your feed was last re-ranked, a running Vinted import, the last backup, and the server's
load, memory, disk and temperature. `rack-status` shows it again; **`rack-live`** follows Rack's
activity as it happens (searches in cyan, re-ranking in green, hunts in magenta, imports and
warnings in yellow, errors in red; Ctrl+C to stop; `rack-live 2h` starts two hours back).


| You want to | Do |
|---|---|
| See if Rack is running | `cd ~/rack && docker compose ps` |
| Watch what the worker is doing | `docker compose logs -f --since 10m worker` |
| Restart Rack | `docker compose restart` |
| Reset your password | `docker compose exec api rack reset-password outis` |
| Turn the server off | `sudo poweroff` (it comes back with Rack when switched on) |
| Restart it | `sudo reboot` |

---

## 13. If something goes wrong

- **Can't reach the address:** on the server, `tailscale status` (is it online?) and
  `tailscale serve status`. On the iPhone, check Tailscale is switched on.
- **Page loads but says it can't reach Rack:** `docker compose ps` and
  `docker compose logs --tail 50 api`.
- **The restore printed errors:** start again from section 8 (`docker compose down -v` first,
  which empties the server's database and photos; your backups in `~/rack/backups` stay).
- **Going back to the gaming PC:** in the admin console, rename the server back to `rack-server`
  and the gaming PC back to `outis`. Then in PowerShell on the gaming PC run
  `cd C:\dev\rack; docker compose up -d`, then `tailscale serve --bg 8000`. It comes back exactly
  as it was at the moment of the backup in 7a.

---

## 14. Optional: reach Rack without Tailscale (Cloudflare Tunnel)

Tailscale already gives you Rack anywhere, privately. A Cloudflare Tunnel puts Rack on a normal
web address (for example `https://rack.yourdomain.com`) so it also opens on devices without
Tailscale. Nothing is opened on your router, but the address *is* on the internet, so this
section adds Cloudflare Access in front: only your email can get past it.

**You need a domain on Cloudflare.** Buy one in the Cloudflare dashboard (Domain Registration,
about £8-10 a year for a `.com`), or add one you own and switch its nameservers to Cloudflare.

### 14a. Create the tunnel (Cloudflare dashboard)
1. **Zero Trust** (left menu). The first time, pick a team name and the **Free** plan (up to 50
   users; it may ask for a card even on the free plan).
2. **Networks > Tunnels > Create a tunnel > Cloudflared.** Name it `rack`.
3. On "Install and run a connector", choose **Docker**. Copy only the long token at the end of
   the command shown (after `--token`). Don't run that command: Rack's compose file already has
   the connector.
4. **Public hostname:** subdomain `rack`, your domain; **Service: HTTP**, URL **`api:8000`**.
   Save.

### 14b. Start the connector (server)
```bash
cd ~/rack
nano .env.tunnel          # one line: TUNNEL_TOKEN=<the token>
chmod 600 .env.tunnel
nano .env                 # set RACK_PUBLIC_URL=https://rack.<yourdomain> (RACK_COOKIE_SECURE stays true)
docker compose --profile tunnel up -d
docker compose logs --tail 20 cloudflared     # "Registered tunnel connection" x4
```
From now on, start and update Rack with `--profile tunnel`, for example
`docker compose --profile tunnel up -d --build`, or the tunnel stops at the next update.

`RACK_PUBLIC_URL` is only used for the links in alerts and invites. The Tailscale address keeps
working as before.

### 14c. Put Cloudflare Access in front (do this before using the address)
1. **Zero Trust > Access > Applications > Add an application > Self-hosted.**
2. Name `Rack`, domain `rack.<yourdomain>`, session duration **1 month**.
3. Policy: **Allow**, *Include > Emails >* your email address. Login method: **One-time PIN**.
4. Save. Opening the address now asks for your email, sends a code, and only then shows Rack's
   own login. Anyone else never reaches Rack at all.

**The iPhone app keeps using the Tailscale address.** Access's email login is a web page the app
can't show. Keep the app's server set to `https://outis.tail2b624f.ts.net` and use the new
address in browsers.

### 14d. Slow down password guessing (security audit RACK-25)
**Your domain > Security > WAF > Rate limiting rules > Create rule:** when the URI path starts with
`/api/auth/`, the same IP, more than 10 requests in 10 seconds, **Block**. The free plan allows one
rule, and this is the one to have. (Rack also limits logins itself: 5 tries per address and per
username, 60 in total per 15 minutes.)

### 14e. Check it
- In a private browser window, `https://rack.<yourdomain>` asks for your email first.
- After the code, Rack's login appears; log in as usual.
- To turn the tunnel off again: `docker compose stop cloudflared`.
