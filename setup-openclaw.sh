#!/usr/bin/env bash
# ============================================================
# OpenClaw + Ollama Setup Script
# Based on: "I Built a FREE OpenClaw (no Mac Mini or API Fees)"
#           by Stephen G. Pope (@StephenGPope)
#
# This script installs Ollama and OpenClaw on Linux so you can
# run a personal AI assistant 100% free — no Mac Mini, no paid
# API keys. Everything runs locally on your hardware.
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# -----------------------------------------------------------
# 1. Check prerequisites
# -----------------------------------------------------------
info "Checking prerequisites..."

if ! command -v node &>/dev/null; then
    error "Node.js is required but not installed. Install Node 22+ first:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    warn "Node.js version $(node -v) detected. Node 22+ is recommended."
fi

info "Node.js $(node -v) ✓"

# -----------------------------------------------------------
# 2. Install Ollama (if not already installed)
# -----------------------------------------------------------
if command -v ollama &>/dev/null; then
    info "Ollama already installed: $(ollama --version)"
else
    info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    info "Ollama installed ✓"
fi

# Ensure Ollama service is running
if ! pgrep -x "ollama" &>/dev/null; then
    info "Starting Ollama service..."
    ollama serve &>/dev/null &
    sleep 3
    info "Ollama service started ✓"
else
    info "Ollama service is running ✓"
fi

# -----------------------------------------------------------
# 3. Pull a recommended free local model
# -----------------------------------------------------------
echo ""
info "Pulling a recommended local model..."
echo "  Choose a model based on your GPU VRAM:"
echo ""
echo "  [1] qwen3:8b        (~5 GB VRAM)  — Good for 8GB GPUs"
echo "  [2] qwen3:14b       (~10 GB VRAM) — Better quality, 16GB GPUs"
echo "  [3] qwen3-coder:32b (~20 GB VRAM) — Best local, 24GB+ GPUs"
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
    info "Pulling $MODEL (this may take a while on first run)..."
    ollama pull "$MODEL"
    info "Model $MODEL ready ✓"
else
    warn "Skipping model pull. Run 'ollama pull <model>' later."
fi

# -----------------------------------------------------------
# 4. Install OpenClaw
# -----------------------------------------------------------
if command -v openclaw &>/dev/null; then
    info "OpenClaw already installed ✓"
else
    info "Installing OpenClaw..."
    curl -fsSL https://openclaw.ai/install.sh | bash
    info "OpenClaw installed ✓"
fi

# -----------------------------------------------------------
# 5. Launch OpenClaw with Ollama (or run onboarding)
# -----------------------------------------------------------
echo ""
echo "============================================================"
echo -e "${GREEN} OpenClaw + Ollama Setup Complete! ${NC}"
echo "============================================================"
echo ""
echo "  Quick Start Options:"
echo ""
echo "  Option A — Launch via Ollama (easiest, recommended):"
if [ "$MODEL" != "skip" ]; then
    echo "    ollama launch openclaw --model $MODEL"
else
    echo "    ollama launch openclaw --model qwen3:8b"
fi
echo ""
echo "  Option B — Launch via OpenClaw directly:"
echo "    openclaw onboard --install-daemon"
echo ""
echo "  Option C — Use free cloud models (no GPU needed):"
echo "    ollama launch openclaw --model kimi-k2.5:cloud"
echo "    ollama launch openclaw --model minimax-m2.5:cloud"
echo "    ollama launch openclaw --model glm-5:cloud"
echo ""
echo "  Connect messaging apps (Telegram, WhatsApp, etc.):"
echo "    openclaw configure --section channels"
echo ""
echo "  Check gateway status:"
echo "    openclaw gateway status"
echo ""
echo "  Open the dashboard:"
echo "    openclaw dashboard"
echo ""
echo "============================================================"
echo -e "${YELLOW} Security Note: Run OpenClaw in an isolated"
echo -e " environment. It can read files and execute actions.${NC}"
echo "============================================================"
