-- 0015_auth_hooks.sql
-- (1) Provision a profile for every new auth user.
-- (2) Custom access-token hook injecting app_role + clinic_id into the JWT so clients
--     and Edge Functions read the role without a round-trip. RLS stays authoritative
--     via the app.* helpers; the claim is a convenience/fast-path only.

-- (1) New-user -> profile ----------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'patient')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
comment on function app.handle_new_user() is 'AFTER INSERT on auth.users: create the matching public.profiles row.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- (2) Custom access-token hook ----------------------------------------------
create or replace function app.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  claims   jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_uid    uuid  := (event ->> 'user_id')::uuid;
  v_role   public.app_role;
  v_clinic uuid;
begin
  select role, clinic_id into v_role, v_clinic
  from public.profiles where id = v_uid;

  if v_role is not null then
    claims := jsonb_set(claims, '{app_role}', to_jsonb(v_role::text));
  end if;
  if v_clinic is not null then
    claims := jsonb_set(claims, '{clinic_id}', to_jsonb(v_clinic::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;
comment on function app.custom_access_token_hook(jsonb) is 'Auth hook: add app_role + clinic_id JWT claims.';

-- The auth admin role runs the hook and must read profiles; clients must not call it.
grant usage on schema app to supabase_auth_admin;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;
revoke execute on function app.custom_access_token_hook(jsonb) from authenticated, anon, public;
