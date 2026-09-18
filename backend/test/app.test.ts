import { beforeEach, describe, expect, it } from "vitest";
import { crearApp, HORAS_SIN_REPORTES } from "../src/rutas";
import type { Db } from "../src/db/index";
import { crearDbPglite } from "../src/db/pglite";
import type { Aviso, Push } from "../src/push";
import { CONSENTIMIENTOS } from "../src/textos";
import { semanaAnterior, semanaIso, sha256 } from "../src/utiles";

const CLAVE = "clave-de-test";
const CRON = "cron-de-test";
const ADMIN = "admin-de-test";

let db: Db;
let reloj: Date;
let enviados: Aviso[];
let app: ReturnType<typeof crearApp>;

const pushEspia: Push = {
  nombre: "espia",
  async enviar(pushToken, aviso) {
    if (!pushToken) return false;
    enviados.push(aviso);
    return true;
  },
};

beforeEach(async () => {
  db = await crearDbPglite();
  reloj = new Date("2026-09-16T15:00:00Z"); // miércoles, semana 2026-W38
  enviados = [];
  app = crearApp({ db, push: pushEspia, ahora: () => reloj, claveRegistro: CLAVE, cronSecret: CRON, adminToken: ADMIN });
});

const avanzar = (horas: number) => { reloj = new Date(reloj.getTime() + horas * 3_600_000); };

