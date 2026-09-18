import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { crearApp, HORAS_SIN_REPORTES } from "../src/rutas.js";
import type { Db } from "../src/db/index.js";
import { crearDbPglite } from "../src/db/pglite.js";
import type { Aviso, Push } from "../src/push.js";
import { type Accion, type Cadena, type EstadoCadena, ErrorCadena, type ParamsVinculo } from "../src/stellar.js";
import { CONSENTIMIENTOS } from "../src/textos.js";
import { semanaAnterior, semanaIso, sha256 } from "../src/utiles.js";

const CLAVE = "clave-de-test";
const CRON = "cron-de-test";
const ADMIN = "admin-de-test";

/** Imita family-registry: mismas transiciones y mismas reglas de quién firma. */
class CadenaFalsa implements Cadena {
  red = "testnet";
  contrato = "CFALSO";
  estados = new Map<string, EstadoCadena>();
  anclados: string[] = [];
  n = 0;
  explorador = (h: string) => `https://explorer/${h}`;
  async crearCuenta() {
    return `tx-cuenta-${++this.n}`;
  }
  async preparar(accion: Accion, p: ParamsVinculo) {
    return [`entrada|${accion}|${p.firmante}`];
  }
  async enviar(accion: Accion, p: ParamsVinculo, firmadas: string[]) {
    if (firmadas.length !== 1 || firmadas[0] !== `firmada|${accion}|${p.firmante}`) throw new ErrorCadena("invocacion_distinta");
    const k = `${p.parent}|${p.child}`;
    const actual = this.estados.get(k);
    if (accion === "propose") this.estados.set(k, "Pending");
    if (accion === "accept") {
      if (actual !== "Pending") throw new ErrorCadena("simulacion_fallida", "NotPending");
      this.estados.set(k, "Active");
    }
    if (accion === "revoke") {
      if (!actual || actual === "Revoked") throw new ErrorCadena("simulacion_fallida");
      this.estados.set(k, "Revoked");
    }
    return `tx-${accion}-${++this.n}`;
  }
  async leer(parent: string, child: string) {
    return this.estados.get(`${parent}|${child}`) ?? null;
  }
  async anclar(hash: string) {
    this.anclados.push(hash);
    return `tx-ancla-${++this.n}`;
  }
}

let db: Db;
let reloj: Date;
let enviados: Aviso[];
let cadena: CadenaFalsa;
let app: ReturnType<typeof crearApp>;

const pushEspia: Push = {
  nombre: "espia",
  async enviar(pushToken, aviso) {
    if (!pushToken) return false;
    enviados.push(aviso);
    return true;
  },
};

const deps = () => ({
  db, cadena, configCadena: { red: "testnet" }, push: pushEspia, ahora: () => reloj,
  claveRegistro: CLAVE, cronSecret: CRON, adminToken: ADMIN, origenes: ["http://localhost:5173"],
});

beforeEach(async () => {
  db = await crearDbPglite();
  reloj = new Date("2026-09-16T15:00:00Z"); // miércoles, semana 2026-W38
  enviados = [];
  cadena = new CadenaFalsa();
  app = crearApp(deps());
});

const avanzar = (horas: number) => {
  reloj = new Date(reloj.getTime() + horas * 3_600_000);
};

