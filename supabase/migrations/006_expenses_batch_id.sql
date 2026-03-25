-- Link expenses to bulk sessions via batch_id (same UUID used in sales.batch_id)
alter table public.expenses
  add column if not exists batch_id uuid default null;
