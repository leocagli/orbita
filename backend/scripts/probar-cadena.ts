// Prueba en vivo contra testnet: `SPONSOR_SECRET=... pnpm exec tsx scripts/probar-cadena.ts`.
// Usa dos cuentas G nuevas (fondeadas con friendbot) como adulto y adolescente, firma sus
// entradas de autorización localmente y recorre propose, accept, revoke y un anclaje.
import { Keypair, authorizeEntry, rpc, xdr } from "@stellar/stellar-sdk";
import { cadenaDesdeEntorno, ErrorCadena, type ParamsVinculo } from "../src/stellar.js";
import { CONSENTIMIENTOS } from "../src/textos.js";
import { sha256 } from "../src/utiles.js";

const cadena = cadenaDesdeEntorno(process.env);
if (!cadena) throw new Error("Falta SPONSOR_SECRET");
const servidor = new rpc.Server("https://soroban-testnet.stellar.org");
const PASS = "Test SDF Network ; September 2015";

async function fondear(kp: Keypair) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
}

async function firmar(entradas: string[], kp: Keypair) {
  const { sequence } = await servidor.getLatestLedger();
  return Promise.all(
    entradas.map(async (b64) => {
      const e = await authorizeEntry(xdr.SorobanAuthorizationEntry.fromXDR(b64, "base64"), kp, sequence + 100, PASS);
      return e.toXDR("base64");
    }),
  );
}

const adulto = Keypair.random();
const adolescente = Keypair.random();
await Promise.all([fondear(adulto), fondear(adolescente)]);
console.log("adulto", adulto.publicKey());
console.log("adolescente", adolescente.publicKey());

const base: Omit<ParamsVinculo, "firmante"> = {
  parent: adulto.publicKey(),
  child: adolescente.publicKey(),
  consentHash: sha256(CONSENTIMIENTOS.adulto[1]),
  consentVersion: 1,
  assentHash: sha256(CONSENTIMIENTOS.adolescente[1]),
};

console.log("estado inicial:", await cadena.leer(base.parent, base.child));

const pProp = { ...base, firmante: adulto.publicKey() };
const hProp = await cadena.enviar("propose", pProp, await firmar(await cadena.preparar("propose", pProp), adulto));
console.log("propose", cadena.explorador(hProp), "->", await cadena.leer(base.parent, base.child));

// Negativo: el adulto intenta aceptar en nombre del adolescente.
const pAcc = { ...base, firmante: adolescente.publicKey() };
try {
  const entradas = await cadena.preparar("accept", pAcc);
  await cadena.enviar("accept", pAcc, await firmar(entradas, adulto));
  console.log("ERROR: se aceptó con la firma equivocada");
  process.exit(1);
} catch (e) {
  console.log("accept firmado por el adulto rechazado:", e instanceof ErrorCadena ? e.codigo : (e as Error).message.slice(0, 120));
}

const hAcc = await cadena.enviar("accept", pAcc, await firmar(await cadena.preparar("accept", pAcc), adolescente));
console.log("accept", cadena.explorador(hAcc), "->", await cadena.leer(base.parent, base.child));

const pRev = { ...base, firmante: adolescente.publicKey() };
const hRev = await cadena.enviar("revoke", pRev, await firmar(await cadena.preparar("revoke", pRev), adolescente));
console.log("revoke", cadena.explorador(hRev), "->", await cadena.leer(base.parent, base.child));

const hAnc = await cadena.anclar(sha256("prueba de anclaje de Órbita"));
console.log("anclaje", cadena.explorador(hAnc));
console.log("CADENA OK");
