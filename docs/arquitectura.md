# Arquitectura (borrador, tanda 1)

Nombre de trabajo: **stellar-protege**. No usa marca, dominio ni nombre de ningún organismo público.

## Principios

1. **Educar, no prohibir.** Cuando el menor entra a un sitio de apuestas ve una pantalla educativa con opción de seguir. El padre recibe la alerta. No hay bloqueo duro por defecto.
2. **Transparencia con el menor.** La protección siempre se ve (notificación persistente) y el menor sabe qué registra la app y qué no. Hace falta consentimiento del padre más asentimiento del adolescente.
3. **Nada de datos de menores on-chain.** La blockchain guarda vínculos entre direcciones seudónimas, hashes de consentimiento e insignias. La navegación queda en el dispositivo y, cifrada, en el canal hacia el padre.
4. **Reutilizar lo que ya funciona** de [ba-protege](https://github.com/Bitcoindefi/ba-protege) (MIT), dejando su aviso de copyright.

## Componentes

```
 teléfono del menor                    backend                    teléfono del padre
 ┌──────────────────────┐   eventos    ┌────────────────┐  push   ┌──────────────────┐
 │ app "dispositivo"    │─────────────▶│ relay + latido │────────▶│ app "control"    │
 │ · filtro DNS local   │  (cifrados   │ (no puede leer │         │ · alertas        │
 │ · motor de detección │   para el    │  los eventos)  │         │ · contenido para │
 │ · pantalla educativa │   padre)     └────────────────┘         │   padres         │
 │ · onRevoke / admin   │                                          └────────┬─────────┘
 └──────────┬───────────┘                                                   │
            │  aceptar vínculo, recibir insignias      proponer vínculo     │
            ▼                                                               ▼
        ┌──────────────────────── Stellar (Soroban) ───────────────────────────┐
        │ family-registry: vínculo padre/hijo + hash y versión de consentimiento│
        │ learning-badges: insignias educativas no transferibles                │
        └───────────────────────────────────────────────────────────────────────┘
```

### App del menor (Android, variante `dispositivo`)

Se reutiliza de ba-protege y se adapta:

| Pieza de ba-protege | Cambio |
|---|---|
| `MotorBloqueo.kt` (veredicto Permitido/Bloqueado) | Pasa a motor de detección con veredicto `Permitido` / `Educar(categoria)`. Categorías: apuesta con licencia (`.bet.ar`), apuesta sin licencia (lista), sospecha por palabra clave, lista del padre. Para un menor, todas generan alerta. |
| `ProtegeVpnService.kt` + `DnsPaquete.kt` | Modo observación: resuelve todo y registra lo marcado. `onRevoke()` genera el evento "protección desactivada". |
| `NavegacionAccessibilityService.kt` | **Fuera del MVP.** La política de Play pide aprobación para accesibilidad y la pantalla educativa se puede disparar desde el filtro DNS. |
| `ProtegeDeviceAdminReceiver.kt` | Solo para avisar si se desactiva el admin, que es el paso previo a desinstalar. No bloquea nada. |
| `PantallaCorteActivity.kt` | Pasa a pantalla educativa: qué es, cómo gana siempre la casa, líneas de ayuda y botón "seguir igual". |
| `Registro.kt` / `EventoEntity` | Cola de salida hacia el backend, cifrada para la clave del padre, con retención de 90 días que sí se aplique. |

Requisitos de Google Play:
- declarar VpnService para control parental;
- `IsMonitoringTool` en el manifest;
- notificación persistente;
- aviso y consentimiento explícito dentro de la app.

### App del padre (Android, variante `control`)

- Lista de menores vinculados y su estado: protegido, protección desactivada o sin latido.
- Alertas de sitios marcados, agrupadas por categoría.
- Contenido educativo para padres: cómo hablar del tema y señales de alerta.

### Backend

- **Relay de eventos:** recibe blobs cifrados de punta a punta y los reenvía por push. No tiene la clave para leerlos.
- **Latido:** el dispositivo reporta cada N minutos. Si pasan M sin reporte, el padre recibe "el teléfono dejó de reportar". El texto tiene que decir que puede ser falta de conexión o desinstalación, porque no se distinguen.
- **Emisor de insignias:** tiene el rol `issuer` en `learning-badges` y la otorga cuando se completa un módulo.

### Contratos Soroban (esta tanda)

Stack: Rust + `soroban-sdk 26.1.x` + OpenZeppelin Stellar `=0.7.2`. Testnet (protocolo 28).

#### `family-registry`

Registro inmutable, sin admin. Un vínculo por par (padre, menor).

| Función | Auth | Efecto |
|---|---|---|
| `propose(parent, child, consent_hash, consent_version)` | padre | Crea el vínculo en `Pending`. Si ya existía, lo vuelve a `Pending` con la versión nueva, así que un consentimiento nuevo exige asentimiento nuevo. |
| `accept(child, parent, consent_hash, assent_hash)` | menor | `Pending` pasa a `Active`. `consent_hash` tiene que coincidir con el propuesto: si el adulto cambió el consentimiento mientras el menor firmaba, la aceptación falla. |
| `revoke(by, parent, child)` | padre o menor | Pasa a `Revoked` y guarda quién revocó. El menor **puede** revocar; el padre lo ve. |
| `get(parent, child)` | ninguna | Devuelve el vínculo si existe. |

Eventos: propuesto, aceptado, revocado. Guarda solo direcciones, `BytesN<32>`, `u32` y timestamps del ledger.

#### `learning-badges`

Insignias NFT **sin** `transfer` ni `approve`. Usa el almacenamiento base de OpenZeppelin `non_fungible` y `AccessControl` para el rol `issuer`.

| Función | Auth | Efecto |
|---|---|---|
| `award(caller, to, kind)` | rol `issuer` | Acuña una insignia de tipo `kind`, como `modulo_casa_siempre_gana`. Una por dirección y tipo. |
| `burn(owner, token_id)` | titular | El titular puede borrar su insignia, así que publicarla es opcional. |
| `badge_of(owner, kind)`, `kind_of(token_id)` | ninguna | Consultas: id de la insignia de ese tipo, si la tiene, y tipo de una insignia. |
| `balance`, `owner_of`, `name`, `symbol`, `token_uri` | ninguna | Interfaz estándar de lectura para billeteras y exploradores. |

La metadata no lleva datos personales. Las insignias no tienen valor monetario: nada de recompensas en dinero para menores.

Las firmas exactas quedan en `contracts/*/src/lib.rs`.

## Qué va on-chain y qué no

| Dato | Dónde |
|---|---|
| Vínculo padre/menor (direcciones seudónimas), estado, hash y versión de consentimiento | Stellar |
| Insignias educativas | Stellar |
| Dominios visitados, horarios, categorías, eventos de desactivación | Dispositivo + relay cifrado para el padre |
| Latidos, tokens de push, listas de dominios | Backend |
| Nombre, edad, teléfono, textos de consentimiento completos | Solo en los dispositivos; on-chain va el hash |

## Limitaciones conocidas

- **Evasión del filtro:** DNS-over-HTTPS en el navegador saltea el filtro DNS. Es aceptable para un producto educativo y hay que decirlo en la app.
- **Latido ambiguo:** no distingue desinstalación de falta de conexión.
- **iOS:** no permite ver URLs. Solo Family Controls, con protección contra borrado.
- **Cuentas del menor:** si ven la dirección de un menor, pueden inferir que es menor. Van direcciones nuevas por menor, sin vincularlas a identidad.
- **Lista de dominios:** StevenBlack es MIT y se puede empaquetar. HaGeZi es GPL-3.0; no redistribuirla modificada sin revisar la licencia.

## Tandas

1. **Esta:** research, este documento y los contratos `family-registry` y `learning-badges` con tests, desplegados en testnet.
2. **App Android:** traer el código de ba-protege, retirar la marca oficial, motor en modo educar, pantalla educativa, `onRevoke` y emparejamiento real contra `family-registry`.
3. **Backend:** relay cifrado, push y latido.
4. **Cuentas y fees:** passkeys (smart accounts de OpenZeppelin) y fees con OpenZeppelin Relayer.
5. **Más adelante:** iOS y extensión de Chrome.

Research de respaldo: `stellar-ai-workshop-starter/research/proteccion-menores-apuestas.md`.
