# Órbita, de Cosmos: brief de marca y producto

Fecha: 2026-09-17. Borrador para alimentar los mockups (`/design`) y la app Android.

## Qué es

Órbita es una app educativa para adolescentes y sus familias frente a las apuestas online. Cuando el adolescente entra a un sitio de apuestas, el teléfono le propone una pausa con información; el adulto recibe un resumen de conducta y señales para conversar; los dos tienen a mano ayuda profesional. No bloquea, no diagnostica, no trata.

Dos apps con el mismo sistema visual:

| App | Para quién | Nombre en tienda |
|---|---|---|
| **Órbita** | el adolescente | Órbita |
| **Órbita Familia** | el adulto responsable | Órbita Familia |

## Nombre y relación con Cosmos

- **Órbita** conecta con el universo Cosmos (movimiento, trayectoria, el astronauta) y nombra la idea del producto: ayudar a no salirse de órbita.
- Es **marca propia con respaldo**: "Órbita, de Cosmos". No es una variante como Cosmos Pay: la app de un menor no puede leerse como parte de una billetera 18+.
- Pendiente: chequear el nombre en INPI, Google Play y App Store, y el dominio.

## Lo que se hereda del manual de Cosmos

Fuente: `Propuesta_de_marca_Cosmos.pdf` (septiembre 2026). No se copia al repo.

| Elemento | Cosmos | Órbita |
|---|---|---|
| Valores | confianza, cercanía, innovación, libertad | los mismos, con **cuidado** en primer lugar |
| Tono | claro, cercano, seguro, profesional, ágil | claro, cercano, seguro; nunca acusatorio ni alarmista |
| Tipografía de títulos | POI Aeronaut (la versión del manual es Trial) | igual, **licenciar antes de publicar** |
| Tipografía de texto | Open Sauce One | igual |
| Paleta | negro, blanco, Dark Navy `#05064F`, Cosmic Blue `#000877` | misma paleta, pero **base clara**: fondo blanco, texto Dark Navy, Cosmic Blue como acento. El fondo negro fintech queda solo para piezas de marca |
| Elementos gráficos | curvas continuas | la curva es la **órbita**: aparece en el estado activo, en el progreso y en la pantalla de pausa |
| Personaje | astronauta | el astronauta acompaña y explica; no es mascota infantil ni aparece en alertas |
| Isotipo | C con trazo orbital | no se reutiliza. Órbita tiene ícono propio (una órbita con un punto), con "de Cosmos" en la pantalla de inicio y en la tienda |

Colores propios que se agregan, pendientes de validar en contraste:
- un azul claro para fondos de tarjetas y estados positivos;
- un ámbar suave para la pantalla de pausa (no rojo: no es una alarma).

## Voz

- Voseo rioplatense.
- Se habla **con** el adolescente, no sobre él. Nunca "tu hijo hizo", sino "hubo 5 pausas esta semana".
- Palabras que no se usan: vigilar, controlar, bloquear, detectar, ludopatía (en la interfaz), riesgo, adicto, prohibido.
- Palabras que sí: pausa, órbita, acompañar, conversar, ayuda, señales, tendencia.
- Cada dato de conducta lleva la aclaración: "No es un diagnóstico. Puede venir de publicidad o de otra persona que usa el teléfono."

## Pantallas de Órbita (adolescente)

1. **Bienvenida:** qué hace la app, qué ve y qué no ve, en una pantalla. Sin registro con datos personales.
2. **Vincular:** código de seis dígitos que muestra el adulto. Asentimiento explícito: "Acepto que [alias del adulto] reciba un resumen semanal de pausas". Se puede revocar desde ajustes, y la app lo dice.
3. **Inicio:** estado "Órbita activa" con la curva; acceso a Aprender, Ayuda y Ajustes.
4. **Pausa:** aparece al entrar a un sitio de apuestas. Un dato concreto (por ejemplo cómo gana siempre la casa), una pregunta corta, y dos botones: "Seguir igual" y "Salir". Sin cuenta regresiva, sin culpa. Se registra como una pausa, no como una falta.
5. **Aprender:** módulos de dos o tres minutos. Al completarlos, progreso en la órbita. Sin puntajes ni ranking.
6. **Ayuda:** líneas y centros según provincia, con horario y fecha de verificación. Llamar o escribir desde acá **no avisa al adulto**, y la pantalla lo dice.
7. **Ajustes:** qué se comparte, con quién, revocar el vínculo, borrar datos.

## Pantallas de Órbita Familia (adulto)

1. **Bienvenida y consentimiento:** texto exacto de qué recibe y qué no, guardado con su versión.
2. **Vincular:** genera el código; muestra el estado del vínculo (pendiente, activo, revocado).
3. **Inicio:** una tarjeta por adolescente con la tendencia semanal ("5 pausas, 2 la semana pasada"), sin dominios ni horarios exactos. Estado de la protección.
4. **Señales:** lista de señales para observar fuera del teléfono (pedidos de dinero, irritación al cortar, desinterés por la escuela), con fuente.
5. **Conversar:** guía corta para hablar del tema, escrita con un equipo de salud mental.
6. **Ayuda:** el mismo directorio, con la aclaración de que el adolescente también puede pedir ayuda por su cuenta.
7. **Avisos:** historial de notificaciones.

## Notificaciones al adulto

| Evento | Texto | Cuándo |
|---|---|---|
| Resumen semanal | "Esta semana hubo 5 pausas en el teléfono de [alias], 2 la anterior." | una vez por semana |
| Protección desactivada | "La protección en el teléfono de [alias] se desactivó hace 10 minutos." | al recibirse el evento |
| Sin reportes | "El teléfono de [alias] no reporta desde hace 2 días. Puede ser falta de conexión o que la app se haya desinstalado." | pasado el umbral |
| Vínculo revocado | "[Alias] desvinculó su teléfono." | al recibirse el evento |

No hay notificación por cada pausa ni en tiempo real: sería vigilancia y no cambia la conversación.

## Requisitos de tienda que afectan el diseño

- Aviso persistente en el teléfono del adolescente: "Órbita activa".
- Pantalla de consentimiento para la VPN local y declaración de app de control parental.
- Ficha de tienda que explique el monitoreo con claridad.

## Pendientes

- Nombre: INPI, tiendas y dominio.
- Licencia de POI Aeronaut.
- Contraste de la paleta clara (WCAG AA).
- Mockups con `/design`, a partir de este brief.
- Textos de Pausa, Aprender y Conversar revisados por un equipo de salud mental.
