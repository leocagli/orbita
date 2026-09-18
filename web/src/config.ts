// URL del backend. En Vercel se fija con VITE_API_URL; si no, el dominio de producción.
export const API_URL: string = import.meta.env.VITE_API_URL ?? "https://orbita-backend.vercel.app";
