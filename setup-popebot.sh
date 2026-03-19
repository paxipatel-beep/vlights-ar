#!/usr/bin/env bash
# ============================================================
# PopeBot Setup Script — Free Autonomous AI Agent
# Based on: "I Built a FREE OpenClaw (no Mac Mini or API Fees)"
#           by Stephen G. Pope (@StephenGPope)
#           https://www.youtube.com/watch?v=8uP2IrP3IG8
#
# PopeBot is an autonomous AI agent that runs 24/7 using:
#   - Docker (3 containers: event handler, reverse proxy, runner)
#   - Ollama (free local LLMs — no API fees)
#   - GitHub Actions (job execution, change tracking, approvals)
#   - Web chat interface + optional Telegram
#
# Repository: https://github.com/stephengpope/thepopebot
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()  { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# -----------------------------------------------------------
# 1. Check all prerequisites
# -----------------------------------------------------------
step "Step 1/5: Checking prerequisites"

MISSING=""

# Node.js
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        MISSING="$MISSING  - Node.js 18+ (current: $(node -v))\n"
    else
        info "Node.js $(node -v) ✓"
    fi
else
    MISSING="$MISSING  - Node.js 18+ → https://nodejs.org\n"
fi

# npm
if command -v npm &>/dev/null; then
    info "npm $(npm -v) ✓"
else
    MISSING="$MISSING  - npm (comes with Node.js)\n"
fi

# Git
if command -v git &>/dev/null; then
    info "Git $(git --version | cut -d' ' -f3) ✓"
else
    MISSING="$MISSING  - Git → https://git-scm.com\n"
fi

# GitHub CLI
if command -v gh &>/dev/null; then
    info "GitHub CLI $(gh --version | head -1 | cut -d' ' -f3) ✓"
else
    MISSING="$MISSING  - GitHub CLI (gh) → https://cli.github.com\n"
fi

# Docker
if command -v docker &>/dev/null; then
    info "Docker $(docker --version | cut -d' ' -f3 | tr -d ',') ✓"
else
    MISSING="$MISSING  - Docker → https://www.docker.com\n"
fi

# Docker Compose
if docker compose version &>/dev/null 2>&1; then
    info "Docker Compose ✓"
elif command -v docker-compose &>/dev/null; then
    info "Docker Compose (legacy) ✓"
else
    MISSING="$MISSING  - Docker Compose → https://docs.docker.com/compose/install/\n"
fi

if [ -n "$MISSING" ]; then
    echo ""
    warn "Missing prerequisites:"
    echo -e "$MISSING"
    error "Install the tools above, then re-run this script."
fi

# -----------------------------------------------------------
# 2. Install & start Ollama (free local LLM server)
# -----------------------------------------------------------
step "Step 2/5: Setting up Ollama (free local LLMs)"

if command -v ollama &>/dev/null; then
    info "Ollama already installed ✓"
else
    info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    info "Ollama installed ✓"
fi

# Start Ollama if not running
if ! pgrep -x "ollama" &>/dev/null; then
    info "Starting Ollama service..."
    ollama serve &>/dev/null &
    sleep 3
    info "Ollama service started ✓"
else
    info "Ollama service running ✓"
fi

# -----------------------------------------------------------
# 3. Pull a local model for free AI
# -----------------------------------------------------------
step "Step 3/5: Selecting a free local LLM"

echo ""
echo "  Choose a model based on your hardware:"
echo ""
echo "  [1] qwen3:8b        (~5 GB)   — Good for 8GB GPUs / Apple M-series"
echo "  [2] qwen3:14b       (~10 GB)  — Better quality, 16GB+ GPUs"
echo "  [3] qwen3-coder:32b (~20 GB)  — Best local experience, 24GB+ GPUs"
echo "  [4] Skip             — I'll pull a model later"
echo ""
read -rp "Select model [1-4] (default: 1): " MODEL_CHOICE
MODEL_CHOICE=${MODEL_CHOICE:-1}

case $MODEL_CHOICE in
    1) MODEL="qwen3:8b" ;;
    2) MODEL="qwen3:14b" ;;
    3) MODEL="qwen3-coder:32b" ;;
    4) MODEL="skip" ;;
    *) MODEL="qwen3:8b" ;;
esac

