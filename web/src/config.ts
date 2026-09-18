// URL del backend. Orden: VITE_API_URL si se definió al compilar; si la web corre en un
// dominio de Vercel `orbita-web…`, el mismo dominio con `orbita-api…` (los dos proyectos
// viven en el mismo equipo); si no, la API local de correr-local.sh.
function apiPorDefecto(): string {
  const { protocol, hostname } = window.location;
  if (/^orbita-web(-|\.)/.test(hostname)) return `${protocol}//${hostname.replace(/^orbita-web/, "orbita-api")}`;
  return "http://localhost:3310";
}

export const API_URL: string = import.meta.env.VITE_API_URL ?? apiPorDefecto();
