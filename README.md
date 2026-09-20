# Órbita, de Cosmos (repo: stellar-protege)

App educativa para adolescentes y sus familias frente a las apuestas online. Propone una pausa con información en vez de bloquear, le da al adulto un resumen de conducta y señales para conversar, y acerca ayuda profesional a los dos. No diagnostica ni trata.

> **Estado:** contratos en testnet, backend (Hono) y web (Vite) funcionando de punta a punta con passkeys en local. Falta el despliegue en Vercel. Plan en [docs/arquitectura.md](docs/arquitectura.md), marca y pantallas en [docs/diseno.md](docs/diseno.md).

## Principios

- **Educar, no prohibir.** Si el menor entra a un sitio de apuestas, ve una pantalla educativa con opción de seguir, y el adulto recibe el aviso.
- **Transparencia.** El menor sabe que la protección está activa y qué registra. Hacen falta el consentimiento del adulto y el asentimiento del menor.
- **Nada de datos de menores on-chain.** En la blockchain solo quedan vínculos entre cuentas seudónimas, hashes de consentimiento y el hash diario del registro de auditoría.

## Dónde entra Stellar

1. **Cuentas sin frase semilla.** Cada persona tiene una cuenta inteligente de OpenZeppelin cuya llave es una passkey, creada con smart-account-kit.
2. **Vínculo on-chain.** El adulto firma `propose` y el adolescente firma `accept` en `family-registry`. Cualquiera de los dos puede firmar `revoke`. El backend paga las comisiones pero no puede firmar por nadie.
3. **Anclaje.** Una vez por día el backend publica en `anclas` el último hash del registro de consentimientos, que está encadenado por hash. Cualquiera puede verificarlo en `/v1/auditoria/verificar`.

## Estructura

```text
.
├── contracts
│   ├── family-registry    vínculo adulto/menor con consentimiento y asentimiento
│   ├── anclas             publica el hash diario del registro de consentimientos
│   └── learning-badges    insignias no transferibles (fuera del producto por ahora)
├── backend                API en Hono para Vercel; Neon en producción, PGlite en local
├── web                    web en Vite + TypeScript con passkeys
├── scripts
│   ├── desplegar-testnet.sh   compila y despliega family-registry y anclas
│   ├── mantener-ttl.sh        extiende el TTL de contratos y WASM en testnet
│   └── desplegar-vercel.sh    publica la API y la web en Vercel con un token propio
├── .github/workflows      mantener-ttl.yml corre el script cada lunes
├── docs                   arquitectura y diseño
└── correr-local.sh        API en :3310 y web en :5310
```

## Requisitos

- Rust 1.84 o superior con el target `wasm32v1-none`
- Stellar CLI 28 (testnet corre protocolo 28)
- Node 20 o superior y pnpm

## Tests y build

```sh
cargo test
stellar contract build
cd backend && pnpm test
cd web && pnpm build
./correr-local.sh
```

## Contratos

### family-registry

| Función | Firma | Qué hace |
|---|---|---|
| `propose(parent, child, consent_hash, consent_version)` | adulto | Crea o renueva el vínculo en `Pending`. |
| `accept(child, parent, consent_hash, assent_hash)` | menor | Pasa a `Active` si el consentimiento coincide. |
| `revoke(by, parent, child)` | adulto o menor | Pasa a `Revoked` y registra quién revocó. |
| `get(parent, child)` | ninguna | Devuelve el vínculo. |

Cada escritura extiende el TTL del vínculo y de la instancia a 180 días cuando quedan menos de 30.

### anclas

| Función | Firma | Qué hace |
|---|---|---|
| `anclar(hash, filas)` | ninguna | Emite el evento `Anclado` y devuelve el ledger. |

No pide firma a propósito. La procedencia la da la cuenta del backend que envía la transacción, y el hash se puede comparar contra el registro público. Escribe una clave temporal para que el relayer no la trate como una lectura.

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

Desplegados con Stellar CLI 28.0.0 (protocolo 28). family-registry y anclas se redesplegaron el 2026-09-19, después de revisar la integración con las skills de Stellar.

| Contrato | ID |
|---|---|
| family-registry | [`CAQDKJ62HKUQTURQAEGKHPAIC3DQK36A6QR4IHH2IYW4EI7EAVENFJ6M`](https://lab.stellar.org/r/testnet/contract/CAQDKJ62HKUQTURQAEGKHPAIC3DQK36A6QR4IHH2IYW4EI7EAVENFJ6M) |
| anclas | [`CCGNGLJ5ZMNRIJB4GURJISTDEJYLIHOBNS2ZKF7TEGAVQ7DIINV4YVZN`](https://lab.stellar.org/r/testnet/contract/CCGNGLJ5ZMNRIJB4GURJISTDEJYLIHOBNS2ZKF7TEGAVQ7DIINV4YVZN) |
| learning-badges | [`CDSNCELUGNKQ7ECT7J7MYL2UC6J2ROYMCSLFFAYUPKZMDMXWNUWBGWQZ`](https://lab.stellar.org/r/testnet/contract/CDSNCELUGNKQ7ECT7J7MYL2UC6J2ROYMCSLFFAYUPKZMDMXWNUWBGWQZ) |

- **IDs fijados en la web.** Están en `web/src/contratos.ts`, no se toman del backend. Así un backend comprometido no puede hacer firmar contra otro contrato. Si testnet se resetea, hay que redesplegar y actualizar ese archivo y los valores por defecto de `backend/src/stellar.ts`.
- **Mantenimiento de TTL.** El workflow `mantener-ttl.yml` necesita el secreto `STELLAR_MANTENIMIENTO_SECRET` con una cuenta de testnet cualquiera.
- **Cuenta de despliegue:** es la identidad local `protege-deployer` (`GCPEDBHF2IOZU5LRJDAWLE4MGMNAHWNJF532O6I6G273NTU6AGRCD47I`). Además de desplegar, es admin de `learning-badges` y la fuente de solo lectura del backend para simular.

Prueba de punta a punta del 2026-09-19 con passkeys virtuales y el relayer público de testnet: `propose`, `accept`, anclaje y `revoke` confirmados en cadena.

## Pendientes conocidos

- **Recuperación de cuenta.** La passkey queda atada al dominio. Conviene un dominio propio y un segundo firmante antes de salir de testnet.
- **Reglas de contexto.** La web firma siempre con la regla 0 de la cuenta inteligente.
- **Reset de testnet.** No se detecta solo; hay que redesplegar a mano.

## Créditos y licencia

- **Base de la app móvil:** el diseño parte de [Bitcoindefi/ba-protege](https://github.com/Bitcoindefi/ba-protege) (MIT). Cuando se traiga su código hay que conservar su aviso de copyright.
- **Contratos:** usan [OpenZeppelin Stellar Contracts](https://github.com/OpenZeppelin/stellar-contracts) (MIT).
- **Cuentas con passkeys:** [smart-account-kit](https://github.com/kalepail/smart-account-kit).
- **Licencia de este repo:** pendiente de definir.
