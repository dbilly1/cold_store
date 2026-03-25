-- Track which expenses were paid directly from the daily cash till
alter table public.expenses
  add column if not exists paid_from_till boolean default false;
