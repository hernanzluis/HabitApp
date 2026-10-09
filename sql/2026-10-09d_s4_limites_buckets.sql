-- =============================================================================
-- S4 (auditoría 2026-10-09): límites de tamaño y de tipo en los buckets.
-- Fecha: 2026-10-09. Aprobado por Luis.
--
-- Sin límites, cualquier usuario podía subir hasta 50 MB por fichero (límite
-- del plan) y de cualquier tipo, y llenar el 1 GB del plan gratuito.
-- Medido el 2026-10-09: 12 fotos reales, todas image/jpeg, máximo 467 kB,
-- media 232 kB. El selector comprime (calidad 0,7-0,8) pero no redimensiona;
-- los avatares se suben siempre como image/jpeg y las fotos de hábito con el
-- tipo que devuelve el selector (image/jpeg por defecto).
-- Límites con margen amplio sobre lo real (unas 20 veces el máximo medido):
--   habit-photos: 10 MB; avatars: 5 MB; solo imágenes jpeg/png/webp/heic/heif.
-- Solo afecta a subidas nuevas; ningún fichero actual los supera.
-- =============================================================================

update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
 where id = 'habit-photos';

update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
 where id = 'avatars';

-- Comprobación (solo lectura)
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;
