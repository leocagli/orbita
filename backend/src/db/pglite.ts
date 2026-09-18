// Postgres en memoria para tests y `pnpm dev`. No se despliega.
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./index.js";
import { ESQUEMA } from "./esquema.js";

export async function crearDbPglite(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(ESQUEMA);
  return {
    async query<T>(texto: string, params: unknown[] = []) {
      const r = await pg.query<T>(texto, params);
      return r.rows;
    },
  };
}
