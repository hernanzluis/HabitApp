-- =============================================================================
-- APLICADO el 2026-09-30 con aprobación expresa de Luis (verificado en el
-- catálogo). Una persona no puede ser a la vez asignada y
-- validadora del mismo hábito (nadie podría validar sus logs: la pantalla
-- Validar excluye los logs propios, y el fallback del admin solo cubre
-- hábitos sin ningún validador).
-- Fecha: 2026-09-30. Caso real: "Comer todos los dias fruta" (Lucia asignada
-- y validadora), creado desde AdminScreen, que no impedía marcar a la misma
-- persona en las dos listas.
--
-- Por qué triggers y no un CHECK/UNIQUE: la regla cruza dos tablas
-- (habit_assignments y habit_validators). Un trigger BEFORE INSERT OR UPDATE
-- en cada una rechaza el alta si el mismo (habit_id, user_id) ya está en la
-- otra, en cualquier orden y también al editar.
--
-- - SECURITY DEFINER: la comprobación debe ver la otra tabla completa, sin
--   depender de lo que RLS deje leer a quien inserta.
-- - pg_advisory_xact_lock por (habit_id, user_id): dos altas simultáneas en
--   las dos tablas para la misma pareja se serializan; la segunda ve la
--   primera y se rechaza.
-- - ERRCODE check_violation (23514) y un mensaje legible: la build actual de
--   la app (sin el arreglo de UI) lo mostraría tal cual al admin.
--
-- Estado comprobado el 2026-09-30: 0 filas violan la regla (el único caso
-- real ya lo corrigió Luis), así que los triggers se crean sin conflicto.
-- =============================================================================

begin;

create function public.prevent_assignee_as_validator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_other_table text;
  v_conflict boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.habit_id::text || ':' || new.user_id::text, 0));

  if tg_table_name = 'habit_assignments' then
    v_other_table := 'habit_validators';
    select exists (select 1 from habit_validators v where v.habit_id = new.habit_id and v.user_id = new.user_id)
      into v_conflict;
  else
    v_other_table := 'habit_assignments';
    select exists (select 1 from habit_assignments a where a.habit_id = new.habit_id and a.user_id = new.user_id)
      into v_conflict;
  end if;

  if v_conflict then
    raise exception using
      errcode = 'check_violation',
      message = 'Una misma persona no puede estar asignada a un hábito y ser también su validadora',
      detail = format('assignee_is_validator: habit_id=%s user_id=%s ya está en %s', new.habit_id, new.user_id, v_other_table);
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_assignee_as_validator() from public, anon, authenticated;

create trigger habit_assignments_not_validator
  before insert or update of habit_id, user_id on public.habit_assignments
  for each row execute function public.prevent_assignee_as_validator();

create trigger habit_validators_not_assignee
  before insert or update of habit_id, user_id on public.habit_validators
  for each row execute function public.prevent_assignee_as_validator();

commit;

-- Comprobación (solo lectura): 0 filas que violen la regla y los dos triggers.
select count(*) as solapes
  from habit_assignments a
  join habit_validators v on v.habit_id = a.habit_id and v.user_id = a.user_id;
select event_object_table, trigger_name
  from information_schema.triggers
 where trigger_name in ('habit_assignments_not_validator', 'habit_validators_not_assignee');
