# HabitApp — Checklist de tests manuales

Cubre lo que `tests/` (backend, 7 fases, 98 tests automáticos) no puede ver:
UI real, gestos, cámara, permisos del sistema, estados visuales y timing de
cliente. Ver [tests/README.md](../tests/README.md) para el catálogo
automático — donde un ítem de aquí verifica el resultado visible de algo que
también está cubierto allí, se indica explícitamente con **cross-ref**: no
son pruebas redundantes, son las dos mitades de la misma garantía (la de
backend prueba que la regla existe; la manual prueba que el usuario real la
ve bien).

Formato: `- [ ] acción → resultado esperado concreto`. Cada bloque lleva su
propia fecha de "última vez probado" — no por ítem individual, para poder ver
de un vistazo qué bloque lleva tiempo sin repasarse. Actualiza la fecha a
mano tras cada repaso completo del bloque.

Alcance: solo la app móvil (HabitApp). El producto web (habitteam-web) se
cubrirá en un checklist separado más adelante.

---

## 1. Alta y onboarding

**Última vez probado:** _(pendiente)_

- [ ] Registrarse como admin (modo "Crear grupo", `SignUpScreen.js` → `onSignUp`) con datos reales → tras enviar el formulario aterrizas directamente en `HomeScreen` ya autenticado, sin pantalla intermedia rota ni "no rows" — esta es la condición de carrera (`authFlags.skipNextRedirect`) que ningún test automático puede forzar; repetir el alta varias veces seguidas buscando exactamente este fallo → cross-ref: **Fase 1, huecos conocidos** (`test-01-alta.js`, test 5 explícitamente fuera de alcance por ser timing de cliente)
- [ ] Como admin recién creado, sin ningún hábito activo → `HomeScreen` te redirige automáticamente a `AdminScreen` con la pestaña "Familia" ya abierta → cross-ref **Fase 1, test 2** (la condición de datos ya está probada; aquí se verifica que la navegación real ocurre)
- [ ] En la pestaña "Familia", sin ningún miembro más que tú → se ve el mensaje "¡Bienvenido! Empieza añadiendo a los miembros de tu familia" con icono de personas azul (`AdminScreen.js:1102-1107`)
- [ ] Pulsar "+ Añadir miembro", rellenar nombre y email → se genera un código numérico de 6 dígitos y aparece la vista para compartirlo/copiarlo (`AdminScreen.js`, `handleGenerateCode`)
- [ ] Desde OTRO dispositivo o cuenta, elegir "Activar con código" e introducir ese código → el email y el nombre se autocompletan (vienen del código) y avanza al paso de crear contraseña, sin pedir escribirlos de nuevo → cross-ref **Fase 1, test 3**
- [ ] Completar el paso de contraseña → cuenta activada, aterrizas en `HomeScreen` ya como miembro (`role='usuario'`), sin quedarte colgado en una pantalla de carga
- [ ] Introducir un código de 6 dígitos ya usado o inventado → mensaje de error claro ("Código inválido"), no un crash ni una pantalla en blanco

## 2. Recuperación de contraseña

**Última vez probado:** _(pendiente)_

