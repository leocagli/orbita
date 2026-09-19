// Cuenta Stellar de cada persona: una cuenta inteligente de OpenZeppelin cuya única llave
// es una passkey del teléfono o la computadora. No hay frase semilla. El backend de Órbita
// paga las comisiones, pero no puede firmar por nadie: antes de pedir la passkey, la web
// revisa que cada entrada sea exactamente la acción del vínculo que la persona eligió.

import { SmartAccountKit } from "smart-account-kit";
import { IndexedDBStorage } from "smart-account-kit/storage";
import { Address, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { api } from "./api";
import { API_URL } from "./config";
import { CUENTA_WASM_HASH, DOMINIOS_DE_CUENTAS, FAMILY_REGISTRY, PASSPHRASE, RPC_URL, VERIFICADOR_WEBAUTHN } from "./contratos";

export type Rol = "adulto" | "adolescente";
export type Accion = "propose" | "accept" | "revoke";

/** Una firma vale solo por unos 5 minutos (60 ledgers): si el envío falla, no queda reutilizable. */
const VIDA_DE_FIRMA_LEDGERS = 60;

const kits = new Map<Rol, SmartAccountKit>();
const servidor = new rpc.Server(RPC_URL);

function kitPara(rol: Rol) {
  let kit = kits.get(rol);
  if (!kit) {
    kit = new SmartAccountKit({
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
      accountWasmHash: CUENTA_WASM_HASH,
      webauthnVerifierAddress: VERIFICADOR_WEBAUTHN,
      // El backend de Órbita actúa como relayer: paga el despliegue de la cuenta.
      relayerUrl: `${API_URL}/v1/stellar/relayer`,
      // Un almacén por rol, por si una misma persona prueba las dos vistas en el mismo navegador.
      storage: new IndexedDBStorage(`orbita-${rol}`),
    });
    kits.set(rol, kit);
  }
  return kit;
}

/** Crea la passkey y la cuenta inteligente; el despliegue lo paga el backend. */
export async function crearCuenta(rol: Rol, nombre: string): Promise<{ contrato: string; tx: string | null }> {
  if (!DOMINIOS_DE_CUENTAS.includes(window.location.hostname)) {
    throw new Error("Las cuentas se crean solo desde el sitio principal de Órbita.");
  }
  const kit = kitPara(rol);
  const r = await kit.createWallet("Órbita", nombre, { autoSubmit: true });
  const envio = r.submitResult;
  if (!envio?.success) {
    const detalle = envio && "error" in envio ? String((envio.error as { message?: string })?.message ?? envio.error) : "";
    throw new Error(`No se pudo crear la cuenta en Stellar. ${detalle}`.trim());
  }
  return { contrato: r.contractId, tx: envio.hash ?? null };
}

/** Reconecta la cuenta guardada en este navegador, sin pedir la passkey. */
export async function reconectar(rol: Rol) {
  return kitPara(rol).connectWallet();
}

/**
 * Rechaza cualquier entrada que no sea `accion` sobre family-registry, sin llamadas
 * anidadas y con la cuenta propia entre los argumentos.
 */
export function verificarEntrada(entrada: xdr.SorobanAuthorizationEntry, accion: Accion, propia: string) {
  const raiz = entrada.rootInvocation();
  const funcion = raiz.function();
  if (funcion.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
    throw new Error("La firma pedida no es una llamada a un contrato.");
  }
  const llamada = funcion.contractFn();
  const contrato = Address.fromScAddress(llamada.contractAddress()).toString();
  const nombre = llamada.functionName().toString();
  if (contrato !== FAMILY_REGISTRY) throw new Error("La firma pedida es para otro contrato. No se firmó nada.");
  if (nombre !== accion) throw new Error(`Se pidió firmar "${nombre}" en lugar de "${accion}". No se firmó nada.`);
  if (raiz.subInvocations().length > 0) throw new Error("La firma pedida incluye otras llamadas. No se firmó nada.");
  const argumentos = llamada.args().map((a) => scValToNative(a));
  if (!argumentos.includes(propia)) throw new Error("La firma pedida no es sobre tu cuenta. No se firmó nada.");
}

/** Firma con la passkey cada entrada de autorización que armó el backend, después de verificarla. */
export async function firmarEntradas(rol: Rol, accion: Accion, entradas: string[]): Promise<string[]> {
  const kit = kitPara(rol);
  if (!kit.isConnected) await kit.connectWallet({ prompt: true });
  const propia = kit.contractId;
  if (!propia) throw new Error("No hay una cuenta conectada.");
  const decodificadas = entradas.map((b64) => xdr.SorobanAuthorizationEntry.fromXDR(b64, "base64"));
  for (const e of decodificadas) verificarEntrada(e, accion, propia);

  const { sequence } = await servidor.getLatestLedger();
  const firmadas: string[] = [];
  for (const entrada of decodificadas) {
    const firmada = await kit.signAuthEntry(entrada, { contextRuleIds: [0], expiration: sequence + VIDA_DE_FIRMA_LEDGERS });
    firmadas.push(firmada.toXDR("base64"));
  }
  return firmadas;
}

/** Propone, acepta o revoca el vínculo en family-registry con la firma de quien llama. */
export async function operarVinculo(rol: Rol, token: string, vinculoId: string, accion: Accion) {
  const prep = await api<{ entradas: string[] }>("POST", `/v1/vinculos/${vinculoId}/cadena/preparar`, { accion }, token);
  const entradas = await firmarEntradas(rol, accion, prep.entradas);
  return api<{ estado: string; tx: { hash: string; url: string | null } }>(
    "POST",
    `/v1/vinculos/${vinculoId}/cadena/enviar`,
    { accion, entradas },
    token,
  );
}
