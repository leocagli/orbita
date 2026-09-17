# Órbita, de Cosmos (repo: stellar-protege)

App educativa para adolescentes y sus familias frente a las apuestas online. Propone una pausa con información en vez de bloquear, le da al adulto un resumen de conducta y señales para conversar, y acerca ayuda profesional a los dos. No diagnostica ni trata.

> **Estado:** research, diseño y contratos listos; app Android y backend todavía no existen. Plan en [docs/arquitectura.md](docs/arquitectura.md), marca y pantallas en [docs/diseno.md](docs/diseno.md). Los contratos Soroban quedaron como capa opcional: `family-registry` audita el estado del vínculo y `learning-badges` quedó fuera del producto.

## Principios

- **Educar, no prohibir.** Si el menor entra a un sitio de apuestas, ve una pantalla educativa con opción de seguir, y el adulto recibe la alerta.
- **Transparencia.** El menor sabe que la protección está activa y qué registra. Hacen falta el consentimiento del adulto y el asentimiento del menor.
- **Nada de datos de menores on-chain.** En la blockchain solo quedan vínculos entre direcciones seudónimas, hashes de consentimiento e insignias.

## Estructura

```text
.
├── contracts
│   ├── family-registry    vínculo adulto/menor con consentimiento y asentimiento
│   └── learning-badges    insignias educativas no transferibles
├── docs
│   └── arquitectura.md    diseño, on-chain vs. off-chain, tandas
├── Cargo.toml             workspace; soroban-sdk alineado con OpenZeppelin Stellar
└── AGENTS.md              reglas para agentes de código
```

## Requisitos

- Rust 1.84 o superior con el target `wasm32v1-none`
- Stellar CLI 28 (testnet corre protocolo 28)

## Tests y build

```sh
cargo test
stellar contract build
```

## Contratos

### family-registry

| Función | Firma | Qué hace |
|---|---|---|
| `propose(parent, child, consent_hash, consent_version)` | adulto | Crea o renueva el vínculo en `Pending`. |
| `accept(child, parent, consent_hash, assent_hash)` | menor | Pasa a `Active` si el consentimiento coincide. |
| `revoke(by, parent, child)` | adulto o menor | Pasa a `Revoked` y registra quién revocó. |
| `get(parent, child)` | ninguna | Devuelve el vínculo. |

### learning-badges

| Función | Firma | Qué hace |
|---|---|---|
| `award(caller, to, kind)` | rol `issuer` | Otorga una insignia; una por dirección y tipo. |
| `burn(owner, token_id)` | titular | Borra la insignia. |
| `badge_of(owner, kind)`, `kind_of(token_id)` | ninguna | Consultas. |
| `balance`, `owner_of`, `name`, `symbol`, `token_uri` | ninguna | Lectura estándar de NFT. |
| `grant_role`, `revoke_role` y demás | admin | Control de acceso de OpenZeppelin. |

No existen `transfer`, `transfer_from`, `approve` ni `approve_for_all`.

## Testnet

Desplegados el 2026-09-15 con Stellar CLI 28.0.0 (protocolo 28).

| Contrato | ID |
|---|---|
| family-registry | [`CAMMCDEUJ5YQ5AHSYVO75GCQR7NTKH4CHINSXWGHMJQRLPJJ2BVWKHGJ`](https://lab.stellar.org/r/testnet/contract/CAMMCDEUJ5YQ5AHSYVO75GCQR7NTKH4CHINSXWGHMJQRLPJJ2BVWKHGJ) |
| learning-badges | [`CDSNCELUGNKQ7ECT7J7MYL2UC6J2ROYMCSLFFAYUPKZMDMXWNUWBGWQZ`](https://lab.stellar.org/r/testnet/contract/CDSNCELUGNKQ7ECT7J7MYL2UC6J2ROYMCSLFFAYUPKZMDMXWNUWBGWQZ) |

- **Cuenta de despliegue:** es la identidad local `protege-deployer` (`GCPEDBHF2IOZU5LRJDAWLE4MGMNAHWNJF532O6I6G273NTU6AGRCD47I`). Además de desplegar, es admin de `learning-badges` y tiene el rol `issuer` de prueba.
- **Marcador de metadata:** el `base_uri` de las insignias (`https://example.org/protege/badges/`) no apunta a nada real, porque todavía no hay servidor de metadata. El contrato no permite cambiarlo, así que habrá que redesplegar cuando exista.

Prueba de humo ejecutada con las cuentas de demo `protege-padre-demo` y `protege-hijo-demo`:

1. El padre propone y el hijo acepta: el vínculo queda `Active`.
2. Una segunda aceptación falla con `Error(Contract, #3)`.
3. Se otorga al hijo la insignia `casa_siempre_gana` (token 0). `owner_of`, `kind_of`, `token_uri` y `balance` devuelven lo esperado.
4. `transfer` no existe en el contrato: la CLI lo rechaza.

## Créditos y licencia

- **Base de la app móvil:** el diseño parte de [Bitcoindefi/ba-protege](https://github.com/Bitcoindefi/ba-protege) (MIT). Cuando se traiga su código hay que conservar su aviso de copyright.
- **Contratos:** usan [OpenZeppelin Stellar Contracts](https://github.com/OpenZeppelin/stellar-contracts) (MIT).
- **Licencia de este repo:** pendiente de definir.
