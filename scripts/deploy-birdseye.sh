#!/usr/bin/env bash
# Concierge — birdseye deploy (run ON the server, or via:
#   ssh root@72.61.177.29 'bash /opt/concierge/scripts/deploy-birdseye.sh')
# Source is rsynced to /opt/concierge by the local deploy step; this script
# builds, (re)starts PM2, installs the nginx site, and sets the cron jobs.
# Safe to re-run. SSL: run the certbot line at the bottom once DNS resolves.
set -euo pipefail

APP_DIR=/opt/concierge
DOMAIN=concierge.scribechs.com
PORT=3014

cd "$APP_DIR"

echo "== install + build =="
npm ci
npx prisma generate
npm run build

echo "== pm2 =="
if pm2 describe concierge >/dev/null 2>&1; then
  pm2 restart concierge --update-env
else
  pm2 start npm --name concierge -- start
fi
pm2 save

echo "== nginx =="
if [ ! -f "/etc/nginx/sites-available/$DOMAIN" ]; then
  cat > "/etc/nginx/sites-available/$DOMAIN" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX
  ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
fi
nginx -t && systemctl reload nginx

echo "== cron (idempotent) =="
( crontab -l 2>/dev/null | grep -v "concierge-" ; cat <<CRON
# --gated: runs every firing 9am-1pm ET, otherwise only on the half hour.
*/5 * * * * cd $APP_DIR && npx tsx prisma/intake-gmail.ts 25 --gated >> /root/concierge-intake.log 2>&1
30 3 * * * cd $APP_DIR && npx tsx prisma/detect-learning.ts >> /root/concierge-learning.log 2>&1
30 4 * * * cd $APP_DIR && npx tsx prisma/import-products.ts >> /root/concierge-products.log 2>&1
30 2 * * * cd $APP_DIR && npx tsx prisma/analytics-backfill.ts >> /root/concierge-analytics.log 2>&1
0 3 * * * cd $APP_DIR && npx tsx prisma/import-shopify-orders.ts \$(date -d "\$(date +\%Y-\%m-01) -1 month" +\%Y-\%m-01)T00:00:00Z >> /root/concierge-orders.log 2>&1
15 3 * * * cd $APP_DIR && node scripts/dsp-update.cjs >> /root/concierge-analytics.log 2>&1
45 3 * * * cd $APP_DIR && npx tsx prisma/import-hubspot-orders.ts >> /root/concierge-orders.log 2>&1
# digests: 11:00 UTC = 7am EDT (6am EST in winter)
0 11 * * * cd $APP_DIR && npx tsx prisma/send-digest.ts daily >> /root/concierge-digest.log 2>&1
5 11 * * 1 cd $APP_DIR && npx tsx prisma/send-digest.ts weekly >> /root/concierge-digest.log 2>&1
0 2 * * * bash $APP_DIR/scripts/backup-db.sh >> /root/concierge-backup.log 2>&1
CRON
) | crontab -

echo "== smoke check =="
sleep 3
curl -sf -o /dev/null -w "localhost:$PORT -> HTTP %{http_code}\n" "http://127.0.0.1:$PORT/login"

echo
echo "DONE. After the DNS A record ($DOMAIN -> this server) resolves, run:"
echo "  certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m jake@scribechs.com"
