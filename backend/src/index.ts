// Entrada para Vercel (preset Hono): exporta la app configurada con las variables del proyecto.
import { crearApp } from "./rutas";
import { crearDbNeon } from "./db/index";
import { crearPush } from "./push";

const app = crearApp({
  db: process.env.DATABASE_URL ? crearDbNeon(process.env.DATABASE_URL) : null,
  push: crearPush(process.env.FCM_SERVICE_ACCOUNT),
  ahora: () => new Date(),
  claveRegistro: process.env.REGISTRO_CLAVE ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  adminToken: process.env.ADMIN_TOKEN ?? "",
});

export default app;
