-- 0002_schemas_and_enums.sql
-- Private `app` schema (RLS helpers + auth hook; NOT exposed over the API) and the
-- enumerated domains used across the schema. Enums encode the ontologies from
-- docs/MOVA_MASTER_DOCUMENT.md (Parts 1.5, 5, 6) and docs/03_architecture.md.

create schema if not exists app;
comment on schema app is 'Private MOVA helpers: RLS predicates + auth hook. Never exposed via PostgREST.';

-- Identity / access ----------------------------------------------------------
create type public.app_role as enum ('patient', 'clinician', 'clinic_admin', 'admin');
create type public.care_relationship as enum ('primary', 'secondary', 'consulting');

-- Clinical / motion ----------------------------------------------------------
-- Unified body-site ontology (docs/03_architecture.md §2). Drives placement-aware
-- sensor handling and the spider-web overlay.
create type public.body_site as enum (
  'pelvis', 'lower_back', 'sternum', 'head',
  'l_upperarm', 'r_upperarm', 'l_wrist', 'r_wrist',
  'l_thigh', 'r_thigh', 'l_shank', 'r_shank', 'l_foot', 'r_foot',
  'unspecified'
);

-- Exercise packs (ship order per Part 5).
create type public.exercise_modality as enum (
  'upper_limb_reaching', 'hand_grasp', 'head_neck', 'gait_balance', 'sit_to_stand_lower_limb'
);
create type public.difficulty_level as enum ('intro', 'easy', 'moderate', 'hard', 'expert');

create type public.prescription_status as enum ('draft', 'active', 'paused', 'completed', 'cancelled');
create type public.goal_status as enum ('active', 'met', 'missed', 'revised');
create type public.session_status as enum ('scheduled', 'in_progress', 'completed', 'aborted', 'reviewed');
-- Window-level model output vs clinician-facing smoothed episode (Part 1.4.2).
create type public.fog_event_kind as enum ('window', 'episode');

-- Consent / compliance -------------------------------------------------------
create type public.consent_type as enum ('data_processing', 'camera', 'data_sharing', 'research');
create type public.consent_status as enum ('granted', 'denied', 'revoked');

-- Engagement / comms ---------------------------------------------------------
create type public.message_kind as enum ('text', 'system', 'attachment', 'visit_invite');
create type public.notification_type as enum (
  'reminder', 'achievement', 'message', 'schedule_change', 'clinical_alert', 'system'
);

-- Content / registry (Phase 8 surfaces) --------------------------------------
create type public.content_kind as enum ('paper', 'model_card', 'dataset_card', 'doc', 'article');
create type public.content_status as enum ('draft', 'published', 'archived');

-- Inference contract (Supabase <-> Python service) ---------------------------
create type public.inference_task as enum ('fog', 'har', 'movement_quality', 'joint_angle', 'pose');
create type public.inference_status as enum ('queued', 'running', 'succeeded', 'failed');

-- Audit ----------------------------------------------------------------------
create type public.audit_action as enum ('insert', 'update', 'delete');
