-- Switch from recorder-based to session-based reconciliation
-- Drop recorded_by added in 004 (if it was run)
alter table public.daily_reconciliations
  drop column if exists recorded_by;

drop index if exists daily_reconciliations_date_recorder_idx;

-- Drop original date-only unique constraint (if 004 was not run)
alter table public.daily_reconciliations
  drop constraint if exists daily_reconciliations_reconciliation_date_key;

-- session_key: batch_id (uuid as text) for bulk entries, "direct" for individual entries
alter table public.daily_reconciliations
  add column if not exists session_key text;

-- Unique per (date, session)
create unique index if not exists daily_reconciliations_date_session_idx
  on public.daily_reconciliations(reconciliation_date, session_key);
