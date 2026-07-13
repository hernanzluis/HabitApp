# Producto web — HabitTeam.app

**Repositorio web:** habitteam-web (proyecto separado, mismo Supabase) — https://github.com/hernanzluis/habitteam-web
**Directorio local:** /Users/luishernanz/habitteam-web
**Dominio:** habitteam.app (registrado en Namecheap)
**Stack web:** React + React Router v7 + Tailwind CSS v3 + @supabase/supabase-js
**Despliegue:** Vercel (gratuito), automático tras push a la rama principal

## Stack tecnológico

| Tecnología | Versión |
|---|---|
| React | ^19.2.6 |
| React DOM | ^19.2.6 |
| react-router-dom | ^7.16.0 |
| tailwindcss | ^3.4.19 |
| @supabase/supabase-js | — |

## Rutas

Entrada: `src/App.js` — `BrowserRouter` con `ScrollToTop`.

- `/` → `Home.jsx` (página pública)
- `/acceder` → `Acceder.jsx` (login admin web)
- `/admin` → `Admin.jsx` (panel admin)
- `/admin/miembro/:userId` → `MemberDetail.jsx` (detalle de miembro)
- `/privacidad` → `Privacy.jsx`
- `/terminos` → `Terms.jsx`
- `/cookies` → `Cookies.jsx`

## Página corporativa (pública)

- Hero con titular impactante, mensaje cercano no corporativo y enfoque familiar
- Sección Cómo funciona (3 pasos: crear grupo → completar hábitos con foto → validar entre miembros)
- Sección Características (8 features alineadas con la app)
- Sección Precios (3 planes: Familiar / Plus / Empresa — ver [business.md](business.md))
- CTA final + Footer
- Banner fijo encima del Nav: "Producto en desarrollo — Únete a la lista de espera" con enlace `mailto:hernanz.luis@gmail.com`. `z-[60]`, Nav desplazado a `top-[40px]`
- Título de pestaña del navegador: "HabitTeam" (index.html)
- Logo "HabitTeam" enlazado a `/` en todas las páginas (Nav con `<Link>` + scroll al top, Admin y MemberDetail con `<a href="/">`)

## Panel de administración (privado, `/admin`)

- Login con Supabase Auth restringido a usuarios con `role = 'admin'`
- Protección de ruta: verificación de sesión y rol al montar, redirige a `/acceder` si no autorizado
- Sidebar en desktop, tabs en móvil
- `Admin.jsx` carga el perfil del usuario y monta 4 tabs: Actividad, Miembros, Hábitos, Categorías

### Componentes (src/components/admin/)

- **`Activity.jsx`** — sección por defecto: 3 métricas (completados hoy, cumplimiento semanal %, validaciones pendientes); grid de tarjetas por miembro con avatar, racha general, X/Y completados hoy, 7 círculos L-D con tres estados de color, thumbnail foto reciente, última actividad, borde naranja si >3 días sin actividad; click en tarjeta navega a detalle de miembro
- **`Members.jsx`** — tabla de miembros activos con selector de rol inline (Miembro/Administrador) excepto para el propio admin; tabla de invitaciones pendientes con código en monospace; modal "+ Añadir miembro" que genera código de activación de 6 dígitos con botón copiar; restricción: no se puede dejar el grupo sin administrador
- **`Habits.jsx`** — tabla con categoría (punto de color), título, recurrencia, avatares de asignados y validadores, toggle activo/inactivo con actualización optimista; click en título abre modal de edición completo (campos + asignados + validadores precargados); modal "+ Nuevo hábito" con todos los campos de la app móvil (título, descripción, recurrencia, weekly_target, hora límite, fecha expiración, categoría, foto obligatoria, asignados, validadores). Props: `companyId`, `adminId`
- **`Categories.jsx`** — tabla de categorías personalizadas del grupo con botón eliminar; tabla de categorías predefinidas del sistema (solo lectura); modal "+ Nueva categoría" con selector de color (8 colores) y selector de icono (15 opciones en texto) con preview en tiempo real

### `MemberDetail.jsx`

Vista detallada de un miembro (`/admin/miembro/:userId`): perfil, calendario mensual navegable con tres estados de color, racha individual por hábito, últimas 3 fotos con lightbox, últimas 10 validaciones recibidas con validador/reaction/comentario. También incluye una **sección de recompensas/rachas por hábito** (🏆 con `timesAchieved`), usando la misma tabla `habit_rewards` que la app móvil — ver [database.md](database.md).

> **Nota i18n:** a diferencia de las páginas públicas (Home, Nav) y las legales, los componentes del panel admin (`Admin.jsx`, `Activity.jsx`, `Members.jsx`, `Habits.jsx`, `Categories.jsx`, `Acceder.jsx`, `MemberDetail.jsx`) usan strings en español **hardcodeados sin i18n** (`useTranslation()`). Ver [i18n.md](i18n.md).

### Código de colores (círculos y calendario)

- Gris (#E5E7EB / #EEEEEE) = sin actividad
- Amarillo (#F59E0B) = log registrado pero sin validación `validated`
- Verde (#22C55E / #4CAF50) = log con al menos una validación `validated`

## Estado actual

En producción en habitteam.app. Landing page completa con banner de lista de espera, copy familiar y modelo de precios. Panel de administración en `/admin` con sección Actividad (dashboard del grupo con código de colores gris/amarillo/verde), detalle de miembro con calendario mensual navegable, y gestión de miembros, hábitos y categorías. Login funcional con Supabase Auth restringido a admins. Despliegue en Vercel, dominio en Namecheap.
