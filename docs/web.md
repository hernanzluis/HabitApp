# Producto web — HabitTeam.app

**Repositorio web:** habitteam-web (proyecto separado, mismo Supabase) — https://github.com/hernanzluis/habitteam-web
**Directorio local:** /Users/luishernanz/habitteam-web
**Dominio:** habitteam.app (registrado en Namecheap)
**Stack web:** React + React Router v7 + Tailwind CSS v3 + @supabase/supabase-js
**Despliegue:** Vercel (gratuito), automático tras push a la rama principal

## Stack tecnológico

**dependencies:**

| Paquete | Versión |
|---|---|
| react | ^19.2.6 |
| react-dom | ^19.2.6 |
| react-router-dom | ^7.16.0 |
| @supabase/supabase-js | ^2.106.2 |
| i18next | ^26.3.0 |
| react-i18next | ^17.0.8 |
| i18next-browser-languagedetector | ^8.2.1 |
| react-scripts | 5.0.1 |
| web-vitals | ^2.1.4 |
| @testing-library/dom | ^10.4.1 |
| @testing-library/jest-dom | ^6.9.1 |
| @testing-library/react | ^16.3.2 |
| @testing-library/user-event | ^13.5.0 |

**devDependencies:**

| Paquete | Versión |
|---|---|
| tailwindcss | ^3.4.19 |
| autoprefixer | ^10.5.0 |
| postcss | ^8.5.15 |

**overrides:** `typescript: 4.9.5`. Bootstrapped con Create React App (`react-scripts`); scripts estándar `start`/`build`/`test`/`eject`.

## Configuración de entorno

- Cliente Supabase: `src/lib/supabase.js` — `createClient(supabaseUrl, supabaseAnonKey)`, sin opciones extra (sin config custom de `auth`/`db`/`global`).
- URL: `process.env.REACT_APP_SUPABASE_URL`
- Anon key: `process.env.REACT_APP_SUPABASE_ANON_KEY`

## Rutas

Entrada: `src/App.js` — `BrowserRouter` envuelve toda la app (sin otros providers de contexto). Incluye un componente `ScrollToTop` (usa `useLocation()` + `useEffect` sobre `[pathname]` para hacer `window.scrollTo(0,0)` en cada cambio de ruta; no renderiza nada).

| Ruta | Componente |
|---|---|
| `/` | `Home.jsx` (página pública) |
| `/acceder` | `Acceder.jsx` (login admin web) |
| `/admin` | `Admin.jsx` (panel admin) |
| `/admin/miembro/:userId` | `MemberDetail.jsx` (detalle de miembro) |
| `/privacidad` | `Privacy.jsx` |
| `/terminos` | `Terms.jsx` |
| `/cookies` | `Cookies.jsx` |

## i18n (implementación)

Configuración en `src/i18n.js`: `i18next` + `react-i18next` (`initReactI18next`) + `i18next-browser-languagedetector`.

- `resources`: `{ es: { translation: es }, en: { translation: en } }` — namespace único `translation`, importado directamente de `src/locales/es.json` y `en.json`.
- `fallbackLng: 'en'`.
- Detección: `order: ['localStorage', 'navigator']`, `lookupLocalStorage: 'habitteam_lang'`, `caches: ['localStorage']`.
- **Lógica adicional:** tras inicializar, si el idioma detectado no empieza por `'es'`, se fuerza `i18n.changeLanguage('en')` — es decir, cualquier locale del navegador que no sea español cae en inglés (no se intenta mapear francés/alemán/etc. a nada más).
- `interpolation.escapeValue: false`.
- `src/locales/es.json` / `en.json` (123 líneas cada uno): claves de primer nivel `banner`, `nav`, `hero`, `howItWorks`, `features`, `pricing`, `cta`, `footer`. `pricing.plans` es un array de 3 objetos (`name`, `price`, `period`, `featured`, `features[]`).
- Selector de idioma en `Nav.jsx`: botones ES|EN que llaman a `i18n.changeLanguage(lang)` y además hacen `localStorage.setItem('habitteam_lang', lang)` manualmente (redundante con el cacheo propio de i18next, pero explícito en el código).

