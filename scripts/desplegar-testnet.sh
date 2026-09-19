#!/usr/bin/env bash
# Despliega family-registry y anclas en testnet y muestra los IDs nuevos.
# Uso: ./scripts/desplegar-testnet.sh [identidad]   (por defecto: protege-deployer)
# Después de un reset de testnet: fondear la identidad y la cuenta de lectura con
# friendbot, correr este script y actualizar FAMILY_REGISTRY_ID y ANCLAS_ID (o los valores
# por defecto en backend/src/stellar.ts y web/src/contratos.ts).
set -euo pipefail
cd "$(dirname "$0")/.."
FUENTE="${1:-protege-deployer}"
source "$HOME/.cargo/env" 2>/dev/null || true

stellar contract build --package family-registry >/dev/null
stellar contract build --package anclas >/dev/null

desplegar() {
  stellar contract deploy --wasm "target/wasm32v1-none/release/$1.wasm" \
    --source "$FUENTE" --network testnet --alias "$2" 2>/dev/null | tail -1
}

REGISTRY=$(desplegar family_registry family-registry)
ANCLAS=$(desplegar anclas anclas)
echo "FAMILY_REGISTRY_ID=$REGISTRY"
echo "ANCLAS_ID=$ANCLAS"
