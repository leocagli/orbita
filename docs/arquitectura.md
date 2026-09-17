# Arquitectura (borrador, revisado 2026-09-17)

Producto: **Órbita, de Cosmos** (nombre de trabajo del repo: stellar-protege). No usa marca, dominio ni nombre de ningún organismo público. Marca y pantallas en [diseno.md](diseno.md).

Alcance: modo educativo con notificaciones al adulto, señales de conducta y derivación a ayuda. Frente a la ludopatía adolescente, la app **previene y ayuda a detectar a tiempo**; no diagnostica ni trata. Fundamentos en `stellar-ai-workshop-starter/research/deteccion-temprana-derivacion.md`.

## Principios

1. **Educar, no prohibir.** Cuando el menor entra a un sitio de apuestas ve una pantalla educativa con opción de seguir. El padre recibe la alerta. No hay bloqueo duro por defecto.
2. **Transparencia con el menor.** La protección siempre se ve (notificación persistente) y el menor sabe qué registra la app y qué no. Hace falta consentimiento del padre más asentimiento del adolescente.
3. **Nada de datos de menores on-chain, y la cadena fuera del camino crítico.** La app y las notificaciones funcionan enteras sin blockchain. Stellar queda como capa opcional (ver "Qué va on-chain").
4. **Conducta, no salud.** Al adulto se le muestra conducta observable y agregada ("5 pausas esta semana"), nunca inferencias como "riesgo de ludopatía", que serían datos sensibles (Ley 25.326). La app no dice que "detecta" ni "previene" una patología (ANMAT 64/2025).
5. **Ayuda sin condiciones.** El adolescente puede pedir ayuda desde la app sin que se avise al adulto.
6. **Reutilizar lo que ya funciona** de [ba-protege](https://github.com/Bitcoindefi/ba-protege) (MIT), dejando su aviso de copyright.

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
            │                                                               │
            ▼                                                               ▼
        ┌──────────── registro de consentimientos (backend, firmado) ──────────┐
        │ consentimiento del adulto, asentimiento y revocación del adolescente  │
        └──────────────────────────────┬────────────────────────────────────────┘
                                       │ opcional, best effort
                                       ▼
        ┌──────── capa de auditoría opcional ──────────────────────────────────┐
        │ family-registry en Stellar (estado del vínculo) y anclaje de métricas │
        │ agregadas (BFA o RFC 3161 para compradores públicos)                  │
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
| `PantallaCorteActivity.kt` | Pasa a la pantalla **Pausa**: un dato concreto, una pregunta y los botones "Seguir igual" y "Salir". Sin cuenta regresiva ni culpa. |
| `Registro.kt` / `EventoEntity` | Cola de salida hacia el backend, cifrada para la clave del adulto, con retención de 90 días que sí se aplique. Las pausas se **deduplican por sesión** (una visita genera muchas consultas DNS) y se agregan por semana antes de mostrarse. |

Requisitos de Google Play:
- declarar VpnService para control parental;
- `IsMonitoringTool` en el manifest;
- notificación persistente;
- aviso y consentimiento explícito dentro de la app.

### App del padre (Android, variante `control`)

- Lista de adolescentes vinculados y su estado: protección activa, desactivada o sin reportes.
- Tendencia semanal de pausas por adolescente, sin dominios ni horarios exactos por defecto.
- Señales para observar fuera del teléfono, guía para conversar y directorio de ayuda por provincia.
- Notificaciones: resumen semanal, protección desactivada, sin reportes y vínculo revocado. Nunca una por cada pausa.

### Backend

- **Relay de eventos:** recibe blobs cifrados de punta a punta y los reenvía por push. No tiene la clave para leerlos.
- **Latido:** el dispositivo reporta cada N minutos. Si pasan M sin reporte, el padre recibe "el teléfono dejó de reportar". El texto tiene que decir que puede ser falta de conexión o desinstalación, porque no se distinguen.
- **Registro de consentimientos:** log firmado de solo agregado con el texto exacto mostrado, su versión, la verificación de identidad del adulto, el asentimiento del adolescente y las revocaciones. Es la prueba real del consentimiento (Decreto 1558/2001, art. 5); un hash en una cadena solo prueba integridad y fecha.
- **Progreso educativo:** módulos completados por usuario, en el backend. Si más adelante hacen falta credenciales portables, Open Badges; nunca tokens.
- **Directorio de ayuda:** líneas y centros por provincia con fecha de verificación, revisado cada trimestre.

### Contratos Soroban

Stack: Rust + `soroban-sdk 26.1.x` + OpenZeppelin Stellar `=0.7.2`. Testnet (protocolo 28). Los dos contratos de la tanda 1 siguen en el repo, con tests y desplegados en testnet, pero su rol cambió:

- **`family-registry`:** capa de auditoría **opcional** del estado del vínculo. Se escribe desde el backend, en forma asincrónica y best effort; si falla, nada del producto se detiene. En mainnet el backend tendría que extender el TTL de los vínculos activos, porque una entrada persistente se archiva a los ~201 días sin extensión.
- **`learning-badges`:** **fuera del producto.** Poner insignias en una cadena pública expone direcciones de menores sin aportar nada. Queda como referencia técnica; se puede borrar en la próxima limpieza.

#### `family-registry`

Registro inmutable, sin admin. Un vínculo por par (adulto, adolescente).

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
| Consentimiento, asentimiento y revocaciones, con el texto mostrado | Registro firmado en el backend |
| Estado del vínculo (direcciones seudónimas, hash y versión) | Stellar, opcional y best effort |
| Métricas agregadas para rendir cuentas a una lotería o provincia | Raíz de Merkle con sello de BFA o RFC 3161; Stellar `MEMO_HASH` solo si el comprador lo pide |
| Progreso educativo | Backend, sin tokens |
| Pausas (dominio, hora, categoría) y eventos de desactivación | Dispositivo + relay cifrado para el adulto, deduplicadas y agregadas |
| Latidos, tokens de push, listas de dominios | Backend |
| Nombre, edad, teléfono | Solo en los dispositivos |

Motivos del cambio respecto de la tanda 1: SCF exige que Stellar tenga un papel central, y una capa de auditoría no lo cumple; el anclaje que un tribunal argentino ya aceptó como prueba de integridad es BFA (Cámara Civil y Comercial de Morón, 2024); y un `MEMO_HASH` cuesta centavos por año, mientras que el estado persistente de Soroban exige pagar alquiler para no archivarse. Detalle en `research/viabilidad-proteccion-menores.md`, secciones 8 y 9.

## Limitaciones conocidas

- **Evasión del filtro:** DNS-over-HTTPS en el navegador saltea el filtro DNS. Es aceptable para un producto educativo y hay que decirlo en la app.
- **Latido ambiguo:** no distingue desinstalación de falta de conexión.
- **iOS:** no permite ver URLs. Solo Family Controls, con protección contra borrado.
- **Cuentas del menor:** si ven la dirección de un menor, pueden inferir que es menor. Van direcciones nuevas por menor, sin vincularlas a identidad.
- **Lista de dominios:** StevenBlack es MIT y se puede empaquetar. HaGeZi es GPL-3.0; no redistribuirla modificada sin revisar la licencia.

## Tandas

1. **Hecha:** research, este documento y los contratos con tests, desplegados en testnet.
2. **Hecha:** viabilidad, alcance (prevenir y detectar a tiempo), marca (Órbita, de Cosmos) y brief de diseño.
3. **Siguiente, backend mínimo:** registro de consentimientos, emparejamiento por código, relay cifrado, push y latido. Sin esto las alertas siguen saliendo en el teléfono del adolescente.
4. **App Android:** traer el código de ba-protege, retirar la marca oficial, motor en modo pausa, deduplicación y agregado semanal, `onRevoke`, pantallas de Órbita y Órbita Familia.
5. **Contenido:** textos de Pausa, Aprender y Conversar revisados por un equipo de salud mental; directorio verificado.
6. **Antes de publicar:** consulta de encuadre a ANMAT, revisión legal de datos de menores, prueba cerrada en Play con `IsMonitoringTool`.
7. **Más adelante:** anclaje de métricas para compradores públicos, iOS y extensión de Chrome.

Research de respaldo: `stellar-ai-workshop-starter/research/proteccion-menores-apuestas.md`.
