// Postgres embebido para tests y para correr local. No se despliega.
// Sin `dir` queda en memoria; con `dir` persiste en disco.
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./index.js";
import { ESQUEMA } from "./esquema.js";

export async function crearDbPglite(dir?: string): Promise<Db> {
  const pg = new PGlite(dir);
  await pg.exec(ESQUEMA);
  return {
    async query<T>(texto: string, params: unknown[] = []) {
      const r = await pg.query<T>(texto, params);
      return r.rows;
    },
  };
}
