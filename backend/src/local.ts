// Servidor local para probar sin Vercel: `pnpm dev`.
// Sin DATABASE_URL usa PGlite (en memoria, o en disco con PGLITE_DIR). Habla con testnet
// real: con SPONSOR_SECRET paga nuestra cuenta, sin él paga el relayer público.
import { serve } from "@hono/node-server";
import { crearApp } from "./rutas.js";
import { crearDbNeon } from "./db/index.js";
import { crearDbPglite } from "./db/pglite.js";
import { crearPush } from "./push.js";
import { cadenaDesdeEntorno, configPublica } from "./stellar.js";

const db = process.env.DATABASE_URL ? crearDbNeon(process.env.DATABASE_URL) : await crearDbPglite(process.env.PGLITE_DIR);
const cadena = cadenaDesdeEntorno(process.env);
const config = configPublica(process.env);

const app = crearApp({
  db,
  cadena,
  configCadena: config,
  push: crearPush(process.env.FCM_SERVICE_ACCOUNT),
  ahora: () => new Date(),
  claveRegistro: process.env.REGISTRO_CLAVE ?? "clave-de-desarrollo",
  cronSecret: process.env.CRON_SECRET ?? "cron-de-desarrollo",
  origenes: (process.env.ORIGENES_WEB ?? "http://localhost:5173,http://127.0.0.1:5173").split(","),
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
const base = process.env.DATABASE_URL ? "Neon" : process.env.PGLITE_DIR ? `PGlite en ${process.env.PGLITE_DIR}` : "PGlite en memoria";
console.log(`Órbita backend en http://0.0.0.0:${port} (${base}, Stellar ${cadena.red}, comisiones: ${config.pago_comisiones})`);
