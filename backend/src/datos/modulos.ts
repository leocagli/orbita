// Módulos educativos cortos para el adolescente. Cada uno termina en una insignia no
// transferible en el contrato learning-badges: un logro para mostrar, sin datos
// personales en la metadata y sin ninguna afirmación de que esto detecta o previene la
// ludopatía. Solo informa.
//
// `kind` es el símbolo que usa el contrato: hasta 32 caracteres, solo letras, números y
// guion bajo. Cambiar un texto no cambia el `kind`; si hace falta romper compatibilidad,
// se agrega un módulo nuevo con otro `kind` en vez de reescribir este.

export interface Modulo {
  kind: string;
  titulo: string;
  texto: string;
}

export const MODULOS: Modulo[] = [
  {
    kind: "casa_siempre_gana",
    titulo: "La casa siempre gana",
    texto:
      "Las cuotas de una apuesta no reflejan lo que va a pasar: están calculadas para que, sumando muchas jugadas, " +
      "la plataforma gane más de lo que paga. Ganar una vez es posible, pero jugar muchas veces con esa ventaja en " +
      "contra hace que perder sea lo esperable, no un accidente.",
  },
  {
    kind: "no_es_para_menores",
    titulo: "Las apuestas no son para menores",
    texto:
      "En Argentina, los sitios de apuestas legales no pueden aceptar a menores de 18 años. Los bonos de bienvenida " +
      "y las apuestas gratis no son un regalo: están pensados para que sigas jugando más tiempo, no para que ganes " +
      "más plata.",
  },
  {
    kind: "pedir_ayuda_no_es_debilidad",
    titulo: "Pedir ayuda no es debilidad",
    texto:
      "Si el juego te preocupa, hablar con un adulto de confianza o llamar a una línea gratuita no es un fracaso. " +
      "Desde Órbita podés pedir ayuda sin que el adulto vinculado reciba ningún aviso: es solo para vos.",
  },
];

export const MODULO_POR_KIND = new Map(MODULOS.map((m) => [m.kind, m]));
