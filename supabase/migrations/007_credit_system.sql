-- Add 'credit' to the payment_method enum
alter type payment_method add value if not exists 'credit';

-- Customers table
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.customers enable row level security;

create policy "Authenticated users can manage customers"
  on public.customers for all to authenticated using (true) with check (true);

-- Credit payments table (records when a customer pays back their debt)
create table if not exists public.credit_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'mobile_money')),
  payment_date date not null default current_date,
  recorded_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.credit_payments enable row level security;

create policy "Authenticated users can manage credit_payments"
  on public.credit_payments for all to authenticated using (true) with check (true);

-- Add customer_id to sales (nullable — only set when payment_method = 'credit')
alter table public.sales
  add column if not exists customer_id uuid references public.customers(id);
