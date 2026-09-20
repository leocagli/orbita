import { API_URL } from "./config";

export class ErrorApi extends Error {
  constructor(public status: number, public cuerpo: { error?: string; codigo?: string; detalle?: unknown }) {
    super(cuerpo.codigo ?? cuerpo.error ?? `error ${status}`);
  }
}

export async function api<T = any>(metodo: "GET" | "POST", ruta: string, body?: unknown, token?: string | null): Promise<T> {
  const r = await fetch(API_URL + ruta, {
    method: metodo,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorApi(r.status, json);
  return json as T;
}

export interface TxCadena {
  hash: string;
  url: string | null;
}

export interface VinculoAdulto {
  vinculo_id: string;
  estado: "esperando_adulto" | "propuesto" | "activo" | "revocado";
  revocado_por: string | null;
  adolescente: string;
  adolescente_stellar: string;
  proteccion_activa: boolean;
  sin_reportes: boolean;
  pausas: { semana: string; actual: number; anterior: number } | null;
  cadena: { propuesta: TxCadena | null; aceptacion: TxCadena | null; revocacion: TxCadena | null };
}

export interface VinculoAdolescente {
  vinculo_id: string;
  estado: VinculoAdulto["estado"];
  adulto: string;
  cadena: VinculoAdulto["cadena"];
}

export interface Modulo {
  kind: string;
  titulo: string;
  texto: string;
  obtenida: { token_id: number; tx: TxCadena | null } | null;
}

export interface Servicio {
  nombre: string;
  gestiona: string;
  provincia: string;
  contacto: string;
  horario: string;
  urgencia: boolean;
  fuente: string;
}
