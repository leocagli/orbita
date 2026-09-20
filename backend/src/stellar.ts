// Integración con Stellar (Soroban). Las comisiones las paga un relayer (por defecto el
// relayer público de testnet) o, si hay SPONSOR_SECRET, nuestra propia cuenta. En ningún
// caso el backend firma por el adulto ni por el adolescente: sus firmas llegan como
// entradas de autorización firmadas con su passkey (o con su clave, en pruebas).

import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export type EstadoCadena = "Pending" | "Active" | "Revoked";
export type Accion = "propose" | "accept" | "revoke";

export interface ParamsVinculo {
  parent: string;
  child: string;
  /** Quién firma: el adulto en propose, el adolescente en accept, cualquiera en revoke. */
  firmante: string;
  consentHash: string;
  consentVersion: number;
  assentHash: string;
}

export interface Cadena {
  red: string;
  contrato: string;
  /** Direcciones del sistema (fuente de simulación, sponsor, emisor): no pueden ser de usuarios. */
  reservadas: string[];
  /** Si hay un emisor configurado con el rol issuer, para otorgar insignias educativas. */
  insigniasDisponibles: boolean;
  explorador(hash: string): string;
  /** Envía el despliegue de una cuenta inteligente ya autorizado por el deployer del kit. */
  crearCuenta(funcB64: string, authB64: string[]): Promise<string>;
  /** Simula la invocación y devuelve las entradas que tiene que firmar `firmante`. */
  preparar(accion: Accion, p: ParamsVinculo): Promise<string[]>;
  /** Recibe las entradas firmadas, las valida contra la invocación esperada y envía. */
  enviar(accion: Accion, p: ParamsVinculo, firmadas: string[]): Promise<string>;
  leer(parent: string, child: string): Promise<EstadoCadena | null>;
  /** Publica `hashHex` (32 bytes) con el contrato `anclas`. */
  anclar(hashHex: string, filas: number): Promise<string>;
  /** Id de la insignia `kind` que tiene `to`, si la tiene. Solo lectura, sin firma. */
  insigniaDe(to: string, kind: string): Promise<number | null>;
  /** Otorga la insignia `kind` a `to`. Devuelve null si ya la tenía (no es un error). */
  otorgarInsignia(to: string, kind: string): Promise<{ tokenId: number; tx: string } | null>;
  /**
   * Confirma contra la red, no contra nuestra base, que `txHash` publicó ese hash con esas
   * filas en el contrato `anclas`. `null` si el RPC ya no tiene esa transacción (los nodos
   * públicos no la guardan para siempre): en ese caso no se pudo verificar, no es que falló.
   */
  verificarAnclaje(txHash: string, hashHex: string, filas: number): Promise<boolean | null>;
}

export class ErrorCadena extends Error {
  constructor(public codigo: string, detalle?: string) {
    super(detalle ? `${codigo}: ${detalle}` : codigo);
  }
}

export interface ConfigCadena {
  rpcUrl: string;
  passphrase: string;
  contrato: string;
  anclas: string;
  /** Contrato learning-badges. Sin él (o sin issuerSecret) no se otorgan insignias. */
  insignias?: string;
  /** Con clave propia pagamos nosotros; si no, paga el relayer. */
  sponsorSecret?: string;
  relayerUrl?: string;
  /** Clave de una dirección con el rol `issuer` en learning-badges. */
  issuerSecret?: string;
  /** Cuenta existente usada solo como fuente para simular (sin firmar nada). */
  fuenteLectura: string;
  /** Hashes WASM de cuentas inteligentes que se aceptan desplegar. */
  wasmCuentas: string[];
  red: string;
}

export const esDireccion = (s: string) => StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s);

const bytes32 = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));

function argumentos(accion: Accion, p: ParamsVinculo): xdr.ScVal[] {
  const addr = (s: string) => Address.fromString(s).toScVal();
  switch (accion) {
    case "propose":
      return [addr(p.parent), addr(p.child), bytes32(p.consentHash), nativeToScVal(p.consentVersion, { type: "u32" })];
    case "accept":
      return [addr(p.child), addr(p.parent), bytes32(p.consentHash), bytes32(p.assentHash)];
    case "revoke":
      return [addr(p.firmante), addr(p.parent), addr(p.child)];
  }
}

const direccionDe = (e: xdr.SorobanAuthorizationEntry) =>
  e.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress()
    ? Address.fromScAddress(e.credentials().address().address()).toString()
    : null;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un 429 o un 5xx del RPC es pasajero: se reintenta con espera creciente. */
function pasajero(e: unknown): boolean {
  const estado = (e as { response?: { status?: number }; status?: number })?.response?.status ?? (e as { status?: number })?.status;
  if (estado === 429 || (typeof estado === "number" && estado >= 500)) return true;
  const texto = String((e as Error)?.message ?? e);
  return /429|too many requests|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|502|503|504/i.test(texto);
}

