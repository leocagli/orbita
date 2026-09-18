// Cuenta Stellar de cada persona: una cuenta inteligente de OpenZeppelin cuya única llave
// es una passkey del teléfono o la computadora. No hay frase semilla. El backend de Órbita
// paga las comisiones, pero no puede firmar por nadie.

import { SmartAccountKit } from "smart-account-kit";
import { IndexedDBStorage } from "smart-account-kit/storage";
import { xdr } from "@stellar/stellar-sdk";
import { api } from "./api";
import { API_URL } from "./config";

export type Rol = "adulto" | "adolescente";

interface ConfigCadena {
  red: string;
  rpc_url: string;
  passphrase: string;
  cuenta_wasm_hash: string;
  webauthn_verifier: string;
}

let config: Promise<ConfigCadena> | null = null;
const kits = new Map<Rol, SmartAccountKit>();

async function kitPara(rol: Rol) {
  config ??= api<ConfigCadena>("GET", "/v1/stellar/config");
  const c = await config;
  let kit = kits.get(rol);
  if (!kit) {
    kit = new SmartAccountKit({
      rpcUrl: c.rpc_url,
      networkPassphrase: c.passphrase,
      accountWasmHash: c.cuenta_wasm_hash,
      webauthnVerifierAddress: c.webauthn_verifier,
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
  const kit = await kitPara(rol);
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
  const kit = await kitPara(rol);
  return kit.connectWallet();
}

/** Firma con la passkey cada entrada de autorización que armó el backend. */
export async function firmarEntradas(rol: Rol, entradas: string[]): Promise<string[]> {
  const kit = await kitPara(rol);
  if (!kit.isConnected) await kit.connectWallet({ prompt: true });
  const firmadas: string[] = [];
  for (const b64 of entradas) {
    const entrada = xdr.SorobanAuthorizationEntry.fromXDR(b64, "base64");
    const firmada = await kit.signAuthEntry(entrada, { contextRuleIds: [0] });
    firmadas.push(firmada.toXDR("base64"));
  }
  return firmadas;
}

/** Propone, acepta o revoca el vínculo en family-registry con la firma de quien llama. */
export async function operarVinculo(rol: Rol, token: string, vinculoId: string, accion: "propose" | "accept" | "revoke") {
  const prep = await api<{ entradas: string[] }>("POST", `/v1/vinculos/${vinculoId}/cadena/preparar`, { accion }, token);
  const entradas = await firmarEntradas(rol, prep.entradas);
  return api<{ estado: string; tx: { hash: string; url: string | null } }>(
    "POST",
    `/v1/vinculos/${vinculoId}/cadena/enviar`,
    { accion, entradas },
    token,
  );
}
