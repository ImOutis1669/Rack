# Server commands: everything you need to run Rack's server

A reference for the OptiPlex (`rack-server`, Ubuntu 26.04, Tailscale name `outis`). The setup
itself is in `docs/server-setup.md`. Commands marked **(PC)** run in PowerShell on the gaming PC;
everything else runs on the server after `ssh rack`.

Most Rack commands need you to be in Rack's folder first: **`cd ~/rack`**.

**On the server, `help-outis` shows this whole page** (arrow keys or space to scroll, `q` to
quit). `help-outis backups` shows just one section (any word from a title works), and
`help-outis --list` lists the sections.

---

## Getting in and out

| Do this | Command |
|---|---|
| Log in to the server **(PC)** | `ssh rack` |
| Run one command without staying logged in **(PC)** | `ssh rack "cd ~/rack && docker compose ps"` |
| Log out | `exit` (or Ctrl+D) |
| Stop whatever's running on screen | Ctrl+C |
| Rack in a browser | `https://outis.tail2b624f.ts.net` (Tailscale on) |

`ssh rack` works because of the shortcut in `C:\Users\jerem\.ssh\config`. The long form is
`ssh outis@outis.tail2b624f.ts.net` (not `ssh outis@outis`: your PC is also called Outis).

---

## Is Rack OK?

| Do this | Command |
|---|---|
| Rack at a glance (also shown at login) | `rack-status` |
| Watch Rack working, live (Ctrl+C to stop) | `rack-live` |
| ...starting from 2 hours ago | `rack-live 2h` |
| Are the three containers up? | `docker compose ps` |
| Does the API answer? | `curl -s http://127.0.0.1:8000/api/health` (says `{"status":"ok"}`) |
| CPU and memory per container | `docker stats` (Ctrl+C to stop) |

In `docker compose ps`, **api** should say *healthy*, **db** *healthy*, **worker** *running*.

---

## Logs (what Rack has been doing)

| Do this | Command |
|---|---|
| The worker's last 100 lines | `docker compose logs --tail 100 worker` |
| Follow the worker live | `docker compose logs -f worker` |
| The API's last 100 lines | `docker compose logs --tail 100 api` |
| The last hour, all containers | `docker compose logs --since 1h` |
| Only errors from the last day | `docker compose logs --since 24h \| grep -iE "error\|traceback"` |
| Searches only | `docker compose logs --since 6h worker \| grep -E "refresh"` |

---

## Start, stop, restart

| Do this | Command |
|---|---|
| Restart all of Rack | `docker compose restart` |
| Restart just the worker (searching, scoring) | `docker compose restart worker` |
| Restart just the API (the web app) | `docker compose restart api` |
| Stop Rack (data kept) | `docker compose stop` |
| Start it again | `docker compose up -d` |
| Stop and remove the containers (data kept) | `docker compose down` |

**Never** add `-v` to `docker compose down` unless you mean to erase the database and photos:
`down -v` deletes them.

Rack starts by itself when the server boots.

---

## Updating Rack

```bash
cd ~/rack
./scripts/server-backup.sh          # back up first
git pull
docker compose up -d --build        # rebuild and restart with the new code
docker compose ps                   # check it's healthy
```

Database changes (migrations) run by themselves when the API starts. If `git pull` complains
about local changes, run `git status` and ask me before deleting anything.

| Do this | Command |
|---|---|
| Which version is running? | `git log --oneline -1` |
| What's changed on GitHub since? | `git fetch && git log --oneline HEAD..origin/main` |

---

## Backups

Every night at 03:30 the database is saved to `~/rack/backups/rack-<date>.dump`. Photos are added
on Sundays as `rack-data-<date>.tgz`. 14 days are kept.

| Do this | Command |
|---|---|
| Back up now | `./scripts/server-backup.sh` |
| Back up now, including photos | `./scripts/server-backup.sh --photos` |
| List the backups | `ls -lh ~/rack/backups` |
| Did last night's run work? | `tail -5 ~/rack/backups/backup.log` |
| See the schedule | `crontab -l` |
| Copy backups to the PC **(PC)** | `scp rack:~/rack/backups/rack-*.dump C:\dev\rack\backups\` |

### Restoring the database from a backup

This **replaces everything in Rack's database** with the backup's contents. Changes made since
that backup are lost, so make a fresh backup first in case you change your mind.

```bash
cd ~/rack
./scripts/server-backup.sh                                   # safety copy of now
docker compose stop api worker
docker compose cp backups/rack-<date>.dump db:/tmp/restore.dump
docker compose exec db pg_restore -U rack -d rack --clean --if-exists --no-owner /tmp/restore.dump
docker compose up -d
```

### Restoring the photos

```bash
cd ~/rack
docker compose stop api worker
docker run --rm -v rack_rack_data:/data -v ~/rack/backups/rack-data-<date>.tgz:/b.tgz:ro alpine \
  sh -c "tar xzf /b.tgz -C /data && chown -R 1000:1000 /data"
