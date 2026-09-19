import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Db } from "./db/index.js";
import type { Push } from "./push.js";
import { anotar, verificar } from "./registro.js";
import { type Accion, type Cadena, type EstadoCadena, ErrorCadena, esDireccion } from "./stellar.js";
import { AVISOS, CONSENTIMIENTOS, NOTA_NO_DIAGNOSTICO, versionVigente } from "./textos.js";
import { ES_SEMANA, codigoDeSeisDigitos, horasEntre, id, semanaAnterior, semanaIso, sha256, token } from "./utiles.js";
import { AYUDA as ayuda } from "./datos/ayuda.js";

export interface Deps {
  db: Db | null;
  cadena: Cadena | null;
  configCadena: Record<string, string>;
  push: Push;
  ahora: () => Date;
  claveRegistro: string;
  /** Si está vacío, se aceptan solo los crons de Vercel (por su user-agent). */
  cronSecret: string;
  /** Orígenes web permitidos (CORS), además de los despliegues de orbita-web en Vercel. */
  origenes: string[];
}

const WEB_EN_VERCEL = /^https:\/\/orbita-web(-[a-z0-9-]+)?\.vercel\.app$/;

/** Sin latido durante este tiempo, el adulto recibe "sin reportes". */
export const HORAS_SIN_REPORTES = 48;
const MINUTOS_CODIGO = 10;

type Adulto = { id: string; alias: string; stellar: string; push_token: string | null };
type Dispositivo = { id: string; alias: string; stellar: string };
type Vars = { adulto: Adulto; dispositivo: Dispositivo; rol: "adulto" | "adolescente" };
type App = Hono<{ Variables: Vars }>;

type Vinculo = {
  id: string; estado: string; adulto_id: string; dispositivo_id: string;
  adulto_alias: string; adulto_stellar: string; adulto_push: string | null;
  disp_alias: string; disp_stellar: string;
};

const consentimientoSchema = z.object({
  version: z.number().int().positive(),
  texto_hash: z.string().regex(/^[0-9a-f]{64}$/),
});
const direccionSchema = z.string().refine(esDireccion, "direccion_stellar_invalida");

const ESTADO_LOCAL: Record<EstadoCadena, string> = { Pending: "propuesto", Active: "activo", Revoked: "revocado" };
const COLUMNA_TX: Record<Accion, string> = { propose: "tx_propuesta", accept: "tx_aceptacion", revoke: "tx_revocacion" };

