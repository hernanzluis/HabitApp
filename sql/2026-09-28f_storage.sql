-- =============================================================================
-- PROPUESTA — NO EJECUTADO. Storage: dos opciones, elegir UNA.
-- Fecha: 2026-09-28. Informe: docs/security-inventory-2026-09-28.md (sección B).
--
-- Hoy (demostrado con datos zztest-):
-- - avatars y habit-photos son buckets PÚBLICOS: cualquiera con la URL
--   descarga el fichero (HTTP 200 sin ninguna cabecera).
-- - Policy SELECT de storage.objects = cualquier autenticado, todo el bucket:
--   un usuario de la empresa B LISTA las carpetas de todos los usuarios y los
--   ficheros de A, y los descarga por la API.
-- - Las rutas son <user_id>/<habit_id>/<timestamp>.jpg y <user_id>/avatar.jpg:
--   predecibles para quien conozca los ids, que hoy salen de habit_logs,
--   habit_assignments, etc. (legibles sin sesión hasta aplicar el fichero e).
-- =============================================================================


-- =============================================================================
-- OPCIÓN 1 (recomendada para la v1) — buckets públicos, sin listado ajeno.
-- Esfuerzo: ~1 h (SQL + prueba manual). Sin cambios en app ni web.
--
-- Cierra: listar y descargar por API ficheros de otras empresas.
-- NO cierra: quien ya tenga una URL la puede abrir para siempre, sin sesión
-- (el bucket sigue siendo público). Con el fichero e aplicado, las URLs dejan
-- de filtrarse por la API; el riesgo que queda es una URL compartida o
-- filtrada por otro canal.
-- =============================================================================
begin;

drop policy if exists "users can read avatars" on storage.objects;
drop policy if exists "users can read habit photos pk3cq_0" on storage.objects;

-- Leer/listar solo carpetas de usuarios de la propia empresa. Cubre también el
-- listado de la propia carpeta que hace ProfileScreen al borrar la cuenta, y
-- el upsert de avatar (propio y el de un miembro por un admin).
create policy "members read own company files" on storage.objects
  for select to authenticated using (
    bucket_id in ('avatars', 'habit-photos')
    and exists (
      select 1 from public.profiles p
       where p.id::text = (storage.foldername(name))[1]
         and p.company_id = public.my_company_id()
    )
  );

commit;


-- =============================================================================
-- OPCIÓN 2 — buckets privados + URLs firmadas.
-- Esfuerzo: 1,5-2,5 días (código + migración de datos + pruebas manuales en
-- app y web). Recomendable para la 1.1.
--
-- Cierra además: nadie abre un fichero sin sesión, y una URL filtrada caduca.
--
-- Cambios de código necesarios (todos los que hoy pintan una URL pública):
--   App:  HomeScreen, RankingScreen, ValidateHabitScreen, HabitStatsScreen
--         (renderizan photo_url/avatar_url), HabitDetailScreen y ProfileScreen
--         (suben y guardan getPublicUrl), AdminScreen (avatar de miembro,
--         getPublicUrl + update_member_avatar), RootNavigator (avatar cabecera).
--   Web:  components/admin/Activity.jsx, components/admin/Habits.jsx,
--         pages/MemberDetail.jsx.
--   Patrón: guardar la RUTA (no la URL) en photo_url/avatar_url, y resolver en
--   cliente con createSignedUrls(rutas, 3600) en lote por pantalla; cuidado con
--   la caché de imágenes de React Native (la URL firmada cambia en cada firma).
--   Datos: migrar las URLs públicas ya guardadas a rutas (UPDATE con
--   regexp_replace), y ajustar profiles_avatar_url_check del fichero c.
--
-- SQL (además de la policy de la opción 1):
--   update storage.buckets set public = false where id in ('avatars', 'habit-photos');
-- =============================================================================


-- =============================================================================
-- Aparte, sea cual sea la opción: ficheros huérfanos.
-- A 2026-09-28 hay 11 carpetas en cada bucket de usuarios que ya NO existen
-- en auth.users (69 fotos de hábitos + 11 avatares), públicas por URL.
-- delete_member / delete_own_account no limpian Storage. Borrarlos es borrar
-- datos: requiere aprobación expresa de Luis y se hace con la API de Storage
-- (storage.from(bucket).remove(paths)), no con DELETE sobre storage.objects,
-- para que se borren también los ficheros físicos.
-- =============================================================================
