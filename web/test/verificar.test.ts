// Estos tests cubren la última defensa de la web: qué se firma con la passkey.
// Cada caso arma una entrada de autorización real y comprueba que se rechace.

import { describe, expect, it } from "vitest";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { verificarEntrada } from "../src/verificar";
import { ANCLAS, FAMILY_REGISTRY } from "../src/contratos";

const ADULTO = "GCPEDBHF2IOZU5LRJDAWLE4MGMNAHWNJF532O6I6G273NTU6AGRCD47I";
const OTRO = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function invocacion(contrato: string, funcion: string, args: string[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contrato).toScAddress(),
        functionName: funcion,
        args: args.map((a) => Address.fromString(a).toScVal()),
      }),
    ),
    subInvocations: subs,
  });
}

const entrada = (raiz: xdr.SorobanAuthorizedInvocation) =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: raiz,
  });

describe("verificarEntrada", () => {
  it("acepta la acción pedida sobre la cuenta propia", () => {
    const e = entrada(invocacion(FAMILY_REGISTRY, "propose", [ADULTO, OTRO]));
    expect(() => verificarEntrada(e, "propose", ADULTO)).not.toThrow();
  });

  it("rechaza otro contrato", () => {
    const e = entrada(invocacion(ANCLAS, "propose", [ADULTO, OTRO]));
    expect(() => verificarEntrada(e, "propose", ADULTO)).toThrow(/otro contrato/);
  });

  it("rechaza otra función", () => {
    const e = entrada(invocacion(FAMILY_REGISTRY, "revoke", [ADULTO, OTRO]));
    expect(() => verificarEntrada(e, "propose", ADULTO)).toThrow(/en lugar de/);
  });

  it("rechaza llamadas anidadas", () => {
    const sub = invocacion(ANCLAS, "anclar", [OTRO]);
    const e = entrada(invocacion(FAMILY_REGISTRY, "propose", [ADULTO, OTRO], [sub]));
    expect(() => verificarEntrada(e, "propose", ADULTO)).toThrow(/otras llamadas/);
  });

  it("rechaza una firma sobre la cuenta de otra persona", () => {
    const e = entrada(invocacion(FAMILY_REGISTRY, "propose", [OTRO, OTRO]));
    expect(() => verificarEntrada(e, "propose", ADULTO)).toThrow(/no es sobre tu cuenta/);
  });

  it("rechaza lo que no sea una llamada a contrato", () => {
    const raiz = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
        new xdr.CreateContractArgsV2({
          contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
            new xdr.ContractIdPreimageFromAddress({
              address: Address.fromString(ADULTO).toScAddress(),
              salt: Buffer.alloc(32),
            }),
          ),
          executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
          constructorArgs: [nativeToScVal(1, { type: "u32" })],
        }),
      ),
      subInvocations: [],
    });
    expect(() => verificarEntrada(entrada(raiz), "propose", ADULTO)).toThrow(/llamada a un contrato/);
  });
});
