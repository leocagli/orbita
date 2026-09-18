# Backend de Órbita

API mínima para Órbita (adolescente) y Órbita Familia (adulto): consentimientos, emparejamiento por código, conteos de pausas por semana, latidos, avisos al adulto y directorio de ayuda. Corre en Vercel Functions con Hono y Neon Postgres.

**Lo que nunca recibe el servidor:** dominios visitados, horarios exactos, nombres reales. El teléfono deduplica y manda totales por semana; el adulto ve tendencias.

## Correr local

```sh
pnpm install
pnpm test        # PGlite en memoria, sin servidor de base
pnpm dev         # http://localhost:3000, con PGlite si no hay DATABASE_URL
```

## Rutas

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `GET /v1/salud` | público | estado |
| `GET /v1/consentimientos/:tipo` | público | texto vigente y su hash (`adulto` o `adolescente`) |
| `GET /v1/ayuda?provincia=` | público | directorio de ayuda con fecha de verificación |
| `POST /v1/adultos` | público | alta del adulto con su consentimiento; devuelve token |
| `POST /v1/vinculos/codigo` | adulto | código de 6 dígitos válido 10 minutos |
| `GET /v1/adultos/yo` | adulto | vínculos, estado de protección, tendencia semanal |
| `GET /v1/adultos/avisos` | adulto | historial de avisos |
| `POST /v1/adultos/push-token` | adulto | registra el token de FCM |
| `DELETE /v1/vinculos/:id` | adulto | revoca el vínculo |
| `POST /v1/dispositivos/vincular` | público | canjea el código con el asentimiento del adolescente; devuelve token |
| `POST /v1/dispositivos/latido` | dispositivo | latido con estado de protección |
| `POST /v1/dispositivos/eventos` | dispositivo | totales de pausas por semana y eventos de protección |
| `POST /v1/dispositivos/desvincular` | dispositivo | el adolescente revoca; se avisa al adulto |
| `GET /api/cron/latidos` | cron | avisa "sin reportes" pasadas 48 h sin latido, una vez por episodio |
| `GET /api/cron/resumen` | cron (lunes) | resumen semanal de pausas |
| `GET /v1/auditoria/verificar` | admin | verifica la cadena del registro de consentimientos |

Los tokens van en `Authorization: Bearer ...` y se guardan hasheados.

## Registro de consentimientos

Tabla de solo agregado. Cada fila guarda tipo de sujeto, acción (otorgado, asentido, revocado), versión y hash del texto mostrado, fecha, el hash de la fila anterior, su propio hash y una firma HMAC con `REGISTRO_CLAVE`. `GET /v1/auditoria/verificar` recorre la cadena.

Límite conocido: dos altas al mismo tiempo pueden competir por el mismo `hash_previo`; con el volumen inicial no importa, y se resuelve con una transacción cuando haga falta.

## Desplegar en Vercel

1. Crear el proyecto y conectar Neon: `vercel link` y `vercel integration add neon --plan free`. Eso define `DATABASE_URL`.
2. Aplicar el esquema: `DATABASE_URL=... pnpm migrar`.
3. Variables en el proyecto: `REGISTRO_CLAVE`, `CRON_SECRET`, `ADMIN_TOKEN` (ver `.env.example`). `FCM_SERVICE_ACCOUNT` cuando exista Firebase.
4. `vercel deploy` o el despliegue desde el panel.

Los crons están en `vercel.json`. En plan hobby corren como máximo una vez por día, con horario aproximado.
