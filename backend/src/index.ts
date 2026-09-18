// Entrada para Vercel (preset Hono). El preset exige que este archivo importe hono,
// así que la app configurada se monta sobre una instancia propia.
import { Hono } from "hono";
import { crearApp } from "./rutas.js";
import { crearDbNeon } from "./db/index.js";
import { crearPush } from "./push.js";
import { cadenaDesdeEntorno, configPublica } from "./stellar.js";

const app = new Hono();

app.route(
  "/",
  crearApp({
    db: process.env.DATABASE_URL ? crearDbNeon(process.env.DATABASE_URL) : null,
    cadena: cadenaDesdeEntorno(process.env),
    configCadena: configPublica(process.env),
    push: crearPush(process.env.FCM_SERVICE_ACCOUNT),
    ahora: () => new Date(),
    claveRegistro: process.env.REGISTRO_CLAVE ?? "",
    cronSecret: process.env.CRON_SECRET ?? "",
    adminToken: process.env.ADMIN_TOKEN ?? "",
    origenes: (process.env.ORIGENES_WEB ?? "https://orbita-web.vercel.app").split(","),
  }),
);

export default app;