**Uso real de `useTranslation()`** (confirmado por grep en todo `src/`): solo en `Nav.jsx`, `Home.jsx`, `Privacy.jsx`, `Terms.jsx`, `Cookies.jsx` — es decir, únicamente las páginas públicas y legales. **Todo el panel de administración** (`Acceder.jsx`, `Admin.jsx`, `MemberDetail.jsx`, y los 4 componentes de `components/admin/`) tiene strings en español hardcodeados sin i18n en absoluto.

**Nota sobre las páginas legales:** `Privacy.jsx`, `Terms.jsx` y `Cookies.jsx` usan `useTranslation()` únicamente para leer `i18n.language` y elegir qué bloque de idioma mostrar — el contenido legal en sí **no** viene de `locales/*.json`, sino de un objeto local `CONTENT = { es: {...}, en: {...} }` definido en cada fichero.

## Página corporativa (pública) — `Home.jsx`

Secciones en orden: banner de desarrollo fijo (`#0A66C2`, `mailto:hernanz.luis@gmail.com`, `z-[60]`) → `<Nav />` (desplazado a `top-[40px]`) → Hero (`hero.line1/2/3`, subtítulo, CTA a `/acceder` + CTA secundaria con scroll a ancla) → "Cómo funciona" (`#como-funciona`, 3 pasos numerados 01–03 desde `howItWorks.steps`) → "Características" (`#caracteristicas`, lista dividida renderizada dinámicamente desde `features.list`, 8 items) → "Precios" (`#precios`, grid de 3 planes desde `pricing.plans`; el plan Plus tiene `featured: true` con fondo negro destacado — ver [business.md](business.md)) → CTA final (`cta.line1/2/3`, botón → `/acceder`) → Footer (marca + tagline, columnas Producto/Empresa desde `footer.product`/`footer.company`, columna Legal con `<Link>` reales a `/privacidad`, `/terminos`, `/cookies`, copyright, iconos sociales Instagram/TikTok/Facebook en SVG).

- Título de pestaña del navegador: "HabitTeam" (index.html)
- Logo "HabitTeam" enlazado a `/` en todas las páginas (Nav con `<Link>` + scroll al top, Admin y MemberDetail con `<a href="/">`)

## `Nav.jsx`

- Constante `NAV_HEIGHT = 88` usada para el offset de scroll.
- Estado: `menuOpen` (menú hamburguesa móvil).
- `handleNavClick`: si está en Home, hace scroll suave al ancla descontando `NAV_HEIGHT`; si no, navega a `/#ancla` vía router.
- `currentLang` derivado de `i18n.language.split('-')[0]`, por defecto `'en'` salvo que sea `'es'`.
- Usado en: `Home.jsx`, `Privacy.jsx`, `Terms.jsx`, `Cookies.jsx`. **No** se usa en `Acceder.jsx` (cabecera propia minimalista) ni en `Admin.jsx`/`MemberDetail.jsx` (cabecera propia del panel admin, sin i18n).

## Páginas legales — `Privacy.jsx`, `Terms.jsx`, `Cookies.jsx`

Las tres siguen el mismo patrón: `<Nav />` arriba, breadcrumb "HabitTeam › {sección}" con `<Link to="/">`, caja de aviso ámbar ("contenido informativo, consulta a un profesional legal"), `<h1>` + fecha de última actualización, secciones mapeadas desde `CONTENT[lang].sections` (`heading` + `body` partido por `\n` en párrafos), footer mínimo con enlaces a Privacidad/Términos/Cookies. Contenido bilingüe hardcodeado en JS por fichero, no en `locales/*.json` (ver nota de i18n arriba).

## Panel de administración (privado, `/admin`)

### `Acceder.jsx` (login)

Sin i18n, formulario simple (`email`, `password`). Flujo de `handleSubmit`:
1. `supabase.auth.signInWithPassword({ email, password })` — si falla, error "Email o contraseña incorrectos".
2. `profiles.select('role').eq('id', data.user.id).single()` — si falla o es null, error "No se pudo verificar tu perfil. Inténtalo de nuevo.".
3. Si `profile.role !== 'admin'` → error "Solo los administradores pueden acceder desde la web", sin redirigir.
4. Éxito → `window.location.href = '/admin'` (navegación dura del navegador, no `navigate()` de React Router — inconsistente con el resto del panel, que sí usa `navigate()`).

Sin formulario de registro; enlace "¿No tienes cuenta? Empieza gratis" → `/`.

