#!/usr/bin/env bash
# Продолжение деплоя — если основной скрипт упал после создания Supabase-проекта.
# Передай ref проекта и пароль БД через переменные:
#
#   SUPABASE_REF=brmwrsefoxatjrxvcaaa \
#   SUPABASE_REGION=eu-central-1 \
#   ./scripts/deploy-continue.sh
#
# Если переменных нет — спросит интерактивно.

set -euo pipefail

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${G}▶${NC} $*"; }
step() { echo; echo -e "${B}━━━ $* ━━━${NC}"; }
warn() { echo -e "${Y}⚠${NC} $*"; }
err()  { echo -e "${R}✗${NC} $*"; exit 1; }

step "Продолжение деплоя"

if [ -z "${SUPABASE_REF:-}" ]; then
  read -p "REF проекта Supabase (20 букв): " SUPABASE_REF
fi
if [ -z "${SUPABASE_REGION:-}" ]; then
  read -p "Регион [eu-central-1]: " SUPABASE_REGION
  SUPABASE_REGION=${SUPABASE_REGION:-eu-central-1}
fi
read -s -p "Пароль БД Supabase (тот что вводили): " DB_PASSWORD; echo
[ ${#DB_PASSWORD} -lt 6 ] && err "Слишком короткий пароль"

read -p "Email админа CRM: " ADMIN_EMAIL
read -s -p "Пароль админа CRM (>=8): " ADMIN_PASSWORD; echo
[ ${#ADMIN_PASSWORD} -lt 8 ] && err "Пароль админа >= 8 символов"
read -p "Имя админа [Администратор]: " ADMIN_NAME
ADMIN_NAME=${ADMIN_NAME:-Администратор}

JWT_SECRET=$(openssl rand -hex 32)
TIMESTAMP=$(date +%s)
DATABASE_URL="postgresql://postgres.${SUPABASE_REF}:${DB_PASSWORD}@aws-0-${SUPABASE_REGION}.pooler.supabase.com:6543/postgres"
log "DATABASE_URL собран"

# Wait for DB to be ready (Supabase init can take 60-90s)
step "Жду готовности БД"
for i in $(seq 1 30); do
  # Простой TCP-чек через node:
  if node -e "
    const net=require('net');
    const s=net.connect({host:'aws-0-${SUPABASE_REGION}.pooler.supabase.com',port:6543,timeout:3000});
    s.on('connect',()=>{s.end();process.exit(0)});
    s.on('error',()=>process.exit(1));
    s.on('timeout',()=>process.exit(1));
  " 2>/dev/null; then
    log "БД отвечает на порту 6543"
    break
  fi
  printf "."
  sleep 3
done
echo

step "Деплой бэкенда"
WORKDIR=$(mktemp -d -t crm-deploy.XXXXXX 2>/dev/null || echo "$HOME/crm-deploy-tmp-$TIMESTAMP")
mkdir -p "$WORKDIR"
cd "$WORKDIR"

log "Клонирую бэкенд..."
git clone --depth 1 -b claude/build-crm-system-JzCP9 https://github.com/fayr89/CRM.git backend
cd backend
rm -rf .vercel

BACKEND_PROJECT="crm-backend-$TIMESTAMP"
log "Линкую к Vercel-проекту $BACKEND_PROJECT..."
vercel link --yes --project "$BACKEND_PROJECT" 2>&1 | tail -3 || true

add_env() {
  local key="$1" value="$2"
  printf "%s" "$value" | vercel env add "$key" production 2>&1 | tail -1 || \
    warn "env add $key — уже существует, пропускаю"
}

log "Устанавливаю env-переменные..."
add_env DATABASE_URL "$DATABASE_URL"
add_env JWT_SECRET "$JWT_SECRET"
add_env ADMIN_EMAIL "$ADMIN_EMAIL"
add_env ADMIN_PASSWORD "$ADMIN_PASSWORD"
add_env ADMIN_NAME "$ADMIN_NAME"
add_env NODE_ENV "production"

log "Production deploy бэкенда..."
DEPLOY_OUT=$(vercel deploy --prod --yes 2>&1) || err "Деплой упал:\n$DEPLOY_OUT"
BACKEND_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)
[ -z "$BACKEND_URL" ] && err "Не нашёл URL в выводе"
log "Бэкенд: $BACKEND_URL"

log "Проверка /health (через 10 сек)..."
sleep 10
HEALTH=$(curl -sf "$BACKEND_URL/health" 2>&1 || echo "FAIL")
if [[ "$HEALTH" == *'"status":"ok"'* ]]; then
  log "Health: OK ✅"
else
  warn "Health не сразу — БД ещё инициализируется, проверьте $BACKEND_URL/health через 1-2 мин"
fi

step "Деплой фронтенда"
cd "$WORKDIR"
log "Клонирую фронтенд..."
git clone --depth 1 -b v0/crm-direct-sales-b863f241 https://github.com/fayr89/CRM.git frontend
cd frontend
rm -rf .vercel

FRONTEND_PROJECT="crm-frontend-$TIMESTAMP"
log "Линкую к Vercel-проекту $FRONTEND_PROJECT..."
vercel link --yes --project "$FRONTEND_PROJECT" 2>&1 | tail -3 || true

log "NEXT_PUBLIC_API_URL=$BACKEND_URL"
printf "%s" "$BACKEND_URL" | vercel env add NEXT_PUBLIC_API_URL production 2>&1 | tail -1 || \
  warn "env add — возможно уже есть"

log "Production deploy фронтенда..."
DEPLOY_OUT=$(vercel deploy --prod --yes 2>&1) || err "Деплой фронта упал:\n$DEPLOY_OUT"
FRONTEND_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)
[ -z "$FRONTEND_URL" ] && err "Не нашёл URL фронта"

step "Готово"
cat << INFO

${G}═══════════════════════════════════════════════════${NC}
${G}    ✅ CRM запущена${NC}
${G}═══════════════════════════════════════════════════${NC}

Фронтенд:  ${B}$FRONTEND_URL${NC}
Бэкенд:    ${B}$BACKEND_URL${NC}
Supabase:  ${B}https://supabase.com/dashboard/project/$SUPABASE_REF${NC}

Вход в CRM:
  Email:   $ADMIN_EMAIL
  Пароль:  (введённый)

Если хочешь демо-данные:
  cd $WORKDIR/backend
  DATABASE_URL='$DATABASE_URL' \\
    ADMIN_EMAIL='$ADMIN_EMAIL' \\
    ADMIN_PASSWORD='пароль' \\
    JWT_SECRET='$JWT_SECRET' \\
    npm install --silent && npm run seed

INFO
echo "Workdir: $WORKDIR"
