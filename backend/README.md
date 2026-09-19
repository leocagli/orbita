# Backend de Órbita

API de Órbita (adolescente) y Órbita Familia (adulto): consentimientos, emparejamiento por código, vínculo firmado en Stellar, conteos de pausas por semana, latidos, avisos al adulto, anclaje del registro y directorio de ayuda. Corre en Vercel Functions con Hono y Neon Postgres.

**Lo que nunca recibe el servidor:** dominios visitados, horarios exactos, nombres reales. El teléfono deduplica y manda totales por semana; el adulto ve tendencias.

## Stellar (testnet)

- **Cuentas:** cada persona tiene una cuenta inteligente de OpenZeppelin con passkey, creada con `smart-account-kit` desde la web.
- **Vínculo:** vive en `family-registry`. El adulto firma `propose` y el adolescente `accept`, cada uno con su passkey. El backend arma la invocación, valida que las firmas sean sobre esa invocación exacta y la envía. No puede firmar por nadie.
- **Avisos:** solo salen con el vínculo `Active` en la cadena. El cron diario detecta revocaciones hechas fuera de la app.
- **Anclaje:** el cron diario publica el último hash del registro de consentimientos con el contrato `anclas`.
- **Comisiones:** por defecto las paga el relayer público de testnet (SDF + OpenZeppelin Channels), así que el backend no necesita ninguna clave de Stellar. Con `SPONSOR_SECRET` las paga una cuenta propia.

## Correr local

```sh
pnpm install
pnpm test                               # PGlite en memoria, cadena simulada
pnpm dev                                # :3000, PGlite y testnet real vía relayer
pnpm exec tsx scripts/probar-cadena.ts  # recorrido real en testnet sin passkeys
```

Desde la raíz, `./correr-local.sh` levanta la API en :3310 y la web en :5310.

## Rutas

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `GET /v1/salud` | público | estado |
| `GET /v1/stellar/config` | público | red, contratos y verificador WebAuthn para la web |
| `POST /v1/stellar/relayer` | público | despliegue de cuentas con passkey (protocolo del kit; solo el WASM aceptado) |
| `GET /v1/consentimientos/:tipo` | público | texto vigente y su hash |
| `GET /v1/ayuda?provincia=` | público | directorio de ayuda |
| `POST /v1/adultos` | público | alta del adulto con su consentimiento y su cuenta Stellar |
| `POST /v1/vinculos/codigo` | adulto | código de 6 dígitos válido 10 minutos |
| `GET /v1/adultos/yo` | adulto | vínculos, transacciones, tendencia semanal |
| `GET /v1/adultos/avisos` | adulto | historial de avisos |
| `POST /v1/dispositivos/vincular` | público | el adolescente canjea el código; el vínculo espera la firma del adulto |
| `GET /v1/dispositivos/yo` | dispositivo | estado del vínculo |
| `POST /v1/vinculos/:id/cadena/preparar` | adulto o dispositivo | entradas de autorización a firmar (`propose`, `accept` o `revoke`) |
| `POST /v1/vinculos/:id/cadena/enviar` | adulto o dispositivo | envía las entradas firmadas y sincroniza el estado |
| `POST /v1/dispositivos/latido` | dispositivo | latido |
| `POST /v1/dispositivos/eventos` | dispositivo | totales de pausas y eventos de protección |
| `GET /api/cron/latidos` | cron diario | sincroniza con la cadena, avisa "sin reportes", ancla el registro |
| `GET /api/cron/resumen` | cron de los lunes | resumen semanal |
| `GET /v1/auditoria/anclajes` | público | anclajes con enlace al explorador |
| `GET /v1/auditoria/verificar` | público | recorre la cadena del registro y dice si está íntegra |

## Desplegar en Vercel

Preset **Hono**, raíz `backend/`, entrada `src/index.ts`. El esquema se aplica solo al arrancar.

Variables necesarias:
- `DATABASE_URL`: la agrega la integración de Neon (Storage, Neon, Connect).
- `ORIGENES_WEB`: los orígenes exactos de la web, separados por coma (por ejemplo `https://orbita.cosmospay.lat`). No hay dominios de Vercel permitidos por defecto, porque los nombres de `*.vercel.app` los puede tomar cualquiera: `orbita-web.vercel.app` ya es de otra persona.

En la web, compilar con `VITE_API_URL` (URL del backend) y `VITE_DOMINIO_WEB` (dominio donde se crean las passkeys, sin `https://`).

Opcionales: `SPONSOR_SECRET` (pagar comisiones con cuenta propia), `CRON_SECRET` (sin ella se aceptan solo los pedidos del scheduler de Vercel), `REGISTRO_CLAVE` (sin ella se deriva de `DATABASE_URL`), `FCM_SERVICE_ACCOUNT` (push).

Reglas que rompieron despliegues anteriores:
- Vercel compila cada `.ts` sin bundler: los imports relativos llevan `.js` y `tsconfig` usa `NodeNext`.
- `@types/node` y `typescript` van en `devDependencies`.
- La entrada tiene que importar `hono` directamente.