### `Admin.jsx`

**Verificación de sesión/rol** (`checkAuth`, en `useEffect`):
1. `supabase.auth.getUser()` — sin `authUser`, `navigate('/acceder')`.
2. `profiles.select('id, full_name, role, company_id').eq('id', authUser.id).single()`.
3. Si `!prof || prof.role !== 'admin'` → `navigate('/acceder')`.
4. `companies.select('name').eq('id', prof.company_id).single()` → `companyName`.
5. Guarda `profile` en estado, `checking = false`.

Mientras `checking` es `true` se muestra un loader de pantalla completa ("Verificando acceso...") y no se renderiza nada más.

**Tabs:** estado `activeSection` (`activity | members | habits | categories`, default `activity`), controlado tanto por un sidebar de escritorio como por una barra de tabs móvil (mismo array `navItems`, ambos ocultos con `hidden md:flex` / `md:hidden` según breakpoint). Labels: Actividad, Miembros, Hábitos, Categorías.

**Props pasadas a cada componente:**
- `<Activity companyId={profile.company_id} />`
- `<Members companyId={profile.company_id} adminId={profile.id} />`
- `<Habits companyId={profile.company_id} adminId={profile.id} />`
- `<Categories companyId={profile.company_id} />`

Header: marca → `/`, `companyName`, `profile.full_name`, botón "Cerrar sesión" → `supabase.auth.signOut()` + `navigate('/acceder')`.

### `Activity.jsx` — sección por defecto

**Queries** (`loadData`):
1. `profiles.select('id, full_name, avatar_url').eq('company_id', companyId)`
2. `habits.select('id').eq('company_id', companyId).eq('is_active', true)` (solo hábitos activos)
3. `habit_assignments.select('habit_id, user_id').in('habit_id', habitIds)`
4. `habit_logs.select('id, habit_id, user_id, photo_url, status, created_at').in('user_id', memberIds).gte('created_at', <hace 30 días>)` — ventana de 30 días
5. `habit_validations.select('id, habit_log_id, status').in('habit_log_id', logIds).in('status', ['pending','validated'])`

Sin RPCs.

**Métricas calculadas en cliente:**
- `completedToday` — logs con `created_at` de hoy (medianoche local)
- `weeklyCompliance` — `round(logs-únicos-por-día-y-usuario-esta-semana / (asignaciones-totales × días-transcurridos-de-la-semana) × 100)`, 0 si no hay asignaciones
- `pendingCount` — de la query de validaciones
- Por miembro: `streak` (racha diaria consecutiva, `calculateStreak`), `dots` (7 puntos L-D vía `getWeekDots`: `validated` si el log de ese día está en `validatedLogIds`, `pending` si hay log sin validar, `none` si no hay log)
- `inactive` = más de 3 días sin actividad → borde naranja + badge "Sin actividad"
- `lastActivity` — texto relativo ("Hace X min/horas/días")

**Colores de los dots/calendario** (mismo esquema reutilizado en `MemberDetail`): `validated` → `#22C55E`, `pending` → `#F59E0B`, `none` → `#E5E7EB`.

**Interacción:** click en una tarjeta de miembro → `navigate('/admin/miembro/' + member.id)`. Cada tarjeta muestra avatar/inicial, nombre, badge "Sin actividad" si inactivo, racha 🔥, thumbnail de última foto si existe, "X de Y completados hoy", fila de 7 dots con etiquetas L M X J V S D, última actividad.

3 tarjetas de métrica arriba: "Completados hoy", "Cumplimiento semanal" (%), "Validaciones pendientes".

### `Members.jsx`

**Queries:**
- `profiles.select('id, full_name, email, role, created_at').eq('company_id', companyId).order('created_at')`
- `activation_codes.select('id, full_name, email, code, created_at, expires_at').eq('company_id', companyId).eq('used', false).order('created_at', {ascending:false})`

