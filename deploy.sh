#!/usr/bin/env bash
# =============================================================================
#  vlights AR Dashboard — One-Shot VPS Deploy Script
#  Target: Ubuntu 20.04/22.04 LTS on Hostinger VPS
#  Domain:  payments.paxipatelbot.in
#  Run as:  sudo bash deploy.sh
# =============================================================================
set -e

APP_DIR="/var/www/vlights-ar"
DOMAIN="payments.paxipatelbot.in"
PORT="3000"
DASHBOARD_PASSWORD="Prakash_9892284364"
EMAIL="paxipatel@gmail.com"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${BLUE}══${NC} $1"; }

# ── Root check ───────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo bash deploy.sh"
fi

step "1. System update & dependencies"
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw

# ── Node.js 20 LTS via NodeSource ────────────────────────────────────────────
step "2. Installing Node.js 20 LTS"
if ! node --version 2>/dev/null | grep -q "v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs
fi
node --version
npm --version
log "Node.js installed"

# ── PM2 ──────────────────────────────────────────────────────────────────────
step "3. Installing PM2 process manager"
npm install -g pm2 --quiet
log "PM2 installed: $(pm2 --version)"

# ── App directory ─────────────────────────────────────────────────────────────
step "4. Setting up application directory"
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/data"    # SQLite database lives here

# Copy app files from current directory (run deploy.sh from inside the project folder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Copying app files from $SCRIPT_DIR → $APP_DIR"
rsync -a --exclude='.env' --exclude='node_modules' --exclude='data' "$SCRIPT_DIR/" "$APP_DIR/"

# ── npm install ───────────────────────────────────────────────────────────────
step "5. Installing Node dependencies"
cd "$APP_DIR"
npm install --omit=dev --quiet
log "Dependencies installed"

# ── .env file ────────────────────────────────────────────────────────────────
step "6. Writing .env configuration"
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=$PORT
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
SESSION_SECRET=$SESSION_SECRET
DB_PATH=./data/vlights.db
EOF
chmod 600 "$APP_DIR/.env"
log ".env written (session secret randomized)"

# ── Permissions ───────────────────────────────────────────────────────────────
chown -R www-data:www-data "$APP_DIR"
chmod -R 755 "$APP_DIR"
chmod 700 "$APP_DIR/data"

# ── PM2 startup ───────────────────────────────────────────────────────────────
step "7. Starting app with PM2"
# Stop old instance if exists
pm2 delete vlights-ar 2>/dev/null || true

cd "$APP_DIR"
pm2 start server.js \
  --name vlights-ar \
  --env production \
  --log /var/log/vlights-ar.log \
  --error /var/log/vlights-ar-err.log \
  --time \
  --restart-delay=3000 \
  --max-memory-restart=512M

pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || true
log "PM2 started: vlights-ar running on port $PORT"

# ── Firewall ──────────────────────────────────────────────────────────────────
step "8. Configuring firewall"
ufw allow 22/tcp  > /dev/null 2>&1 || true
ufw allow 80/tcp  > /dev/null 2>&1 || true
ufw allow 443/tcp > /dev/null 2>&1 || true
ufw --force enable > /dev/null 2>&1 || true
log "Firewall: 22, 80, 443 open"

# ── Nginx config ─────────────────────────────────────────────────────────────
step "9. Writing Nginx configuration"
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

cat > "$NGINX_CONF" <<NGINXEOF
# vlights AR Dashboard — $DOMAIN
# Managed by deploy.sh — do not edit manually

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Health check endpoint (skip auth)
    location /health {
        proxy_pass http://127.0.0.1:$PORT/health;
        proxy_http_version 1.1;
    }

    # Proxy all traffic to Node.js app
    location / {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_http_version 1.1;

        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host       \$host;
        proxy_set_header X-Real-IP  \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_cache_bypass      \$http_upgrade;
        proxy_read_timeout      300s;
        proxy_connect_timeout   75s;

        # Upload size limit (for bulk CSV/Excel upload)
        client_max_body_size    20M;
    }

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;
}
NGINXEOF

# Enable site
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Test Nginx config
nginx -t
systemctl reload nginx
log "Nginx configured for $DOMAIN"

# ── SSL with Certbot ──────────────────────────────────────────────────────────
step "10. Obtaining SSL certificate (Let's Encrypt)"
warn "Make sure $DOMAIN → this server's IP in DNS before proceeding."
warn "Waiting 5 seconds… (Ctrl+C to abort SSL setup)"
sleep 5

if certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect; then
  log "SSL certificate installed. HTTPS enabled!"
else
  warn "Certbot failed. Dashboard is accessible via HTTP for now."
  warn "Fix DNS and re-run: sudo certbot --nginx -d $DOMAIN --email $EMAIL"
fi

# ── Auto-renew SSL ────────────────────────────────────────────────────────────
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | sort -u | crontab -
log "SSL auto-renewal cron set (3am daily)"

# ── Final status ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  vlights AR Dashboard — Deploy Complete!   ${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo -e "  URL:      ${BLUE}https://$DOMAIN${NC}"
echo -e "  Password: ${YELLOW}$DASHBOARD_PASSWORD${NC}"
echo -e "  DB:       $APP_DIR/data/vlights.db"
echo -e "  Logs:     pm2 logs vlights-ar"
echo ""
echo -e "  PM2 status: $(pm2 list | grep vlights-ar | awk '{print $18}')"
echo ""
echo -e "${GREEN}  All done. Share the URL with your team!${NC}"
echo ""
