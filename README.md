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

## OpenClaw AI Assistant Setup (Free, No API Fees)

Based on [this video](https://www.youtube.com/watch?v=8uP2IrP3IG8) by Stephen G. Pope — run a personal AI assistant locally with zero cost.

### Quick setup

```bash
# Run the automated setup script
bash setup-openclaw.sh
```

### What it installs

| Component | Purpose |
|-----------|---------|
| **Ollama** | Local LLM runtime — runs AI models on your hardware |
| **Local model** | qwen3 (8B/14B/32B) — no API fees, full privacy |
| **OpenClaw** | AI assistant that connects to Telegram, WhatsApp, Slack, etc. |

### Requirements

- **Node.js 22+** (already installed for this project)
- **GPU with 8GB+ VRAM** recommended for local models (or use free cloud models)
- **Linux, macOS, or Windows with WSL2**

### Usage after setup

```bash
# Launch with local model (free, private)
ollama launch openclaw --model qwen3:8b

# Or use free cloud models (no GPU needed)
ollama launch openclaw --model kimi-k2.5:cloud

# Connect messaging apps
openclaw configure --section channels

# Open dashboard
openclaw dashboard
```

---

*Built with [Perplexity Computer](https://www.perplexity.ai/computer)*
