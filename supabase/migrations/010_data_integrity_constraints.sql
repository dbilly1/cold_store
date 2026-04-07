-- A1: Credit sales must have a customer
-- Using NOT VALID so existing bad rows don't block the migration.
-- Run VALIDATE CONSTRAINT separately once bad rows are confirmed clean.
alter table public.sales
  add constraint sales_credit_requires_customer
  check (payment_method != 'credit' OR customer_id is not null)
  not valid;

-- A2: Prevent self-approval of stock adjustments
alter table public.stock_adjustments
  add constraint no_self_approval
  check (approved_by is null or approved_by != adjusted_by)
  not valid;

-- A3: Index on expenses(batch_id) to speed up reconciliation queries
create index if not exists idx_expenses_batch_id
  on public.expenses (batch_id)
  where batch_id is not null;
