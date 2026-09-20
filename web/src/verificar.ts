// Última defensa antes de pedir la passkey: si el backend estuviera comprometido y
// mandara otra cosa para firmar, acá se rechaza. Va en su propio archivo para poder
// probarlo sin levantar el navegador ni la cuenta inteligente.

import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { FAMILY_REGISTRY } from "./contratos";

export type Accion = "propose" | "accept" | "revoke";

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
