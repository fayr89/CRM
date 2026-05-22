#!/usr/bin/env bash
# Полный деплой CRM на Vercel + Supabase. Запускать локально.
#
# Использование:
#   curl -sL https://raw.githubusercontent.com/fayr89/CRM/claude/build-crm-system-JzCP9/scripts/deploy.sh -o deploy.sh
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Что делает:
#   1. Проверяет node, git, openssl, jq
#   2. Устанавливает vercel и supabase CLI глобально (через npm)
#   3. Логинит в оба сервиса (откроет браузер дважды — OAuth, паролей не нужно)
#   4. Создаёт проект в Supabase
#   5. Деплоит бэкенд из ветки claude/build-crm-system-JzCP9
#   6. Деплоит фронт из ветки v0/crm-direct-sales-b863f241 с правильным API URL
#   7. Печатает итоговые URL и креды для входа
#
# Ничего не отправляется наружу, токены лежат в ~/.vercel и ~/.supabase.

set -euo pipefail

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${G}▶${NC} $*"; }
step() { echo; echo -e "${B}━━━ $* ━━━${NC}"; }
warn() { echo -e "${Y}⚠${NC} $*"; }
err()  { echo -e "${R}✗${NC} $*"; exit 1; }

# 1. Prerequisites
step "1/8  Проверка инструментов"
command -v node    >/dev/null || err "Установите Node.js 20+: https://nodejs.org"
command -v git     >/dev/null || err "Установите git"
command -v openssl >/dev/null || err "openssl не найден"
command -v jq      >/dev/null || err "Установите jq: brew install jq / apt install jq"
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VER" -ge 20 ] || err "Нужен Node.js >= 20 (сейчас $(node -v))"
log "OK: node $(node -v), git $(git --version | awk '{print $3}'), jq"

# 2. Install CLIs
step "2/8  Установка vercel и supabase CLI"
if ! command -v vercel >/dev/null; then
  npm install -g vercel@latest 2>&1 | tail -2
fi
if ! command -v supabase >/dev/null; then
  npm install -g supabase@latest 2>&1 | tail -2
fi
log "vercel: $(vercel --version), supabase: $(supabase --version)"