async function llamar(metodo: string, ruta: string, body?: unknown, token?: string) {
  const res = await app.request(ruta, {
    method: metodo,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const consentimiento = (tipo: "adulto" | "adolescente") => ({ version: 1, texto_hash: sha256(CONSENTIMIENTOS[tipo][1]) });
const direccion = () => Keypair.random().publicKey();

/** Firma "con la passkey": en la cadena falsa, basta con marcar la entrada como firmada. */
async function firmarYEnviar(vinculoId: string, accion: Accion, token: string) {
  const prep = await llamar("POST", `/v1/vinculos/${vinculoId}/cadena/preparar`, { accion }, token);
  if (prep.status !== 200) return prep;
  const entradas = prep.json.entradas.map((e: string) => e.replace("entrada|", "firmada|"));
  return llamar("POST", `/v1/vinculos/${vinculoId}/cadena/enviar`, { accion, entradas }, token);
}

async function familia({ activar = true } = {}) {
  const adultoStellar = direccion();
  const adolescenteStellar = direccion();
  const adulto = (await llamar("POST", "/v1/adultos", { alias: "Mara", stellar: adultoStellar, consentimiento: consentimiento("adulto") })).json;
  const { codigo } = (await llamar("POST", "/v1/vinculos/codigo", undefined, adulto.token)).json;
  const dispositivo = (
    await llamar("POST", "/v1/dispositivos/vincular", {
      codigo, alias: "Juli", stellar: adolescenteStellar, asentimiento: consentimiento("adolescente"), version_app: "0.1",
    })
  ).json;
  if (activar) {
    await firmarYEnviar(dispositivo.vinculo_id, "propose", adulto.token);
    await firmarYEnviar(dispositivo.vinculo_id, "accept", dispositivo.token);
  }
  await llamar("POST", "/v1/adultos/push-token", { push_token: "fcm-123" }, adulto.token);
  enviados = [];
  return { adulto, dispositivo, adultoStellar, adolescenteStellar };
}

describe("vínculo en Stellar", () => {
  it("el adolescente canjea el código y el vínculo espera la firma del adulto", async () => {
    const { adulto, dispositivo } = await familia({ activar: false });
    expect(dispositivo.estado).toBe("esperando_adulto");
    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.json.vinculos[0]).toMatchObject({ estado: "esperando_adulto", pausas: null });
  });

  it("propose del adulto y accept del adolescente dejan el vínculo activo, con sus transacciones", async () => {
    const { adulto, dispositivo, adultoStellar, adolescenteStellar } = await familia({ activar: false });

    const prop = await firmarYEnviar(dispositivo.vinculo_id, "propose", adulto.token);
    expect(prop.json).toMatchObject({ ok: true, estado: "propuesto" });
    expect(await cadena.leer(adultoStellar, adolescenteStellar)).toBe("Pending");

    const acc = await firmarYEnviar(dispositivo.vinculo_id, "accept", dispositivo.token);
    expect(acc.json).toMatchObject({ ok: true, estado: "activo", tx: { url: expect.stringContaining("tx-accept") } });

    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.json.vinculos[0]).toMatchObject({ estado: "activo", adolescente: "Juli", adolescente_stellar: adolescenteStellar });
    expect(yo.json.vinculos[0].cadena.propuesta.hash).toMatch(/^tx-propose/);
    expect(yo.json.vinculos[0].cadena.aceptacion.hash).toMatch(/^tx-accept/);

    const disp = await llamar("GET", "/v1/dispositivos/yo", undefined, dispositivo.token);
    expect(disp.json.vinculos[0]).toMatchObject({ estado: "activo", adulto: "Mara" });

    const avisos = await llamar("GET", "/v1/adultos/avisos", undefined, adulto.token);
    expect(avisos.json.avisos[0].texto).toMatch(/Juli aceptó el vínculo/);

    const registro = await db.query<{ accion: string; sujeto_tipo: string; contexto: string }>(
      "select accion, sujeto_tipo, contexto from registro_consentimientos order by n",
    );
    expect(registro.map((r) => `${r.sujeto_tipo}:${r.accion}`)).toEqual(["adulto:otorgado", "adulto:otorgado", "adolescente:asentido"]);
    expect(registro[2].contexto).toMatch(/tx:tx-accept/);
  });

  it("cada rol solo puede hacer su parte y en el orden correcto", async () => {
    const { adulto, dispositivo } = await familia({ activar: false });
    expect((await firmarYEnviar(dispositivo.vinculo_id, "accept", dispositivo.token)).status).toBe(409); // sin propuesta
    expect((await firmarYEnviar(dispositivo.vinculo_id, "propose", dispositivo.token)).status).toBe(409); // no es el adulto
    await firmarYEnviar(dispositivo.vinculo_id, "propose", adulto.token);
    expect((await firmarYEnviar(dispositivo.vinculo_id, "accept", adulto.token)).status).toBe(409); // no es el adolescente
  });

  it("una firma sobre otra cosa se rechaza y no cambia nada", async () => {
    const { adulto, dispositivo } = await familia({ activar: false });
    const r = await llamar("POST", `/v1/vinculos/${dispositivo.vinculo_id}/cadena/enviar`, { accion: "propose", entradas: ["firmada|propose|OTRO"] }, adulto.token);
    expect(r.status).toBe(502);
    expect(r.json.codigo).toBe("invocacion_distinta");
    expect((await llamar("GET", "/v1/adultos/yo", undefined, adulto.token)).json.vinculos[0].estado).toBe("esperando_adulto");
  });

  it("nadie opera un vínculo ajeno", async () => {
    const a = await familia({ activar: false });
    const b = await familia({ activar: false });
    expect((await firmarYEnviar(a.dispositivo.vinculo_id, "propose", b.adulto.token)).status).toBe(404);
  });

  it("el adolescente revoca en la cadena: se avisa al adulto y se cortan los avisos", async () => {
    const { adulto, dispositivo } = await familia();
    const rev = await firmarYEnviar(dispositivo.vinculo_id, "revoke", dispositivo.token);
    expect(rev.json).toMatchObject({ ok: true, estado: "revocado" });

    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.json.vinculos[0]).toMatchObject({ estado: "revocado", revocado_por: "adolescente" });
    expect(enviados.map((a) => a.texto)).toEqual(["Juli desvinculó su teléfono."]);

    await llamar("POST", "/v1/dispositivos/eventos", { eventos: [{ tipo: "proteccion_desactivada", evento_id: "e9" }] }, dispositivo.token);
    expect(enviados).toHaveLength(1);
    expect((await firmarYEnviar(dispositivo.vinculo_id, "revoke", dispositivo.token)).status).toBe(409);
  });

  it("si el vínculo se revoca fuera de la app, el cron lo detecta en la cadena", async () => {
    const { adulto, dispositivo, adultoStellar, adolescenteStellar } = await familia();
    cadena.estados.set(`${adultoStellar}|${adolescenteStellar}`, "Revoked");
    const r = await llamar("GET", "/api/cron/latidos", undefined, CRON);
    expect(r.json.sincronizados).toBe(1);
    expect((await llamar("GET", "/v1/adultos/yo", undefined, adulto.token)).json.vinculos[0].estado).toBe("revocado");
    expect(enviados.map((a) => a.texto)).toEqual(["Juli desvinculó su teléfono."]);
    expect(dispositivo.token).toBeTruthy();
  });
});

