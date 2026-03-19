# vlights AR Payment Followup Dashboard
**Self-hosted backend — Node.js + Express + SQLite**

---

## Quick Deploy (Hostinger VPS)

1. **Upload this folder** to your VPS (via SFTP, SCP, or FileZilla)
2. **SSH into your VPS**
3. **Run the deploy script:**
   ```bash
   cd vlights-ar          # folder you uploaded
   sudo bash deploy.sh
   ```
4. Open **https://payments.paxipatelbot.in** in your browser
5. Sign in with the team password: `Prakash_9892284364`

> **DNS first:** Make sure `payments.paxipatelbot.in` points to your VPS IP address in Hostinger's DNS panel before running deploy.sh.

---

## What deploy.sh does

| Step | Action |
|------|--------|
| 1 | Updates Ubuntu packages |
| 2 | Installs Node.js 20 LTS |
| 3 | Installs PM2 (process manager) |
| 4 | Copies app to `/var/www/vlights-ar/` |
| 5 | Runs `npm install` |
| 6 | Writes `.env` with randomised session secret |
| 7 | Starts app with PM2 (auto-restarts on crash/reboot) |
| 8 | Opens firewall ports 22, 80, 443 |
| 9 | Writes Nginx reverse proxy config |
| 10 | Runs Certbot for free HTTPS (Let's Encrypt) |

---

## Manual setup (without deploy.sh)

```bash
# 1. Install dependencies
npm install

# 2. Create .env
cp .env.example .env
# Edit .env if needed

# 3. Start
node server.js

# Dashboard at http://localhost:3000
```

---

## Login

| Field | Value |
|-------|-------|
| Your Name | Any name (e.g. Chirag, Paxi) — shown in activity log |
| Password | `Prakash_9892284364` |

All 5+ team members share the same password. Each person enters their name at login — this is used to track who added notes and changed statuses.

---

## Features

- **856 accounts** pre-loaded from Zoho Books CSV export
- **Status tracking** per account: Pending / Called / Promise Received / Partial Payment / Paid / Disputed
- **Comment panel** per account — chat-style communication log with author names and timestamps
- **Real-time sync** — auto-refreshes every 30 seconds across all browser sessions
- **Upload new data** — drag-drop Excel or CSV, auto column mapping, bulk load into database
- **Activity log** — see all status changes and comments across all team members
- **Export CSV** — download current state for reporting
- **Dark mode** toggle

---

## Project structure

```
vlights-ar/
├── server.js          # Express server + API routes
├── db.js              # SQLite schema + prepared statements
├── package.json       # Dependencies
├── .env               # Secrets (created by deploy.sh)
├── .env.example       # Template
├── deploy.sh          # One-shot deploy script
├── nginx.conf         # Nginx template (reference)
├── data/
│   └── vlights.db     # SQLite database (created on first run)
└── public/
    ├── index.html     # Dashboard HTML shell
    ├── app.js         # Frontend JS (API-connected)
    └── style.css      # All styles
```

---

## Useful commands on your VPS

```bash
# Check app status
pm2 status

# View live logs
pm2 logs vlights-ar

# Restart app
pm2 restart vlights-ar

# Stop app
pm2 stop vlights-ar

# View Nginx error log
tail -f /var/log/nginx/error.log

# Renew SSL manually
sudo certbot renew
```

---

## Change password

Edit `/var/www/vlights-ar/.env`:
```
DASHBOARD_PASSWORD=NewPassword123
```
Then restart: `pm2 restart vlights-ar`

---

## Database backup

```bash
# Copy database off-server
scp root@YOUR_VPS_IP:/var/www/vlights-ar/data/vlights.db ./backup.db
```

---

## PopeBot — Free Autonomous AI Agent (24/7)

Based on [this video](https://www.youtube.com/watch?v=8uP2IrP3IG8) by [Stephen G. Pope](https://github.com/stephengpope/thepopebot) — run a free autonomous AI agent using Docker + Ollama + GitHub Actions.

### Quick setup

```bash
bash setup-popebot.sh
```

### What it installs

| Component | Purpose |
|-----------|---------|
| **Ollama** | Free local LLM server — no API fees |
| **PopeBot** | Autonomous AI agent framework (Docker-based) |
| **Docker** | 3 containers: event handler, reverse proxy, runner |
| **GitHub Actions** | Job execution, change tracking, approval workflows |

### Prerequisites

- **Node.js 18+**, npm, Git
- **GitHub CLI** (`gh`) — [cli.github.com](https://cli.github.com)
- **Docker + Docker Compose** — [docker.com](https://www.docker.com)
- **ngrok** (local only) — [ngrok.com](https://ngrok.com) (free account)

### Architecture (from the video)

```
┌─────────────────────────────────────────┐
│            Docker Compose               │
│  ┌──────────────┐  ┌────────────────┐   │
│  │ Event Handler│  │ Reverse Proxy  │   │
│  │ (PopeBot)    │  │ (Traefik/SSL)  │   │
│  └──────┬───────┘  └────────────────┘   │
│         │          ┌────────────────┐   │
│         └─────────►│    Runner      │   │
│                    │ (GitHub Actions)│   │
│                    └────────────────┘   │
└─────────────────────────────────────────┘
         │                    │
    ┌────▼────┐         ┌────▼────┐
    │ Ollama  │         │ GitHub  │
    │(Free AI)│         │  Repo   │
    └─────────┘         └─────────┘
```

### Usage after setup

```bash
# Start the agent
cd ~/my-agent && docker compose up -d

# Access web chat at your APP_URL (ngrok or server URL)
# Create admin account on first visit

# Set up Telegram (optional)
npm run setup-telegram

# View logs
docker compose logs -f

# Stop the agent
docker compose down
```

### Key features

- **Heartbeat** — schedule recurring tasks (email, research, etc.)
- **Web chat** — streaming AI chat with file/PDF upload support
- **Swarm view** — monitor all running jobs
- **Auto-upgrade** — one-click updates from the web UI
- **API access** — POST jobs programmatically via webhook
- **Git-based audit** — every agent action is a git commit

---

*Built with [Perplexity Computer](https://www.perplexity.ai/computer)*
