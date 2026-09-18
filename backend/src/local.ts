// Servidor local para probar sin Vercel: `pnpm dev`.
// Sin DATABASE_URL usa PGlite en memoria, así que se puede correr sin Neon.
import { serve } from "@hono/node-server";
import { crearApp } from "./rutas.js";
import { crearDbNeon } from "./db/index.js";
import { crearDbPglite } from "./db/pglite.js";
import { crearPush } from "./push.js";

const db = process.env.DATABASE_URL
  ? crearDbNeon(process.env.DATABASE_URL)
  : await crearDbPglite();

const app = crearApp({
  db,
  push: crearPush(process.env.FCM_SERVICE_ACCOUNT),
  ahora: () => new Date(),
  claveRegistro: process.env.REGISTRO_CLAVE ?? "clave-de-desarrollo",
  cronSecret: process.env.CRON_SECRET ?? "cron-de-desarrollo",
  adminToken: process.env.ADMIN_TOKEN ?? "admin-de-desarrollo",
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`Órbita backend en http://0.0.0.0:${port} (${process.env.DATABASE_URL ? "Neon" : "PGlite en memoria"})`);
