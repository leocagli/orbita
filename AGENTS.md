# Instrucciones para agentes

Workspace de contratos Soroban de stellar-protege. Cada contrato es un miembro del workspace en `contracts/<nombre>/`. El diseño general está en `docs/arquitectura.md`.

## Reglas del proyecto

- **Datos de menores:** nunca van on-chain datos personales ni de navegación (URLs, dominios, horarios, nombres, edades, identificadores de dispositivo). On-chain solo direcciones seudónimas, hashes, versiones y timestamps.
- **Versiones:** `soroban-sdk` va alineado con la versión que usa OpenZeppelin Stellar, y los crates `stellar-*` se fijan con `=`. Si se actualiza uno, se actualiza el otro.
- **Insignias:** `learning-badges` no debe exponer `transfer`, `transfer_from`, `approve` ni `approve_for_all`. Hay un test que lo verifica.
- **Idioma:** documentación y comentarios en español. Las funciones del contrato se nombran en inglés, por compatibilidad con billeteras y exploradores.

## Estructura

- `Cargo.toml`: raíz del workspace; los contratos heredan de acá las dependencias.
- `contracts/<nombre>/src/lib.rs`: implementación (`#![no_std]`).
- `contracts/<nombre>/src/test.rs`: tests unitarios del lado del host.

## Build

Desde la raíz del workspace:

```sh
stellar contract build
```

Compila cada miembro `cdylib` a WASM en `target/wasm32v1-none/release/*.wasm`. Para un solo contrato: `stellar contract build --package <nombre>`.

No reemplazar por `cargo build --target wasm32v1-none`: `stellar contract build` aplica los flags y la metadata que espera la red.

Requiere Rust 1.84 o superior y el target `wasm32v1-none` (`rustup target add wasm32v1-none`).

## Tests

```sh
cargo test
```

Un solo contrato: `cargo test -p <nombre>`.

## Despliegue e invocación (testnet)

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/<nombre>.wasm \
  --source-account <identidad> \
  --network testnet \
  --alias <alias>

stellar contract invoke --id <alias> --network testnet --source-account <identidad> -- -h
```

## Referencias

- https://developers.stellar.org/docs/build/smart-contracts/overview
- https://docs.openzeppelin.com/stellar-contracts/
