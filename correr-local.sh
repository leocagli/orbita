#!/usr/bin/env bash
# Levanta Órbita en esta máquina: API en :3310 y web en :5310, con testnet real.
# Uso: ./correr-local.sh [parar]
set -uo pipefail
RAIZ="$(cd "$(dirname "$0")" && pwd)"
ESTADO="$HOME/.orbita"
mkdir -p "$ESTADO"

parar() {
  for f in "$ESTADO"/api.pid "$ESTADO"/web.pid; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null && pkill -P "$(cat "$f")" 2>/dev/null
    rm -f "$f"
  done
}
parar
[ "${1:-}" = "parar" ] && { echo "Órbita detenida"; exit 0; }

# Claves locales, generadas una vez y guardadas solo en esta máquina.
[ -f "$ESTADO/claves.env" ] || cat > "$ESTADO/claves.env" <<EOF
REGISTRO_CLAVE=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 16)
ADMIN_TOKEN=$(openssl rand -hex 16)
EOF
chmod 600 "$ESTADO/claves.env"
set -a; . "$ESTADO/claves.env"; set +a

cd "$RAIZ/backend"
SPONSOR_SECRET="$(stellar keys secret protege-deployer)" PORT=3310 PGLITE_DIR="$ESTADO/datos" ORIGENES_WEB="http://localhost:5310" \
  setsid nohup pnpm exec tsx src/local.ts > "$ESTADO/api.log" 2>&1 < /dev/null &
echo $! > "$ESTADO/api.pid"

cd "$RAIZ/web"
VITE_API_URL="http://localhost:3310" pnpm exec vite build --logLevel error >/dev/null
setsid nohup pnpm exec vite preview --host 0.0.0.0 --port 5310 --strictPort > "$ESTADO/web.log" 2>&1 < /dev/null &
echo $! > "$ESTADO/web.pid"

for i in $(seq 1 60); do
  curl -sf http://localhost:3310/v1/salud >/dev/null && curl -sf http://localhost:5310/ >/dev/null && break
  sleep 1
done
head -1 "$ESTADO/api.log"
curl -s http://localhost:3310/v1/salud; echo
echo "Web: http://localhost:5310"
