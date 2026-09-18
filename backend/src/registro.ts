// Registro de consentimientos: solo agregado, encadenado por hash y firmado con HMAC.
// Es la prueba de qué texto se mostró (por su hash y versión), a quién y cuándo, y de
// que nadie editó filas después. No reemplaza verificar la identidad del adulto.

import type { Db } from "./db/index.js";
import { hmac, sha256 } from "./utiles.js";

export type Accion = "otorgado" | "asentido" | "revocado";
export type SujetoTipo = "adulto" | "adolescente";

export interface Entrada {
  sujeto_tipo: SujetoTipo;
  sujeto_id: string;
  accion: Accion;
  version: number;
  texto_hash: string;
  contexto: string | null;
  ts: Date;
}

interface Fila extends Omit<Entrada, "ts"> {
  n: number;
  ts: string | Date;
  hash_previo: string | null;
  hash: string;
  firma: string;
}

function hashDe(e: Entrada, hashPrevio: string | null): string {
  return sha256(
    JSON.stringify([
      hashPrevio,
      e.sujeto_tipo,
      e.sujeto_id,
      e.accion,
      e.version,
      e.texto_hash,
      e.contexto,
      e.ts.toISOString(),
    ]),
  );
}

export async function anotar(db: Db, clave: string, e: Entrada): Promise<string> {
  const [ultima] = await db.query<{ hash: string }>(
    "select hash from registro_consentimientos order by n desc limit 1",
  );
  const hashPrevio = ultima?.hash ?? null;
  const hash = hashDe(e, hashPrevio);
  await db.query(
    `insert into registro_consentimientos
       (sujeto_tipo, sujeto_id, accion, version, texto_hash, contexto, ts, hash_previo, hash, firma)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [e.sujeto_tipo, e.sujeto_id, e.accion, e.version, e.texto_hash, e.contexto, e.ts, hashPrevio, hash, hmac(clave, hash)],
  );
  return hash;
}

/** Recorre toda la cadena. Devuelve la primera fila rota, o null si está íntegra. */
export async function verificar(db: Db, clave: string): Promise<{ filas: number; rota: number | null }> {
  const filas = await db.query<Fila>("select * from registro_consentimientos order by n asc");
  let previo: string | null = null;
  for (const f of filas) {
    const esperado = hashDe({ ...f, ts: new Date(f.ts) }, previo);
    if (f.hash_previo !== previo || f.hash !== esperado || f.firma !== hmac(clave, f.hash)) {
      return { filas: filas.length, rota: Number(f.n) };
    }
    previo = f.hash;
  }
  return { filas: filas.length, rota: null };
}
