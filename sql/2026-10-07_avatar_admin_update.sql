-- =============================================================================
-- Avatar de un miembro reemplazado por el admin de su empresa.
-- Fecha: 2026-10-07. Aprobado por Luis en el chat. Sin begin/commit: se
-- ensaya con scripts/sql-ensayo.sh y se aplica con scripts/sql-aplica.sh.
--
-- AdminScreen sube el avatar a avatars/<id del miembro>/avatar.jpg con
-- upsert: true. Si el fichero ya existe, Storage lo trata como UPDATE, y el
-- admin solo tenía política de INSERT ("admins can upload avatar for own
-- company member"): el reemplazo fallaba con "new row violates row-level
-- security policy" (403). Esta política es su espejo para UPDATE, con la
-- misma condición en USING y en WITH CHECK (no permite mover el fichero a
-- la carpeta de alguien de otra empresa). No da permiso de DELETE.
-- =============================================================================

create policy "admins can update avatar for own company member" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and public.is_admin() and exists (
           select 1 from public.profiles p
            where p.id::text = (storage.foldername(name))[1]
              and p.company_id = public.my_company_id()))
  with check (bucket_id = 'avatars' and public.is_admin() and exists (
           select 1 from public.profiles p
            where p.id::text = (storage.foldername(name))[1]
              and p.company_id = public.my_company_id()));

-- Comprobación (solo lectura)
select policyname, cmd, roles from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (qual ilike '%avatars%' or with_check ilike '%avatars%')
 order by cmd, policyname;