- [ ] Desde `Login`, pulsar el enlace de "¿Olvidaste tu contraseña?" → navega a `ForgotPasswordScreen` con el campo de email vacío
- [ ] Dejar el email vacío o escribir uno con formato inválido y pulsar enviar → aparece el error de validación de cliente correspondiente (email requerido / email inválido) sin llegar a llamar a Supabase (`ForgotPasswordScreen.js`, `isValidEmail`)
- [ ] Introducir un email con formato válido (esté registrado o no) y pulsar enviar → mensaje de éxito ("revisa tu correo") y el botón de envío queda deshabilitado tras el envío — nótese que `resetPasswordForEmail` responde igual exista o no esa cuenta, así que este paso no puede usarse para confirmar si un email está registrado
- [ ] Forzar un fallo de red durante el envío (modo avión) → aparece un mensaje de error de red distinto al de "email inválido", no un crash
- [ ] Pulsar el enlace recibido por correo real (o, si el entorno de prueba no puede recibir correo real, un enlace de recovery generado desde el dashboard de Supabase/Admin API con el mismo `redirectTo`) con la app cerrada → la app se abre directamente en `ResetPasswordScreen` con el formulario de nueva contraseña, sin pasar por Login (`RootNavigator.js`, deep link `habitapp://reset-password`)
- [ ] Repetir el mismo enlace con la app ya abierta en segundo plano → misma navegación a `ResetPasswordScreen`, sin necesidad de reiniciar la app (cubre tanto cold-start como warm-app, `Linking.useLinkingURL()`)
- [ ] En `ResetPasswordScreen`, escribir una contraseña de menos de 8 caracteres o dejar el campo de confirmación distinto → error de validación de cliente correspondiente, sin llegar a llamar a `updateUser`
- [ ] Completar el formulario con una contraseña válida y confirmada, y enviar → sin pantallas intermedias ni pulsar nada más, la app aterriza directamente en `HomeScreen` ya autenticado con la cuenta — es sesión real, no hace falta volver a iniciar sesión con la contraseña nueva
- [ ] Cerrar sesión y volver a entrar con la contraseña NUEVA → funciona; con la contraseña ANTIGUA → falla → cross-ref **Fase 7, tests 4 y 5** (el cambio real en el servidor ya está probado; aquí se verifica que el usuario real puede completar el ciclo entero desde la UI)
- [ ] Pulsar "Cancelar" en `ResetPasswordScreen` antes de enviar el formulario → aparece un aviso de confirmación; al confirmar, la sesión de recovery se cierra y la app vuelve a la pantalla de Login sin haber cambiado la contraseña
- [ ] Pulsar un enlace de recovery ya usado, o dejarlo caducar (por defecto expira pasado un tiempo, ver configuración de Supabase) → en vez de abrir `ResetPasswordScreen`, aparece un aviso claro de "enlace no válido" y la app se queda en la pantalla desde la que se abrió — no una pantalla en blanco ni un crash → cross-ref **Fase 7, test 6** (que el token de un solo uso se rechace en servidor ya está probado; aquí se verifica que el usuario ve un mensaje comprensible, no un error técnico)

## 3. Hábitos — creación y visualización

**Última vez probado:** _(pendiente)_

- [ ] Crear un hábito **Diario** con hora límite → en el listado aparece "Antes de las HH:MM" bajo la descripción
- [ ] Crear un hábito **X veces por semana** con objetivo 3 → en `AdminScreen` aparece "3× veces por semana" en su fila
- [ ] Crear un hábito **X veces por mes** con objetivo 2 → aparece "2× veces por mes"
- [ ] Crear un hábito **Una vez** con fecha y hora límite → se ve la fecha de caducidad; pasada esa fecha, el hábito deja de aparecer en `HomeScreen` (`HomeScreen.js:283`, filtro de `expires_at`)
- [ ] Asignar una categoría con icono/color propios → el icono correcto (Ionicons) se ve tanto en el selector del modal como en la tarjeta del hábito en `HomeScreen`
- [ ] Un hábito sin categoría asignada → se muestra el icono por defecto `help-circle-outline`

## 4. Límites de plan (Familiar)

**Última vez probado:** _(pendiente)_

- [ ] Como admin de un grupo en plan Familiar con ya 10 hábitos activos, intentar crear un hábito nuevo → aparece un `Alert` con el título "Has alcanzado el límite de hábitos activos de tu plan actual" (sin cuerpo de mensaje adicional, un único botón OK) y el hábito NO se crea — ni error crudo en pantalla ni fallo silencioso (`AdminScreen.js`, `handleCreateHabit`) → cross-ref **Fase 5, test 2** (la RPC `check_habit_limit` ya está probada; aquí se verifica que la UI real bloquea ANTES de intentar el INSERT y que el usuario entiende por qué — recuerda que esta comprobación de cliente no tiene respaldo en el servidor, ver hueco documentado en `tests/README.md`)
- [ ] Como admin de un grupo en plan Familiar con ya 6 miembros, pulsar "+ Añadir miembro" e intentar generar un código para un séptimo → antes de crear el código, aparece el `Alert` "Has alcanzado el límite de miembros de tu plan actual" y NO se genera ningún código nuevo (`AdminScreen.js`, `handleGenerateCode`) → cross-ref **Fase 5, test 3** (la RPC `check_member_limit` y su respaldo real dentro de `handle_activation_registration` ya están probados; aquí se verifica que el admin ve el aviso ANTES de repartir un código que luego fallaría al activarse)

