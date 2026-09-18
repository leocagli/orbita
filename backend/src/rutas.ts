import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Db } from "./db/index.js";
import type { Push } from "./push.js";
import { anotar, verificar } from "./registro.js";
import { AVISOS, CONSENTIMIENTOS, NOTA_NO_DIAGNOSTICO, versionVigente } from "./textos.js";
import { ES_SEMANA, codigoDeSeisDigitos, horasEntre, id, semanaAnterior, semanaIso, sha256, token } from "./utiles.js";
import { AYUDA as ayuda } from "./datos/ayuda.js";

export interface Deps {
  db: Db | null;
  push: Push;
  ahora: () => Date;
  claveRegistro: string;
  cronSecret: string;
  adminToken: string;
}

/** Sin latido durante este tiempo, el adulto recibe "sin reportes". */
export const HORAS_SIN_REPORTES = 48;
const MINUTOS_CODIGO = 10;

type Vars = { adulto: { id: string; alias: string; push_token: string | null }; dispositivo: { id: string; alias: string } };
type App = Hono<{ Variables: Vars }>;

const consentimientoSchema = z.object({
  version: z.number().int().positive(),
  texto_hash: z.string().regex(/^[0-9a-f]{64}$/),
});

function bearer(c: Context): string | null {
  const h = c.req.header("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function crearApp(deps: Deps): App {
  const app: App = new Hono();
  const { push, ahora, claveRegistro } = deps;

  const requiereDb: MiddlewareHandler = async (c, next) => {
    if (!deps.db) return c.json({ error: "sin_base", detalle: "Falta DATABASE_URL" }, 503);
    await next();
  };
  const db = () => deps.db as Db;

  const autenticaAdulto: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
    const t = bearer(c);
    if (!t) return c.json({ error: "sin_token" }, 401);
    const [a] = await db().query<Vars["adulto"]>("select id, alias, push_token from adultos where token_hash = $1", [sha256(t)]);
    if (!a) return c.json({ error: "token_invalido" }, 401);
    c.set("adulto", a);
    await next();
  };

  const autenticaDispositivo: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
    const t = bearer(c);
    if (!t) return c.json({ error: "sin_token" }, 401);
    const [d] = await db().query<Vars["dispositivo"]>("select id, alias from dispositivos where token_hash = $1", [sha256(t)]);
    if (!d) return c.json({ error: "token_invalido" }, 401);
    c.set("dispositivo", d);
    await next();
  };

  const autenticaCron: MiddlewareHandler = async (c, next) => {
    if (!deps.cronSecret || bearer(c) !== deps.cronSecret) return c.json({ error: "no_autorizado" }, 401);
    await next();
  };

  /** Guarda el aviso y, si hay push, lo manda. `claveUnica` evita repetir el mismo aviso. */
  async function avisar(adulto: Vars["adulto"], tipo: string, texto: string, claveUnica: string | null) {
    const aviso = { id: id(), tipo, texto };
    const insertado = await db().query<{ id: string }>(
      `insert into avisos (id, adulto_id, tipo, texto, creado, clave_unica) values ($1, $2, $3, $4, $5, $6)
       on conflict (clave_unica) do nothing returning id`,
      [aviso.id, adulto.id, tipo, texto, ahora(), claveUnica],
    );
    if (insertado.length === 0) return false;
    const llego = await push.enviar(adulto.push_token, aviso);
    await db().query("update avisos set enviado_por = $2, enviado = $3 where id = $1", [
      aviso.id,
      llego ? push.nombre : "registro",
      ahora(),
    ]);
    return true;
  }

  function validarConsentimiento(tipo: "adulto" | "adolescente", c: z.infer<typeof consentimientoSchema>) {
    const texto = CONSENTIMIENTOS[tipo][c.version];
    if (!texto) return "version_desconocida";
    if (sha256(texto) !== c.texto_hash) return "texto_no_coincide";
    return null;
  }

  // ---------- Público ----------

  app.get("/v1/salud", (c) => c.json({ ok: true, base: Boolean(deps.db), push: push.nombre, ahora: ahora().toISOString() }));

  app.get("/v1/consentimientos/:tipo", (c) => {
    const tipo = c.req.param("tipo");
    if (tipo !== "adulto" && tipo !== "adolescente") return c.json({ error: "tipo_invalido" }, 400);
    const version = versionVigente(tipo);
    const texto = CONSENTIMIENTOS[tipo][version];
    return c.json({ tipo, version, texto, texto_hash: sha256(texto) });
  });

  app.get("/v1/ayuda", (c) => {
    const provincia = c.req.query("provincia");
    const servicios = provincia
      ? ayuda.servicios.filter((s) => s.provincia === "nacional" || s.provincia.toLowerCase() === provincia.toLowerCase())
      : ayuda.servicios;
    return c.json({ fecha_verificacion: ayuda.fecha_verificacion, nota: ayuda.nota, servicios });
  });

  // ---------- Adulto ----------

  app.post("/v1/adultos", requiereDb, async (c) => {
    const body = z.object({ alias: z.string().trim().min(1).max(40), consentimiento: consentimientoSchema }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido", detalle: body.error.issues }, 400);
    const problema = validarConsentimiento("adulto", body.data.consentimiento);
    if (problema) return c.json({ error: problema }, 400);

    const adultoId = id();
    const t = token();
    await db().query("insert into adultos (id, alias, token_hash, creado) values ($1, $2, $3, $4)", [adultoId, body.data.alias, sha256(t), ahora()]);
    await anotar(db(), claveRegistro, {
      sujeto_tipo: "adulto",
      sujeto_id: adultoId,
      accion: "otorgado",
      version: body.data.consentimiento.version,
      texto_hash: body.data.consentimiento.texto_hash,
      contexto: "alta",
      ts: ahora(),
    });
    return c.json({ adulto_id: adultoId, token: t }, 201);
  });

  app.post("/v1/vinculos/codigo", requiereDb, autenticaAdulto, async (c) => {
    const adulto = c.get("adulto");
    const codigo = codigoDeSeisDigitos();
    const expira = new Date(ahora().getTime() + MINUTOS_CODIGO * 60_000);
    await db().query("insert into codigos (codigo, adulto_id, expira) values ($1, $2, $3)", [codigo, adulto.id, expira]);
    return c.json({ codigo, expira: expira.toISOString() }, 201);
  });

  app.get("/v1/adultos/yo", requiereDb, autenticaAdulto, async (c) => {
    const adulto = c.get("adulto");
    const actual = semanaIso(ahora());
    const anterior = semanaAnterior(ahora());
    const filas = await db().query<{
      vinculo_id: string; estado: string; revocado_por: string | null; dispositivo_id: string; alias: string;
      proteccion_activa: boolean; ultimo_latido: string | null; actual: number | null; anterior: number | null;
    }>(
      `select v.id as vinculo_id, v.estado, v.revocado_por, d.id as dispositivo_id, d.alias, d.proteccion_activa, d.ultimo_latido,
              (select cantidad from pausas_semana p where p.dispositivo_id = d.id and p.semana = $2) as actual,
              (select cantidad from pausas_semana p where p.dispositivo_id = d.id and p.semana = $3) as anterior
         from vinculos v join dispositivos d on d.id = v.dispositivo_id
        where v.adulto_id = $1 order by v.creado`,
      [adulto.id, actual, anterior],
    );
    return c.json({
      alias: adulto.alias,
      nota: NOTA_NO_DIAGNOSTICO,
      vinculos: filas.map((f) => ({
        vinculo_id: f.vinculo_id,
        estado: f.estado,
        revocado_por: f.revocado_por,
        adolescente: f.alias,
        proteccion_activa: f.proteccion_activa,
        ultimo_latido: f.ultimo_latido,
        sin_reportes: !f.ultimo_latido || horasEntre(new Date(f.ultimo_latido), ahora()) >= HORAS_SIN_REPORTES,
        pausas: { semana: actual, actual: Number(f.actual ?? 0), anterior: Number(f.anterior ?? 0) },
      })),
    });
  });

  app.get("/v1/adultos/avisos", requiereDb, autenticaAdulto, async (c) => {
    const adulto = c.get("adulto");
    const avisos = await db().query(
      "select id, tipo, texto, creado, enviado_por from avisos where adulto_id = $1 order by creado desc limit 100",
      [adulto.id],
    );
    return c.json({ avisos });
  });

  app.post("/v1/adultos/push-token", requiereDb, autenticaAdulto, async (c) => {
    const body = z.object({ push_token: z.string().min(1).max(4096).nullable() }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido" }, 400);
    await db().query("update adultos set push_token = $2 where id = $1", [c.get("adulto").id, body.data.push_token]);
    return c.json({ ok: true });
  });

  app.delete("/v1/vinculos/:id", requiereDb, autenticaAdulto, async (c) => {
    const adulto = c.get("adulto");
    const [v] = await db().query<{ id: string; estado: string }>(
      "select id, estado from vinculos where id = $1 and adulto_id = $2",
      [c.req.param("id"), adulto.id],
    );
    if (!v) return c.json({ error: "no_encontrado" }, 404);
    if (v.estado === "revocado") return c.json({ error: "ya_revocado" }, 409);
    await db().query("update vinculos set estado = 'revocado', revocado_por = 'adulto', revocado = $2 where id = $1", [v.id, ahora()]);
    await anotar(db(), claveRegistro, {
      sujeto_tipo: "adulto", sujeto_id: adulto.id, accion: "revocado", version: versionVigente("adulto"),
      texto_hash: sha256(CONSENTIMIENTOS.adulto[versionVigente("adulto")]), contexto: `vinculo:${v.id}`, ts: ahora(),
    });
    return c.json({ ok: true });
  });

  // ---------- Dispositivo del adolescente ----------

  app.post("/v1/dispositivos/vincular", requiereDb, async (c) => {
    const body = z.object({
      codigo: z.string().regex(/^\d{6}$/),
      alias: z.string().trim().min(1).max(40),
      asentimiento: consentimientoSchema,
      version_app: z.string().max(40).optional(),
    }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido", detalle: body.error.issues }, 400);
    const problema = validarConsentimiento("adolescente", body.data.asentimiento);
    if (problema) return c.json({ error: problema }, 400);

    const [cod] = await db().query<{ adulto_id: string; expira: string; usado: boolean }>(
      "select adulto_id, expira, usado from codigos where codigo = $1",
      [body.data.codigo],
    );
    if (!cod || cod.usado || new Date(cod.expira) < ahora()) return c.json({ error: "codigo_invalido" }, 400);
    await db().query("update codigos set usado = true where codigo = $1", [body.data.codigo]);

    const dispositivoId = id();
    const t = token();
    await db().query(
      "insert into dispositivos (id, alias, token_hash, version_app, ultimo_latido, creado) values ($1, $2, $3, $4, $5, $5)",
      [dispositivoId, body.data.alias, sha256(t), body.data.version_app ?? null, ahora()],
    );
    const vinculoId = id();
    await db().query(
      "insert into vinculos (id, adulto_id, dispositivo_id, estado, creado) values ($1, $2, $3, 'activo', $4)",
      [vinculoId, cod.adulto_id, dispositivoId, ahora()],
    );
    await anotar(db(), claveRegistro, {
      sujeto_tipo: "adolescente", sujeto_id: dispositivoId, accion: "asentido", version: body.data.asentimiento.version,
      texto_hash: body.data.asentimiento.texto_hash, contexto: `vinculo:${vinculoId}`, ts: ahora(),
    });
    const [adulto] = await db().query<{ alias: string }>("select alias from adultos where id = $1", [cod.adulto_id]);
    return c.json({ dispositivo_id: dispositivoId, vinculo_id: vinculoId, token: t, adulto: adulto.alias }, 201);
  });

  app.post("/v1/dispositivos/latido", requiereDb, autenticaDispositivo, async (c) => {
    const body = z.object({ proteccion_activa: z.boolean(), version_app: z.string().max(40).optional() }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido" }, 400);
    await db().query(
      "update dispositivos set ultimo_latido = $2, proteccion_activa = $3, version_app = coalesce($4, version_app) where id = $1",
      [c.get("dispositivo").id, ahora(), body.data.proteccion_activa, body.data.version_app ?? null],
    );
    return c.json({ ok: true, semana: semanaIso(ahora()) });
  });

  /**
   * El teléfono manda totales por semana ya deduplicados. Reenviar el mismo total es
   * idempotente. Los eventos de protección llevan un id propio para no avisar dos veces.
   */
  app.post("/v1/dispositivos/eventos", requiereDb, autenticaDispositivo, async (c) => {
    const body = z.object({
      eventos: z.array(z.discriminatedUnion("tipo", [
        z.object({ tipo: z.literal("pausas"), semana: z.string().regex(ES_SEMANA), cantidad: z.number().int().min(0).max(100_000) }),
        z.object({ tipo: z.literal("proteccion_desactivada"), evento_id: z.string().min(1).max(80) }),
        z.object({ tipo: z.literal("proteccion_activada"), evento_id: z.string().min(1).max(80) }),
      ])).min(1).max(200),
    }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido", detalle: body.error.issues }, 400);

    const dispositivo = c.get("dispositivo");
    const adultos = await db().query<Vars["adulto"]>(
      `select a.id, a.alias, a.push_token from adultos a join vinculos v on v.adulto_id = a.id
        where v.dispositivo_id = $1 and v.estado = 'activo'`,
      [dispositivo.id],
    );

    let avisos = 0;
    for (const e of body.data.eventos) {
      if (e.tipo === "pausas") {
        await db().query(
          `insert into pausas_semana (dispositivo_id, semana, cantidad, actualizado) values ($1, $2, $3, $4)
           on conflict (dispositivo_id, semana) do update set cantidad = excluded.cantidad, actualizado = excluded.actualizado`,
          [dispositivo.id, e.semana, e.cantidad, ahora()],
        );
      } else {
        const activa = e.tipo === "proteccion_activada";
        await db().query("update dispositivos set proteccion_activa = $2 where id = $1", [dispositivo.id, activa]);
        if (!activa) {
          for (const a of adultos) {
            if (await avisar(a, "proteccion_desactivada", AVISOS.proteccionDesactivada(dispositivo.alias), `proteccion:${dispositivo.id}:${e.evento_id}`)) avisos++;
          }
        }
      }
    }
    await db().query("update dispositivos set ultimo_latido = $2 where id = $1", [dispositivo.id, ahora()]);
    return c.json({ ok: true, avisos });
  });

  app.post("/v1/dispositivos/desvincular", requiereDb, autenticaDispositivo, async (c) => {
    const dispositivo = c.get("dispositivo");
    const vinculos = await db().query<{ id: string; adulto_id: string; alias: string; push_token: string | null }>(
      `select v.id, a.id as adulto_id, a.alias, a.push_token from vinculos v join adultos a on a.id = v.adulto_id
        where v.dispositivo_id = $1 and v.estado = 'activo'`,
      [dispositivo.id],
    );
    if (vinculos.length === 0) return c.json({ error: "sin_vinculo_activo" }, 409);
    for (const v of vinculos) {
      await db().query("update vinculos set estado = 'revocado', revocado_por = 'adolescente', revocado = $2 where id = $1", [v.id, ahora()]);
      await anotar(db(), claveRegistro, {
        sujeto_tipo: "adolescente", sujeto_id: dispositivo.id, accion: "revocado", version: versionVigente("adolescente"),
        texto_hash: sha256(CONSENTIMIENTOS.adolescente[versionVigente("adolescente")]), contexto: `vinculo:${v.id}`, ts: ahora(),
      });
      await avisar({ id: v.adulto_id, alias: v.alias, push_token: v.push_token }, "desvinculado", AVISOS.desvinculado(dispositivo.alias), `desvinculado:${v.id}`);
    }
    return c.json({ ok: true });
  });

  // ---------- Crons ----------

  app.get("/api/cron/latidos", requiereDb, autenticaCron, async (c) => {
    const filas = await db().query<Vars["adulto"] & { dispositivo_id: string; alias_dispositivo: string; ultimo_latido: string | null }>(
      `select a.id, a.alias, a.push_token, d.id as dispositivo_id, d.alias as alias_dispositivo, d.ultimo_latido
         from vinculos v join adultos a on a.id = v.adulto_id join dispositivos d on d.id = v.dispositivo_id
        where v.estado = 'activo'`,
    );
    let avisos = 0;
    for (const f of filas) {
      const horas = f.ultimo_latido ? horasEntre(new Date(f.ultimo_latido), ahora()) : Infinity;
      if (horas < HORAS_SIN_REPORTES) continue;
      // Un aviso por episodio de silencio: la clave incluye el último latido conocido.
      const clave = `sin_reportes:${f.dispositivo_id}:${f.ultimo_latido ?? "nunca"}`;
      if (await avisar(f, "sin_reportes", AVISOS.sinReportes(f.alias_dispositivo, Number.isFinite(horas) ? horas : HORAS_SIN_REPORTES), clave)) avisos++;
    }
    return c.json({ ok: true, revisados: filas.length, avisos });
  });

  app.get("/api/cron/resumen", requiereDb, autenticaCron, async (c) => {
    // Corre el lunes: resume la semana que terminó y la compara con la previa.
    const cerrada = semanaAnterior(ahora());
    const previa = semanaAnterior(new Date(ahora().getTime() - 7 * 86_400_000));
    const filas = await db().query<Vars["adulto"] & { dispositivo_id: string; alias_dispositivo: string; actual: number | null; anterior: number | null }>(
      `select a.id, a.alias, a.push_token, d.id as dispositivo_id, d.alias as alias_dispositivo,
              (select cantidad from pausas_semana p where p.dispositivo_id = d.id and p.semana = $1) as actual,
              (select cantidad from pausas_semana p where p.dispositivo_id = d.id and p.semana = $2) as anterior
         from vinculos v join adultos a on a.id = v.adulto_id join dispositivos d on d.id = v.dispositivo_id
        where v.estado = 'activo'`,
      [cerrada, previa],
    );
    let avisos = 0;
    for (const f of filas) {
      const texto = AVISOS.resumen(f.alias_dispositivo, Number(f.actual ?? 0), Number(f.anterior ?? 0));
      if (await avisar(f, "resumen", texto, `resumen:${f.dispositivo_id}:${cerrada}`)) avisos++;
    }
    return c.json({ ok: true, semana: cerrada, avisos });
  });

  // ---------- Auditoría ----------

  app.get("/v1/auditoria/verificar", requiereDb, async (c) => {
    if (!deps.adminToken || bearer(c) !== deps.adminToken) return c.json({ error: "no_autorizado" }, 401);
    return c.json(await verificar(db(), claveRegistro));
  });

  app.notFound((c) => c.json({ error: "no_encontrado" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "error_interno" }, 500);
  });

  return app;
}
