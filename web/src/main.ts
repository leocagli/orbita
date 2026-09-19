import "./estilos.css";
import { api, ErrorApi, type Servicio, type TxCadena, type VinculoAdolescente, type VinculoAdulto } from "./api";
import { crearCuenta, operarVinculo, reconectar, type Rol } from "./cuenta";
import { FAMILY_REGISTRY } from "./contratos";

// ---------- utilidades ----------

const app = document.getElementById("app")!;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Sesion {
  token: string;
  alias: string;
  contrato: string;
}
const leerSesion = (rol: Rol): Sesion | null => {
  try {
    return JSON.parse(localStorage.getItem(`orbita.${rol}`) ?? "null");
  } catch {
    return null;
  }
};
const guardarSesion = (rol: Rol, s: Sesion) => localStorage.setItem(`orbita.${rol}`, JSON.stringify(s));

const explorar = (tipo: "contract" | "tx", id: string) => `https://stellar.expert/explorer/testnet/${tipo}/${id}`;
const corto = (s: string) => `${s.slice(0, 5)}…${s.slice(-5)}`;

function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorApi) {
    const c = e.cuerpo.codigo ?? e.cuerpo.error;
    const conocidos: Record<string, string> = {
      codigo_invalido: "El código no es válido o ya venció. Pedile al adulto uno nuevo.",
      texto_no_coincide: "El texto que aceptaste cambió. Recargá la página.",
      cuenta_ya_registrada: "Esta cuenta ya está registrada.",
      misma_cuenta: "El adulto y el adolescente tienen que usar cuentas distintas.",
      sin_base: "El servicio todavía no tiene base de datos configurada.",
      sin_cadena: "El servicio todavía no tiene la cuenta de Stellar configurada.",
      accion_no_permitida: "Esa acción no corresponde en este momento. Recargá para ver el estado actual.",
    };
    return conocidos[c ?? ""] ?? `No se pudo completar (${c ?? e.status}).`;
  }
  const m = e instanceof Error ? e.message : String(e);
  if (/NotAllowedError|cancel|abort/i.test(m)) return "Cancelaste la passkey. Probá de nuevo cuando quieras.";
  return `No se pudo completar: ${m}`;
}