## 5. Completar hábitos

**Última vez probado:** _(pendiente)_

- [ ] Completar un hábito con `photo_required=true` sin adjuntar ninguna foto → no se puede enviar / aparece aviso pidiendo la foto (`HabitDetailScreen.js:184`) — recuerda que esta regla es **solo de cliente**, sin respaldo en el backend (ver `tests/README.md`, hueco "photo_required")
- [ ] Completar un hábito con `photo_required=false` → se envía correctamente sin ninguna foto
- [ ] Completar cualquier hábito → aparece el overlay de celebración con la racha actual en grande
- [ ] Completar un hábito justo cuando se cumple el `streak_target` de una recompensa → el overlay de celebración muestra ADEMÁS una caja con 🏆 y la descripción de la recompensa **en dorado** (`#FFD700`, `HabitDetailScreen.js:380-387`), en vez del mensaje genérico "bien hecho"
- [ ] En `HomeScreen`, un hábito con una recompensa aún no conseguida más próxima → se ve el chip azul "🎯 A X días de: {descripción}" bajo la descripción (`HomeScreen.js:500-505`) → cross-ref **Fase 3, test 11** (`featuredReward`: el número/criterio ya está probado; aquí se verifica que se ve bien en pantalla, incluido el caso contraintuitivo de que gane un `streak_target` mayor)
- [ ] Un hábito diario con `due_time` ya superada y sin completar hoy → el texto "Antes de las HH:MM" se pinta en **naranja** (`#f97316`, `HomeScreen.js:508`, estilo `dueTimeUrgent`)

## 6. Estadísticas de hábito (HabitStatsScreen)

**Última vez probado:** _(pendiente)_

- [ ] Abrir las estadísticas de un hábito con varias recompensas, algunas ya conseguidas y otras no → las conseguidas se muestran con fondo verde claro, emoji 🏆 y descripción en verde oscuro (`#2E7D32`), más el texto "conseguida X veces"; las pendientes se muestran con fondo neutro, emoji 🎯 y el texto "a X días de conseguirla" (`HabitStatsScreen.js:606-627`) → cross-ref **Fase 3, tests 7-10** (el cálculo de veces conseguidas / días restantes ya está probado; aquí se verifica que se ve bien diferenciado en pantalla)
- [ ] En el calendario mensual: un día con log validado se pinta en verde, un día con log pendiente de validar se pinta en amarillo, un día sin log se queda en gris claro, y el día de hoy sin log se marca solo con un borde azul (sin relleno) → coincide con la leyenda mostrada debajo del calendario
- [ ] Para un hábito **weekly_x**, un día dentro de una semana que ya cumplió el objetivo semanal se pinta en verde SOLO si todos los logs de esa semana están validados, y en amarillo si el objetivo numérico ya se cumplió pero aún queda algún log de esa semana sin validar — este matiz es fácil de pasar por alto a simple vista (`HabitStatsScreen.js:229-236`)
- [ ] Navegar el calendario hacia atrás con "‹" hasta 6 meses antes del mes actual → la flecha se deshabilita (se pinta en gris) y no retrocede más; hacia delante, nunca se puede pasar del mes actual
- [ ] Con comentarios de validadores existentes en logs recientes → aparecen en "Últimas validaciones" con avatar (o iniciales si no hay foto), nombre, fecha abreviada y el comentario entre comillas; sin comentarios → se muestra el texto de estado vacío correspondiente

## 7. Actividad y ranking (RankingScreen)

**Última vez probado:** _(pendiente)_

