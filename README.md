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
4. **Insignias educativas.** Al terminar un módulo corto sobre apuestas, el adolescente recibe en `learning-badges` una insignia no transferible. Ni el backend ni nadie más puede sacársela ni moverla a otra cuenta.

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

Cada escritura extiende el TTL del vínculo y de la instancia a 180 días cuando quedan menos de 30. Mientras el vínculo está `Pending` o `Active`, `propose` exige una `consent_version` mayor que la vigente, para que nadie pueda hacer firmar al menor un consentimiento más viejo. Después de `Revoked` se puede volver a empezar con cualquier versión.

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

No existen `transfer`, `transfer_from`, `approve` ni `approve_for_all`. Reactivado como parte del producto el 2026-09-20: antes estaba desplegado pero sin conectar a la web ni al backend. La identidad `protege-deployer` tiene el rol `issuer`; el backend usa `ISSUER_SECRET` para otorgar insignias (por defecto, reusa `SPONSOR_SECRET` si tiene ese rol). Los módulos educativos están en `backend/src/datos/modulos.ts`.

## Testnet

Desplegados con Stellar CLI 28.0.0 (protocolo 28). family-registry y anclas se redesplegaron el 2026-09-19; family-registry se redesplegó de nuevo el 2026-09-20, con la validación de versión de consentimiento, después de revisar la integración con las skills de Stellar.

| Contrato | ID |
|---|---|
| family-registry | [`CA5SSO56XW6XGQJTZXTOM25XPTFL5C5IQOSGQ55GD6CSRKQP3MKZFKLD`](https://lab.stellar.org/r/testnet/contract/CA5SSO56XW6XGQJTZXTOM25XPTFL5C5IQOSGQ55GD6CSRKQP3MKZFKLD) |
| anclas | [`CCGNGLJ5ZMNRIJB4GURJISTDEJYLIHOBNS2ZKF7TEGAVQ7DIINV4YVZN`](https://lab.stellar.org/r/testnet/contract/CCGNGLJ5ZMNRIJB4GURJISTDEJYLIHOBNS2ZKF7TEGAVQ7DIINV4YVZN) |
| learning-badges | [`CDSNCELUGNKQ7ECT7J7MYL2UC6J2ROYMCSLFFAYUPKZMDMXWNUWBGWQZ`](https://lab.stellar.org/r/testnet/contract/CDSNCELUGNKQ7ECT7J7MYL2UC6J2ROYMCSLFFAYUPKZMDMXWNUWBGWQZ) |

- **IDs fijados en la web.** Están en `web/src/contratos.ts`, no se toman del backend. Así un backend comprometido no puede hacer firmar contra otro contrato. Si testnet se resetea, hay que redesplegar y actualizar ese archivo y los valores por defecto de `backend/src/stellar.ts`.
- **Mantenimiento de TTL.** El workflow `mantener-ttl.yml` necesita el secreto `STELLAR_MANTENIMIENTO_SECRET` con una cuenta de testnet cualquiera.
- **Cuenta de despliegue:** es la identidad local `protege-deployer` (`GCPEDBHF2IOZU5LRJDAWLE4MGMNAHWNJF532O6I6G273NTU6AGRCD47I`). Además de desplegar, es admin de `learning-badges` y la fuente de solo lectura del backend para simular.

Prueba de punta a punta del 2026-09-20 con passkeys virtuales, pagando con cuenta propia: `propose`, `accept`, anclaje y `revoke` confirmados en cadena contra el family-registry nuevo.

## Revisión con las skills de Stellar (2026-09-19 y 2026-09-20)

Se bajó el catálogo completo de skills.stellar.org (oficiales y de comunidad) y se compararon contra el código. De 37 skills, sirven de verdad `smart-contracts`, `dapp` y `data` (oficiales) y las de la comunidad sobre errores comunes en Soroban y pruebas de passkeys con WebAuthn. El resto trata tokens, pagos, anchors o DeFi, que Órbita no tiene.

Lo que encontraron y ya está corregido:
- **Degradar el consentimiento.** `propose` aceptaba cualquier `consent_version`, así que alguien con la firma del adulto podía volver a una versión vieja del consentimiento mientras el vínculo estaba vigente. Ahora exige una versión mayor, salvo después de una revocación.
- **Sin reintentos ante el RPC.** Las llamadas a Stellar no reintentaban ante un 429 o un error pasajero del servidor. Ahora `backend/src/stellar.ts` reintenta con espera creciente.
- **Sin chequeo de red en la web.** La web podía firmar aunque el RPC no estuviera en la red esperada. Ahora `verificarRed()` lo confirma antes de crear una cuenta o firmar.
- **La defensa de firmas no tenía tests.** `verificarEntrada`, que rechaza firmar otra cosa que no sea la acción elegida, ya tiene 6 tests en `web/test/verificar.test.ts`.
- **El cron de latidos sin tope.** Recorría todos los vínculos abiertos uno por uno. Ahora tiene un tope y los sincroniza en lotes.

## Fortalecido después (2026-09-20)

- **Auditoría pública verificada en cadena.** `/v1/auditoria/anclajes` ya no confía solo en la tabla local: el anclaje más reciente se confirma en vivo contra la red, leyendo el evento `Anclado` de la transacción con `getTransaction`. Si el RPC ya no tiene esa transacción, lo dice (`verificado_en_cadena: null`), en vez de fingir que está mal.
- **Analizador estático de contratos:** se intentó instalar `cargo-scout-audit`, pero necesita un toolchain nightly específico que no se pudo bajar (ver más abajo). Se corrió `cargo clippy --all-targets` en los tres contratos, sin advertencias.

## Pendientes conocidos

- **Recuperación de cuenta.** La passkey queda atada al dominio. Conviene un dominio propio y un segundo firmante antes de salir de testnet.
- **Reglas de contexto.** La web firma siempre con la regla 0 de la cuenta inteligente.
- **Reset de testnet.** No se detecta solo; hay que redesplegar a mano.
- **Falta `cargo scout-audit`.** Pide el toolchain `nightly-2025-08-07`, que no se pudo instalar. Reintentar cuando haya espacio en disco y de vuelta la conexión a los servidores de `rustup`.
- **Relayer público sin respaldo.** Si el relayer de testnet de SDF desaparece, no hay alternativa configurada.
- **Verificación en cadena solo del último anclaje.** Los anteriores no se revisan en cada pedido porque el RPC público no guarda transacciones viejas.

## Créditos y licencia

- **Base de la app móvil:** el diseño parte de [Bitcoindefi/ba-protege](https://github.com/Bitcoindefi/ba-protege) (MIT). Cuando se traiga su código hay que conservar su aviso de copyright.
- **Contratos:** usan [OpenZeppelin Stellar Contracts](https://github.com/OpenZeppelin/stellar-contracts) (MIT).
- **Cuentas con passkeys:** [smart-account-kit](https://github.com/kalepail/smart-account-kit).
- **Licencia de este repo:** pendiente de definir.
