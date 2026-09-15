-- 0035_signup_role_hotfix.sql
-- Security hotfix, applied to the hosted project ahead of the migrations numbered before it.
--
-- handle_new_user (last defined in 0020) took the new account's role from raw_user_meta_data. That is whatever
-- the browser passes as options.data to /auth/v1/signup, so anyone with a mailbox could sign up as 'admin' with the
-- public anon key, and app.is_admin() then opens every per-patient row. Every signup now becomes a patient in the
-- Mova Personal clinic. Clinician, clinic_admin and admin roles are granted only by a trusted context (the service
-- role or a platform admin), which app.enforce_profile_guard already allows and nothing else does.
--
-- Everything else the 0020 trigger does (name, display name, avatar from identity metadata) is unchanged.

create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
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
    'patient',
    '00000000-0000-0000-0000-0000000000a1'::uuid
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
  'AFTER INSERT on auth.users: create/patch the profile with name + avatar from identity metadata. Every signup is a patient in the Mova Personal clinic; the role never comes from signup metadata.';
