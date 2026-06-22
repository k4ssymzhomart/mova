-- 0001_extensions.sql
-- Extensions MOVA relies on. All ship with Supabase Postgres.
-- pgcrypto  -> gen_random_uuid(), crypt() (seed users)
-- citext    -> case-insensitive emails/handles
-- pg_trgm   -> fuzzy patient/exercise search on the clinician portal
-- moddatetime is provided via our own app.touch_updated_at() in 0003.

-- Extensions live in the `extensions` schema, which Supabase keeps on the database
-- search_path. The inline citext UNIQUE indexes rely on that so the citext btree
-- opclass resolves; pg_trgm GIN indexes reference extensions.gin_trgm_ops explicitly.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Time-series note: session_frames uses native declarative partitioning (0006) so
-- the schema applies on any Postgres. Where TimescaleDB is available, the default
-- partition can be promoted with create_hypertable() — see 0006 for the swap point.
