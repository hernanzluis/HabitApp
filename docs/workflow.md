# Forma de trabajo

- Claude (asistente) diseña los cambios y produce prompts para Claude Code.
- Code ejecuta el SQL en Supabase directamente (no lo hace Luis manualmente).
- Code modifica el código, hace commit y push a GitHub.
- Vercel despliega automáticamente la web tras el push.
- Luis solo interviene en Supabase manualmente si el cambio es destructivo o crítico.
- Tras cada funcionalidad implementada se prueba manualmente antes de pasar al siguiente bloque.
- Los prompts para Code siempre indican el repo destino: "Para Code (en HabitApp):" o "Para Code (en habitteam-web):".
- Instrucciones siempre dentro de bloques de código con triple backtick.

## Evaluar cobertura de tests en cada cambio

- Cualquier funcionalidad nueva o cambio de comportamiento existente debe
  evaluarse también desde el punto de vista de `tests/` (ver
  `tests/README.md`, catálogo de 6 fases): ¿algún test existente queda
  desactualizado por este cambio? ¿el cambio introduce un caso nuevo que
  merece cobertura?
- Aplica tanto si el cambio lo pide Luis explícitamente como si sale de una
  auditoría o de un hallazgo durante el propio desarrollo — ya ha pasado
  varias veces: el trigger de escalada de privilegios en `profiles`, el
  fallback de validador cuando un hábito se queda sin ninguno, el
  aislamiento cross-empresa en `habit_validations`.
- No todo cambio necesita un test nuevo. Criterio: si el cambio toca RLS,
  una RPC, una tabla, o una regla de negocio verificable por datos → sí
  evaluarlo (test automático en `tests/`). Si es puramente visual/UI sin
  lógica de servidor (por ejemplo, el color de un botón, un gesto, una
  animación) → evaluar si merece un ítem en
  [manual-testing.md](manual-testing.md) en su lugar — es el mismo criterio
  aplicado a las dos mitades: RLS/RPC/tabla/regla de negocio → automático;
  UI/interacción visible → manual. Un cambio puede necesitar los dos a la
  vez (por ejemplo, un fix de RLS que además cambia lo que ve el usuario).
- Si tras evaluarlo se decide que un cambio no necesita test (automático ni
  manual), no hace falta documentarlo caso por caso. Si en cambio se decide
  **posponer** un test que sí tendría sentido, eso sí debe quedar anotado
  como hueco conocido, con el mismo formato que los huecos ya existentes:
  en `tests/README.md` si es automático, en la sección "Huecos conocidos"
  de `manual-testing.md` si es manual.

## Cerrar lo que se descubre, no solo documentarlo

- El objetivo por defecto es cerrar los temas que se abren, no dejarlos a
  medias. Cuando una tarea (una fase de `tests/`, una auditoría, una revisión
  de `manual-testing.md`) descubre algo que no funciona o no existe — como ha
  pasado con la escalada de privilegios en `profiles`, el fallback de
  validador, o el flujo de recuperación de contraseña — la reacción por
  defecto es evaluar cerrarlo en la misma sesión de trabajo donde se
  descubrió, no solo documentarlo y seguir adelante.
- Razón: un hallazgo documentado hoy, sin el contexto completo de por qué se
  encontró y qué se investigó, es mucho más caro de retomar dentro de unas
  semanas que resolverlo ahora que todo el contexto está fresco (código ya
  revisado, decisiones ya tomadas, sesión de Supabase abierta).
- Esto no significa que todo se resuelva sí o sí en el momento. Hay hallazgos
  que requieren una decisión de producto (por ejemplo, "hábitos personales")
  o que dependen de trabajo externo (builds EAS, Stripe, o — como en el caso
  de la recuperación de contraseña — un paso manual en el dashboard de
  Supabase que solo Luis puede hacer) y esos sí quedan como pendientes
  explícitos.
- La regla es: por defecto se evalúa cerrar, y solo se pospone con una razón
  concreta documentada (no simplemente "lo dejamos para luego" sin más).
- Cuando algo se pospone, debe quedar en el documento correspondiente
  (`tests/README.md` o `docs/manual-testing.md`, según toque) con el mismo
  nivel de detalle que ya se ha usado en los huecos existentes: qué se
  encontró, por qué se pospone, y qué haría falta para cerrarlo.