async function llamar(metodo: string, ruta: string, body?: unknown, token?: string) {
  const res = await app.request(ruta, {
    method: metodo,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const consentimiento = (tipo: "adulto" | "adolescente") => ({ version: 1, texto_hash: sha256(CONSENTIMIENTOS[tipo][1]) });

async function familia() {
  const adulto = await llamar("POST", "/v1/adultos", { alias: "Mara", consentimiento: consentimiento("adulto") });
  const codigo = await llamar("POST", "/v1/vinculos/codigo", undefined, adulto.json.token);
  const dispositivo = await llamar("POST", "/v1/dispositivos/vincular", {
    codigo: codigo.json.codigo, alias: "Juli", asentimiento: consentimiento("adolescente"), version_app: "0.1",
  });
  return { adulto: adulto.json, dispositivo: dispositivo.json };
}

describe("emparejamiento", () => {
  it("el adulto consiente, genera un código y el adolescente asiente", async () => {
    const { adulto, dispositivo } = await familia();
    expect(dispositivo.adulto).toBe("Mara");

    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.status).toBe(200);
    expect(yo.json.vinculos).toHaveLength(1);
    expect(yo.json.vinculos[0]).toMatchObject({ adolescente: "Juli", estado: "activo", proteccion_activa: true, sin_reportes: false });
    expect(yo.json.nota).toMatch(/No es un diagnóstico/);

    const registro = await db.query<{ accion: string; sujeto_tipo: string }>("select accion, sujeto_tipo from registro_consentimientos order by n");
    expect(registro).toEqual([
      { accion: "otorgado", sujeto_tipo: "adulto" },
      { accion: "asentido", sujeto_tipo: "adolescente" },
    ]);
  });

  it("rechaza un hash que no coincide con el texto vigente", async () => {
    const r = await llamar("POST", "/v1/adultos", { alias: "Mara", consentimiento: { version: 1, texto_hash: "a".repeat(64) } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("texto_no_coincide");
  });

  it("el código expira a los 10 minutos y no se reutiliza", async () => {
    const adulto = await llamar("POST", "/v1/adultos", { alias: "Mara", consentimiento: consentimiento("adulto") });
    const { codigo } = (await llamar("POST", "/v1/vinculos/codigo", undefined, adulto.json.token)).json;
    const cuerpo = { codigo, alias: "Juli", asentimiento: consentimiento("adolescente") };

    avanzar(0.2); // 12 minutos
    expect((await llamar("POST", "/v1/dispositivos/vincular", cuerpo)).json.error).toBe("codigo_invalido");

    const { codigo: otro } = (await llamar("POST", "/v1/vinculos/codigo", undefined, adulto.json.token)).json;
    expect((await llamar("POST", "/v1/dispositivos/vincular", { ...cuerpo, codigo: otro })).status).toBe(201);
    expect((await llamar("POST", "/v1/dispositivos/vincular", { ...cuerpo, codigo: otro })).json.error).toBe("codigo_invalido");
  });

  it("sin token o con token ajeno no entra", async () => {
    expect((await llamar("GET", "/v1/adultos/yo")).status).toBe(401);
    expect((await llamar("GET", "/v1/adultos/yo", undefined, "inventado")).status).toBe(401);
    expect((await llamar("POST", "/v1/dispositivos/latido", { proteccion_activa: true }, "inventado")).status).toBe(401);
  });
});

describe("pausas y tendencia", () => {
  it("guarda totales por semana de forma idempotente y arma la tendencia", async () => {
    const { adulto, dispositivo } = await familia();
    const semana = semanaIso(reloj);
    const previa = semanaAnterior(reloj);
    const eventos = [
      { tipo: "pausas", semana: previa, cantidad: 2 },
      { tipo: "pausas", semana, cantidad: 5 },
    ];
    expect((await llamar("POST", "/v1/dispositivos/eventos", { eventos }, dispositivo.token)).status).toBe(200);
    expect((await llamar("POST", "/v1/dispositivos/eventos", { eventos }, dispositivo.token)).status).toBe(200);

    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.json.vinculos[0].pausas).toEqual({ semana, actual: 5, anterior: 2 });
    expect(JSON.stringify(yo.json)).not.toMatch(/bet|casino/);
  });

  it("rechaza semanas mal formadas", async () => {
    const { dispositivo } = await familia();
    const r = await llamar("POST", "/v1/dispositivos/eventos", { eventos: [{ tipo: "pausas", semana: "2026-38", cantidad: 1 }] }, dispositivo.token);
    expect(r.status).toBe(400);
  });
});

describe("avisos al adulto", () => {
  it("protección desactivada avisa una sola vez por evento", async () => {
    const { adulto, dispositivo } = await familia();
    await llamar("POST", "/v1/adultos/push-token", { push_token: "fcm-123" }, adulto.token);
    const eventos = [{ tipo: "proteccion_desactivada", evento_id: "e1" }];

    expect((await llamar("POST", "/v1/dispositivos/eventos", { eventos }, dispositivo.token)).json.avisos).toBe(1);
    expect((await llamar("POST", "/v1/dispositivos/eventos", { eventos }, dispositivo.token)).json.avisos).toBe(0);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toBe("La protección en el teléfono de Juli se desactivó.");

    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.json.vinculos[0].proteccion_activa).toBe(false);
    const avisos = await llamar("GET", "/v1/adultos/avisos", undefined, adulto.token);
    expect(avisos.json.avisos[0]).toMatchObject({ tipo: "proteccion_desactivada", enviado_por: "espia" });
  });

  it("sin push token el aviso queda registrado igual", async () => {
    const { adulto, dispositivo } = await familia();
    await llamar("POST", "/v1/dispositivos/eventos", { eventos: [{ tipo: "proteccion_desactivada", evento_id: "e1" }] }, dispositivo.token);
    expect(enviados).toHaveLength(0);
    const avisos = await llamar("GET", "/v1/adultos/avisos", undefined, adulto.token);
    expect(avisos.json.avisos[0].enviado_por).toBe("registro");
  });

  it("el cron de latidos avisa cuando el teléfono deja de reportar, una vez por episodio", async () => {
    const { adulto, dispositivo } = await familia();
    expect((await llamar("GET", "/api/cron/latidos", undefined, "otro")).status).toBe(401);

    avanzar(HORAS_SIN_REPORTES - 1);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.avisos).toBe(0);

    avanzar(2);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.avisos).toBe(1);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.avisos).toBe(0);

    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.json.vinculos[0].sin_reportes).toBe(true);
    const avisos = await llamar("GET", "/v1/adultos/avisos", undefined, adulto.token);
    expect(avisos.json.avisos[0].texto).toMatch(/no reporta desde hace 2 días/);

    // Vuelve a reportar y después vuelve a callarse: nuevo episodio, nuevo aviso.
    await llamar("POST", "/v1/dispositivos/latido", { proteccion_activa: true }, dispositivo.token);
    expect((await llamar("GET", "/v1/adultos/yo", undefined, adulto.token)).json.vinculos[0].sin_reportes).toBe(false);
    avanzar(HORAS_SIN_REPORTES + 1);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.avisos).toBe(1);
  });

  it("el resumen semanal compara la semana cerrada con la previa", async () => {
    const { adulto, dispositivo } = await familia();
    const cerrada = semanaAnterior(reloj);
    const previa = semanaAnterior(new Date(reloj.getTime() - 7 * 86_400_000));
    await llamar("POST", "/v1/dispositivos/eventos", {
      eventos: [{ tipo: "pausas", semana: previa, cantidad: 7 }, { tipo: "pausas", semana: cerrada, cantidad: 3 }],
    }, dispositivo.token);

    expect((await llamar("GET", "/api/cron/resumen", undefined, CRON)).json.avisos).toBe(1);
    expect((await llamar("GET", "/api/cron/resumen", undefined, CRON)).json.avisos).toBe(0);
    const avisos = await llamar("GET", "/v1/adultos/avisos", undefined, adulto.token);
    expect(avisos.json.avisos[0].texto).toBe("Esta semana hubo 3 pausas en el teléfono de Juli, 7 la anterior.");
  });
});

