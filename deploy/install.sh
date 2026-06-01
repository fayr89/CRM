#!/usr/bin/env bash
# Установка nginx + SSL для проксирования российского домена на Vercel.
# Запуск:
#   bash <(curl -fsSL https://raw.githubusercontent.com/fayr89/CRM/claude/build-crm-system-JzCP9/deploy/install.sh) crm.iitit.ru crm-orcin-six.vercel.app
# Аргументы:
#   $1 — публичный домен (то, что у пользователя в браузере, например crm.iitit.ru)
#   $2 — upstream на Vercel (например crm-orcin-six.vercel.app)

set -euo pipefail

DOMAIN="${1:-}"
UPSTREAM="${2:-}"

if [[ -z "$DOMAIN" || -z "$UPSTREAM" ]]; then
  echo "Использование: $0 <ваш-домен> <upstream-vercel-домен>" >&2
  echo "Пример:        $0 crm.iitit.ru crm-orcin-six.vercel.app" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Запустите от root (sudo bash $0 ...)" >&2
  exit 1
fi

ADMIN_EMAIL_DEFAULT="admin@${DOMAIN#*.}"
read -r -p "Email для Let's Encrypt уведомлений [${ADMIN_EMAIL_DEFAULT}]: " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-$ADMIN_EMAIL_DEFAULT}"

echo "==> Обновляю пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx ufw unattended-upgrades

echo "==> Включаю firewall (открыт только 22 / 80 / 443)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "==> Включаю unattended-upgrades (авто-патчи безопасности)"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

CONF_PATH="/etc/nginx/sites-available/${DOMAIN}.conf"
echo "==> Создаю конфиг ${CONF_PATH} (пока HTTP, для certbot challenge)"

cat > "$CONF_PATH" <<NGINX
# Reverse proxy: ${DOMAIN} → ${UPSTREAM} (Vercel)
# SSL прописывает certbot ниже автоматически.

upstream vercel_upstream {
    # Vercel CDN. Резолвится при каждом cold-start nginx.
    server ${UPSTREAM}:443;
    keepalive 16;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # Лимит на тело запроса (фидбек с аттачами до ~10mb по фактическому коду).
    client_max_body_size 25M;

    # Таймауты — даём МС-вызовам и пр. подышать.
    proxy_connect_timeout 15s;
    proxy_send_timeout    60s;
    proxy_read_timeout    60s;

    location / {
        proxy_pass https://vercel_upstream;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name ${UPSTREAM};

        # КЛЮЧЕВОЕ: Vercel роутит по Host. Передаём публичный домен,
        # чтобы он попал в правильный проект (он у вас уже добавлен
        # как custom domain в Vercel Settings → Domains).
        proxy_set_header Host ${DOMAIN};

        # Реальный IP клиента — для аудит-лога CRM.
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;

        # Keep-alive до upstream — меньше задержка на повторных запросах.
        proxy_set_header Connection "";

        # Без буфера для стримов (SSE/long-poll если будут).
        proxy_buffering off;
    }

    # certbot оставит здесь свои файлы для challenge.
    location ~ /\.well-known/acme-challenge { allow all; root /var/www/html; }
}
NGINX

# Включаем сайт.
ln -sf "$CONF_PATH" "/etc/nginx/sites-enabled/${DOMAIN}.conf"

# Удаляем дефолтный nginx-конфиг чтобы не мешал.
rm -f /etc/nginx/sites-enabled/default

echo "==> Проверяю синтаксис nginx"
nginx -t

echo "==> Перезагружаю nginx"
systemctl reload nginx
systemctl enable nginx >/dev/null

echo "==> Запрашиваю SSL у Let's Encrypt для ${DOMAIN}"
echo "    (если DNS ещё не указал на этот VPS — упадёт; подождите и запустите"
echo "     certbot --nginx -d ${DOMAIN} --agree-tos --no-eff-email -m ${ADMIN_EMAIL}"
echo "     вручную, когда DNS пропишется)"

if certbot --nginx --non-interactive --agree-tos --no-eff-email \
    -m "${ADMIN_EMAIL}" -d "${DOMAIN}" --redirect; then
    echo "==> SSL установлен"
else
    echo "!! certbot упал. DNS возможно ещё не пропишется. Дождитесь, потом:"
    echo "   certbot --nginx -d ${DOMAIN} --agree-tos --no-eff-email -m ${ADMIN_EMAIL} --redirect"
fi

# Авто-обновление SSL через systemd-таймер уже включается пакетом certbot;
# для надёжности явно дёрнем.
systemctl enable certbot.timer >/dev/null 2>&1 || true
systemctl start certbot.timer >/dev/null 2>&1 || true

echo ""
echo "================================================================"
echo "  Готово."
echo "  Проверьте: https://${DOMAIN}/health"
echo "  Должно вернуть {\"status\":\"ok\",\"timestamp\":\"...\"}"
echo "================================================================"