/** Deshabilita el botón mientras corre la acción y muestra el resultado debajo. */
async function conBoton(boton: HTMLButtonElement, texto: string, accion: () => Promise<void>) {
  const original = boton.textContent;
  const caja = boton.closest(".tarjeta")?.querySelector<HTMLElement>(".resultado");
  boton.disabled = true;
  boton.textContent = texto;
  if (caja) caja.innerHTML = "";
  try {
    await accion();
  } catch (e) {
    console.error(e);
    if (caja) caja.innerHTML = `<div class="mensaje error" role="alert">${esc(mensajeDeError(e))}</div>`;
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}

/** Semana ISO en hora argentina (UTC-3), igual que el backend. */
function semanaIso(fecha = new Date()) {
  const d = new Date(fecha.getTime() - 3 * 3_600_000);
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = u.getUTCDay() || 7;
  u.setUTCDate(u.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
  const n = Math.ceil(((u.getTime() - inicio.getTime()) / 86_400_000 + 1) / 7);
  return `${u.getUTCFullYear()}-W${String(n).padStart(2, "0")}`;
}

const ORBITA_SVG = `<svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">
  <g class="gira"><ellipse cx="40" cy="40" rx="32" ry="16" fill="none" stroke="#000877" stroke-width="4" transform="rotate(-25 40 40)"/>
  <circle cx="68" cy="27" r="6" fill="#000877"/></g><circle cx="40" cy="40" r="9" fill="#05064f"/></svg>`;

function marco(contenido: string) {
  app.innerHTML = `
    <header class="barra">
      <a class="marca" href="#/"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="16" rx="13" ry="7" fill="none" stroke="#000877" stroke-width="3" transform="rotate(-25 16 16)"/><circle cx="26" cy="11" r="3" fill="#000877"/></svg>
        <span><strong>Órbita</strong><br><small>de Cosmos</small></span></a>
      <span class="red" title="Los datos de prueba viven en la red de prueba de Stellar">Stellar testnet</span>
    </header>
    <main>${contenido}</main>
    <footer>Órbita no diagnostica ni trata. Si necesitás ayuda urgente, llamá al 0800-999-0091 (24 h).<br>
      <a href="#/auditoria">Registro público en Stellar</a></footer>`;
}

const txLink = (etiqueta: string, t: TxCadena | null) => (t ? `<a href="${esc(t.url ?? explorar("tx", t.hash))}" target="_blank" rel="noopener">${etiqueta} ↗</a>` : "");
const txsDe = (c: VinculoAdulto["cadena"]) => {
  const links = [txLink("Propuesta", c.propuesta), txLink("Aceptación", c.aceptacion), txLink("Revocación", c.revocacion)].filter(Boolean);
  return links.length ? `<div class="txs"><span class="suave">En Stellar:</span>${links.join("")}</div>` : "";
};

const ETIQUETA: Record<VinculoAdulto["estado"], string> = {
  esperando_adulto: "Falta la firma del adulto",
  propuesto: "Falta la firma del adolescente",
  activo: "Vínculo activo",
  revocado: "Revocado",
};

async function textoConsentimiento(tipo: Rol) {
  return api<{ version: number; texto: string; texto_hash: string }>("GET", `/v1/consentimientos/${tipo}`);
}

// ---------- inicio ----------

function vistaInicio() {
  marco(`
    <h1>Una pausa antes de apostar.</h1>
    <p class="suave">Órbita acompaña a adolescentes y familias frente a las apuestas online: en vez de bloquear, propone una pausa con información, le da al adulto un resumen semanal y acerca ayuda profesional.</p>
    <p class="suave chico">El vínculo entre el adulto y el adolescente se firma en Stellar: cada uno con su propia cuenta y su passkey. Nadie puede vincular ni mantener vinculado a otro sin su firma.</p>
    <div class="grilla">
      <a class="tarjeta opcion destacada" href="#/adulto"><h2>Soy adulto responsable</h2><p class="suave">Órbita Familia: vinculá el teléfono de un adolescente y recibí un resumen semanal.</p></a>
      <a class="tarjeta opcion" href="#/adolescente"><h2>Soy adolescente</h2><p class="suave">Órbita: pausas con información y ayuda cuando la necesites, sin que nadie se entere.</p></a>
    </div>`);
}

// ---------- adulto ----------

async function vistaAdulto() {
  const sesion = leerSesion("adulto");
  if (!sesion) return altaAdulto();
  marco(`<p class="suave">Cargando…</p>`);
  reconectar("adulto").catch(() => null);
  await panelAdulto(sesion);
}

async function altaAdulto() {
  const cons = await textoConsentimiento("adulto");
  marco(`
    <h1>Órbita Familia</h1>
    <div class="tarjeta">
      <h2>1. Leé qué vas a recibir</h2>
      <div class="consentimiento">${esc(cons.texto)}</div>
      <label for="alias">¿Cómo querés que te vea el adolescente?</label>
      <input id="alias" type="text" maxlength="40" placeholder="Por ejemplo: Mamá, Papá, Tía Ana" autocomplete="off" />
      <label class="check"><input id="acepto" type="checkbox" /> Leí el texto y lo acepto.</label>
      <h2 style="margin-top:18px">2. Creá tu cuenta en Stellar</h2>
      <p class="suave chico">Se protege con una passkey: la huella, la cara o el PIN de este dispositivo. No hay contraseñas ni frases semilla. Órbita paga las comisiones de la red.</p>
      <div class="acciones"><button id="crear">Crear mi cuenta con passkey</button></div>
      <div class="resultado" aria-live="polite"></div>
    </div>`);
  const boton = document.getElementById("crear") as HTMLButtonElement;
  boton.onclick = () =>
    conBoton(boton, "Creando la cuenta…", async () => {
      const alias = (document.getElementById("alias") as HTMLInputElement).value.trim();
      if (!alias) throw new Error("Escribí cómo querés que te vea el adolescente.");
      if (!(document.getElementById("acepto") as HTMLInputElement).checked) throw new Error("Para seguir tenés que aceptar el texto.");
      const { contrato } = await crearCuenta("adulto", alias);
      const r = await api<{ token: string }>("POST", "/v1/adultos", {
        alias, stellar: contrato, consentimiento: { version: cons.version, texto_hash: cons.texto_hash },
      });
      guardarSesion("adulto", { token: r.token, alias, contrato });
      await panelAdulto(leerSesion("adulto")!);
    });
}

let refresco: number | undefined;

async function panelAdulto(s: Sesion) {
  window.clearInterval(refresco);
  const [yo, avisos] = await Promise.all([
    api<{ nota: string; vinculos: VinculoAdulto[] }>("GET", "/v1/adultos/yo", undefined, s.token),
    api<{ avisos: { texto: string; creado: string }[] }>("GET", "/v1/adultos/avisos", undefined, s.token),
  ]);
  const tarjetas = yo.vinculos.map((v) => tarjetaVinculoAdulto(v, yo.nota)).join("");
  marco(`
    <h1>Hola, ${esc(s.alias)}</h1>
    <p class="suave chico">Tu cuenta Stellar: <a href="${explorar("contract", s.contrato)}" target="_blank" rel="noopener">${corto(s.contrato)} ↗</a></p>
    <div class="tarjeta">
      <h2>Vincular un teléfono</h2>
      <p class="suave">Generá un código y cargalo en Órbita, en el teléfono del adolescente. Vence en 10 minutos.</p>
      <div id="codigo"></div>
      <div class="acciones"><button id="generar" class="secundario">Generar código</button></div>
      <div class="resultado" aria-live="polite"></div>
    </div>
    ${tarjetas || ""}
    <div class="tarjeta">
      <h2>Avisos</h2>
      ${avisos.avisos.length ? avisos.avisos.map((a) => `<div class="aviso">${esc(a.texto)}<time>${new Date(a.creado).toLocaleString("es-AR")}</time></div>`).join("") : `<p class="suave">Todavía no hay avisos.</p>`}
    </div>
    <div class="tarjeta">
      <details><summary>Señales para mirar fuera del teléfono</summary>
        <ul class="suave"><li>Pedidos de dinero fuera de lo habitual.</li><li>Mentiras sobre en qué usa el tiempo o la plata.</li>
        <li>Irritación o ansiedad cuando tiene que dejar el teléfono.</li><li>Menos interés por la escuela o por lo que antes le gustaba.</li></ul>
        <p class="chico suave">Fuente: Consejo de Derechos de Niñas, Niños y Adolescentes de CABA. Si ves varias, conversalo con calma y consultá con un profesional.</p>
      </details>
    </div>`);

  const botonCodigo = document.getElementById("generar") as HTMLButtonElement;
  botonCodigo.onclick = () =>
    conBoton(botonCodigo, "Generando…", async () => {
      const r = await api<{ codigo: string; expira: string }>("POST", "/v1/vinculos/codigo", undefined, s.token);
      document.getElementById("codigo")!.innerHTML = `<div class="codigo" aria-label="Código">${esc(r.codigo)}</div>
        <p class="suave chico">Vence a las ${new Date(r.expira).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.</p>`;
    });

  for (const v of yo.vinculos) {
    const b = document.querySelector<HTMLButtonElement>(`[data-vinculo="${v.vinculo_id}"]`);
    if (!b) continue;
    const accion = b.dataset.accion as "propose" | "revoke";
    b.onclick = () =>
      conBoton(b, accion === "propose" ? "Firmando en Stellar…" : "Revocando en Stellar…", async () => {
        await operarVinculo("adulto", s.token, v.vinculo_id, accion);
        await panelAdulto(s);
      });
  }
  // Mientras haya vínculos esperando, refrescamos para ver la firma del otro lado.
  if (yo.vinculos.some((v) => v.estado === "esperando_adulto" || v.estado === "propuesto") || yo.vinculos.length === 0) {
    refresco = window.setInterval(() => {
      if (location.hash === "#/adulto" && !document.querySelector("button:disabled")) panelAdulto(s).catch(console.error);
    }, 8000);
  }
}

function tarjetaVinculoAdulto(v: VinculoAdulto, nota: string) {
  let cuerpo = "";
  if (v.estado === "esperando_adulto") {
    cuerpo = `<p>${esc(v.adolescente)} cargó tu código. Para que el vínculo exista, firmalo en Stellar con tu passkey.</p>
      <div class="acciones"><button data-vinculo="${v.vinculo_id}" data-accion="propose">Firmar el vínculo</button></div>`;
  } else if (v.estado === "propuesto") {
    cuerpo = `<p>Ya firmaste. Falta que ${esc(v.adolescente)} acepte desde su teléfono. Hasta entonces no recibís ningún dato.</p>`;
  } else if (v.estado === "activo" && v.pausas) {
    cuerpo = `<div class="tendencia"><span class="numero">${v.pausas.actual}</span><span>${v.pausas.actual === 1 ? "pausa" : "pausas"} esta semana, ${v.pausas.anterior} la anterior</span></div>
      <p class="suave chico">${esc(nota)}</p>
      <p class="chico">${v.sin_reportes ? "⚠️ El teléfono no reporta hace más de 2 días." : v.proteccion_activa ? "La protección está activa." : "⚠️ La protección está desactivada."}</p>
      <div class="acciones"><button class="peligro" data-vinculo="${v.vinculo_id}" data-accion="revoke">Revocar vínculo</button></div>`;
  } else if (v.estado === "revocado") {
    cuerpo = `<p class="suave">${v.revocado_por === "adolescente" ? `${esc(v.adolescente)} desvinculó su teléfono.` : "Revocaste este vínculo."}</p>`;
  }
  return `<div class="tarjeta ${v.estado === "esperando_adulto" ? "destacada" : ""}">
    <h2>${esc(v.adolescente)} <span class="estado ${v.estado}">${ETIQUETA[v.estado]}</span></h2>
    ${cuerpo}${txsDe(v.cadena)}<div class="resultado" aria-live="polite"></div></div>`;
}

// ---------- adolescente ----------

async function vistaAdolescente() {
  const sesion = leerSesion("adolescente");
  if (!sesion) return altaAdolescente();
  marco(`<p class="suave">Cargando…</p>`);
  reconectar("adolescente").catch(() => null);
  await panelAdolescente(sesion);
}

async function altaAdolescente() {
  const cons = await textoConsentimiento("adolescente");
  marco(`
    <h1>Órbita</h1>
    <div class="tarjeta">
      <h2>Antes de empezar</h2>
      <div class="consentimiento">${esc(cons.texto)}</div>
      <label for="alias">Tu nombre o apodo</label>
      <input id="alias" type="text" maxlength="40" autocomplete="off" />
      <label for="codigo">Código que te pasó el adulto</label>
      <input id="codigo" type="text" inputmode="numeric" maxlength="6" placeholder="6 números" autocomplete="off" />
      <label class="check"><input id="acepto" type="checkbox" /> Entiendo qué se comparte y acepto.</label>
      <p class="suave chico">Vas a crear tu propia cuenta en Stellar, protegida con tu huella, tu cara o tu PIN. Es tuya: con ella aceptás el vínculo y también lo podés cortar cuando quieras.</p>
      <div class="acciones"><button id="crear">Crear mi cuenta y vincular</button></div>
      <div class="resultado" aria-live="polite"></div>
    </div>`);
  const boton = document.getElementById("crear") as HTMLButtonElement;
  boton.onclick = () =>
    conBoton(boton, "Creando tu cuenta…", async () => {
      const alias = (document.getElementById("alias") as HTMLInputElement).value.trim();
      const codigo = (document.getElementById("codigo") as HTMLInputElement).value.trim();
      if (!alias) throw new Error("Escribí tu nombre o apodo.");
      if (!/^\d{6}$/.test(codigo)) throw new Error("El código tiene 6 números.");
      if (!(document.getElementById("acepto") as HTMLInputElement).checked) throw new Error("Para seguir tenés que aceptar.");
      const { contrato } = await crearCuenta("adolescente", alias);
      const r = await api<{ token: string }>("POST", "/v1/dispositivos/vincular", {
        codigo, alias, stellar: contrato, asentimiento: { version: cons.version, texto_hash: cons.texto_hash }, version_app: "web-0.1",
      });
      guardarSesion("adolescente", { token: r.token, alias, contrato });
      await panelAdolescente(leerSesion("adolescente")!);
    });
}

async function panelAdolescente(s: Sesion) {
  window.clearInterval(refresco);
  const yo = await api<{ vinculos: VinculoAdolescente[] }>("GET", "/v1/dispositivos/yo", undefined, s.token);
  api("POST", "/v1/dispositivos/latido", { proteccion_activa: true, version_app: "web-0.1" }, s.token).catch(() => null);
  const v = yo.vinculos.at(-1);
  let estado = "";
  if (!v) estado = `<p class="suave">No tenés vínculos.</p>`;
  else if (v.estado === "esperando_adulto") estado = `<p>Esperando que ${esc(v.adulto)} firme el vínculo en Stellar.</p><p class="suave chico">Esta pantalla se actualiza sola.</p>`;
  else if (v.estado === "propuesto")
    estado = `<p>${esc(v.adulto)} firmó el vínculo. Si estás de acuerdo, aceptalo con tu passkey. Si no, podés rechazarlo.</p>
      <div class="acciones"><button data-accion="accept">Aceptar vínculo</button><button class="peligro" data-accion="revoke">Rechazar</button></div>`;
  else if (v.estado === "activo")
    estado = `<div class="orbita-activa">${ORBITA_SVG}<div><h2 style="margin:0">Órbita activa</h2>
      <p class="suave chico" style="margin:0">Con ${esc(v.adulto)} se comparte solo cuántas pausas hubo por semana y si la protección está activa. Nunca qué sitios ni a qué hora.</p></div></div>
      <div class="acciones"><button class="secundario" id="probar">Probar la pausa</button><button class="peligro" data-accion="revoke">Desvincular</button></div>`;
  else estado = `<p class="suave">Desvinculaste tu teléfono. ${esc(v.adulto)} ya no recibe nada.</p>`;

  marco(`
    <h1>Hola, ${esc(s.alias)}</h1>
    <p class="suave chico">Tu cuenta Stellar: <a href="${explorar("contract", s.contrato)}" target="_blank" rel="noopener">${corto(s.contrato)} ↗</a></p>
    <div class="tarjeta ${v?.estado === "propuesto" ? "destacada" : ""}">${estado}${v ? txsDe(v.cadena) : ""}<div class="resultado" aria-live="polite"></div></div>
    <div class="tarjeta" id="ayuda"><h2>¿Necesitás hablar con alguien?</h2>
      <p class="suave">Si llamás o escribís, nadie recibe un aviso. Es gratis y confidencial.</p>
      <label for="provincia">Tu provincia</label>
      <select id="provincia"><option value="">Todo el país</option><option>CABA</option><option>Buenos Aires</option><option>Córdoba</option><option>Santa Fe</option><option>Entre Ríos</option></select>
      <div id="servicios"></div></div>`);

  document.querySelectorAll<HTMLButtonElement>("button[data-accion]").forEach((b) => {
    const accion = b.dataset.accion as "accept" | "revoke";
    b.onclick = () =>
      conBoton(b, accion === "accept" ? "Aceptando en Stellar…" : "Firmando en Stellar…", async () => {
        if (accion === "revoke" && !confirm("¿Querés cortar el vínculo? El adulto va a recibir un aviso.")) return;
        await operarVinculo("adolescente", s.token, v!.vinculo_id, accion);
        await panelAdolescente(s);
      });
  });
  document.getElementById("probar")?.addEventListener("click", () => mostrarPausa(s));
  const provincia = document.getElementById("provincia") as HTMLSelectElement;
  provincia.onchange = () => cargarAyuda(provincia.value);
  cargarAyuda("");

  if (v && (v.estado === "esperando_adulto" || v.estado === "propuesto")) {
    refresco = window.setInterval(() => {
      if (location.hash === "#/adolescente" && !document.querySelector("button:disabled")) panelAdolescente(s).catch(console.error);
    }, 8000);
  }
}

async function cargarAyuda(provincia: string) {
  const r = await api<{ fecha_verificacion: string; servicios: Servicio[] }>("GET", `/v1/ayuda${provincia ? `?provincia=${encodeURIComponent(provincia)}` : ""}`);
  const caja = document.getElementById("servicios");
  if (!caja) return;
  caja.innerHTML =
    r.servicios
      .map((x) => `<div class="servicio"><div><strong>${esc(x.nombre)}</strong> <span class="suave chico">${esc(x.gestiona)}</span></div>
        <div class="tel"><a href="tel:${esc(x.contacto.replace(/[^\d]/g, ""))}">${esc(x.contacto)}</a>${x.urgencia ? ` <span class="estado revocado">Urgencias</span>` : ""}</div>
        <div class="suave chico">${esc(x.horario)}</div></div>`)
      .join("") + `<p class="suave chico">Datos verificados en fuentes oficiales el ${esc(r.fecha_verificacion)}.</p>`;
}

// ---------- pausa ----------

const DATOS = [
  "En las apuestas, las cuotas están calculadas para que la casa gane a largo plazo. Cuanto más se juega, más probable es perder.",
  "En Argentina, los sitios de apuestas legales no pueden aceptar a menores de 18 años.",
  "Los bonos y las apuestas gratis están pensados para que sigas jugando, no para que ganes.",
  "Apostar más para recuperar lo que perdiste es una de las señales de que el juego dejó de ser un juego.",
];

function mostrarPausa(s: Sesion) {
  const dato = DATOS[Math.floor(Math.random() * DATOS.length)];
  const capa = document.createElement("div");
  capa.className = "pausa-fondo";
  capa.innerHTML = `<div class="pausa" role="dialog" aria-modal="true" aria-labelledby="titulo-pausa">
    <p class="chico suave">Vista previa: en el teléfono esto aparece al entrar a un sitio de apuestas.</p>
    <h2 id="titulo-pausa">Una pausa</h2><p>${esc(dato)}</p><p><strong>¿Qué estabas buscando cuando llegaste acá?</strong></p>
    <div class="acciones"><button id="salir">Salir</button><button class="secundario" id="seguir">Seguir igual</button></div>
    <p class="chico suave">Si querés hablar con alguien, más abajo tenés líneas gratuitas. Nadie recibe un aviso.</p></div>`;
  document.body.appendChild(capa);
  const cerrar = async () => {
    capa.remove();
    // Cuenta la pausa en este dispositivo y manda solo el total de la semana.
    const semana = semanaIso();
    const clave = `orbita.pausas.${semana}`;
    const total = Number(localStorage.getItem(clave) ?? "0") + 1;
    localStorage.setItem(clave, String(total));
    await api("POST", "/v1/dispositivos/eventos", { eventos: [{ tipo: "pausas", semana, cantidad: total }] }, s.token).catch(console.error);
  };
  capa.querySelector<HTMLButtonElement>("#salir")!.onclick = cerrar;
  capa.querySelector<HTMLButtonElement>("#seguir")!.onclick = cerrar;
  capa.querySelector<HTMLButtonElement>("#salir")!.focus();
}

// ---------- auditoría ----------

async function vistaAuditoria() {
  marco(`<p class="suave">Cargando…</p>`);
  const r = await api<{ anclajes: { hash_registro: string; filas: number; creado: string; url: string | null; tx: string }[] }>("GET", "/v1/auditoria/anclajes").catch(
    () => ({ anclajes: [] }),
  );
  marco(`
    <h1>Registro público en Stellar</h1>
    <p class="suave">Cada consentimiento, aceptación y revocación queda en un registro encadenado. Una vez por día, Órbita publica en Stellar el último hash de ese registro. Así cualquiera puede comprobar que nadie lo editó después, sin ver ningún dato personal.</p>
    <p class="suave chico">Además, cada vínculo vive en el contrato <a href="${explorar("contract", FAMILY_REGISTRY)}" target="_blank" rel="noopener">family-registry ↗</a>, firmado por el adulto y por el adolescente.</p>
    <div class="tarjeta">${
      r.anclajes.length
        ? r.anclajes.map((a) => `<div class="aviso"><a href="${esc(a.url ?? explorar("tx", a.tx))}" target="_blank" rel="noopener">${corto(a.tx)} ↗</a> · ${a.filas} registros<time>${new Date(a.creado).toLocaleString("es-AR")} · hash ${corto(a.hash_registro)}</time></div>`).join("")
        : `<p class="suave">Todavía no hay anclajes.</p>`
    }</div>`);
}

// ---------- ruteo ----------

async function rutear() {
  window.clearInterval(refresco);
  try {
    const ruta = location.hash.replace(/^#/, "") || "/";
    if (ruta === "/adulto") await vistaAdulto();
    else if (ruta === "/adolescente") await vistaAdolescente();
    else if (ruta === "/auditoria") await vistaAuditoria();
    else vistaInicio();
  } catch (e) {
    console.error(e);
    marco(`<div class="mensaje error" role="alert">${esc(mensajeDeError(e))}</div><p><a href="#/">Volver al inicio</a></p>`);
  }
}

window.addEventListener("hashchange", rutear);
rutear();
