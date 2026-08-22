# Meeting Room Name Voting

A responsive, real-name meeting room naming vote web app with **two fully independent themes**
(**Galaxy** and **Natural Landscape**), edit-and-resubmit voting, and a public results page.

All UI text is English. Built with **zero external dependencies** — only Node.js built-in modules
(`http`, `fs`, `crypto`) and the built-in `node:sqlite`. No `npm install` required.

## Features

- **Two independent themes** — Galaxy & Natural Landscape, fully isolated data.
- **Real-name voting** — sign in with your full name; anonymous submission is blocked.
- **Editable votes** — save/update any time before closing; only the latest submission per user+theme is kept.
- **Preset selection** — 10 system presets per theme, up to `N` selectable (default 5).
- **Custom nominations** — 5 optional inputs per theme, only the first `M` non-empty entries count (default 2).
- **Automatic aggregation** — per-theme ranking merges presets + nominations, deduplicates identical names,
  accumulates votes, and records all voters & nominators.
- **Public results** — no-login page with full ranking + full submission log per theme.
- **Admin console** — configure meeting room count, rules, preset lists and the voting time window.

## Deploy for free (everyone can open it) — 5 minutes

Goal: get a public URL like `https://meeting-room-name-voting.onrender.com` that anyone can open
to vote and view results, **free**, no credit card.

1. **Push this folder to a GitHub repo** (this project is already a git repo with `origin` set to your repo).
   On your own machine (which can reach GitHub):
   ```bash
   git add -A
   git commit -m "deploy"
   git push -u origin main
   ```
2. Go to **https://dashboard.render.com** → **New** → **Web Service** → **Connect your GitHub repo**
   (`a790425203-ctrl/Meeting-room-name-voting`).
3. Render auto-reads `render.yaml`. Set these env vars (under Environment):
   - `ADMIN_PASSWORD` — your admin password (e.g. `admin123`)
   - `SESSION_SECRET` — a long random string (e.g. any 32+ char text)
4. Click **Deploy**. After ~1–2 min you get a public URL. The app auto-creates its SQLite DB on first run.

That's it — share the URL. The voting page is at `/`, public results at `/results`, admin at `/admin`.

> The `data/` folder (SQLite DB) is created at runtime. On Render free tier it persists as long as the
> service is not deleted. For production durability, mount a Render Disk to `/data`.

## Quick start (local)

Requirements: Node.js **>= 22.5** (uses the built-in `node:sqlite`).

```bash
node server/index.js
```

Then open:

- Vote page: http://localhost:3000/
- Public results: http://localhost:3000/results
- Admin console: http://localhost:3000/admin  (default password: `admin123`)

## Project structure

```
meeting-room-voting/
├── server/
│   ├── index.js        # HTTP server + API routes + static file serving
│   ├── config.js       # default configuration & theme mapping
│   ├── db.js           # data access layer (node:sqlite) + schema
│   ├── aggregation.js  # per-theme aggregation engine
│   └── auth.js         # real-name HMAC token auth (user + admin)
├── public/
│   ├── index.html      # voting page
│   ├── results.html    # public results page
│   ├── admin.html      # admin console
│   ├── css/styles.css  # responsive dark theme
│   └── js/             # api client + per-page logic
├── data/               # SQLite database (created at runtime)
├── SCHEMA.md           # tables, fields & interaction logic
└── DEPLOYMENT.md       # deployment guide
```

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `ADMIN_PASSWORD` | `admin123` | Admin console password (**change in production**) |
| `SESSION_SECRET` | demo secret | HMAC token signing key (**change in production**) |
| `DB_PATH` | `data/voting.db` | SQLite database path |

See `DEPLOYMENT.md` for full deployment instructions.
