import { neon } from "@neondatabase/serverless";
import { ESQUEMA } from "./esquema.js";

/** Mínimo común entre Neon (producción) y PGlite (tests y desarrollo). */
export interface Db {
  query<T = Record<string, unknown>>(texto: string, params?: unknown[]): Promise<T[]>;
}

export function crearDbNeon(url: string): Db {
  const sql = neon(url);
  return {
    async query<T>(texto: string, params: unknown[] = []) {
      return (await sql.query(texto, params)) as T[];
    },
  };
}

export async function migrar(db: Db) {
  for (const sentencia of ESQUEMA.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.query(sentencia);
  }
}