**Mutaciones:**
- **Añadir miembro:** valida nombre+email no vacíos → `supabase.rpc('check_member_limit', { p_company_id: companyId })`. Si `limitOk === false` → error "Has alcanzado el límite de miembros de tu plan actual", no se crea nada. Si ok: genera código de 6 dígitos (`Math.floor(100000 + Math.random()*900000)`) → INSERT en `activation_codes` (email en minúsculas/trim, nombre trim). Muestra el código con botón copiar (`navigator.clipboard.writeText`).
- **Eliminar miembro:** `window.confirm` → `supabase.rpc('delete_member', { member_id: member.id })` — único camino de borrado, sin `.delete()` directo sobre `profiles` (presumiblemente para hacer limpieza en cascada server-side).
- **Cambiar rol:** `profiles.update({ role: newRole }).eq('id', member.id)` directo, sin RPC.
  - **Restricción "no dejar el grupo sin admin"** (chequeo cliente, no constraint de DB):
    ```js
    if (member.role === 'admin' && newRole !== 'admin') {
      const adminCount = members.filter((m) => m.role === 'admin').length;
      if (adminCount <= 1) {
        alert('Debe haber al menos un administrador en el grupo.');
        return;
      }
    }
    ```
- **Cancelar invitación pendiente:** `window.confirm` → `activation_codes.delete().eq('id', invite.id)` directo.

Modal "Añadir miembro": campos Nombre completo / Email (sin validación de formato más allá de no-vacío), tras generar el código pasa a una segunda vista con el código y botón "Copiar"/"Listo".

Tabla "Miembros activos": Nombre, Email (oculto en pantallas pequeñas), Rol (badge de solo lectura en la propia fila del admin, `<select>` Miembro/Administrador en el resto), Registro, Eliminar (oculto en la propia fila, muestra "Tú").

Tabla "Invitaciones pendientes": Nombre, Email, Código (monospace), Creado, Expira, Cancelar.

### `Habits.jsx` (el componente admin más grande, ~830 líneas)

**Queries** (`Promise.all`, con una ineficiencia real: las queries de asignados y validadores vuelven a pedir los ids de hábitos en vez de reutilizar la query principal — dos round-trips extra):
1. `habits.select('id, title, description, recurrence, weekly_target, is_active, created_at, category_id, photo_required, due_time, expires_at').eq('company_id', companyId).order('created_at', {ascending:false})`
2. `categories.select('id, name, icon, color').or('company_id.is.null,company_id.eq.' + companyId)` — predefinidas + propias en una sola query
3. `profiles.select('id, full_name, avatar_url').eq('company_id', companyId).order('full_name')`
4. `habit_assignments.select('habit_id, user_id').in('habit_id', <ids re-consultados>)`
5. `habit_validators.select('habit_id, user_id').in('habit_id', <ids re-consultados>)`

**Toggle activo/inactivo:** actualización optimista + `habits.update({ is_active }).eq('id', habit.id)`, revierte y muestra `alert()` en error.

**Eliminar:** `window.confirm` (avisa que se borran logs y validaciones asociados) → `habits.delete().eq('id', habit.id)` (confía en el CASCADE de la DB, no hace deletes explícitos de tablas hijas).

**Crear hábito:**
- Validación cliente: título obligatorio, al menos un asignado.
- `supabase.rpc('check_habit_limit', { p_company_id: companyId })` antes de insertar. Si `limitOk === false` → error "Has alcanzado el límite de hábitos activos de tu plan actual", no se crea nada.
- INSERT en `habits` (título, descripción, recurrencia, `weekly_target` solo si `weekly_x`, `category_id` o null, `photo_required`, `due_time` solo si `daily` y con valor, `expires_at` calculado solo si `once`).
- En paralelo: INSERT en `habit_assignments`, `habit_validators`, `habit_rewards` (solo si hay elementos respectivamente).

**Editar hábito:** misma validación, **sin** llamada a `check_habit_limit` (el límite solo se comprueba al crear). Patrón "borrar todo y reinsertar": DELETE + INSERT de `habit_assignments`, `habit_validators`, `habit_rewards`. Al abrir el modal de edición hace fetch adicional de los asignados/validadores/recompensas actuales del hábito (si falla, el formulario simplemente arranca vacío — fallo no crítico, comentado en el código).

