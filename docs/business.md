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
- `check_habit_limit(p_company_id)` → boolean: comprueba si el grupo puede crear un hábito activo más
- `check_member_limit(p_company_id)` → boolean: comprueba si el grupo puede añadir un miembro más
- `get_company_plan_info(p_company_id)` → devuelve plan, history_days, advanced_stats, max_members, max_active_habits del grupo

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
- `history_days` y `advanced_stats`: filtros de UI/queries en cliente usando hook `lib/usePlanInfo.js`
