#!/usr/bin/env bash
# Despliega Órbita en Vercel sin pasar por la interfaz web: crea o reutiliza los dos
# proyectos, carga las variables y publica a producción.
#
# Antes de correrlo:
#   1. Crear un token en https://vercel.com/account/tokens y guardarlo en ~/.config/orbita/vercel-token
#   2. Crear una base en Neon (https://neon.tech) y guardar su cadena de conexión en ~/.config/orbita/database-url
#   Los dos archivos con chmod 600. Nada de esto se imprime en pantalla.
#
# Uso: scripts/desplegar-vercel.sh [equipo]
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$HOME/.config/orbita"
WEB="orbitaar7"
API="orbitaar7-api"
EQUIPO="${1:-}"

leer() { [ -f "$1" ] && tr -d '\r\n' < "$1"; }

TOKEN="$(leer "$CONF/vercel-token" || true)"
BASE="$(leer "$CONF/database-url" || true)"

if [ -z "${TOKEN:-}" ]; then
  echo "Falta el token de Vercel en $CONF/vercel-token" >&2
  echo "Crealo en https://vercel.com/account/tokens y guardalo así:" >&2
  echo "  mkdir -p $CONF && printf '%s' 'TU_TOKEN' > $CONF/vercel-token && chmod 600 $CONF/vercel-token" >&2
  exit 2
fi

vc() { npx -y vercel@latest "$@" --token "$TOKEN" ${EQUIPO:+--scope "$EQUIPO"}; }

# Una variable por entorno, reemplazando la anterior si existe.
poner_var() {
  local dir="$1" nombre="$2" valor="$3"
  vc env rm "$nombre" production --yes --cwd "$dir" >/dev/null 2>&1 || true
  printf '%s' "$valor" | vc env add "$nombre" production --cwd "$dir" >/dev/null
  echo "  variable $nombre cargada"
}

echo "== Proyecto $API (backend)"
vc link --yes --project "$API" --cwd "$RAIZ/backend" >/dev/null
poner_var "$RAIZ/backend" ORIGENES_WEB "https://$WEB.vercel.app"
if [ -n "${BASE:-}" ]; then
  poner_var "$RAIZ/backend" DATABASE_URL "$BASE"
else
  echo "  sin DATABASE_URL: la API va a responder 503 en casi todo. Cargá Neon y volvé a correr." >&2
fi
URL_API="https://$API.vercel.app"
vc deploy --prod --yes --cwd "$RAIZ/backend" >/dev/null
echo "  desplegada en $URL_API"

echo "== Proyecto $WEB (web)"
vc link --yes --project "$WEB" --cwd "$RAIZ/web" >/dev/null
poner_var "$RAIZ/web" VITE_API_URL "$URL_API"
poner_var "$RAIZ/web" VITE_DOMINIO_WEB "$WEB.vercel.app"
vc deploy --prod --yes --cwd "$RAIZ/web" >/dev/null
echo "  desplegada en https://$WEB.vercel.app"

echo "== Comprobación"
printf '  API salud: '; curl -s -o /dev/null -w '%{http_code}\n' "$URL_API/v1/salud"
printf '  web: '; curl -s -o /dev/null -w '%{http_code}\n' "https://$WEB.vercel.app/"
printf '  CORS de la web hacia la API: '
curl -s -D - -o /dev/null -H "Origin: https://$WEB.vercel.app" "$URL_API/v1/salud" | grep -i '^access-control-allow-origin' | tr -d '\r' || echo "sin permiso"
