// URL del backend: VITE_API_URL al compilar, o la API local de correr-local.sh.
// No se deduce del dominio: los nombres de *.vercel.app los puede tomar cualquiera
// (orbita-web.vercel.app, por ejemplo, es de otra persona).
export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3310";
