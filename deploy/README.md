# Российский VPS как реверс-прокси перед Vercel

## Зачем
Часть провайдеров РФ блокирует IP-диапазоны Vercel. Если поставить между
пользователем и Vercel VPS в РФ — провайдер видит только российский IP
и пропускает запросы. Vercel остаётся как был (автодеплой, скейл, превью).

## Архитектура

```
Юзер → DNS crm.iitit.ru → VPS в РФ → nginx → Vercel (crm-orcin-six.vercel.app)
```

## Что понадобится

- VPS на Ubuntu 22.04 / Debian 12. Минимально 1 vCPU + 1 GB RAM + 10 GB диска.
  Рекомендую Selectel (≈300₽/мес) или Timeweb Cloud (≈400₽/мес).
- SSH-доступ к VPS (root или sudo-юзер).
- Доступ к управлению DNS домена `iitit.ru`.

## Пошагово

### Шаг 1 — Купить VPS и получить IP

После создания у вас будет публичный IP. Запомните его, например `95.181.45.123`.

### Шаг 2 — Поменять DNS (ОДИН РАЗ)

В панели регистратора `iitit.ru`:
1. Удалить текущую CNAME-запись `crm` → `cname.vercel-dns.com` (или какая там сейчас).
2. Добавить **A-запись** `crm` → IP вашего VPS (например `95.181.45.123`).
3. TTL — 300 секунд (или минимально допустимый, чтобы быстрее переключилось).

Подождать 5-30 минут, пока DNS пропишется. Проверить:
```bash
dig +short crm.iitit.ru
# должно вернуть IP вашего VPS
```

### Шаг 3 — Запустить установочный скрипт

Подключиться к VPS по SSH:
```bash
ssh root@95.181.45.123
```

Запустить (одной командой):
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/fayr89/CRM/claude/build-crm-system-JzCP9/deploy/install.sh) crm.iitit.ru crm-orcin-six.vercel.app
```

Скрипт сам:
- Поставит nginx и certbot.
- Создаст конфиг для `crm.iitit.ru` (HTTP).
- Запросит SSL у Let's Encrypt и переведёт на HTTPS.
- Включит firewall (открыт только 22/80/443).
- Поставит автообновление SSL.

После выполнения — открой `https://crm.iitit.ru` в браузере. Должно работать
как раньше, только теперь трафик идёт через VPS.

### Шаг 4 — Проверить

1. Открой сайт в браузере с РФ-интернета (без VPN) → должен открыться сразу.
2. `curl -I https://crm.iitit.ru/health` → должно вернуть `HTTP/2 200`.
3. Залогиньтесь, посмотрите что заказы грузятся.

## Что делать если что-то не так

### Не получает SSL
Проверьте что DNS действительно показывает на VPS:
```bash
dig +short crm.iitit.ru
```
Если IP старый — подождите, иногда DNS кешируется до часа. Когда обновится,
переподнять certbot:
```bash
certbot --nginx -d crm.iitit.ru --agree-tos --no-eff-email -m your@email.ru
```

### Сайт открывается, но без авторизации (401 / 403)
Скорее всего у Vercel включена Deployment Protection. Зайдите в Vercel
→ Project → Settings → Deployment Protection → выключите для Production.

### Большие файлы не загружаются (например, фото в feedback)
По умолчанию nginx ограничивает body 1 МБ. Проверьте что в конфиге есть
`client_max_body_size 25M;` — скрипт ставит автоматически.

### Откатиться обратно на прямой Vercel
В DNS вернуть CNAME `crm` → `cname.vercel-dns.com` (тот специфичный, что
Vercel выдавал в Settings → Domains). VPS можно выключить.

## Мониторинг

Бесплатные uptime-сервисы — `uptimerobot.com`, `betteruptime.com`. Настройте
проверку `https://crm.iitit.ru/health` каждые 5 минут, на падение — алерт
в почту/Telegram.

## Что обновлять
- `apt update && apt upgrade -y` раз в 1-3 месяца (или включить
  unattended-upgrades — скрипт это делает).
- SSL обновляется автоматом через cron certbot.
- Конфиг nginx менять не нужно если ничего не меняли в архитектуре.

## Безопасность
- Скрипт открывает только 22/80/443 через ufw.
- Рекомендую заменить root-пароль на SSH-ключ:
  ```bash
  ssh-copy-id root@95.181.45.123
  # потом в /etc/ssh/sshd_config: PasswordAuthentication no
  # systemctl restart ssh
  ```
- nginx и SSL обновляются автоматически.