docker compose up -d
```

---

## Your account

| Do this | Command |
|---|---|
| Forgot your password: set a new one | `docker compose exec api rack reset-password outis` |
| List accounts | `docker compose exec api rack users` |

Resetting the password logs out your devices: log in again on the iPhone app and browser.

---

## Looking inside the database

| Do this | Command |
|---|---|
| Open the database prompt (type `\q` to leave) | `docker compose exec db psql -U rack rack` |
| How many listings? | `docker compose exec db psql -U rack rack -c "select count(*), count(*) filter (where active) from listings;"` |
| Listings per site | `docker compose exec db psql -U rack rack -c "select source, count(*) from listings group by 1;"` |
| Site health | `docker compose exec db psql -U rack rack -c "select source, last_success_at, last_error from source_health;"` |
| Database size | `docker compose exec db psql -U rack rack -c "select pg_size_pretty(pg_database_size('rack'));"` |

Look, don't change: editing rows by hand can break Rack. Ask me instead.

---

## Disk space

| Do this | Command |
|---|---|
| How full is the disk? | `df -h /` |
| What's using the space in Rack's folder? | `du -sh ~/rack/backups ~/rack` |
| Docker's space use | `docker system df` |
| Clear old Docker builds and images (safe, keeps Rack's data) | `docker system prune -f` |
| Also clear the build cache | `docker builder prune -f` |

Do a `docker system prune -f` every month or two; updates leave old builds behind.

---

## The server itself

| Do this | Command |
|---|---|
| Install updates now (they also install themselves daily) | `sudo apt update && sudo apt full-upgrade -y` |
| Does it need a restart after updates? | `ls /var/run/reboot-required` (exists = yes) |
| Restart the server (Rack comes back by itself) | `sudo reboot` |
| Turn it off | `sudo poweroff` |
| How long has it been up? | `uptime` |
| Memory | `free -h` |
| Processes, live (q to quit) | `top` (or `htop` after `sudo apt install htop`) |
| Temperature | `cat /sys/class/thermal/thermal_zone*/temp` (divide by 1000 for °C) |
| Firmware updates (Secure Boot lists, etc.) | `fwupdmgr get-upgrades` then `sudo fwupdmgr update` |
| Its home-network address | `ip -4 addr show eno1` |
| Time and timezone | `timedatectl` |

`sudo` asks for your server password; nothing shows while you type it.

---

## Tailscale

| Do this | Command |
|---|---|
| Is the server on the tailnet? Who else is? | `tailscale status` |
| Its Tailscale address | `tailscale ip -4` |
| Is Rack being served at the HTTPS address? | `tailscale serve status` |
| Serve Rack again (if `serve status` shows nothing) | `sudo tailscale serve --bg 8000` |
| Reconnect after a logout | `sudo tailscale up --ssh` |

In the admin console (login.tailscale.com/admin): keep **key expiry disabled** for this server.

---

## Scheduled jobs (cron)

| Do this | Command |
|---|---|
| See them | `crontab -l` |
| Edit them | `crontab -e` |

The backup line is
`30 3 * * * /home/outis/rack/scripts/server-backup.sh >> /home/outis/rack/backups/backup.log 2>&1`.
**Don't** pipe into `crontab -` to edit (that's how the line got wiped once): use `crontab -e`.

---

## When something's wrong

| Symptom | Try |
|---|---|
| Rack won't load in the browser | `tailscale status` (server online?), `tailscale serve status`, then `docker compose ps` |
| A container isn't *healthy* / *running* | `docker compose logs --tail 50 <api\|worker\|db>`, then `docker compose up -d` |
| No new listings | `rack-status` (Sites line), `docker compose logs --since 2h worker \| grep -i refresh` |
| A site shows ✗ | The error is in `rack-status`; often the site is briefly refusing. It retries by itself |
| Feed not updating after changes | `docker compose restart worker` |
| Disk nearly full | `docker system prune -f`, then check `du -sh ~/rack/backups` |
| Everything is odd | `sudo reboot` and wait two minutes |
| Need to undo a bad update | `git log --oneline -5`, then ask me (rolling back may also need the database backup) |

When in doubt, copy the output of `rack-status` and `docker compose logs --tail 50 worker` into
a chat with me.