# 3. Inputs
step "3/8  Параметры"
read -p "Email будущего админа CRM: " ADMIN_EMAIL
read -s -p "Пароль админа CRM (>=8 символов): " ADMIN_PASSWORD; echo
[ ${#ADMIN_PASSWORD} -ge 8 ] || err "Пароль должен быть >= 8 символов"

read -s -p "Пароль для базы Supabase (придумайте, >=8): " DB_PASSWORD; echo
[ ${#DB_PASSWORD} -ge 8 ] || err "Пароль БД должен быть >= 8 символов"

read -p "Имя админа [Администратор]: " ADMIN_NAME
ADMIN_NAME=${ADMIN_NAME:-Администратор}

echo
echo "Доступные регионы Supabase:"
echo "  eu-central-1 (Франкфурт) — для России/Европы, рекомендуется"
echo "  eu-west-1    (Дублин)"
echo "  eu-north-1   (Стокгольм)"
echo "  us-east-1    (Вирджиния)"
echo "  ap-south-1   (Мумбаи)"
echo "  ap-northeast-1 (Токио)"
read -p "Регион Supabase [eu-central-1]: " REGION
REGION=${REGION:-eu-central-1}

# Валидация региона
VALID_REGIONS="ap-east-1 ap-northeast-1 ap-northeast-2 ap-south-1 ap-southeast-1 ap-southeast-2 ca-central-1 eu-central-1 eu-central-2 eu-north-1 eu-west-1 eu-west-2 eu-west-3 sa-east-1 us-east-1 us-east-2 us-west-1 us-west-2"
if ! echo " $VALID_REGIONS " | grep -q " $REGION "; then
  err "Регион '$REGION' не поддерживается. Используйте один из: $VALID_REGIONS"
fi

JWT_SECRET=$(openssl rand -hex 32)
TIMESTAMP=$(date +%s)
log "Параметры приняты, JWT_SECRET сгенерирован"

# 4. Login
step "4/8  Авторизация (откроется браузер 2 раза)"
if ! vercel whoami >/dev/null 2>&1; then
  log "Логин в Vercel..."
  vercel login
fi
log "Vercel: $(vercel whoami 2>&1 | tail -1)"

if ! supabase projects list >/dev/null 2>&1; then
  log "Логин в Supabase..."
  supabase login
fi
log "Supabase: вход выполнен"

# 5. Supabase project
step "5/8  Создание проекта Supabase"
ORG_ID=$(supabase orgs list -o json 2>/dev/null | jq -r '.[0].id' 2>/dev/null || echo "")
if [ -z "$ORG_ID" ]; then
  warn "Не получилось через JSON, пробую парсить таблицу..."
  ORG_ID=$(supabase orgs list 2>&1 | awk 'NR>2 && /^[a-z0-9-]/ {print $1; exit}')
fi
[ -z "$ORG_ID" ] && err "Не нашёл организацию Supabase. Зарегистрируйтесь на supabase.com"
log "Org ID: $ORG_ID"

PROJECT_NAME="crm-$TIMESTAMP"
log "Создаю '$PROJECT_NAME' в регионе $REGION..."

SUPA_OUT=$(supabase projects create "$PROJECT_NAME" \
    --org-id "$ORG_ID" \
    --db-password "$DB_PASSWORD" \
    --region "$REGION" \
    -o json 2>&1) || err "supabase projects create упал: $SUPA_OUT"

PROJECT_REF=$(echo "$SUPA_OUT" | jq -r '.id // .ref // empty' 2>/dev/null)
if [ -z "$PROJECT_REF" ]; then
  PROJECT_REF=$(echo "$SUPA_OUT" | grep -oE '[a-z]{20}' | head -1)
fi
[ -z "$PROJECT_REF" ] && err "Не получил ref проекта. Вывод CLI: $SUPA_OUT"

log "Проект создан: $PROJECT_NAME (ref=$PROJECT_REF)"
log "Жду готовности БД (~60 сек)..."
sleep 60

DATABASE_URL="postgresql://postgres.${PROJECT_REF}:${DB_PASSWORD}@aws-0-${REGION}.pooler.supabase.com:6543/postgres"
log "DATABASE_URL: postgresql://postgres.${PROJECT_REF}:***@aws-0-${REGION}.pooler.supabase.com:6543/postgres"

# 6. Backend deploy
step "6/8  Деплой бэкенда"
WORKDIR=$(mktemp -d -t crm-deploy.XXXXXX)
trap 'echo "Workdir: $WORKDIR"' EXIT

cd "$WORKDIR"
log "Клонирую бэкенд-ветку в $WORKDIR/backend..."
git clone --depth 1 -b claude/build-crm-system-JzCP9 https://github.com/fayr89/CRM.git backend
cd backend

BACKEND_PROJECT="crm-backend-$TIMESTAMP"

# Удаляем .vercel чтобы свежо линковать
rm -rf .vercel

log "Линкую к новому проекту $BACKEND_PROJECT..."
vercel link --yes --project "$BACKEND_PROJECT" 2>&1 | tail -3 || \
  warn "Линк с --project не сработал, продолжаю — деплой сам создаст проект"

# Устанавливаем env переменные
add_env() {
  local key="$1" value="$2"
  printf "%s" "$value" | vercel env add "$key" production 2>&1 | tail -1 || \
    warn "env add $key — возможно уже есть, продолжаю"
}

log "Устанавливаю переменные окружения..."
add_env DATABASE_URL "$DATABASE_URL"
add_env JWT_SECRET "$JWT_SECRET"
add_env ADMIN_EMAIL "$ADMIN_EMAIL"
add_env ADMIN_PASSWORD "$ADMIN_PASSWORD"
add_env ADMIN_NAME "$ADMIN_NAME"
add_env NODE_ENV "production"

log "Запускаю production deploy..."
DEPLOY_OUT=$(vercel deploy --prod --yes 2>&1) || err "Деплой бэкенда упал:\n$DEPLOY_OUT"
BACKEND_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)
[ -z "$BACKEND_URL" ] && err "Не нашёл URL в выводе:\n$DEPLOY_OUT"
log "Бэкенд: $BACKEND_URL"

# Smoke test
log "Жду 10 сек и проверяю health..."
sleep 10
HEALTH=$(curl -sf "$BACKEND_URL/health" 2>&1 || echo "FAIL")
if [[ "$HEALTH" == *'"status":"ok"'* ]]; then
  log "Health: OK ✅"
else
  warn "Health не отвечает сразу — БД ещё инициализируется. Проверьте $BACKEND_URL/health через минуту."
fi

# 7. Frontend deploy
step "7/8  Деплой фронтенда"
cd "$WORKDIR"
log "Клонирую фронт-ветку в $WORKDIR/frontend..."
git clone --depth 1 -b v0/crm-direct-sales-b863f241 https://github.com/fayr89/CRM.git frontend
cd frontend

FRONTEND_PROJECT="crm-frontend-$TIMESTAMP"
rm -rf .vercel

log "Линкую к $FRONTEND_PROJECT..."
vercel link --yes --project "$FRONTEND_PROJECT" 2>&1 | tail -3 || true

log "Устанавливаю NEXT_PUBLIC_API_URL=$BACKEND_URL..."
printf "%s" "$BACKEND_URL" | vercel env add NEXT_PUBLIC_API_URL production 2>&1 | tail -1

log "Запускаю production deploy фронтенда..."
DEPLOY_OUT=$(vercel deploy --prod --yes 2>&1) || err "Деплой фронта упал:\n$DEPLOY_OUT"
FRONTEND_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)
[ -z "$FRONTEND_URL" ] && err "Не нашёл URL фронта в выводе:\n$DEPLOY_OUT"
log "Фронт: $FRONTEND_URL"

# 8. Done
step "8/8  Готово"
cat << INFO

${G}═══════════════════════════════════════════════════${NC}
${G}    ✅ CRM запущена на Vercel + Supabase${NC}
${G}═══════════════════════════════════════════════════${NC}

Фронтенд (UI):    ${B}$FRONTEND_URL${NC}
Бэкенд (API):     ${B}$BACKEND_URL${NC}
Supabase:         ${B}https://supabase.com/dashboard/project/$PROJECT_REF${NC}

Вход:
  Email:    $ADMIN_EMAIL
  Пароль:   (тот что вы ввели)

Демо-данные (опционально):
  cd $WORKDIR/backend
  DATABASE_URL='$DATABASE_URL' \\
    ADMIN_EMAIL='$ADMIN_EMAIL' \\
    ADMIN_PASSWORD='ваш-пароль' \\
    JWT_SECRET='$JWT_SECRET' \\
    npm install --silent && npm run seed

Что дальше:
  • Залейте свой логотип в public/logo.svg (ветка v0/...)
  • При желании настройте собственный домен в Vercel → Project Settings → Domains
  • Скажите мне в чате, чтобы подключить Next.js UI к API (заменю mock-data на fetch)

INFO

trap - EXIT
echo "Workdir с клонами: $WORKDIR (можно удалить когда не нужно)"
