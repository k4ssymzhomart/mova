-- 0020_auth_profile_metadata.sql
-- Pull the patient's name + avatar out of the identity metadata. Google (and most OAuth providers)
-- populate auth.users.raw_user_meta_data with full_name/name, given_name and picture/avatar_url. The
-- prior handle_new_user only stored the email, so the UI couldn't greet the patient by name. This
-- redefines the trigger to persist full_name, a display_name (first name, for greetings) and avatar_url,
-- and backfills profiles that already exist.

create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role   public.app_role := coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'patient');
  v_full   text := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');
  v_given  text := new.raw_user_meta_data ->> 'given_name';
  v_avatar text := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
begin
  insert into public.profiles (id, email, full_name, display_name, avatar_url, role, clinic_id)
  values (
    new.id,
    new.email,
    v_full,
    coalesce(v_given, nullif(split_part(coalesce(v_full, new.email), ' ', 1), '')),
    v_avatar,
    v_role,
    case when v_role = 'patient' then '00000000-0000-0000-0000-0000000000a1'::uuid else null end
  )
  on conflict (id) do update set
    email        = excluded.email,
    full_name    = coalesce(public.profiles.full_name, excluded.full_name),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url   = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;
comment on function app.handle_new_user() is
  'AFTER INSERT on auth.users: create/patch the profile with name + avatar from identity metadata; patients join the Mova Personal clinic.';

-- One-time backfill for users that signed up before this migration.
update public.profiles p set
  full_name = coalesce(
    p.full_name,
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name'
  ),
  display_name = coalesce(
    p.display_name,
    u.raw_user_meta_data ->> 'given_name',
    nullif(split_part(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', p.email::text), ' ', 1), '')
  ),
  avatar_url = coalesce(
    p.avatar_url,
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture'
  )
from auth.users u
where u.id = p.id
  and (p.full_name is null or p.display_name is null or p.avatar_url is null);
