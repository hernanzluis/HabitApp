# Forma de trabajo

- Claude (asistente) diseña los cambios y produce prompts para Claude Code.
- Code ejecuta el SQL en Supabase directamente (no lo hace Luis manualmente).
- Code modifica el código, hace commit y push a GitHub.
- Vercel despliega automáticamente la web tras el push.
- Luis solo interviene en Supabase manualmente si el cambio es destructivo o crítico.
- Tras cada funcionalidad implementada se prueba manualmente antes de pasar al siguiente bloque.
- Los prompts para Code siempre indican el repo destino: "Para Code (en HabitApp):" o "Para Code (en habitteam-web):".
- Instrucciones siempre dentro de bloques de código con triple backtick.
