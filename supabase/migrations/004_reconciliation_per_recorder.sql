-- Per-recorder reconciliation: each person reconciles their own sales
alter table public.daily_reconciliations
  add column if not exists recorded_by uuid references public.profiles(id);

-- Replace date-only unique constraint with date+recorder
alter table public.daily_reconciliations
  drop constraint if exists daily_reconciliations_reconciliation_date_key;

create unique index if not exists daily_reconciliations_date_recorder_idx
  on public.daily_reconciliations(reconciliation_date, recorded_by);
