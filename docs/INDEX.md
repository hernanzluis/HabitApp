# HabitApp — Índice de documentación

La documentación del proyecto vive en `docs/`, dividida por tema. Cubre tanto la app móvil (HabitApp, este repo) como el producto web (habitteam-web, repo separado).

| Fichero | Contenido | Cuándo consultarlo |
|---|---|---|
| [project.md](project.md) | Visión general, perfil de usuario, stack de la app móvil, configuración de entorno (Supabase), comandos, estructura de carpetas, decisiones técnicas, convenciones de código, funcionalidades pendientes (v2), usuarios de prueba | Para entender qué es HabitApp y el contexto general antes de tocar cualquier otra cosa; para arrancarla en local |
| [database.md](database.md) | Esquema completo de tablas de Supabase, RPCs (SECURITY DEFINER), políticas RLS, buckets de Storage, índices, helpers de fechas/cálculo, sistema de recompensas | Antes de crear o modificar tablas, políticas RLS, RPCs, o de implementar lógica que dependa de rachas/recompensas/fechas |
| [navigation.md](navigation.md) | Estructura de navegación (RootNavigator, TabNavigator) y descripción pantalla a pantalla de la app móvil: queries, lógica, interacciones de UI | Antes de añadir o modificar una pantalla de la app móvil, o para entender el flujo entre ellas |
| [design.md](design.md) | Sistema de colores y componentes UI compartidos (botones, separadores, secciones) de la app móvil | Al escribir estilos nuevos en la app móvil, para mantener consistencia visual |
| [business.md](business.md) | Planes de precios, público objetivo, esquema de `plan_limits` y su enforcement (RPCs, campos añadidos a `companies`) | Antes de tocar lógica de límites de plan, precios, o integración de facturación (Stripe, pendiente) |
| [workflow.md](workflow.md) | Proceso de trabajo entre Luis, Claude y Code: quién hace qué, cuándo interviene Luis manualmente en Supabase, formato de los prompts | Al planificar cómo se va a ejecutar una tarea, o si hay dudas sobre quién debe dar cada paso |
| [i18n.md](i18n.md) | Configuración i18n de la app móvil (namespaces, claves de locales) y mención del i18n del producto web | Al añadir textos nuevos o tocar la lógica de idioma en cualquiera de los dos productos |
| [web.md](web.md) | Stack, rutas, y descripción detallada componente a componente del producto web habitteam-web (landing pública y panel de administración) | Antes de tocar cualquier fichero del repo habitteam-web |