export async function conReintentos<T>(fn: () => Promise<T>, intentos = 4, base = 250): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= intentos - 1 || e instanceof ErrorCadena || !pasajero(e)) throw e;
      await esperar(base * 2 ** i);
    }
  }
}

export function crearCadena(cfg: ConfigCadena): Cadena {
  if (!cfg.sponsorSecret && !cfg.relayerUrl) throw new Error("Hace falta sponsorSecret o relayerUrl");
  const servidor = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
  const sponsor = cfg.sponsorSecret ? Keypair.fromSecret(cfg.sponsorSecret) : null;
  const contrato = new Contract(cfg.contrato);
  const anclas = new Contract(cfg.anclas);
  const issuer = cfg.issuerSecret ? Keypair.fromSecret(cfg.issuerSecret) : null;
  const insignias = cfg.insignias ? new Contract(cfg.insignias) : null;

  async function construirDesde(fuente: string, op: xdr.Operation) {
    const cuenta = await conReintentos(() => servidor.getAccount(fuente));
    return new TransactionBuilder(new Account(cuenta.accountId(), cuenta.sequenceNumber()), {
      fee: "1000000",
      networkPassphrase: cfg.passphrase,
    })
      .addOperation(op)
      .setTimeout(120)
      .build();
  }

  const construir = (op: xdr.Operation) => construirDesde(sponsor?.publicKey() ?? cfg.fuenteLectura, op);

  /** Por defecto simula desde la fuente de lectura o el sponsor; `fuente` la reemplaza. */
  async function simular(op: xdr.Operation, fuente?: string) {
    const tx = fuente ? await construirDesde(fuente, op) : await construir(op);
    const sim = await conReintentos(() => servidor.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) throw new ErrorCadena("simulacion_fallida", sim.error);
    return { tx, sim };
  }

  const simboloDeInsignia = (kind: string) => nativeToScVal(kind, { type: "symbol" });

  /** Lectura pública: no hace falta ninguna firma ni tener issuer configurado. */
  async function leerInsignia(to: string, kind: string): Promise<number | null> {
    if (!insignias) return null;
    const op = insignias.call("badge_of", Address.fromString(to).toScVal(), simboloDeInsignia(kind));
    const { sim } = await simular(op);
    const valor = sim.result?.retval;
    return valor ? Number(scValToNative(valor)) : null;
  }

  async function esperarExito(hash: string) {
    const final = await conReintentos(() => servidor.pollTransaction(hash, { attempts: 30 }));
    if (final.status !== "SUCCESS") throw new ErrorCadena("transaccion_fallida", `${final.status} ${hash}`);
    return hash;
  }

  async function porRelayer(func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[]) {
    const r = await conReintentos(() =>
      fetch(cfg.relayerUrl!, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-name": "orbita-backend", "x-client-version": "0.2" },
        body: JSON.stringify({ func: func.toXDR("base64"), auth: auth.map((a) => a.toXDR("base64")) }),
      }).then((res) => {
        // Solo se reintenta lo pasajero; un rechazo del relayer se resuelve abajo.
        if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`relayer HTTP ${res.status}`), { status: res.status });
        return res;
      }),
    );
    const cuerpo = (await r.json().catch(() => null)) as { success?: boolean; data?: { hash?: string }; error?: string; code?: string } | null;
    if (!cuerpo?.success || !cuerpo.data?.hash) {
      throw new ErrorCadena(cuerpo?.code === "SIMULATION_FAILED" ? "simulacion_fallida" : "relayer_rechazo", cuerpo?.error ?? `HTTP ${r.status}`);
    }
    return esperarExito(cuerpo.data.hash);
  }

  /** Envía la invocación con las firmas reales, pagando nosotros o el relayer. */
  async function enviarConAuth(func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[]) {
    if (!sponsor) return porRelayer(func, auth);
    // Simulación en modo enforce (hay firmas): recursos correctos para __check_auth.
    const { tx, sim } = await simular(Operation.invokeHostFunction({ func, auth }));
    const lista = rpc.assembleTransaction(tx, sim).build();
    lista.sign(sponsor);
    const envio = await conReintentos(() => servidor.sendTransaction(lista));
    if (envio.status === "ERROR") throw new ErrorCadena("envio_rechazado", envio.errorResult?.toXDR("base64"));
    return esperarExito(envio.hash);
  }

  return {
    red: cfg.red,
    contrato: cfg.contrato,
    // Si un usuario usara una de estas, la simulación le daría credenciales de cuenta
    // fuente en vez de una entrada de autorización para firmar.
    reservadas: [cfg.fuenteLectura, ...(sponsor ? [sponsor.publicKey()] : []), ...(issuer ? [issuer.publicKey()] : [])],
    insigniasDisponibles: Boolean(insignias && issuer),
    explorador: (hash) => `https://stellar.expert/explorer/${cfg.red}/tx/${hash}`,

    async crearCuenta(funcB64, authB64) {
      const func = xdr.HostFunction.fromXDR(funcB64, "base64");
      if (func.switch() !== xdr.HostFunctionType.hostFunctionTypeCreateContractV2()) {
        throw new ErrorCadena("funcion_no_permitida", "solo se paga el despliegue de cuentas");
      }
      const exe = func.createContractV2().executable();
      if (exe.switch() !== xdr.ContractExecutableType.contractExecutableWasm()) {
        throw new ErrorCadena("funcion_no_permitida", "ejecutable no WASM");
      }
      const hash = exe.wasmHash().toString("hex");
      if (!cfg.wasmCuentas.includes(hash)) throw new ErrorCadena("wasm_no_aceptado", hash);
      const auth = authB64.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
      return enviarConAuth(func, auth);
    },

    async preparar(accion, p) {
      const { sim } = await simular(contrato.call(accion, ...argumentos(accion, p)));
      const entradas = (sim.result?.auth ?? []).filter((e) => direccionDe(e) === p.firmante);
      if (entradas.length === 0) throw new ErrorCadena("sin_firma_requerida");
      return entradas.map((e) => e.toXDR("base64"));
    },

    async enviar(accion, p, firmadasB64) {
      const op = contrato.call(accion, ...argumentos(accion, p));
      // Rehacemos la simulación en modo registro para saber qué invocación exacta esperar
      // y rechazar cualquier firma sobre otra cosa: solo se envía lo que armamos nosotros.
      const { sim } = await simular(op);
      const esperadas = (sim.result?.auth ?? []).filter((e) => direccionDe(e) === p.firmante);
      const firmadas = firmadasB64.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
      if (firmadas.length !== esperadas.length) throw new ErrorCadena("firmas_incompletas");
      for (const f of firmadas) {
        if (direccionDe(f) !== p.firmante) throw new ErrorCadena("firmante_incorrecto");
        const ok = esperadas.some((e) => e.rootInvocation().toXDR("base64") === f.rootInvocation().toXDR("base64"));
        if (!ok) throw new ErrorCadena("invocacion_distinta");
      }
      return enviarConAuth(op.body().invokeHostFunctionOp().hostFunction(), firmadas);
    },

    async leer(parent, child) {
      const op = contrato.call("get", Address.fromString(parent).toScVal(), Address.fromString(child).toScVal());
      const { sim } = await simular(op);
      const valor = sim.result?.retval;
      if (!valor) return null;
      const link = scValToNative(valor) as { status: EstadoCadena[] | EstadoCadena } | null;
      if (!link) return null;
      return (Array.isArray(link.status) ? link.status[0] : link.status) ?? null;
    },

    async anclar(hashHex, filas) {
      if (!/^[0-9a-f]{64}$/.test(hashHex)) throw new ErrorCadena("hash_invalido");
      const op = anclas.call("anclar", bytes32(hashHex), nativeToScVal(filas, { type: "u32" }));
      return enviarConAuth(op.body().invokeHostFunctionOp().hostFunction(), []);
    },

    async verificarAnclaje(txHash, hashHex, filas) {
      let r;
      try {
        r = await conReintentos(() => servidor.getTransaction(txHash));
      } catch {
        return null;
      }
      // NOT_FOUND: el RPC público solo guarda unos días de transacciones. No es que el
      // anclaje sea falso, es que ya no se puede confirmar por esta vía.
      if (r.status !== "SUCCESS") return r.status === "NOT_FOUND" ? null : false;
      const idAnclas = Buffer.from(StrKey.decodeContract(cfg.anclas));
      const hashEsperado = Buffer.from(hashHex, "hex");
      for (const porOperacion of r.events?.contractEventsXdr ?? []) {
        for (const evento of porOperacion) {
          const idEvento = evento.contractId() as unknown as Buffer | undefined;
          if (!idEvento || !Buffer.from(idEvento).equals(idAnclas)) continue;
          const cuerpo = evento.body().v0();
          const topicos = cuerpo.topics();
          if (topicos.length < 2 || scValToNative(topicos[0]) !== "anclado") continue;
          const hashEvento = scValToNative(topicos[1]) as Buffer;
          const datos = scValToNative(cuerpo.data()) as { filas: number };
          if (Buffer.isBuffer(hashEvento) && hashEvento.equals(hashEsperado) && Number(datos.filas) === filas) return true;
        }
      }
      return false;
    },

    insigniaDe: leerInsignia,

    // El emisor firma otorgando: como es la cuenta que paga la transacción, alcanza con
    // su firma sobre el sobre, sin una entrada de autorización aparte para su dirección.
    async otorgarInsignia(to, kind) {
      if (!issuer || !insignias) throw new ErrorCadena("insignias_no_configuradas");
      const op = insignias.call("award", Address.fromString(issuer.publicKey()).toScVal(), Address.fromString(to).toScVal(), simboloDeInsignia(kind));
      let tx, sim;
      try {
        ({ tx, sim } = await simular(op, issuer.publicKey()));
      } catch (e) {
        if (e instanceof ErrorCadena && /AlreadyAwarded|Error\(Contract, #1\)/.test(e.message)) return null;
        throw e;
      }
      const lista = rpc.assembleTransaction(tx, sim).build();
      lista.sign(issuer);
      const envio = await conReintentos(() => servidor.sendTransaction(lista));
      if (envio.status === "ERROR") throw new ErrorCadena("envio_rechazado", envio.errorResult?.toXDR("base64"));
      const hash = await esperarExito(envio.hash);
      const tokenId = sim.result?.retval ? Number(scValToNative(sim.result.retval)) : -1;
      return { tokenId, tx: hash };
    },
  };
}

const POR_DEFECTO = {
  rpc: "https://soroban-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  familyRegistry: "CA5SSO56XW6XGQJTZXTOM25XPTFL5C5IQOSGQ55GD6CSRKQP3MKZFKLD",
  anclas: "CCGNGLJ5ZMNRIJB4GURJISTDEJYLIHOBNS2ZKF7TEGAVQ7DIINV4YVZN",
  insignias: "CDSNCELUGNKQ7ECT7J7MYL2UC6J2ROYMCSLFFAYUPKZMDMXWNUWBGWQZ",
  // Relayer público de testnet que usa smart-account-kit (SDF + OpenZeppelin Channels).
  relayer: "https://smart-account-relayer-proxy.sdf-ecosystem.workers.dev",
  // Cuenta de testnet existente; solo se usa su dirección pública para simular.
  fuenteLectura: "GCPEDBHF2IOZU5LRJDAWLE4MGMNAHWNJF532O6I6G273NTU6AGRCD47I",
  cuentaWasm: "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthn: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
};

/** Testnet por defecto. Con SPONSOR_SECRET paga nuestra cuenta; si no, el relayer. */
export function cadenaDesdeEntorno(env: NodeJS.ProcessEnv): Cadena {
  return crearCadena({
    rpcUrl: env.STELLAR_RPC_URL ?? POR_DEFECTO.rpc,
    passphrase: env.STELLAR_PASSPHRASE ?? POR_DEFECTO.passphrase,
    contrato: env.FAMILY_REGISTRY_ID ?? POR_DEFECTO.familyRegistry,
    anclas: env.ANCLAS_ID ?? POR_DEFECTO.anclas,
    insignias: env.INSIGNIAS_ID ?? POR_DEFECTO.insignias,
    sponsorSecret: env.SPONSOR_SECRET || undefined,
    relayerUrl: env.SPONSOR_SECRET ? undefined : (env.RELAYER_URL ?? POR_DEFECTO.relayer),
    // Sin una clave propia de emisor, si hay SPONSOR_SECRET y tiene el rol issuer (como en
    // desarrollo), se reusa: no hace falta una segunda cuenta solo para otorgar insignias.
    issuerSecret: env.ISSUER_SECRET || env.SPONSOR_SECRET || undefined,
    fuenteLectura: env.FUENTE_LECTURA ?? POR_DEFECTO.fuenteLectura,
    wasmCuentas: (env.CUENTA_WASM_HASHES ?? POR_DEFECTO.cuentaWasm).split(","),
    red: env.STELLAR_RED ?? "testnet",
  });
}

/** Datos públicos que necesita la web para crear cuentas con passkey. */
export function configPublica(env: NodeJS.ProcessEnv) {
  return {
    red: env.STELLAR_RED ?? "testnet",
    rpc_url: env.STELLAR_RPC_URL ?? POR_DEFECTO.rpc,
    passphrase: env.STELLAR_PASSPHRASE ?? POR_DEFECTO.passphrase,
    family_registry: env.FAMILY_REGISTRY_ID ?? POR_DEFECTO.familyRegistry,
    anclas: env.ANCLAS_ID ?? POR_DEFECTO.anclas,
    insignias: env.INSIGNIAS_ID ?? POR_DEFECTO.insignias,
    cuenta_wasm_hash: (env.CUENTA_WASM_HASHES ?? POR_DEFECTO.cuentaWasm).split(",")[0],
    webauthn_verifier: env.WEBAUTHN_VERIFIER ?? POR_DEFECTO.webauthn,
    pago_comisiones: env.SPONSOR_SECRET ? "cuenta propia" : "relayer",
  };
}
