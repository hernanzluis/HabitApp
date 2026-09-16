# Tests de backend — HabitApp

Scripts de test de backend contra Supabase real. Sin Jest ni framework: se ejecutan
directamente con `node tests/xxx.js` y usan asserts propios (`assertEqual` en
`test-helpers.js`) con mensajes explícitos.

## Configuración

Requiere `SUPABASE_SERVICE_ROLE_KEY` en un `.env` en la raíz del repo (ignorado por
git). Necesaria para `supabase.auth.admin.createUser/deleteUser` y para saltarse RLS
en `cleanupTestData()`. **Nunca** se usa ni se importa desde `lib/supabase.js`,
`screens/` ni ningún código que corra en la app o en la web — ese cliente sigue
usando siempre la anon key.

Todo dato de test lleva el prefijo `zztest-` (`TEST_PREFIX` en `test-helpers.js`) en
el email o en el nombre de la company. `cleanupTestData()` rechaza borrar cualquier
registro que no lleve ese prefijo — es la única red de seguridad, dado que la
Service Role Key salta RLS.

## Ejecutar

```bash
node tests/test-01-alta.js
```

## Ficheros

- `test-helpers.js` — helper compartido: creación de usuarios (vía las RPCs reales
  de alta, no reinventadas), unión por código de activación, avance de logs de
  hábito, limpieza en cascada.
- `test-01-alta.js` — Fase 1: alta de admin, condición real de "family setup",
  alta de miembro por código de activación.

## Huecos conocidos, pendientes

### Test 5 de la Fase 1 — `authFlags.skipNextRedirect`

No está implementado, a propósito. Es una condición de carrera de **timing en el
cliente** (estado de React / orden de eventos de `onAuthStateChange` en
`RootNavigator.js`, gestionada por el singleton `authFlags` — ver
[database.md](../docs/database.md)), no algo que se pueda verificar consultando
datos en Supabase: no hay ninguna fila ni columna que capture "¿se navegó demasiado
pronto?". Un script como este, que solo llama a RPCs y lee tablas, no puede
ejercitar esa carrera.

**Candidato natural cuando se monte testing de UI real** (por ejemplo Maestro,
sobre una build de EAS) — ahí sí se puede automatizar: lanzar el flujo de signup/
activación repetidamente y comprobar que nunca se ve un HomeScreen roto o una
pantalla intermedia inconsistente antes de que `activateSession()` complete.
