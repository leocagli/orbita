// Entrada para Vercel (preset Hono). El preset exige que este archivo importe hono,
// así que la app configurada se monta sobre una instancia propia.
//
// Única variable necesaria: DATABASE_URL (la inyecta la integración de Neon en Vercel).
// Todo lo demás tiene valores por defecto para testnet; las comisiones las paga el
// relayer público salvo que se defina SPONSOR_SECRET.
import { Hono } from "hono";
import { crearApp } from "./rutas.js";
import { conMigracion, crearDbNeon } from "./db/index.js";
import { crearPush } from "./push.js";
import { cadenaDesdeEntorno, configPublica } from "./stellar.js";
import { sha256 } from "./utiles.js";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const app = new Hono();

app.route(
  "/",
  crearApp({
    db: url ? conMigracion(crearDbNeon(url)) : null,
    cadena: cadenaDesdeEntorno(process.env),
    configCadena: configPublica(process.env),
    push: crearPush(process.env.FCM_SERVICE_ACCOUNT),
    ahora: () => new Date(),
    // Sin REGISTRO_CLAVE, la clave del registro se deriva de la conexión a la base,
    // que es secreta y solo vive en el servidor.
    claveRegistro: process.env.REGISTRO_CLAVE ?? (url ? sha256(`orbita-registro:${url}`) : ""),
    cronSecret: process.env.CRON_SECRET ?? "",
    origenes: (process.env.ORIGENES_WEB ?? "").split(",").filter(Boolean),
  }),
);

export default app;