if [ "$MODEL" != "skip" ]; then
    info "Pulling $MODEL (this may take a while on first download)..."
    ollama pull "$MODEL"
    info "Model $MODEL ready ✓"
else
    warn "Skipping model pull. Run 'ollama pull <model-name>' later."
fi

# -----------------------------------------------------------
# 4. Scaffold PopeBot project
# -----------------------------------------------------------
step "Step 4/5: Creating PopeBot project"

AGENT_DIR="$HOME/my-agent"

echo ""
read -rp "Agent directory [$AGENT_DIR]: " CUSTOM_DIR
AGENT_DIR=${CUSTOM_DIR:-$AGENT_DIR}

if [ -d "$AGENT_DIR" ] && [ -f "$AGENT_DIR/package.json" ]; then
    info "PopeBot project already exists at $AGENT_DIR ✓"
else
    info "Scaffolding PopeBot at $AGENT_DIR..."
    mkdir -p "$AGENT_DIR"
    cd "$AGENT_DIR"
    npx thepopebot@latest init
    info "PopeBot scaffolded ✓"
fi

cd "$AGENT_DIR"

# -----------------------------------------------------------
# 5. Run interactive setup wizard
# -----------------------------------------------------------
step "Step 5/5: Running PopeBot setup wizard"

echo ""
echo "  The setup wizard will walk you through:"
echo "  1. Creating a GitHub repository for your agent"
echo "  2. Generating a GitHub Personal Access Token"
echo "     (Permissions needed: Actions, Administration,"
echo "      Contents, Metadata, Pull Requests, Workflows"
echo "      — all Read & Write)"
echo "  3. Configuring your LLM (choose 'local' for Ollama)"
echo "     Ollama Docker URL: http://host.docker.internal:11434/v1"
if [ "$MODEL" != "skip" ]; then
    echo "     Model name: $MODEL"
fi
echo "  4. Optional: Brave Search API key (free tier available)"
echo "  5. Optional: ngrok for local access (free account)"
echo "     Start ngrok with: ngrok http 80"
echo ""
read -rp "Ready to start the wizard? [Y/n]: " READY
READY=${READY:-Y}

if [[ "$READY" =~ ^[Yy]$ ]]; then
    npm run setup
else
    warn "Skipped wizard. Run 'npm run setup' later from $AGENT_DIR"
fi

# -----------------------------------------------------------
# Done!
# -----------------------------------------------------------
echo ""
echo "============================================================"
echo -e "${GREEN}  PopeBot Setup Complete!${NC}"
echo "============================================================"
echo ""
echo "  Your agent directory: $AGENT_DIR"
echo ""
echo "  Quick Reference:"
echo ""
echo "  Start the agent (3 Docker containers):"
echo "    cd $AGENT_DIR && docker compose up -d"
echo ""
echo "  View running containers:"
echo "    docker ps"
echo ""
echo "  Access the web chat interface:"
echo "    Open your APP_URL (ngrok URL or server URL)"
echo "    Create your admin account on first visit"
echo ""
echo "  Set up Telegram (optional):"
echo "    cd $AGENT_DIR && npm run setup-telegram"
echo ""
echo "  View agent logs:"
echo "    docker compose logs -f"
echo ""
echo "  Stop the agent:"
echo "    docker compose down"
echo ""
echo "  Upgrade PopeBot:"
echo "    Use the web UI upgrade button, or:"
echo "    npx thepopebot set-var APP_URL <your-url>"
echo ""
echo "============================================================"
echo -e "${CYAN}  Architecture (3 Docker containers):${NC}"
echo "  1. Event Handler — receives messages, manages jobs"
echo "  2. Reverse Proxy — SSL/HTTPS termination (Traefik)"
echo "  3. Runner — executes agent jobs (local or GitHub Actions)"
echo ""
echo -e "${CYAN}  Free LLM via Ollama:${NC}"
if [ "$MODEL" != "skip" ]; then
    echo "  Model: $MODEL"
fi
echo "  Docker URL: http://host.docker.internal:11434/v1"
echo "  No API fees — runs entirely on your hardware"
echo "============================================================"
echo ""
echo -e "${YELLOW}  Repo: https://github.com/stephengpope/thepopebot${NC}"
echo -e "${YELLOW}  Video: https://www.youtube.com/watch?v=8uP2IrP3IG8${NC}"
echo ""