describe("cuentas", () => {
  it("rechaza direcciones inválidas, duplicadas y la misma cuenta para los dos", async () => {
    expect((await llamar("POST", "/v1/adultos", { alias: "Mara", stellar: "GNOVALE", consentimiento: consentimiento("adulto") })).status).toBe(400);
    const s = direccion();
    const a = (await llamar("POST", "/v1/adultos", { alias: "Mara", stellar: s, consentimiento: consentimiento("adulto") })).json;
    expect((await llamar("POST", "/v1/adultos", { alias: "Otra", stellar: s, consentimiento: consentimiento("adulto") })).status).toBe(409);
    const { codigo } = (await llamar("POST", "/v1/vinculos/codigo", undefined, a.token)).json;
    const r = await llamar("POST", "/v1/dispositivos/vincular", { codigo, alias: "Juli", stellar: s, asentimiento: consentimiento("adolescente") });
    expect(r.json.error).toBe("misma_cuenta");
  });

  it("paga el despliegue de cuentas con passkey", async () => {
    const r = await llamar("POST", "/v1/stellar/cuentas", { func: "AAAA", auth: ["BBBB"] });
    expect(r.status).toBe(201);
    expect(r.json.tx.hash).toMatch(/^tx-cuenta/);
  });

  it("habla el protocolo de relayer de smart-account-kit", async () => {
    const ok = await llamar("POST", "/v1/stellar/relayer", { func: "AAAA", auth: ["BBBB"] });
    expect(ok.json).toEqual({ success: true, data: { hash: expect.stringMatching(/^tx-cuenta/), status: "success" } });
    const mal = await llamar("POST", "/v1/stellar/relayer", { xdr: "AAAA" });
    expect(mal.json).toMatchObject({ success: false, code: "INVALID_PARAMS" });
  });

  it("rechaza un hash de consentimiento que no coincide con el texto vigente", async () => {
    const r = await llamar("POST", "/v1/adultos", { alias: "Mara", stellar: direccion(), consentimiento: { version: 1, texto_hash: "a".repeat(64) } });
    expect(r.json.error).toBe("texto_no_coincide");
  });

  it("el código expira a los 10 minutos y no se reutiliza", async () => {
    const a = (await llamar("POST", "/v1/adultos", { alias: "Mara", stellar: direccion(), consentimiento: consentimiento("adulto") })).json;
    const { codigo } = (await llamar("POST", "/v1/vinculos/codigo", undefined, a.token)).json;
    const cuerpo = () => ({ codigo, alias: "Juli", stellar: direccion(), asentimiento: consentimiento("adolescente") });
    avanzar(0.2);
    expect((await llamar("POST", "/v1/dispositivos/vincular", cuerpo())).json.error).toBe("codigo_invalido");
    const { codigo: otro } = (await llamar("POST", "/v1/vinculos/codigo", undefined, a.token)).json;
    expect((await llamar("POST", "/v1/dispositivos/vincular", { ...cuerpo(), codigo: otro })).status).toBe(201);
    expect((await llamar("POST", "/v1/dispositivos/vincular", { ...cuerpo(), codigo: otro })).json.error).toBe("codigo_invalido");
  });

  it("sin token o con token ajeno no entra", async () => {
    expect((await llamar("GET", "/v1/adultos/yo")).status).toBe(401);
    expect((await llamar("GET", "/v1/adultos/yo", undefined, "inventado")).status).toBe(401);
    expect((await llamar("POST", "/v1/dispositivos/latido", { proteccion_activa: true }, "inventado")).status).toBe(401);
  });
});

