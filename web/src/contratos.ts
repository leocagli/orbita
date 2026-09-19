// Red y contratos fijados en el build: la web no los toma del backend, así un backend
// comprometido no puede hacer firmar a nadie contra otro contrato u otra red.
// Si hay un reset de testnet, se actualizan acá (ver scripts/desplegar-testnet.sh).

export const RED = "testnet";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const PASSPHRASE = "Test SDF Network ; September 2015";
export const FAMILY_REGISTRY = "CAQDKJ62HKUQTURQAEGKHPAIC3DQK36A6QR4IHH2IYW4EI7EAVENFJ6M";
export const ANCLAS = "CCGNGLJ5ZMNRIJB4GURJISTDEJYLIHOBNS2ZKF7TEGAVQ7DIINV4YVZN";

// Cuenta inteligente de OpenZeppelin y verificador WebAuthn que publica smart-account-kit.
export const CUENTA_WASM_HASH = "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a";
export const VERIFICADOR_WEBAUTHN = "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";

/**
 * La passkey queda atada al dominio donde se crea. Solo se crean cuentas en el sitio
 * principal (y en local); en un preview de Vercel quedarían inservibles en producción.
 */
export const DOMINIOS_DE_CUENTAS = ["localhost", "orbita-web.vercel.app", "orbita-web-noapay1.vercel.app"];