**Modal crear/editar — campos:**
- Título (obligatorio), Descripción (opcional)
- Recurrencia: Diario / X veces por semana / Una vez
- Condicional según recurrencia: `weekly_x` → stepper "Objetivo semanal" (1–7); `daily` → "Hora límite" opcional; `once` → "Fecha límite" + "Hora" (23:59 por defecto si se deja vacía)
- Categoría: select con "Sin categoría" + todas las categorías (sin mostrar color en el select)
- "Foto obligatoria": toggle, default `true`
- "Asignar a": checkboxes de miembros, obligatorio al menos uno; un miembro marcado como asignado no puede marcarse también como validador (mutuamente excluyente, se desmarca automáticamente del otro)
- "Validadores": checkboxes de miembros, deshabilitados (visual + lógicamente) para quien ya esté asignado
- **Recompensas:** lista editable "🎯 X días → descripción" con botón quitar; formulario inline "+ Añadir recompensa" (número de días ≥1 + descripción)

Tabla de hábitos: Título (click abre editar) + descripción, Categoría (punto de color + nombre), Recurrencia, Asignados/Validadores (`AvatarStack`, hasta 4 avatares + "+N"), Estado (toggle), Eliminar.

### `Categories.jsx`

**Queries:** predefinidas (`categories` con `company_id IS NULL`) y propias (`company_id = companyId`), ambas ordenadas por nombre.

**Crear:** valida nombre no vacío → INSERT en `categories` (`name, icon, color, company_id`).
**Eliminar:** `window.confirm` → `categories.delete().eq('id', cat.id)`, solo disponible para categorías propias (las predefinidas se muestran en tabla de solo lectura).

**8 colores predefinidos:** `#4CAF50, #F44336, #FF9800, #2196F3, #9C27B0, #00BCD4, #009688, #9E9E9E`

**15 iconos disponibles:** `fitness-outline` (Ejercicio), `medical-outline` (Salud), `restaurant-outline` (Alimentación), `book-outline` (Lectura), `moon-outline` (Descanso), `calendar-outline` (Planificación), `water-outline` (Hidratación), `home-outline` (Hogar), `heart-outline` (Bienestar), `star-outline` (Meta), `bicycle-outline` (Ciclismo), `walk-outline` (Caminar), `barbell-outline` (Pesas), `school-outline` (Educación), `ellipsis-horizontal-outline` (Otro, icono por defecto)

Color por defecto de categoría nueva: `#4CAF50`. Modal con preview en vivo (inicial del nombre sobre el color elegido).

### `MemberDetail.jsx` (`/admin/miembro/:userId`)

Mismo patrón de verificación de sesión/rol que `Admin.jsx`. **No comprueba que el `userId` de la ruta pertenezca a la misma empresa que el admin logueado** — no hay cross-check de `company_id` en este fichero.

**Queries:**
1. `profiles.select('id, full_name, email, avatar_url, created_at').eq('id', userId).single()`
2. `habit_assignments.select('habit_id').eq('user_id', userId)`
3. `habits.select('id, title, recurrence, weekly_target, category_id, expires_at').in('id', habitIds)`
4. `categories.select('id, name, icon, color')` (todas, sin filtro, para enriquecer los hábitos)
5. `habit_logs.select('id, habit_id, photo_url, status, created_at').eq('user_id', userId).order('created_at', {ascending:false})`
6. `habit_rewards.select('habit_id, streak_target, description').in('habit_id', habitIds).order('streak_target')`
7. `habit_validations.select('id, habit_log_id, validator_id, status, reaction, comment, created_at').in('habit_log_id', logIds).order('created_at', {ascending:false})` — últimas validaciones
8. `profiles.select('id, full_name').in('id', validatorIds)` — nombres de validadores

**`HabitCalendar`** (componente interno, props `logs`, `habitId`, `validatedLogIds`): calendario mensual navegable (mes/año en estado, `next()` bloqueado más allá del mes actual real), grid de lunes a domingo. Mismo esquema de color que Activity: `validated` `#22C55E`, `pending` `#F59E0B`, `none` `#E5E7EB`, con leyenda debajo.

**Rachas:**
- Hábitos `daily`/`once`: `calculateStreak` (misma lógica que Activity.jsx)
- Hábitos `weekly_x`: `calculateWeeklyStreakForMember` — semanas ISO consecutivas (clave por lunes) donde el conteo de esa semana ≥ `weeklyTarget`
- **Racha del header** (tarjeta de perfil superior): recalculada inline de forma independiente sobre todos los logs sin filtrar por hábito — lógica duplicada, no reutiliza `calculateStreak`

**Lightbox:** click en cualquiera de las últimas 3 fotos de un hábito → overlay fijo oscuro a pantalla completa, cierra al pulsar fuera de la imagen.

