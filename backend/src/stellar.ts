// Integración con Stellar (Soroban). El backend paga las comisiones como cuenta fuente,
// pero nunca firma por el adulto ni por el adolescente: sus firmas llegan como
// entradas de autorización firmadas con su passkey (o con su clave, en pruebas).

import {
  Account,
  Address,
  Contract,
  Keypair,
  Memo,
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
  explorador(hash: string): string;
  /** Envía el despliegue de una cuenta inteligente ya autorizado por el deployer del kit. */
  crearCuenta(funcB64: string, authB64: string[]): Promise<string>;
  /** Simula la invocación y devuelve las entradas que tiene que firmar `firmante`. */
  preparar(accion: Accion, p: ParamsVinculo): Promise<string[]>;
  /** Recibe las entradas firmadas, las valida contra la invocación esperada y envía. */
  enviar(accion: Accion, p: ParamsVinculo, firmadas: string[]): Promise<string>;
  leer(parent: string, child: string): Promise<EstadoCadena | null>;
  /** Publica `hashHex` (32 bytes) como MEMO_HASH en una transacción clásica. */
  anclar(hashHex: string): Promise<string>;
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
  sponsorSecret: string;
  /** Hashes WASM de cuentas inteligentes que se aceptan desplegar pagando nosotros. */
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

export function crearCadena(cfg: ConfigCadena): Cadena {
  const servidor = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
  const sponsor = Keypair.fromSecret(cfg.sponsorSecret);
  const contrato = new Contract(cfg.contrato);

  async function construir(op: xdr.Operation, memo?: Memo) {
    const cuenta = await servidor.getAccount(sponsor.publicKey());
    const b = new TransactionBuilder(new Account(cuenta.accountId(), cuenta.sequenceNumber()), {
      fee: "1000000",
      networkPassphrase: cfg.passphrase,
    })
      .addOperation(op)
      .setTimeout(120);
    if (memo) b.addMemo(memo);
    return b.build();
  }

  async function simular(op: xdr.Operation) {
    const tx = await construir(op);
    const sim = await servidor.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new ErrorCadena("simulacion_fallida", sim.error);
    return { tx, sim };
  }

  async function firmarYEnviar(tx: ReturnType<TransactionBuilder["build"]>): Promise<string> {
    tx.sign(sponsor);
    const envio = await servidor.sendTransaction(tx);
    if (envio.status === "ERROR") throw new ErrorCadena("envio_rechazado", envio.errorResult?.toXDR("base64"));
    const final = await servidor.pollTransaction(envio.hash, { attempts: 30 });
    if (final.status !== "SUCCESS") throw new ErrorCadena("transaccion_fallida", `${final.status} ${envio.hash}`);
    return envio.hash;
  }

  /** Simula con las firmas reales (modo enforce), ensambla con recursos correctos y envía. */
  async function enviarConAuth(func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[]) {
    const op = Operation.invokeHostFunction({ func, auth });
    const { tx, sim } = await simular(op);
    return firmarYEnviar(rpc.assembleTransaction(tx, sim).build());
  }

  return {
    red: cfg.red,
    contrato: cfg.contrato,
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
      // y rechazar cualquier firma sobre otra cosa: el sponsor solo paga lo que construimos.
      const { sim } = await simular(op);
      const esperadas = (sim.result?.auth ?? []).filter((e) => direccionDe(e) === p.firmante);
      const firmadas = firmadasB64.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
      if (firmadas.length !== esperadas.length) throw new ErrorCadena("firmas_incompletas");
      for (const f of firmadas) {
        if (direccionDe(f) !== p.firmante) throw new ErrorCadena("firmante_incorrecto");
        const ok = esperadas.some((e) => e.rootInvocation().toXDR("base64") === f.rootInvocation().toXDR("base64"));
        if (!ok) throw new ErrorCadena("invocacion_distinta");
      }
      const func = op.body().invokeHostFunctionOp().hostFunction();
      return enviarConAuth(func, firmadas);
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

    async anclar(hashHex) {
      if (!/^[0-9a-f]{64}$/.test(hashHex)) throw new ErrorCadena("hash_invalido");
      const tx = await construir(Operation.bumpSequence({ bumpTo: "0" }), Memo.hash(hashHex));
      return firmarYEnviar(tx);
    },
  };
}

/** Config de testnet a partir de variables de entorno. Null si falta la clave del sponsor. */
export function cadenaDesdeEntorno(env: NodeJS.ProcessEnv): Cadena | null {
  if (!env.SPONSOR_SECRET) return null;
  return crearCadena({
    rpcUrl: env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    passphrase: env.STELLAR_PASSPHRASE ?? "Test SDF Network ; September 2015",
    contrato: env.FAMILY_REGISTRY_ID ?? "CAMMCDEUJ5YQ5AHSYVO75GCQR7NTKH4CHINSXWGHMJQRLPJJ2BVWKHGJ",
    sponsorSecret: env.SPONSOR_SECRET,
    wasmCuentas: (env.CUENTA_WASM_HASHES ?? "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a").split(","),
    red: env.STELLAR_RED ?? "testnet",
  });
}

/** Datos públicos que necesita la web para crear cuentas con passkey. */
export function configPublica(env: NodeJS.ProcessEnv) {
  return {
    red: env.STELLAR_RED ?? "testnet",
    rpc_url: env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    passphrase: env.STELLAR_PASSPHRASE ?? "Test SDF Network ; September 2015",
    family_registry: env.FAMILY_REGISTRY_ID ?? "CAMMCDEUJ5YQ5AHSYVO75GCQR7NTKH4CHINSXWGHMJQRLPJJ2BVWKHGJ",
    cuenta_wasm_hash: (env.CUENTA_WASM_HASHES ?? "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a").split(",")[0],
    webauthn_verifier: env.WEBAUTHN_VERIFIER ?? "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  };
}