- [ ] Como miembro no-admin, entrar en la pestaña "Actividad" con al menos un hábito diario asignado → en "Tu actividad" aparece una tarjeta con el icono de racha 🔥 en verde cuando la racha es mayor que 0 y en gris (`#E0E0E0`) cuando es 0, más los 7 puntos de la semana (L-D) coloreados verde=validado / amarillo=pendiente / gris=sin registro (`RankingScreen.js`, `getWeekDots`)
- [ ] Con un hábito **weekly_x** asignado → en vez de puntos por día de la semana, se ven tantos puntos como el objetivo semanal, cada uno etiquetado con el día en que se completó esa repetición, coloreado verde si ya está validada, amarillo si está pendiente, gris si aún no se ha hecho (`WeeklyTargetDots`)
- [ ] Con un hábito **monthly_x** asignado → mismo patrón de puntos que weekly_x, pero la etiqueta de cada punto es el número de día del mes en que se completó, no el día de la semana (`MonthlyTargetDots`)
- [ ] Con un hábito **once** asignado → aparece bajo el separador "Eventos" con un icono de check verde relleno si ya se completó, o un círculo vacío gris con el texto "pendiente" si no (`OnceHabitCard`)
- [ ] Como ADMIN, en la sección "Tu familia" → cada miembro aparece con su nombre como subcabecera y la lista EXPANDIDA de todos sus hábitos, con la misma tarjeta detallada (racha, puntos) que en "Tu actividad" — no un resumen compacto
- [ ] Como miembro NO admin, en "Tu familia" → cada miembro aparece en una tarjeta compacta con solo sus puntos semanales de hábitos diarios y su racha general; no se ve el desglose por hábito individual ni sus hábitos weekly_x/monthly_x/once

## 8. Validación

**Última vez probado:** _(pendiente)_

- [ ] Como validador, entrar en "Validar" con una foto pendiente de otro miembro → se ve la foto, el nombre de quien la subió, y los 5 emojis de reacción (👏 ❤️ 💪 😊 🌟)
- [ ] Pulsar "Aprobar" → el log pasa a validado y desaparece de la lista de pendientes
- [ ] Pulsar "Rechazar" → el log pasa a rechazado y desaparece de la lista de pendientes
- [ ] Elegir una reacción antes de votar → queda resaltada con fondo azul claro (`#EEF3FB`) al seleccionarla
- [ ] Como admin, cuando un hábito se queda sin ningún validador explícito (por ejemplo, el único validador borró su cuenta) → el log pendiente de ese hábito aparece en TU propia pantalla de Validar aunque nunca te hayan asignado como validador, y puedes aprobarlo/rechazarlo con normalidad → cross-ref **Fase 6, test 5e-5h** (el `SELECT`/`INSERT` crudo ya está probado; aquí se verifica que la pantalla real lo muestra y lo deja votar)

## 9. Perfil y avatar

**Última vez probado:** _(pendiente)_

- [ ] Subir una foto de perfil nueva (cámara o galería) → la foto se actualiza EN PANTALLA de inmediato, sin recargar la app ni salir de `ProfileScreen` (cache-bust con `?t=timestamp` añadido en el cliente, `ProfileScreen.js`, `uploadAvatar`)
- [ ] Como admin, pulsar el icono de lápiz junto a "Grupo" y cambiar el nombre → se guarda y se refleja en pantalla al momento (sin test automático dedicado a esta acción concreta — ver huecos, abajo)
- [ ] Como miembro normal (no admin), la fila de "Grupo" NO muestra icono de lápiz — no hay forma de intentar renombrar el grupo desde la UI

## 10. Borrado de cuenta

**Última vez probado:** _(pendiente)_

- [ ] Desde `ProfileScreen`, pulsar "Eliminar mi cuenta" → aparece el primer `Alert` (aviso de qué se va a borrar)
- [ ] Confirmar el primer `Alert` → aparece el segundo `Alert`, de confirmación final e irreversible
- [ ] Confirmar el segundo `Alert` siendo el ÚNICO admin de tu grupo → aparece un `Alert` de error con el mensaje **"Eres el único administrador de tu grupo. Transfiere el rol de administrador a otro miembro, o elimina primero a los demás miembros, antes de eliminar tu cuenta."** — la cuenta NO se borra, sigues dentro de la app con normalidad → cross-ref **Fase 6, test 1** (allí se prueba que la RPC lo rechaza vía excepción SQL; aquí se prueba que el usuario real ve el mensaje bien formateado en un `Alert`, no un error técnico crudo ni la app colgada)
- [ ] Como miembro normal (o admin que no es el único), completar el borrado → sesión cerrada automáticamente, aterrizas en la pantalla de Login sin ninguna acción extra → cross-ref **Fase 6, test 2/3**