**Sección de recompensas** (🏆/🎯, solo si el hábito tiene recompensas): `calculateTotalCompleted` (días únicos para `daily`/`once`, semanas con count≥target para `weekly_x`) → `timesAchieved = floor(total/streak_target)`, `daysToNext = streak_target - (total % streak_target)`. Conseguidas → píldora verde "🏆 {descripción} · ×N conseguida(s)"; la siguiente no conseguida → píldora gris "🎯 A X días de: {descripción}".

Otros detalles: hábitos `once` muestran "Completado ✓ {fecha}" / "Pendiente" con fecha límite opcional en vez de calendario; hasta 3 fotos recientes por hábito; `completionRate = round(logs / max(1, días desde alta) × 100)` (no limitado a 100, puede superar el 100% en hábitos con varios logs por día o `weekly_x`); "Últimas validaciones recibidas" muestra hasta 10, con hábito, validador, reacción y comentario opcionales, tiempo relativo.

## RPCs usadas en el panel web

| RPC | Llamada desde | Detalle técnico |
|---|---|---|
| `check_habit_limit(p_company_id)` | `Habits.jsx` (crear hábito, no en editar) | [database.md](database.md) |
| `check_member_limit(p_company_id)` | `Members.jsx` (añadir miembro) | [database.md](database.md) |
| `delete_member(member_id)` | `Members.jsx` (eliminar miembro) | [database.md](database.md) |

Son las únicas 3 llamadas RPC en todo el repo web.

## Tablas Supabase referenciadas desde el web

`activation_codes`, `categories`, `companies`, `habit_assignments`, `habit_logs`, `habit_rewards`, `habit_validations`, `habit_validators`, `habits`, `profiles` — mismo esquema que la app móvil, ver [database.md](database.md).

## Código de colores (círculos y calendario)

- Gris `#E5E7EB` = sin actividad
- Amarillo `#F59E0B` = log registrado pero sin validación `validated`
- Verde `#22C55E` = log con al menos una validación `validated`

Mismo esquema reutilizado en `Activity.jsx` (dots semanales) y `MemberDetail.jsx` (calendario mensual).

## Decisiones técnicas y observaciones

| Observación | Detalle |
|---|---|
| Navegación inconsistente tras login | `Acceder.jsx` usa `window.location.href = '/admin'` (recarga dura) mientras el resto del panel usa `navigate()` de React Router |
| `MemberDetail.jsx` sin verificación de empresa | La ruta `/admin/miembro/:userId` no comprueba que el miembro pertenezca a la empresa del admin logueado — solo verifica que quien accede sea admin de *alguna* empresa. Cualquier admin autenticado podría ver el detalle de un miembro de otra empresa si conoce/adivina su `userId` |
| Restricción "no dejar el grupo sin admin" solo en cliente | El chequeo en `Members.jsx` se hace contando `members` ya cargados en el estado local; no hay constraint equivalente a nivel de base de datos |
| `check_habit_limit` solo en creación | Editar un hábito existente no vuelve a comprobar el límite de plan (tiene sentido: editar no aumenta el conteo de hábitos activos, salvo que se reactive uno inactivo vía el toggle, que tampoco pasa por esta RPC) |
| Queries redundantes en `Habits.jsx` | Las queries de `habit_assignments` y `habit_validators` vuelven a pedir los ids de hábitos en vez de reutilizar los ya obtenidos en la query principal — dos round-trips de más |
| Racha del header duplicada en `MemberDetail.jsx` | La racha general mostrada en la tarjeta de perfil se recalcula con una lógica inline independiente, en vez de reutilizar `calculateStreak` |
| Páginas legales no usan `locales/*.json` | El contenido de Privacy/Terms/Cookies vive hardcodeado en un objeto `CONTENT` por fichero, no en las claves de i18n |

## Estado actual

En producción en habitteam.app. Landing page completa con banner de lista de espera, copy familiar y modelo de precios. Panel de administración en `/admin` con sección Actividad (dashboard del grupo con código de colores gris/amarillo/verde), detalle de miembro con calendario mensual navegable, y gestión de miembros, hábitos y categorías. Login funcional con Supabase Auth restringido a admins. Despliegue en Vercel, dominio en Namecheap.
