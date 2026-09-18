// Aplica el esquema en Neon: `DATABASE_URL=... pnpm migrar`. Es idempotente.
import { crearDbNeon, migrar } from "../src/db/index.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}
await migrar(crearDbNeon(url));
console.log("Esquema aplicado");
