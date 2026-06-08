-- ============================================================
-- SCHÉMA SUPABASE — Jobs Dating (à coller dans SQL Editor)
-- ============================================================

-- TABLE: companies
create table if not exists public.companies (
  id                serial primary key,
  nom               text not null,
  "nomAffichage"    text,
  filiere           text,
  "logoFile"        text,
  website           text,
  domain            text,
  secteur           text,
  tagline           text,
  description       text,
  histoire          text,
  valeurs           jsonb,
  missions          jsonb,
  concurrents       jsonb,
  chiffres_cles     text,
  recrutement       text,
  questions_rh      jsonb,
  questions_op      jsonb,
  contact           text,
  cre               text,
  salle             text,
  etage             text,
  "addedLive"       boolean default false,
  created_at        timestamptz default now()
);

-- TABLE: students (candidats positionnés par entreprise)
create table if not exists public.students (
  id          text primary key,
  company_id  integer references public.companies(id) on delete cascade,
  nom         text not null,
  prenom      text,
  formation   text,
  email       text,
  phone       text,
  cre         text,
  spontaneous boolean default false,
  created_at  timestamptz default now()
);

-- TABLE: ratings (décisions entreprises sur candidats)
create table if not exists public.ratings (
  student_id  text references public.students(id) on delete cascade,
  company_id  integer references public.companies(id) on delete cascade,
  met         boolean default false,
  rating      text,
  comment     text default '',
  updated_at  timestamptz default now(),
  primary key (student_id, company_id)
);

-- TABLE: presence (présence entreprises le jour J)
create table if not exists public.presence (
  id          integer primary key references public.companies(id) on delete cascade,
  present     boolean default false,
  nb_personnes integer default 0,
  updated_at  timestamptz default now()
);

-- TABLE: sheet_local (données locales : check-in, notes CRE, postes alternance…)
create table if not exists public.sheet_local (
  key             text primary key,
  checked_in      boolean default false,
  checkin_at      text,
  formation_ciblee text,
  notes_cre       text,
  self_registered boolean default false,
  updated_at      timestamptz default now()
);

-- TABLE: self_registrations (candidatures auto-enregistrées sur place)
create table if not exists public.self_registrations (
  id          text primary key,
  nom         text not null,
  prenom      text,
  email       text,
  telephone   text,
  diplome     text,
  "domainesInteret" text,
  situation   text,
  status      text default 'pending',
  created_at  timestamptz default now()
);

-- TABLE: commercial_tracking (suivi hebdo des commerciaux)
-- KPI métier :
--   restants   : étudiants qui poursuivent dans l'année supérieure naturellement (ex: BTS1 -> BTS2)
--   montants   : étudiants qui terminent un cycle et montent (ex: BTS2 -> Bachelor)
--   places     : étudiants placés en alternance (contrats signés)
--   nb_offres  : nombre d'offres d'alternance disponibles
create table if not exists public.commercial_tracking (
  id                 serial primary key,
  date_point         date not null,
  semaine            integer not null,
  annee              integer not null,
  commercial         text not null,
  entite             text not null,
  pipeline_actif     integer default 0,
  nouveaux_prospects integer default 0,
  restants           integer default 0,
  montants           integer default 0,
  places             integer default 0,
  nb_offres          integer default 0,
  objectif_semaine   numeric default 0,
  ca_realise         numeric default 0,
  wins               text default '',
  blocages           text default '',
  plan_suivant       text default '',
  moral              integer default 3,
  confiance          text default 'orange',
  notes              text default '',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create index if not exists idx_ct_commercial on public.commercial_tracking(commercial);
create index if not exists idx_ct_date on public.commercial_tracking(date_point);

-- Migration douce pour bases existantes : ajout colonnes si manquantes
alter table public.commercial_tracking add column if not exists restants  integer default 0;
alter table public.commercial_tracking add column if not exists montants  integer default 0;
alter table public.commercial_tracking add column if not exists places    integer default 0;
alter table public.commercial_tracking add column if not exists nb_offres integer default 0;

-- ============================================================
-- POLICIES RLS (Row Level Security) — autoriser tout depuis service key
-- ============================================================
alter table public.companies        enable row level security;
alter table public.students         enable row level security;
alter table public.ratings          enable row level security;
alter table public.presence         enable row level security;
alter table public.sheet_local      enable row level security;
alter table public.self_registrations enable row level security;
alter table public.commercial_tracking enable row level security;

-- Autoriser toutes les opérations via la service key (backend Node.js)
create policy "allow_all_companies"          on public.companies          for all using (true) with check (true);
create policy "allow_all_students"           on public.students           for all using (true) with check (true);
create policy "allow_all_ratings"            on public.ratings            for all using (true) with check (true);
create policy "allow_all_presence"           on public.presence           for all using (true) with check (true);
create policy "allow_all_sheet_local"        on public.sheet_local        for all using (true) with check (true);
create policy "allow_all_self_registrations" on public.self_registrations for all using (true) with check (true);
create policy "allow_all_commercial_tracking" on public.commercial_tracking for all using (true) with check (true);
