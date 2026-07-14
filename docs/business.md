# HabitTeam — Modelo de negocio

## Planes y precios

- **Plan Familiar:** gratis hasta 6 miembros, hasta 10 hábitos activos, historial 30 días
- **Plan Plus:** 4€/mes hasta 20 miembros, hábitos ilimitados, historial completo
- **Plan Empresa:** precio a consultar, miembros ilimitados, soporte prioritario

## Público objetivo

- Familias y grupos de amigos como punto de entrada (boca a boca orgánico)
- Equipos pequeños de empresa que entran solos sin proceso comercial
- Estrategia bottom-up: el usuario individual adopta el producto y lo lleva a su entorno

## Límites por plan (`plan_limits`)

Tabla en Supabase que centraliza los límites de cada plan. Es la única fuente de verdad — ni la app ni la web tienen estos valores hardcodeados.

| Campo | Tipo | Notas |
|---|---|---|
| plan | text | PK — 'familiar', 'plus', 'empresa' |
| max_members | integer | null = sin límite |
| max_active_habits | integer | null = sin límite |
| history_days | integer | null = sin límite |
| advanced_stats | boolean | false en familiar, true en plus y empresa |

Valores actuales:
| plan | max_members | max_active_habits | history_days | advanced_stats |
|---|---|---|---|---|
| familiar | 6 | 10 | 30 | false |
| plus | 20 | null | null | true |
| empresa | null | null | null | true |

### RPCs relacionadas

Ver detalle técnico (parámetros, dónde se llaman) en [database.md](database.md#funciones-sql-rpcs-security-definer): `check_habit_limit`, `check_member_limit`, `get_company_plan_info`.

### Campos añadidos a `companies`
| Campo | Tipo | Default | Notas |
|---|---|---|---|
| plan | text | 'familiar' | 'familiar', 'plus' o 'empresa' |
| subscription_status | text | 'active' | 'active', 'past_due', 'canceled', 'trialing' |
| stripe_customer_id | text | null | Pendiente de integración Stripe |
| stripe_subscription_id | text | null | Pendiente de integración Stripe |
| plan_renews_at | timestamptz | null | Pendiente de integración Stripe |

### Enforcement
- Crear hábito: `check_habit_limit` llamado en AdminScreen (app) y Habits.jsx (web) antes del INSERT
- Generar código de activación: `check_member_limit` llamado en AdminScreen (app) y Members.jsx (web) antes de generar
- Activar cuenta: `handle_activation_registration` llama a `check_member_limit` como red de seguridad server-side
- `history_days`: filtro de UI/queries en cliente usando hook `lib/usePlanInfo.js` (confirmado en uso real en `ProfileScreen.js` y `HabitStatsScreen.js`)
- `advanced_stats`: el hook `lib/usePlanInfo.js` lo expone (`advancedStats`), pero no se encontró ningún consumo condicional real en ninguna pantalla todavía — está declarado pero pendiente de implementar

## Decisiones de producto

- **Lanzamiento gratuito:** el producto sale al mercado con todos los grupos en plan 'familiar' gratis. No hay cobro en el lanzamiento. El modelo de precios está visible en habitteam.app pero sin checkout activo. Objetivo: validar retención real antes de activar el paywall.
- **Stripe solo en web:** cuando se active la monetización, el checkout de Stripe estará únicamente en habitteam.app (panel web). La app móvil no tendrá compras in-app (IAP) para evitar la comisión del 15-30% de Apple/Google y la complejidad de dos sistemas de facturación en paralelo. La app mostrará el plan activo y un CTA que redirige a la web para gestionar la suscripción.
- **Panel admin web es exclusivo del plan Empresa:** MemberDetail.jsx y el panel admin web en general son features solo accesibles para grupos con plan 'empresa'. Los planes 'familiar' y 'plus' gestionan todo desde la app móvil.
- **advanced_stats pendiente de implementar:** el hook usePlanInfo.js expone el campo advancedStats pero ninguna pantalla lo consume condicionalmente todavía. La UI de estadísticas avanzadas (comparativa entre miembros, tendencias) está pendiente de diseño e implementación.
- **Facturación por grupo, no por usuario:** la suscripción cuelga de companies (stripe_customer_id, plan, subscription_status), no de profiles. Cualquier admin del grupo puede gestionar la suscripción desde el Customer Portal de Stripe. El primer admin que hace checkout se convierte en el customer de Stripe para ese grupo.