describe("pausas y avisos", () => {
  it("guarda totales por semana de forma idempotente y arma la tendencia", async () => {
    const { adulto, dispositivo } = await familia();
    const semana = semanaIso(reloj);
    const eventos = [
      { tipo: "pausas", semana: semanaAnterior(reloj), cantidad: 2 },
      { tipo: "pausas", semana, cantidad: 5 },
    ];
    await llamar("POST", "/v1/dispositivos/eventos", { eventos }, dispositivo.token);
    await llamar("POST", "/v1/dispositivos/eventos", { eventos }, dispositivo.token);
    const yo = await llamar("GET", "/v1/adultos/yo", undefined, adulto.token);
    expect(yo.json.vinculos[0].pausas).toEqual({ semana, actual: 5, anterior: 2 });
    expect(yo.json.nota).toMatch(/No es un diagnóstico/);
  });

  it("un vínculo que todavía no está activo en la cadena no genera avisos", async () => {
    const { adulto, dispositivo } = await familia({ activar: false });
    const r = await llamar("POST", "/v1/dispositivos/eventos", { eventos: [{ tipo: "proteccion_desactivada", evento_id: "e1" }] }, dispositivo.token);
    expect(r.json.avisos).toBe(0);
    expect((await llamar("GET", "/v1/adultos/avisos", undefined, adulto.token)).json.avisos).toHaveLength(0);
  });

  it("protección desactivada avisa una sola vez por evento", async () => {
    const { dispositivo } = await familia();
    const eventos = [{ tipo: "proteccion_desactivada", evento_id: "e1" }];
    expect((await llamar("POST", "/v1/dispositivos/eventos", { eventos }, dispositivo.token)).json.avisos).toBe(1);
    expect((await llamar("POST", "/v1/dispositivos/eventos", { eventos }, dispositivo.token)).json.avisos).toBe(0);
    expect(enviados.map((a) => a.texto)).toEqual(["La protección en el teléfono de Juli se desactivó."]);
  });

  it("el cron avisa cuando el teléfono deja de reportar, una vez por episodio", async () => {
    const { dispositivo } = await familia();
    expect((await llamar("GET", "/api/cron/latidos", undefined, "otro")).status).toBe(401);
    avanzar(HORAS_SIN_REPORTES - 1);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.avisos).toBe(0);
    avanzar(2);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.avisos).toBe(1);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.avisos).toBe(0);
    await llamar("POST", "/v1/dispositivos/latido", { proteccion_activa: true }, dispositivo.token);
    avanzar(HORAS_SIN_REPORTES + 1);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.avisos).toBe(1);
  });

  it("el resumen semanal compara la semana cerrada con la previa", async () => {
    const { dispositivo } = await familia();
    const cerrada = semanaAnterior(reloj);
    const previa = semanaAnterior(new Date(reloj.getTime() - 7 * 86_400_000));
    await llamar("POST", "/v1/dispositivos/eventos", { eventos: [{ tipo: "pausas", semana: previa, cantidad: 7 }, { tipo: "pausas", semana: cerrada, cantidad: 3 }] }, dispositivo.token);
    expect((await llamar("GET", "/api/cron/resumen", undefined, CRON)).json.avisos).toBe(1);
    expect((await llamar("GET", "/api/cron/resumen", undefined, CRON)).json.avisos).toBe(0);
    expect(enviados.at(-1)?.texto).toBe("Esta semana hubo 3 pausas en el teléfono de Juli, 7 la anterior.");
  });
});

