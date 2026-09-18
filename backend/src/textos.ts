// Textos canónicos. El cliente los muestra tal cual y manda el hash de lo que mostró;
// el registro guarda ese hash con la versión. Cambiar un texto es subir la versión,
// nunca editar una versión existente.

export const CONSENTIMIENTOS: Record<"adulto" | "adolescente", Record<number, string>> = {
  adulto: {
    1: [
      "Órbita, de Cosmos. Consentimiento del adulto responsable (versión 1).",
      "Voy a recibir un resumen semanal con la cantidad de pausas que hubo en el teléfono vinculado,",
      "y avisos cuando la protección se desactive, cuando el teléfono deje de reportar o cuando el",
      "adolescente desvincule su teléfono. No voy a recibir qué sitios visitó ni a qué hora.",
      "Los conteos no son un diagnóstico. El adolescente puede pedir ayuda desde su app sin que yo",
      "reciba aviso, y puede desvincular su teléfono cuando quiera. Puedo revocar este consentimiento",
      "en cualquier momento desde la app.",
    ].join(" "),
  },
  adolescente: {
    1: [
      "Órbita, de Cosmos. Asentimiento del adolescente (versión 1).",
      "Acepto vincular mi teléfono con el de un adulto responsable. Lo que se comparte es solo la",
      "cantidad de pausas por semana y si la protección está activa. No se comparte qué sitios visito",
      "ni a qué hora. Si pido ayuda desde la app, el adulto no recibe aviso. Puedo desvincular mi",
      "teléfono cuando quiera y el adulto va a saber que lo hice.",
    ].join(" "),
  },
};

export function versionVigente(tipo: "adulto" | "adolescente"): number {
  return Math.max(...Object.keys(CONSENTIMIENTOS[tipo]).map(Number));
}

export const AVISOS = {
  resumen: (alias: string, actual: number, anterior: number) =>
    `Esta semana hubo ${actual} ${actual === 1 ? "pausa" : "pausas"} en el teléfono de ${alias}, ${anterior} la anterior.`,
  proteccionDesactivada: (alias: string) =>
    `La protección en el teléfono de ${alias} se desactivó.`,
  sinReportes: (alias: string, horas: number) =>
    `El teléfono de ${alias} no reporta desde hace ${Math.round(horas / 24)} días. Puede ser falta de conexión o que la app se haya desinstalado.`,
  desvinculado: (alias: string) => `${alias} desvinculó su teléfono.`,
  vinculado: (alias: string) => `${alias} aceptó el vínculo. Desde ahora vas a recibir el resumen semanal.`,
};

export const NOTA_NO_DIAGNOSTICO =
  "No es un diagnóstico. Una pausa puede venir de publicidad dentro de otro sitio o de otra persona que usa el teléfono.";