function bearer(c: Context): string | null {
  const h = c.req.header("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function crearApp(deps: Deps): App {
  const app: App = new Hono();
  const { push, ahora, claveRegistro } = deps;

  app.use(
    "*",
    cors({
      origin: (origen) => (deps.origenes.includes(origen) || WEB_EN_VERCEL.test(origen) ? origen : null),
      allowHeaders: ["authorization", "content-type", "x-client-name", "x-client-version"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  const requiereDb: MiddlewareHandler = async (c, next) => {
    if (!deps.db) return c.json({ error: "sin_base", detalle: "Falta DATABASE_URL" }, 503);
    await next();
  };
  const requiereCadena: MiddlewareHandler = async (c, next) => {
    if (!deps.cadena) return c.json({ error: "sin_cadena", detalle: "Falta SPONSOR_SECRET" }, 503);
    await next();
  };
  const db = () => deps.db as Db;
  const cadena = () => deps.cadena as Cadena;

  async function buscarAdulto(t: string) {
    const [a] = await db().query<Adulto>("select id, alias, stellar, push_token from adultos where token_hash = $1", [sha256(t)]);
    return a;
  }
  async function buscarDispositivo(t: string) {
    const [d] = await db().query<Dispositivo>("select id, alias, stellar from dispositivos where token_hash = $1", [sha256(t)]);
    return d;
  }

  const autenticaAdulto: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
    const t = bearer(c);
    const a = t ? await buscarAdulto(t) : undefined;
    if (!a) return c.json({ error: "token_invalido" }, 401);
    c.set("adulto", a);
    c.set("rol", "adulto");
    await next();
  };

  const autenticaDispositivo: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
    const t = bearer(c);
    const d = t ? await buscarDispositivo(t) : undefined;
    if (!d) return c.json({ error: "token_invalido" }, 401);
    c.set("dispositivo", d);
    c.set("rol", "adolescente");
    await next();
  };

  /** Acepta el token del adulto o el del teléfono del adolescente. */
  const autenticaCualquiera: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
    const t = bearer(c);
    if (!t) return c.json({ error: "sin_token" }, 401);
    const a = await buscarAdulto(t);
    if (a) {
      c.set("adulto", a);
      c.set("rol", "adulto");
      return next();
    }
    const d = await buscarDispositivo(t);
    if (d) {
      c.set("dispositivo", d);
      c.set("rol", "adolescente");
      return next();
    }
    return c.json({ error: "token_invalido" }, 401);
  };

  /**
   * Con CRON_SECRET, Vercel lo manda como Bearer. Sin él, se aceptan los pedidos del
   * scheduler de Vercel: los crons son idempotentes (avisos deduplicados, anclaje solo
   * si el registro cambió), así que un pedido falso no puede hacer daño.
   */
  /**
   * Límite de pedidos por IP y ventana fija, guardado en la base (en Vercel cada instancia
   * es efímera, así que un contador en memoria no serviría). Sin base no limita.
   */
  const limitar =
    (nombre: string, maximo: number, segundos: number): MiddlewareHandler =>
    async (c, next) => {
      if (!deps.db) return next();
      const ip = c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "sin-ip";
      const ventana = Math.floor(ahora().getTime() / 1000 / segundos);
      const [fila] = await db().query<{ cuenta: number }>(
        `insert into limites (clave, ventana, cuenta, actualizado) values ($1, $2, 1, $3)
         on conflict (clave, ventana) do update set cuenta = limites.cuenta + 1, actualizado = excluded.actualizado
         returning cuenta`,
        [`${nombre}:${ip}`, ventana, ahora()],
      );
      if (Number(fila.cuenta) > maximo) {
        c.header("retry-after", String(segundos));
        return c.json({ error: "demasiados_pedidos", success: false, code: "RATE_LIMITED" }, 429);
      }
      await next();
    };

  const noReservada = (direccion: string) => !(deps.cadena?.reservadas ?? []).includes(direccion);

  const autenticaCron: MiddlewareHandler = async (c, next) => {
    const ok = deps.cronSecret ? bearer(c) === deps.cronSecret : (c.req.header("user-agent") ?? "").startsWith("vercel-cron/");
    if (!ok) return c.json({ error: "no_autorizado" }, 401);
    await next();
  };

  /** Guarda el aviso y, si hay push, lo manda. `claveUnica` evita repetir el mismo aviso. */
  async function avisar(adulto: { id: string; push_token: string | null }, tipo: string, texto: string, claveUnica: string | null) {
    const aviso = { id: id(), tipo, texto };
    const insertado = await db().query<{ id: string }>(
      `insert into avisos (id, adulto_id, tipo, texto, creado, clave_unica) values ($1, $2, $3, $4, $5, $6)
       on conflict (clave_unica) do nothing returning id`,
      [aviso.id, adulto.id, tipo, texto, ahora(), claveUnica],
    );
    if (insertado.length === 0) return false;
    const llego = await push.enviar(adulto.push_token, aviso);
    await db().query("update avisos set enviado_por = $2, enviado = $3 where id = $1", [aviso.id, llego ? push.nombre : "registro", ahora()]);
    return true;
  }

  function validarConsentimiento(tipo: "adulto" | "adolescente", c: z.infer<typeof consentimientoSchema>) {
    const texto = CONSENTIMIENTOS[tipo][c.version];
    if (!texto) return "version_desconocida";
    if (sha256(texto) !== c.texto_hash) return "texto_no_coincide";
    return null;
  }

  async function leerVinculo(vinculoId: string) {
    const [v] = await db().query<Vinculo>(
      `select v.id, v.estado, v.adulto_id, v.dispositivo_id,
              a.alias as adulto_alias, a.stellar as adulto_stellar, a.push_token as adulto_push,
              d.alias as disp_alias, d.stellar as disp_stellar
         from vinculos v join adultos a on a.id = v.adulto_id join dispositivos d on d.id = v.dispositivo_id
        where v.id = $1`,
      [vinculoId],
    );
    return v;
  }

  const tx = (hash: string | null) => (hash && deps.cadena ? { hash, url: deps.cadena.explorador(hash) } : hash ? { hash, url: null } : null);

  /** Qué acción on-chain puede hacer cada rol en cada estado. */
  function accionPermitida(accion: Accion, rol: Vars["rol"], estado: string) {
    if (accion === "propose") return rol === "adulto" && (estado === "esperando_adulto" || estado === "propuesto");
    if (accion === "accept") return rol === "adolescente" && estado === "propuesto";
    return estado === "propuesto" || estado === "activo";
  }

  function paramsDe(v: Vinculo, accion: Accion, rol: Vars["rol"]) {
    const firmante =
      accion === "propose" ? v.adulto_stellar : accion === "accept" ? v.disp_stellar : rol === "adulto" ? v.adulto_stellar : v.disp_stellar;
    return {
      parent: v.adulto_stellar,
      child: v.disp_stellar,
      firmante,
      consentHash: sha256(CONSENTIMIENTOS.adulto[versionVigente("adulto")]),
      consentVersion: versionVigente("adulto"),
      assentHash: sha256(CONSENTIMIENTOS.adolescente[versionVigente("adolescente")]),
    };
  }

  /** Busca el vínculo y verifica que pertenezca a quien llama y que la acción corresponda. */
  async function vinculoParaAccion(c: Context<{ Variables: Vars }>, accion: Accion) {
    const v = await leerVinculo(c.req.param("id") ?? "");
    const rol = c.get("rol");
    const propio = v && (rol === "adulto" ? v.adulto_id === c.get("adulto").id : v.dispositivo_id === c.get("dispositivo").id);
    if (!v || !propio) return { error: c.json({ error: "no_encontrado" }, 404) } as const;
    if (!accionPermitida(accion, rol, v.estado)) return { error: c.json({ error: "accion_no_permitida", estado: v.estado }, 409) } as const;
    return { v, rol } as const;
  }

  function errorDeCadena(c: Context, e: unknown) {
    if (e instanceof ErrorCadena) return c.json({ error: "cadena", codigo: e.codigo, detalle: e.message.slice(0, 300) }, 502);
    throw e;
  }

  /** Lleva el estado local al que dice el contrato y dispara los avisos que correspondan. */
  async function sincronizar(v: Vinculo, estadoCadena: EstadoCadena | null, porQuien: Vars["rol"] | null) {
    const nuevo = estadoCadena ? ESTADO_LOCAL[estadoCadena] : v.estado;
    if (nuevo === v.estado) return nuevo;
    if (nuevo === "revocado") {
      await db().query("update vinculos set estado = 'revocado', revocado_por = coalesce($2, revocado_por), revocado = $3 where id = $1", [
        v.id, porQuien, ahora(),
      ]);
      if (porQuien !== "adulto") {
        await avisar({ id: v.adulto_id, push_token: v.adulto_push }, "desvinculado", AVISOS.desvinculado(v.disp_alias), `desvinculado:${v.id}`);
      }
    } else {
      await db().query("update vinculos set estado = $2 where id = $1", [v.id, nuevo]);
      if (nuevo === "activo") {
        await avisar({ id: v.adulto_id, push_token: v.adulto_push }, "vinculado", AVISOS.vinculado(v.disp_alias), `vinculado:${v.id}`);
      }
    }
    return nuevo;
  }

  const txCadena = (f: { tx_propuesta: string | null; tx_aceptacion: string | null; tx_revocacion: string | null }) => ({
    propuesta: tx(f.tx_propuesta),
    aceptacion: tx(f.tx_aceptacion),
    revocacion: tx(f.tx_revocacion),
  });

  // ---------- Público ----------

  app.get("/v1/salud", (c) =>
    c.json({ ok: true, base: Boolean(deps.db), cadena: deps.cadena?.red ?? null, push: push.nombre, ahora: ahora().toISOString() }),
  );

  app.get("/v1/stellar/config", (c) => c.json(deps.configCadena));

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

  /** Paga el despliegue de una cuenta inteligente con passkey (solo el WASM aceptado). */
  app.post("/v1/stellar/cuentas", limitar("cuentas", 10, 3600), requiereCadena, async (c) => {
    const body = z.object({ func: z.string().min(1).max(20_000), auth: z.array(z.string().max(20_000)).max(4) }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido" }, 400);
    try {
      const hash = await cadena().crearCuenta(body.data.func, body.data.auth);
      return c.json({ ok: true, tx: tx(hash) }, 201);
    } catch (e) {
      return errorDeCadena(c, e);
    }
  });

  /**
   * Mismo servicio con el protocolo de relayer de smart-account-kit, para que el kit
   * registre él mismo el despliegue de la cuenta. Solo acepta despliegues de cuentas.
   */
  app.post("/v1/stellar/relayer", limitar("cuentas", 10, 3600), async (c) => {
    if (!deps.cadena) return c.json({ success: false, error: "Falta SPONSOR_SECRET", code: "UNAUTHORIZED" }, 503);
    const body = z.object({ func: z.string().min(1).max(20_000), auth: z.array(z.string().max(20_000)).max(4) }).safeParse(await c.req.json());
    if (!body.success) return c.json({ success: false, error: "Parámetros inválidos", code: "INVALID_PARAMS" }, 400);
    try {
      const hash = await cadena().crearCuenta(body.data.func, body.data.auth);
      return c.json({ success: true, data: { hash, status: "success" } });
    } catch (e) {
      if (!(e instanceof ErrorCadena)) throw e;
      const code = e.codigo === "simulacion_fallida" ? "SIMULATION_FAILED" : e.codigo === "transaccion_fallida" ? "ONCHAIN_FAILED" : "INVALID_PARAMS";
      return c.json({ success: false, error: e.message.slice(0, 300), code }, 400);
    }
  });

  // ---------- Adulto ----------

  app.post("/v1/adultos", requiereDb, limitar("altas", 10, 3600), async (c) => {
    const body = z
      .object({ alias: z.string().trim().min(1).max(40), stellar: direccionSchema, consentimiento: consentimientoSchema })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido", detalle: body.error.issues }, 400);
    const problema = validarConsentimiento("adulto", body.data.consentimiento);
    if (problema) return c.json({ error: problema }, 400);
    if (!noReservada(body.data.stellar)) return c.json({ error: "direccion_reservada" }, 400);
    const [yaExiste] = await db().query("select 1 from adultos where stellar = $1", [body.data.stellar]);
    if (yaExiste) return c.json({ error: "cuenta_ya_registrada" }, 409);

    const adultoId = id();
    const t = token();
    await db().query("insert into adultos (id, alias, stellar, token_hash, creado) values ($1, $2, $3, $4, $5)", [
      adultoId, body.data.alias, body.data.stellar, sha256(t), ahora(),
    ]);
    await anotar(db(), claveRegistro, {
      sujeto_tipo: "adulto", sujeto_id: adultoId, accion: "otorgado", version: body.data.consentimiento.version,
      texto_hash: body.data.consentimiento.texto_hash, contexto: "alta", ts: ahora(),
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
      vinculo_id: string; estado: string; revocado_por: string | null; alias: string; stellar: string;
      proteccion_activa: boolean; ultimo_latido: string | null; actual: number | null; anterior: number | null;
      tx_propuesta: string | null; tx_aceptacion: string | null; tx_revocacion: string | null;
    }>(
      `select v.id as vinculo_id, v.estado, v.revocado_por, v.tx_propuesta, v.tx_aceptacion, v.tx_revocacion,
              d.alias, d.stellar, d.proteccion_activa, d.ultimo_latido,
              (select cantidad from pausas_semana p where p.dispositivo_id = d.id and p.semana = $2) as actual,
              (select cantidad from pausas_semana p where p.dispositivo_id = d.id and p.semana = $3) as anterior
         from vinculos v join dispositivos d on d.id = v.dispositivo_id
        where v.adulto_id = $1 order by v.creado`,
      [adulto.id, actual, anterior],
    );
    return c.json({
      alias: adulto.alias,
      stellar: adulto.stellar,
      nota: NOTA_NO_DIAGNOSTICO,
      vinculos: filas.map((f) => ({
        vinculo_id: f.vinculo_id,
        estado: f.estado,
        revocado_por: f.revocado_por,
        adolescente: f.alias,
        adolescente_stellar: f.stellar,
        proteccion_activa: f.proteccion_activa,
        ultimo_latido: f.ultimo_latido,
        sin_reportes: f.estado === "activo" && (!f.ultimo_latido || horasEntre(new Date(f.ultimo_latido), ahora()) >= HORAS_SIN_REPORTES),
        pausas: f.estado === "activo" ? { semana: actual, actual: Number(f.actual ?? 0), anterior: Number(f.anterior ?? 0) } : null,
        cadena: txCadena(f),
      })),
    });
  });

  app.get("/v1/adultos/avisos", requiereDb, autenticaAdulto, async (c) => {
    const avisos = await db().query(
      "select id, tipo, texto, creado, enviado_por from avisos where adulto_id = $1 order by creado desc limit 100",
      [c.get("adulto").id],
    );
    return c.json({ avisos });
  });

  app.post("/v1/adultos/push-token", requiereDb, autenticaAdulto, async (c) => {
    const body = z.object({ push_token: z.string().min(1).max(4096).nullable() }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido" }, 400);
    await db().query("update adultos set push_token = $2 where id = $1", [c.get("adulto").id, body.data.push_token]);
    return c.json({ ok: true });
  });

  // ---------- Dispositivo del adolescente ----------

  /** Canjea el código. El vínculo queda esperando que el adulto lo firme en Stellar. */
  // 10 intentos cada 10 minutos por IP: adivinar un código de 6 dígitos deja de ser viable.
  app.post("/v1/dispositivos/vincular", requiereDb, limitar("vincular", 10, 600), async (c) => {
    const body = z
      .object({
        codigo: z.string().regex(/^\d{6}$/),
        alias: z.string().trim().min(1).max(40),
        stellar: direccionSchema,
        asentimiento: consentimientoSchema,
        version_app: z.string().max(40).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido", detalle: body.error.issues }, 400);
    const problema = validarConsentimiento("adolescente", body.data.asentimiento);
    if (problema) return c.json({ error: problema }, 400);

    const [cod] = await db().query<{ adulto_id: string; expira: string; usado: boolean }>(
      "select adulto_id, expira, usado from codigos where codigo = $1",
      [body.data.codigo],
    );
    if (!cod || cod.usado || new Date(cod.expira) < ahora()) return c.json({ error: "codigo_invalido" }, 400);
    const [adulto] = await db().query<{ alias: string; stellar: string }>("select alias, stellar from adultos where id = $1", [cod.adulto_id]);
    if (adulto.stellar === body.data.stellar) return c.json({ error: "misma_cuenta" }, 400);
    if (!noReservada(body.data.stellar)) return c.json({ error: "direccion_reservada" }, 400);
    const [yaExiste] = await db().query("select 1 from dispositivos where stellar = $1", [body.data.stellar]);
    if (yaExiste) return c.json({ error: "cuenta_ya_registrada" }, 409);
    await db().query("update codigos set usado = true where codigo = $1", [body.data.codigo]);

    const dispositivoId = id();
    const t = token();
    await db().query(
      "insert into dispositivos (id, alias, stellar, token_hash, version_app, ultimo_latido, creado) values ($1, $2, $3, $4, $5, $6, $6)",
      [dispositivoId, body.data.alias, body.data.stellar, sha256(t), body.data.version_app ?? null, ahora()],
    );
    const vinculoId = id();
    await db().query("insert into vinculos (id, adulto_id, dispositivo_id, estado, creado) values ($1, $2, $3, 'esperando_adulto', $4)", [
      vinculoId, cod.adulto_id, dispositivoId, ahora(),
    ]);
    return c.json({ dispositivo_id: dispositivoId, vinculo_id: vinculoId, token: t, adulto: adulto.alias, estado: "esperando_adulto" }, 201);
  });

  app.get("/v1/dispositivos/yo", requiereDb, autenticaDispositivo, async (c) => {
    const d = c.get("dispositivo");
    const filas = await db().query<{
      vinculo_id: string; estado: string; adulto: string;
      tx_propuesta: string | null; tx_aceptacion: string | null; tx_revocacion: string | null;
    }>(
      `select v.id as vinculo_id, v.estado, a.alias as adulto, v.tx_propuesta, v.tx_aceptacion, v.tx_revocacion
         from vinculos v join adultos a on a.id = v.adulto_id where v.dispositivo_id = $1 order by v.creado`,
      [d.id],
    );
    return c.json({
      alias: d.alias,
      stellar: d.stellar,
      vinculos: filas.map((f) => ({ vinculo_id: f.vinculo_id, estado: f.estado, adulto: f.adulto, cadena: txCadena(f) })),
    });
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
   * idempotente. Solo generan avisos los vínculos activos en la cadena.
   */
  app.post("/v1/dispositivos/eventos", requiereDb, autenticaDispositivo, async (c) => {
    const body = z
      .object({
        eventos: z
          .array(
            z.discriminatedUnion("tipo", [
              z.object({ tipo: z.literal("pausas"), semana: z.string().regex(ES_SEMANA), cantidad: z.number().int().min(0).max(100_000) }),
              z.object({ tipo: z.literal("proteccion_desactivada"), evento_id: z.string().min(1).max(80) }),
              z.object({ tipo: z.literal("proteccion_activada"), evento_id: z.string().min(1).max(80) }),
            ]),
          )
          .min(1)
          .max(200),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido", detalle: body.error.issues }, 400);

    const dispositivo = c.get("dispositivo");
    const adultos = await db().query<{ id: string; push_token: string | null }>(
      `select a.id, a.push_token from adultos a join vinculos v on v.adulto_id = a.id
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

  // ---------- Vínculo en Stellar ----------

  const accionSchema = z.object({ accion: z.enum(["propose", "accept", "revoke"]) });

  /** Devuelve las entradas de autorización que quien llama tiene que firmar con su passkey. */
  app.post("/v1/vinculos/:id/cadena/preparar", requiereDb, requiereCadena, autenticaCualquiera, async (c) => {
    const body = accionSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido" }, 400);
    const r = await vinculoParaAccion(c, body.data.accion);
    if ("error" in r) return r.error;
    try {
      const entradas = await cadena().preparar(body.data.accion, paramsDe(r.v, body.data.accion, r.rol));
      return c.json({ accion: body.data.accion, contrato: cadena().contrato, entradas });
    } catch (e) {
      return errorDeCadena(c, e);
    }
  });

  /** Recibe las entradas firmadas, envía la transacción y alinea el estado con el contrato. */
  app.post("/v1/vinculos/:id/cadena/enviar", requiereDb, requiereCadena, autenticaCualquiera, async (c) => {
    const body = accionSchema.extend({ entradas: z.array(z.string().max(20_000)).min(1).max(4) }).safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "cuerpo_invalido" }, 400);
    const r = await vinculoParaAccion(c, body.data.accion);
    if ("error" in r) return r.error;
    const { v, rol } = r;
    const accion = body.data.accion;
    const p = paramsDe(v, accion, rol);

    let hash: string;
    let estadoCadena: EstadoCadena | null;
    try {
      hash = await cadena().enviar(accion, p, body.data.entradas);
      estadoCadena = await cadena().leer(p.parent, p.child);
    } catch (e) {
      return errorDeCadena(c, e);
    }
    await db().query(`update vinculos set ${COLUMNA_TX[accion]} = $2 where id = $1`, [v.id, hash]);

    const sujeto = rol === "adulto" ? ({ tipo: "adulto", id: v.adulto_id } as const) : ({ tipo: "adolescente", id: v.dispositivo_id } as const);
    await anotar(db(), claveRegistro, {
      sujeto_tipo: sujeto.tipo,
      sujeto_id: sujeto.id,
      accion: accion === "propose" ? "otorgado" : accion === "accept" ? "asentido" : "revocado",
      version: versionVigente(sujeto.tipo),
      texto_hash: sha256(CONSENTIMIENTOS[sujeto.tipo][versionVigente(sujeto.tipo)]),
      contexto: `vinculo:${v.id};tx:${hash}`,
      ts: ahora(),
    });

    const estado = await sincronizar(v, estadoCadena, accion === "revoke" ? rol : null);
    return c.json({ ok: true, estado, tx: tx(hash) });
  });

  // ---------- Crons ----------

  /** Diario: sincroniza vínculos con la cadena, avisa "sin reportes" y ancla el registro. */
  app.get("/api/cron/latidos", requiereDb, autenticaCron, async (c) => {
    let sincronizados = 0;
    if (deps.cadena) {
      const abiertos = await db().query<{ id: string }>("select id from vinculos where estado in ('propuesto', 'activo')");
      for (const { id: vid } of abiertos) {
        const v = await leerVinculo(vid);
        try {
          if ((await sincronizar(v, await cadena().leer(v.adulto_stellar, v.disp_stellar), null)) !== v.estado) sincronizados++;
        } catch (e) {
          if (!(e instanceof ErrorCadena)) throw e;
        }
      }
    }

    const filas = await db().query<{ id: string; push_token: string | null; dispositivo_id: string; alias_dispositivo: string; ultimo_latido: string | null }>(
      `select a.id, a.push_token, d.id as dispositivo_id, d.alias as alias_dispositivo, d.ultimo_latido
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

    let anclaje: ReturnType<typeof tx> = null;
    if (deps.cadena) {
      const [ultima] = await db().query<{ hash: string; n: string }>("select hash, n from registro_consentimientos order by n desc limit 1");
      const [previo] = await db().query<{ hash_registro: string }>("select hash_registro from anclajes order by id desc limit 1");
      if (ultima && ultima.hash !== previo?.hash_registro) {
        try {
          const h = await cadena().anclar(ultima.hash, Number(ultima.n));
          await db().query("insert into anclajes (hash_registro, filas, tx, creado) values ($1, $2, $3, $4)", [ultima.hash, Number(ultima.n), h, ahora()]);
          anclaje = tx(h);
        } catch (e) {
          if (!(e instanceof ErrorCadena)) throw e;
        }
      }
    }
    // Los contadores de límites de más de un día ya no sirven.
    await db().query("delete from limites where actualizado < $1", [new Date(ahora().getTime() - 86_400_000)]);
    return c.json({ ok: true, revisados: filas.length, avisos, sincronizados, anclaje });
  });

  app.get("/api/cron/resumen", requiereDb, autenticaCron, async (c) => {
    // Corre el lunes: resume la semana que terminó y la compara con la previa.
    const cerrada = semanaAnterior(ahora());
    const previa = semanaAnterior(new Date(ahora().getTime() - 7 * 86_400_000));
    const filas = await db().query<{ id: string; push_token: string | null; dispositivo_id: string; alias_dispositivo: string; actual: number | null; anterior: number | null }>(
      `select a.id, a.push_token, d.id as dispositivo_id, d.alias as alias_dispositivo,
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

  /** Público: cada anclaje del registro de consentimientos en Stellar. */
  app.get("/v1/auditoria/anclajes", requiereDb, async (c) => {
    const filas = await db().query<{ hash_registro: string; filas: number; tx: string; creado: string }>(
      "select hash_registro, filas, tx, creado from anclajes order by id desc limit 60",
    );
    return c.json({
      red: deps.cadena?.red ?? null,
      anclajes: filas.map((f) => ({ ...f, filas: Number(f.filas), url: deps.cadena?.explorador(f.tx) ?? null })),
    });
  });

  /** Público: recorre la cadena del registro y dice si está íntegra. No expone filas. */
  app.get("/v1/auditoria/verificar", requiereDb, async (c) => c.json(await verificar(db(), claveRegistro)));

  app.notFound((c) => c.json({ error: "no_encontrado" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "error_interno" }, 500);
  });

  return app;
}