describe("revocación", () => {
  it("el adolescente puede desvincular: se avisa al adulto y queda en el registro", async () => {
    const { adulto, dispositivo } = await familia();
    expect((await llamar("POST", "/v1/dispositivos/desvincular", undefined, dispositivo.token)).status).toBe(200);
    expect((await llamar("POST", "/v1/dispositivos/desvincular", undefined, dispositivo.token)).status).toBe(409);

    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.json.vinculos[0]).toMatchObject({ estado: "revocado", revocado_por: "adolescente" });
    const avisos = await llamar("GET", "/v1/adultos/avisos", undefined, adulto.token);
    expect(avisos.json.avisos[0].texto).toBe("Juli desvinculó su teléfono.");

    // Un dispositivo desvinculado ya no genera avisos.
    await llamar("POST", "/v1/dispositivos/eventos", { eventos: [{ tipo: "proteccion_desactivada", evento_id: "e9" }] }, dispositivo.token);
    expect((await llamar("GET", "/v1/adultos/avisos", undefined, adulto.token)).json.avisos).toHaveLength(1);
  });

  it("el adulto revoca por id de vínculo", async () => {
    const { adulto, dispositivo } = await familia();
    expect((await llamar("DELETE", `/v1/vinculos/${dispositivo.vinculo_id}`, undefined, adulto.token)).status).toBe(200);
    expect((await llamar("DELETE", `/v1/vinculos/${dispositivo.vinculo_id}`, undefined, adulto.token)).status).toBe(409);
    const registro = await db.query<{ accion: string; sujeto_tipo: string }>("select accion, sujeto_tipo from registro_consentimientos order by n");
    expect(registro.at(-1)).toEqual({ accion: "revocado", sujeto_tipo: "adulto" });
  });
});

describe("registro de consentimientos", () => {
  it("la cadena verifica, y detecta una fila editada", async () => {
    const { dispositivo } = await familia();
    await llamar("POST", "/v1/dispositivos/desvincular", undefined, dispositivo.token);

    expect((await llamar("GET", "/v1/auditoria/verificar", undefined, "otro")).status).toBe(401);
    expect((await llamar("GET", "/v1/auditoria/verificar", undefined, ADMIN)).json).toEqual({ filas: 3, rota: null });

    await db.query("update registro_consentimientos set version = 9 where n = 2");
    expect((await llamar("GET", "/v1/auditoria/verificar", undefined, ADMIN)).json).toEqual({ filas: 3, rota: 2 });
  });
});

describe("público", () => {
  it("expone salud, textos de consentimiento y el directorio de ayuda por provincia", async () => {
    expect((await llamar("GET", "/v1/salud")).json).toMatchObject({ ok: true, base: true, push: "espia" });

    const cons = await llamar("GET", "/v1/consentimientos/adolescente");
    expect(cons.json.version).toBe(1);
    expect(cons.json.texto_hash).toBe(sha256(cons.json.texto));

    const todos = await llamar("GET", "/v1/ayuda");
    const cordoba = await llamar("GET", "/v1/ayuda?provincia=córdoba");
    expect(todos.json.servicios.length).toBeGreaterThan(cordoba.json.servicios.length);
    expect(cordoba.json.servicios.map((s: any) => s.provincia)).toEqual(expect.arrayContaining(["nacional", "Córdoba"]));
    expect(cordoba.json.servicios.some((s: any) => s.provincia === "CABA")).toBe(false);
  });

  it("sin base responde 503 en lo que la necesita", async () => {
    const sinBase = crearApp({ db: null, push: pushEspia, ahora: () => reloj, claveRegistro: CLAVE, cronSecret: CRON, adminToken: ADMIN });
    const r = await sinBase.request("/v1/adultos", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(r.status).toBe(503);
    expect((await sinBase.request("/v1/salud")).status).toBe(200);
  });
});

describe("semana ISO en hora argentina", () => {
  it("cambia de semana el lunes a las 03:00 UTC (lunes 00:00 en Argentina)", () => {
    expect(semanaIso(new Date("2026-09-21T02:59:00Z"))).toBe("2026-W38");
    expect(semanaIso(new Date("2026-09-21T03:00:00Z"))).toBe("2026-W39");
    expect(semanaIso(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});
