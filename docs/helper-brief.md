# Rack: the gaming PC as a helper (brief for a future session)

Paste everything below the line into a new Claude Code chat opened on `C:\dev\rack`.

---

Rack now runs on its own small server (Dell OptiPlex 9020 USFF, i5-4590S, 16 GB, Ubuntu Server,
Docker, reached over Tailscale as `outis`; see `docs/server-setup.md`). It's only for me. My
gaming PC (Windows 11, Docker Desktop, **RTX 4070 Super 12 GB**, 32 GB) is on some of the time.
When it's on, I want Rack to use it for the heavy work; when it's off, the server carries on
alone. Read `CLAUDE.md`, `backend/rack/worker/main.py` (`EmbedAndScore`, `ManualRefresh`, the job
list), `backend/rack/worker/taste.py`, `backend/rack/worker/llm_job.py` and
`backend/rack/ranking/llm.py` first.

## Today
- One worker container on the server does everything: searches (eBay, Vinted, Grailed), CLIP
  embeddings of listing and taste photos (`open_clip` ViT-B-32, `laion2b_s34b_b79k`, on the CPU),
  clustering, re-scoring every user's feed, hunts, price checks, imports, and the optional AI
  second opinion (Claude through the Anthropic SDK, off: `LLM_ENABLED=false`).
- On the OptiPlex, embedding and re-scoring are the slow parts (re-scoring ~17 k listings took
  ~17 s per user on the gaming PC's CPU; measure it on the server first).

## Decisions already made
- **The server stays in charge and always works on its own.** The helper is optional: when the
  gaming PC is off, asleep or Docker isn't running, nothing breaks and nothing waits for it.
- **The helper never searches the marketplaces.** All marketplace traffic stays on the server's
  one crawler and its rate limits (hunts, refreshes, price checks, imports too).
- **What the helper does when it's on:**
  1. **CLIP embeddings on the GPU** (listing photos, taste photos, sold items): the same model and
     weights, CUDA build of PyTorch.
  2. **Re-scoring** (numpy on the gaming PC's much faster CPU), when that's quicker than the
     server.
  3. **A local AI second opinion:** Ollama on the gaming PC with a vision model (start with
     Qwen2.5-VL 7B; compare Gemma 3 12B), as a choice beside Claude: `LLM_PROVIDER=ollama`.
     Only runs while the helper is online; the server never calls Claude instead unless I set
     that.
- **Private over Tailscale only.** No port opened to my home network or the internet.

## Things to ask me before relying on them
- Which local model to use, after a side-by-side on the same 30 listings (step 6).
- Whether the helper may also take the Vinted likes import (it can't: imports fetch from Vinted,
  which stays on the server. Confirm I'm happy with that).
- Whether the gaming PC should start the helper automatically when Docker Desktop starts.

## What to build (one step at a time; plan first and wait for my OK)
1. **Measure first:** on the server, time a full embed of 200 photos, a re-score of my feed and
   the backlog after a refresh. These are the numbers the helper has to beat.
2. **Jobs that can run on either machine without clashing.** Embedding, clustering and
   re-scoring take a Postgres advisory lock (or a lease row with a heartbeat) so the server and
   the helper never run the same job at once. The server's worker skips a job while a live
   helper holds it, and takes it back if the helper's heartbeat stops (PC switched off
   mid-job). Tests for: helper running, helper vanishing mid-job, both starting together.
3. **A helper mode for the worker:** `python -m rack.worker.helper` runs only the jobs above
   (no searches, hunts, imports, price checks or alerts), with `RACK_ROLE=helper`. Same code and
   image, plus a CUDA variant: `Dockerfile.helper` with the CUDA build of PyTorch, and a
   `docker-compose.helper.yml` for the gaming PC with GPU access (`gpus: all`) and only that
   one service.
4. **Reaching the database over Tailscale, safely:**
   - the server exposes Postgres on the tailnet only (`tailscale serve --tcp 5432` or binding to
     the Tailscale address), never on the LAN;
   - a Tailscale ACL lets only the gaming PC reach that port;
   - a separate database role for the helper with only what its jobs need (read listings and
     images, write embeddings, clusters and scores; no users, sessions or settings tables);
   - its password in a git-ignored `.env.helper` on the gaming PC.
5. **Identical embeddings:** a test that the GPU and CPU builds give the same vectors for the
   same photos (cosine ≥ 0.999 after normalising), so scores don't shift depending on which
   machine embedded a photo.
6. **Local AI second opinion:** an Ollama client beside the Claude one in `ranking/llm.py`
   (same prompt, same verdict format, same daily caps; Ollama's own API over Tailscale to the
   gaming PC, plain `httpx`), chosen with `LLM_PROVIDER`. Before turning it on, run both on my
   top 30 and show me the verdicts side by side.
7. **Status:** the Sources panel (web and iPhone) shows "Helper: online, GPU" or "Helper:
   offline", and what it did in the last hour.
8. **Docs:** a "Helper" section in `docs/server-setup.md` (installing the NVIDIA driver,
   Docker Desktop's GPU support, Ollama, `.env.helper`, starting and stopping), `CLAUDE.md`,
   `README.md`, release notes with the before/after timings from step 1.

## Working agreements
- Plan first and wait for my OK; one step at a time; commit after each step.
- Run all checks before committing (backend ruff, format, mypy, pytest; shared, web and iOS
  type checks and tests).
- Push only when I say; update the server only when I say (back up the database first).
- Security first: nothing reachable from outside my tailnet; least privilege for the helper.
- Nothing licensed in the repo (it's public). Don't store eBay user data.

## Not in this brief
- Moving searches, hunts or alerts to the gaming PC, or running two crawlers.
- Waking the gaming PC remotely (Wake-on-LAN).
- Training or fine-tuning models.
