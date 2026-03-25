-- Add batch_id to sales so bulk entries can be grouped
alter table public.sales
  add column if not exists batch_id uuid default null;

create index if not exists idx_sales_batch_id
  on public.sales(batch_id)
  where batch_id is not null;
