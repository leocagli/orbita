#!/usr/bin/env bash
# Extiende al máximo el TTL de todo lo que Órbita necesita vivo en testnet: nuestros
# contratos y la infraestructura compartida de passkeys (WASM de la cuenta inteligente y
# verificador WebAuthn de smart-account-kit). Cualquiera puede extender un TTL pagando la
# comisión, así que esto también mantiene viva la infraestructura para otros proyectos.
#
# Uso: ./scripts/mantener-ttl.sh [identidad]   (por defecto: protege-deployer)
# Lo corre GitHub Actions cada semana (.github/workflows/mantener-ttl.yml).
set -uo pipefail
FUENTE="${1:-protege-deployer}"
RED=testnet
N=3110000 # maxEntryTtl de testnet: 3.110.400 ledgers (~180 días)

CUENTA_WASM=1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a
CONTRATOS=(
  "verificador WebAuthn:CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F"
  "family-registry:CA5SSO56XW6XGQJTZXTOM25XPTFL5C5IQOSGQ55GD6CSRKQP3MKZFKLD"
  "anclas:CCGNGLJ5ZMNRIJB4GURJISTDEJYLIHOBNS2ZKF7TEGAVQ7DIINV4YVZN"
  "learning-badges:CDSNCELUGNKQ7ECT7J7MYL2UC6J2ROYMCSLFFAYUPKZMDMXWNUWBGWQZ"
)

fallos=0
extender() {
  local etiqueta=$1; shift
  if out=$(stellar contract extend "$@" --ledgers-to-extend $N --durability persistent --source "$FUENTE" --network $RED 2>&1); then
    echo "OK    $etiqueta: $(echo "$out" | tail -1)"
  else
    echo "FALLO $etiqueta: $(echo "$out" | tail -2 | tr '\n' ' ')"
    fallos=$((fallos + 1))
  fi
}

hash_de() {
  local d; d=$(mktemp -d)
  stellar contract fetch --id "$1" --network $RED -o "$d/c.wasm" >/dev/null 2>&1 && sha256sum "$d/c.wasm" | cut -d' ' -f1
  rm -rf "$d"
}

extender "WASM cuenta inteligente" --wasm-hash "$CUENTA_WASM"
for par in "${CONTRATOS[@]}"; do
  nombre=${par%%:*}; id=${par#*:}
  extender "$nombre (instancia)" --id "$id"
  h=$(hash_de "$id")
  if [ -n "$h" ]; then extender "$nombre (código)" --wasm-hash "$h"; else echo "FALLO $nombre: no se pudo leer el código"; fallos=$((fallos + 1)); fi
done

exit $fallos
