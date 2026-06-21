-- 0009_content.sql
-- Content + research + ML registry. These back the public Model/Datasets/Benchmark/
-- Research/Docs pages and the patient Learn hub (Phase 8). Published rows are
-- world-readable; everything else is admin-only.

-- Content (papers / model cards / dataset cards / docs / articles) ------------
create table public.content (
  id           uuid primary key default gen_random_uuid(),
  slug         extensions.citext unique not null,
  kind         public.content_kind not null,
  title        text not null,
  summary      text,
  body_mdx     text,
  status       public.content_status not null default 'draft',
  locale       text not null default 'en' check (locale in ('en', 'ru', 'kk')),
  meta         jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.content is 'Reading-layout content: papers, model/dataset cards, docs, articles (Phase 8).';
create index content_kind_idx on public.content (kind);
create index content_status_idx on public.content (status);
create index content_title_trgm_idx on public.content using gin (title extensions.gin_trgm_ops);

-- Citations (Part 6 `references`, renamed to avoid the SQL reserved word) -----
create table public.citations (
  id         uuid primary key default gen_random_uuid(),
  cite_key   extensions.citext unique not null,  -- BibTeX key
  entry_type text,                                -- article, inproceedings, ...
  title      text not null,
  authors    text,
  year       integer,
  venue      text,
  doi        text,
  url        text,
  bibtex     text,      -- raw BibTeX; never host the PDF (link only)
  abstract   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.citations is 'Fulfils Part 6 `references` (BibTeX). Cite + link + summarize; never host copyrighted PDFs.';

-- Model registry -------------------------------------------------------------
create table public.model_registry (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  version     text not null,
  task        public.inference_task,
  framework   text,         -- onnx | torch | ...
  artifact_uri text,        -- storage path / object key
  params      jsonb not null default '{}'::jsonb,
  metrics     jsonb not null default '{}'::jsonb,  -- snapshot of headline metrics
  git_sha     text,
  status      text not null default 'registered'
              check (status in ('registered', 'staging', 'production', 'archived')),
  notes       text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (name, version)
);
comment on table public.model_registry is 'Versioned model checkpoints + headline metrics; source for the Model page.';

-- Benchmark runs (leaderboard source) ----------------------------------------
create table public.benchmark_runs (
  id          uuid primary key default gen_random_uuid(),
  model_id    uuid references public.model_registry (id) on delete set null,
  task        public.inference_task not null,
  dataset     text not null,
  split       text,      -- e.g. 'subject-disjoint S08', 'LOSO'
  protocol    text,      -- subject-disjoint | LOSO | cross-device | cross-position
  metrics     jsonb not null,  -- {auroc, auprc, sensitivity, specificity, macro_f1, ...}
  is_baseline boolean not null default false,
  git_sha     text,
  notes       text,
  run_at      timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
comment on table public.benchmark_runs is 'Eval-harness results feeding the public Benchmark leaderboard (honest metrics doctrine).';
create index benchmark_runs_task_idx on public.benchmark_runs (task);
create index benchmark_runs_model_idx on public.benchmark_runs (model_id);

create trigger touch_content before update on public.content
  for each row execute function app.touch_updated_at();
create trigger touch_citations before update on public.citations
  for each row execute function app.touch_updated_at();
create trigger touch_model_registry before update on public.model_registry
  for each row execute function app.touch_updated_at();
