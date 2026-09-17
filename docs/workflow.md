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
