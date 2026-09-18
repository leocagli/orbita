import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";

export const id = () => randomUUID();

export const token = () => randomBytes(32).toString("base64url");

export const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

export const hmac = (clave: string, texto: string) => createHmac("sha256", clave).update(texto).digest("hex");

export const codigoDeSeisDigitos = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Argentina no tiene horario de verano: UTC-3 fijo. */
const OFFSET_AR_MS = -3 * 60 * 60 * 1000;

/** Semana ISO ("2026-W38") en hora argentina. */
export function semanaIso(fecha: Date): string {
  const d = new Date(fecha.getTime() + OFFSET_AR_MS);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = utc.getUTCDay() || 7; // lunes = 1, domingo = 7
  utc.setUTCDate(utc.getUTCDate() + 4 - dia); // jueves de la misma semana
  const inicioAnio = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((utc.getTime() - inicioAnio.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

export const semanaAnterior = (fecha: Date) => semanaIso(new Date(fecha.getTime() - 7 * 86_400_000));

export const ES_SEMANA = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

export const horasEntre = (a: Date, b: Date) => Math.abs(b.getTime() - a.getTime()) / 3_600_000;
