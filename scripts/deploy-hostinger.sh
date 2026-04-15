#!/usr/bin/env bash
# deploy-hostinger.sh — Deploy Computer app to Hostinger VPS
# Usage: bash deploy-hostinger.sh

set -euo pipefail

HOSTINGER_TOKEN="nRXCRnkK9VBekTEfEAGI9uMpabICInUZmRoNMqpPd4955fb5"
DOMAIN="computer.paxipatelbot.in"
APP_DIR="/var/www/computer"
APP_PORT=3000
REPO="https://github.com/paxipatel-beep/vlights-ar.git"
BRANCH="claude/install-ruflo-fresh-oY2tA"

echo "==> Fetching VPS details from Hostinger..."
VPS_JSON=$(curl -s -H "Authorization: Bearer $HOSTINGER_TOKEN" \
  "https://developers.hostinger.com/api/vps/v1/virtual-machines")

VPS_IP=$(echo "$VPS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
vms = data.get('data', data) if isinstance(data, dict) else data
vm = vms[0] if isinstance(vms, list) else list(vms.values())[0]
ips = vm.get('ip_addresses', vm.get('ips', []))
print(next(ip for ip in ips if ':' not in str(ip.get('address','') if isinstance(ip,dict) else ip)))
" 2>/dev/null || echo "")

if [ -z "$VPS_IP" ]; then
  echo "Could not auto-detect VPS IP. Enter it manually:"
  read -rp "VPS IP: " VPS_IP
fi

echo "==> VPS IP: $VPS_IP"
echo "==> Deploying to $VPS_IP..."

# Prompt for Anthropic API key
read -rp "Enter your ANTHROPIC_API_KEY: " ANTHROPIC_KEY

ssh -o StrictHostKeyChecking=no root@"$VPS_IP" bash <<ENDSSH
set -e

echo "--- Installing dependencies ---"
apt-get update -qq
apt-get install -y -qq curl git nginx

# Install Node 22
if ! command -v node &>/dev/null || [ "\$(node -e 'process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)' 2>/dev/null; echo \$?)" = "1" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Install pm2
npm install -g pm2 2>/dev/null

echo "--- Cloning repo ---"
rm -rf $APP_DIR
git clone --branch $BRANCH $REPO $APP_DIR
cd $APP_DIR
npm install --production

echo "--- Writing .env ---"
cat > $APP_DIR/.env <<EOF
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
SEARCH_PROVIDER=mock
PORT=$APP_PORT
NODE_ENV=production
OUTPUT_DIR=$APP_DIR/output
EOF

mkdir -p $APP_DIR/output

echo "--- Starting app with pm2 ---"
pm2 delete computer 2>/dev/null || true
pm2 start $APP_DIR/src/api/server.js --name computer --cwd $APP_DIR
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo "--- Configuring nginx ---"
cat > /etc/nginx/sites-available/computer <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_cache_bypass \\\$http_upgrade;
        # SSE support
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/computer /etc/nginx/sites-enabled/computer
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "==================================================="
echo " App deployed!"
echo " http://$DOMAIN  (once DNS points to $VPS_IP)"
echo " http://$VPS_IP  (available immediately)"
echo "==================================================="
ENDSSH