## 11. Casos visuales que los tests no pueden ver

**Última vez probado:** _(pendiente)_

- [ ] Estados de carga (`ActivityIndicator`) al entrar por primera vez en cada pantalla principal y al hacer pull-to-refresh → no se queda la pantalla en blanco ni parpadea el contenido antiguo mezclado con el nuevo
- [ ] Forzar un error de red (modo avión) en cualquier pantalla que haga fetch → aparece el banner de error (fondo `#fee2e2`, texto `#b91c1c`, reutilizado en `AdminScreen`/`HabitStatsScreen`/`ProfileScreen`/`HomeScreen`/`HabitDetailScreen`/`RankingScreen`), nunca un crash
- [ ] Hábito diario con `due_time` superada (ya cubierto como acción funcional en el bloque 5, listado aquí también como el caso visual puro a comprobar si solo se está repasando colores)
- [ ] **Nota:** el enunciado original de esta tarea pedía incluir aquí un "modal de onboarding con sugerencias" — no existe en el código actual. Solo hay un botón de desarrollo (`AdminScreen.js:1157`, "Reset onboarding (dev)") que borra la clave `onboarding_completed` de `AsyncStorage`, pero ningún otro fichero lee ni escribe esa clave, y no existe ningún componente de modal/tutorial en la app. Parece código vestigial de una función nunca construida (o retirada sin limpiar el botón). No se incluye un ítem de checklist para algo que no existe — si se decide construir esa función en el futuro, este es el hueco a rellenar.

## 12. i18n

**Última vez probado:** _(pendiente)_

- [ ] Cambiar el idioma del DISPOSITIVO a inglés y abrir la app sin caché previa de idioma → arranca en inglés (detección automática vía `expo-localization`, `lib/i18n.js`)
- [ ] Cambiar el idioma manualmente desde `ProfileScreen` → Idioma → toda la app cambia al momento, sin reiniciar
- [ ] Cerrar y reabrir la app tras un cambio manual de idioma → se mantiene el idioma elegido (guardado en `AsyncStorage`, clave `user_language`), no vuelve a detectar el del dispositivo

## 13. Multiplataforma (Android, secundario)

**Última vez probado:** _(pendiente)_

Según `project.md`: "iOS primero, Android funcional" — los estilos se prueban en iOS y se verifica que no rompan en Android, no al revés.

- [ ] Repetir el flujo de alta completo (bloque 1) en un emulador/dispositivo Android
- [ ] Repetir completar un hábito con foto (bloque 5) en Android — los permisos de cámara/galería se piden y funcionan igual que en iOS
- [ ] Repetir el borrado de cuenta (bloque 10) en Android, incluido el caso de único admin

---

## Huecos conocidos en este checklist

- **Renombrar el grupo (bloque 9):** no hay ningún test automático dedicado a esta acción por sí sola — sí está cubierta indirectamente la policy que lo permite (`companies` UPDATE, Fase 4), pero no un test de backend específico de "el admin renombra su company". Pospuesto sin decisión tomada de si merece un test propio en una fase futura — anotado aquí en vez de en `tests/README.md` porque no es un hueco de cobertura *automática* pendiente, es un hueco de este checklist manual.
- **Modal de onboarding con sugerencias:** no existe en el código — ver nota en el bloque 11. No es un hueco de test, es una funcionalidad inexistente.
- **`resetPasswordForEmail` sin revelar si el email existe:** comportamiento correcto de seguridad (no permite enumerar cuentas registradas), documentado aquí para que no se confunda con un fallo al probarlo con un email no registrado y ver el mismo mensaje de éxito.