describe("registro y anclaje", () => {
  it("el cron ancla el último hash del registro en Stellar, solo si cambió", async () => {
    await familia();
    const r1 = await llamar("GET", "/api/cron/latidos", undefined, CRON);
    expect(r1.json.anclaje.hash).toMatch(/^tx-ancla/);
    const [ultima] = await db.query<{ hash: string }>("select hash from registro_consentimientos order by n desc limit 1");
    expect(cadena.anclados).toEqual([ultima.hash]);
    expect((await llamar("GET", "/api/cron/latidos", undefined, CRON)).json.anclaje).toBeNull();

    const pub = await llamar("GET", "/v1/auditoria/anclajes");
    expect(pub.json.anclajes).toHaveLength(1);
    expect(pub.json.anclajes[0]).toMatchObject({ hash_registro: ultima.hash, filas: 3, url: expect.stringContaining("tx-ancla") });
  });

  it("la cadena del registro verifica y detecta una fila editada", async () => {
    await familia();
    expect((await llamar("GET", "/v1/auditoria/verificar", undefined, "otro")).status).toBe(401);
    expect((await llamar("GET", "/v1/auditoria/verificar", undefined, ADMIN)).json).toEqual({ filas: 3, rota: null });
    await db.query("update registro_consentimientos set version = 9 where n = 2");
    expect((await llamar("GET", "/v1/auditoria/verificar", undefined, ADMIN)).json).toEqual({ filas: 3, rota: 2 });
  });
});

describe("público", () => {
  it("expone salud, configuración de Stellar, consentimientos y ayuda por provincia", async () => {
    expect((await llamar("GET", "/v1/salud")).json).toMatchObject({ ok: true, base: true, cadena: "testnet" });
    expect((await llamar("GET", "/v1/stellar/config")).json).toEqual({ red: "testnet" });
    const cons = await llamar("GET", "/v1/consentimientos/adolescente");
    expect(cons.json.texto_hash).toBe(sha256(cons.json.texto));
    const cordoba = await llamar("GET", "/v1/ayuda?provincia=córdoba");
    expect(cordoba.json.servicios.some((s: any) => s.provincia === "CABA")).toBe(false);
  });

  it("sin base o sin Stellar responde 503 en lo que los necesita", async () => {
    const sinNada = crearApp({ ...deps(), db: null, cadena: null });
    expect((await sinNada.request("/v1/adultos", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status).toBe(503);
    expect((await sinNada.request("/v1/stellar/cuentas", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status).toBe(503);
    expect((await sinNada.request("/v1/salud")).status).toBe(200);
  });

  it("CORS permite solo la web configurada", async () => {
    const ok = await app.request("/v1/salud", { headers: { origin: "http://localhost:5173" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const otro = await app.request("/v1/salud", { headers: { origin: "https://malo.example" } });
    expect(otro.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("semana ISO en hora argentina", () => {
  it("cambia de semana el lunes a las 03:00 UTC (lunes 00:00 en Argentina)", () => {
    expect(semanaIso(new Date("2026-09-21T02:59:00Z"))).toBe("2026-W38");
    expect(semanaIso(new Date("2026-09-21T03:00:00Z"))).toBe("2026-W39");
    expect(semanaIso(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});
