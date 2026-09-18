// Directorio de ayuda. Verificado en páginas oficiales el 2026-09-16. Revisar cada trimestre.
// Fuente de cada fila: stellar-ai-workshop-starter/research/deteccion-temprana-derivacion.md

export interface Servicio {
  nombre: string;
  gestiona: string;
  provincia: string;
  contacto: string;
  horario: string;
  menores: string;
  urgencia: boolean;
  fuente: string;
}

export const AYUDA = {
  fecha_verificacion: "2026-09-16",
  nota: "Verificado en páginas oficiales. Ninguna aclara en qué condiciones atiende directamente a menores, salvo donde se indica.",
  servicios: [
    {
      nombre: "Línea 141",
      gestiona: "SEDRONAR",
      provincia: "nacional",
      contacto: "141",
      horario: "24 h, todo el año",
      menores: "No lo aclara. Cubre ludopatía; muchas llamadas son de familiares.",
      urgencia: false,
      fuente: "https://www.argentina.gob.ar/noticias/la-linea-141-de-la-sedronar-recibio-mas-de-23-mil-llamados-en-lo-que-va-del-2026",
    },
    {
      nombre: "Línea Nacional de Urgencia en Salud Mental",
      gestiona: "Ministerio de Salud de la Nación",
      provincia: "nacional",
      contacto: "0800-999-0091",
      horario: "24 h, todo el año",
      menores: "Sí, con criterios para niños y adolescentes. Es para urgencias.",
      urgencia: true,
      fuente: "https://www.argentina.gob.ar/noticias/la-linea-nacional-de-orientacion-y-apoyo-en-la-urgencia-de-salud-mental-funciona-las-24",
    },
    {
      nombre: "Línea 102",
      gestiona: "Consejo de Derechos de Niñas, Niños y Adolescentes",
      provincia: "CABA",
      contacto: "102",
      horario: "24 h, todo el año",
      menores: "Sí.",
      urgencia: false,
      fuente: "https://buenosaires.gob.ar/noticias/ludopatia-infantil",
    },
    {
      nombre: "Orientación por juego problemático",
      gestiona: "LOTBA",
      provincia: "CABA",
      contacto: "0800-666-6006",
      horario: "Lunes a viernes, 9 a 17",
      menores: "No lo aclara. Ofrece asistencia familiar.",
      urgencia: false,
      fuente: "https://juegosegurolegal.gob.ar/?id=546&page=noticia",
    },
    {
      nombre: "Prevención y Asistencia al Juego Compulsivo",
      gestiona: "Lotería de la Provincia de Buenos Aires",
      provincia: "Buenos Aires",
      contacto: "0800-444-4000",
      horario: "No figura",
      menores: "No lo aclara.",
      urgencia: false,
      fuente: "https://loteria.gba.gob.ar/juego-compulsivo",
    },
    {
      nombre: "Plan de ludopatía adolescente",
      gestiona: "Ministerio de Salud de la Provincia de Buenos Aires",
      provincia: "Buenos Aires",
      contacto: "0800-222-5462",
      horario: "Lunes a viernes 8 a 24; fines de semana 10 a 22",
      menores: "Plan dirigido a adolescentes.",
      urgencia: false,
      fuente: "https://www.gba.gob.ar/gobierno/noticias/la_provincia_present%C3%B3_un_plan_integral_para_abordar_la_ludopat%C3%ADa_adolescente",
    },
    {
      nombre: "Juego Responsable",
      gestiona: "Lotería de Córdoba",
      provincia: "Córdoba",
      contacto: "0800-777-2983",
      horario: "24 h",
      menores: "No lo aclara.",
      urgencia: false,
      fuente: "https://loteriadecordoba.com.ar/juego-responsable",
    },
    {
      nombre: "Juego compulsivo",
      gestiona: "APRECOD",
      provincia: "Santa Fe",
      contacto: "0800-268-5640",
      horario: "Todos los días, 8 a 24",
      menores: "No lo aclara.",
      urgencia: false,
      fuente: "https://www.santafe.gob.ar/ms/juegocompulsivo/",
    },
    {
      nombre: "Prevenjuego",
      gestiona: "IAFAS",
      provincia: "Entre Ríos",
      contacto: "0800-888-2202",
      horario: "Lunes a viernes, 7 a 14",
      menores: "No lo aclara. Atiende personas y familiares.",
      urgencia: false,
      fuente: "https://www.iafas.gov.ar/juego-responsable/prevenjuego/",
    },
  ] satisfies Servicio[],
};
