-- ============================================================
-- Cold Store Inventory & Sales Management System
-- Initial Schema Migration
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- ENUM TYPES 
-- ============================================================

create type user_role as enum ('salesperson', 'supervisor', 'accountant', 'admin');
create type unit_type as enum ('kg', 'units', 'boxes');
create type payment_method as enum ('cash', 'mobile_money');
create type adjustment_reason as enum (
  'melt_loss', 'spoilage', 'handling_loss', 'measurement_variance', 'other'
);
create type audit_type as enum ('full', 'random');
create type audit_status as enum ('draft', 'in_progress', 'completed', 'cancelled');
create type expense_category as enum (
  'electricity', 'transport', 'wages', 'rent',
  'maintenance', 'packaging', 'cleaning', 'miscellaneous'
);
create type alert_type as enum (
  'low_stock', 'cash_mismatch', 'fraud_indicator',
  'negative_stock', 'high_audit_variance',
  'excessive_adjustments', 'unusual_pricing'
);
create type alert_status as enum ('open', 'acknowledged', 'resolved');
create type reconciliation_status as enum ('pending', 'balanced', 'flagged');
create type approval_status as enum ('pending', 'approved', 'rejected');

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role user_role not null default 'salesperson',
  is_approved boolean not null default false,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Unknown'),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- CATEGORIES
-- ============================================================

create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PRODUCTS
-- ============================================================

create table products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category_id uuid references categories(id),
  unit_type unit_type not null default 'kg',
  units_per_box numeric(10,3), -- e.g. 12 units per box, or 25kg per box
  current_stock_kg numeric(10,3) not null default 0,
  current_stock_units numeric(10,3) not null default 0,
  current_stock_boxes numeric(10,3) not null default 0,
  weighted_avg_cost numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  low_stock_threshold numeric(10,3) not null default 10,
  variance_threshold_pct numeric(5,2) not null default 5.00, -- 5% default
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- STOCK ADDITIONS (restocking)
-- ============================================================

create table stock_additions (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id),
  added_by uuid not null references profiles(id),
  quantity_kg numeric(10,3) not null default 0,
  quantity_units numeric(10,3) not null default 0,
  quantity_boxes numeric(10,3) not null default 0,
  cost_price_per_unit numeric(12,2) not null, -- per kg or per unit
  total_cost numeric(12,2) not null,
  supplier text,
  notes text,
  created_at timestamptz not null default now()
);

-- Update weighted average cost and stock on addition
create or replace function update_stock_on_addition()
returns trigger language plpgsql security definer as $$
declare
  v_product products%rowtype;
  v_new_total_value numeric;
  v_new_total_qty numeric; -- in primary unit (kg or units)
  v_added_qty numeric;
begin
  select * into v_product from products where id = new.product_id;

  -- Determine added qty in primary unit
  if v_product.unit_type = 'kg' then
    v_added_qty := new.quantity_kg + (coalesce(new.quantity_boxes, 0) * coalesce(v_product.units_per_box, 0));
  else
    v_added_qty := new.quantity_units + (coalesce(new.quantity_boxes, 0) * coalesce(v_product.units_per_box, 0));
  end if;

  -- Weighted average cost
  v_new_total_value := (v_product.weighted_avg_cost *
    case when v_product.unit_type = 'kg' then v_product.current_stock_kg else v_product.current_stock_units end)
    + (new.cost_price_per_unit * v_added_qty);

  v_new_total_qty := (case when v_product.unit_type = 'kg' then v_product.current_stock_kg else v_product.current_stock_units end)
    + v_added_qty;

  update products set
    current_stock_kg = current_stock_kg + new.quantity_kg + (coalesce(new.quantity_boxes,0) * case when unit_type='kg' then coalesce(units_per_box,0) else 0 end),
    current_stock_units = current_stock_units + new.quantity_units + (coalesce(new.quantity_boxes,0) * case when unit_type='units' then coalesce(units_per_box,0) else 0 end),
    current_stock_boxes = current_stock_boxes + new.quantity_boxes,
    weighted_avg_cost = case when v_new_total_qty > 0 then v_new_total_value / v_new_total_qty else 0 end,
    updated_at = now()
  where id = new.product_id;

  return new;
end;
$$;

create trigger after_stock_addition
  after insert on stock_additions
  for each row execute procedure update_stock_on_addition();

-- ============================================================
-- SALES
-- ============================================================

create table sales (
  id uuid primary key default uuid_generate_v4(),
  sale_date date not null default current_date,
  recorded_by uuid not null references profiles(id),
  notes text,
  total_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  payment_method payment_method not null default 'cash',
  is_deleted boolean not null default false,
  deleted_by uuid references profiles(id),
  deleted_at timestamptz,
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sale_items (
  id uuid primary key default uuid_generate_v4(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity_kg numeric(10,3) not null default 0,
  quantity_units numeric(10,3) not null default 0,
  quantity_boxes numeric(10,3) not null default 0,
  unit_price numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0,
  line_total numeric(12,2) not null,
  cost_price_at_sale numeric(12,2) not null, -- snapshot of weighted avg cost
  created_at timestamptz not null default now()
);

-- Deduct stock after sale item inserted
create or replace function deduct_stock_on_sale()
returns trigger language plpgsql security definer as $$
declare
  v_product products%rowtype;
begin
  select * into v_product from products where id = new.product_id;

  update products set
    current_stock_kg = current_stock_kg - new.quantity_kg
      - (new.quantity_boxes * case when unit_type='kg' then coalesce(units_per_box,0) else 0 end),
    current_stock_units = current_stock_units - new.quantity_units
      - (new.quantity_boxes * case when unit_type='units' then coalesce(units_per_box,0) else 0 end),
    current_stock_boxes = current_stock_boxes - new.quantity_boxes,
    updated_at = now()
  where id = new.product_id;

  -- Check for negative stock and create alert
  select * into v_product from products where id = new.product_id;
  if v_product.current_stock_kg < 0 or v_product.current_stock_units < 0 then
    insert into alerts (alert_type, severity, title, message, related_entity_type, related_entity_id)
    values (
      'negative_stock', 'high',
      'Negative Stock Detected',
      'Product "' || v_product.name || '" has gone negative after a sale.',
      'products', new.product_id
    );
  end if;

  -- Low stock alert
  if v_product.current_stock_kg <= v_product.low_stock_threshold
     or v_product.current_stock_units <= v_product.low_stock_threshold then
    insert into alerts (alert_type, severity, title, message, related_entity_type, related_entity_id)
    values (
      'low_stock', 'medium',
      'Low Stock Warning',
      'Product "' || v_product.name || '" is at or below low stock threshold.',
      'products', new.product_id
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger after_sale_item_insert
  after insert on sale_items
  for each row execute procedure deduct_stock_on_sale();

-- Restore stock when sale is soft-deleted
create or replace function restore_stock_on_sale_delete()
returns trigger language plpgsql security definer as $$
declare
  v_item sale_items%rowtype;
begin
  if new.is_deleted = true and old.is_deleted = false then
    for v_item in select * from sale_items where sale_id = new.id loop
      update products set
        current_stock_kg = current_stock_kg + v_item.quantity_kg,
        current_stock_units = current_stock_units + v_item.quantity_units,
        current_stock_boxes = current_stock_boxes + v_item.quantity_boxes,
        updated_at = now()
      where id = v_item.product_id;
    end loop;
  end if;
  return new;
end;
$$;

create trigger after_sale_soft_delete
  after update on sales
  for each row execute procedure restore_stock_on_sale_delete();

-- ============================================================
-- STOCK ADJUSTMENTS
-- ============================================================

create table stock_adjustments (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id),
  adjusted_by uuid not null references profiles(id),
  reason adjustment_reason not null,
  reason_detail text not null,
  quantity_kg_delta numeric(10,3) not null default 0,
  quantity_units_delta numeric(10,3) not null default 0,
  quantity_boxes_delta numeric(10,3) not null default 0,
  stock_before_kg numeric(10,3) not null,
  stock_before_units numeric(10,3) not null,
  stock_before_boxes numeric(10,3) not null,
  approval_status approval_status not null default 'pending',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  requires_approval boolean not null default false,
  created_at timestamptz not null default now()
);

-- Apply adjustment when approved (or immediately if within threshold)
create or replace function apply_stock_adjustment()
returns trigger language plpgsql security definer as $$
begin
  -- Apply immediately when inserted and does not require approval
  if TG_OP = 'INSERT' and new.requires_approval = false then
    update products set
      current_stock_kg = current_stock_kg + new.quantity_kg_delta,
      current_stock_units = current_stock_units + new.quantity_units_delta,
      current_stock_boxes = current_stock_boxes + new.quantity_boxes_delta,
      updated_at = now()
    where id = new.product_id;
  end if;

  -- Apply when approved
  if TG_OP = 'UPDATE'
     and new.approval_status = 'approved'
     and old.approval_status = 'pending'
     and new.requires_approval = true then
    update products set
      current_stock_kg = current_stock_kg + new.quantity_kg_delta,
      current_stock_units = current_stock_units + new.quantity_units_delta,
      current_stock_boxes = current_stock_boxes + new.quantity_boxes_delta,
      updated_at = now()
    where id = new.product_id;
  end if;

  return new;
end;
$$;

create trigger after_stock_adjustment
  after insert or update on stock_adjustments
  for each row execute procedure apply_stock_adjustment();

-- ============================================================
-- DAILY RECONCILIATION
-- ============================================================

create table daily_reconciliations (
  id uuid primary key default uuid_generate_v4(),
  reconciliation_date date not null unique,
  submitted_by uuid not null references profiles(id),
  system_cash_total numeric(12,2) not null default 0,
  system_mobile_total numeric(12,2) not null default 0,
  actual_cash_entered numeric(12,2) not null default 0,
  actual_mobile_entered numeric(12,2) not null default 0,
  cash_variance numeric(12,2) generated always as (actual_cash_entered - system_cash_total) stored,
  mobile_variance numeric(12,2) generated always as (actual_mobile_entered - system_mobile_total) stored,
  status reconciliation_status not null default 'pending',
  notes text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- STOCK AUDITS
-- ============================================================

create table stock_audits (
  id uuid primary key default uuid_generate_v4(),
  audit_type audit_type not null,
  audit_date date not null default current_date,
  conducted_by uuid not null references profiles(id),
  status audit_status not null default 'draft',
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table stock_audit_items (
  id uuid primary key default uuid_generate_v4(),
  audit_id uuid not null references stock_audits(id) on delete cascade,
  product_id uuid not null references products(id),
  system_stock_kg numeric(10,3) not null,
  system_stock_units numeric(10,3) not null,
  system_stock_boxes numeric(10,3) not null,
  physical_stock_kg numeric(10,3) not null default 0,
  physical_stock_units numeric(10,3) not null default 0,
  physical_stock_boxes numeric(10,3) not null default 0,
  variance_kg numeric(10,3) generated always as (physical_stock_kg - system_stock_kg) stored,
  variance_units numeric(10,3) generated always as (physical_stock_units - system_stock_units) stored,
  variance_boxes numeric(10,3) generated always as (physical_stock_boxes - system_stock_boxes) stored,
  variance_pct numeric(8,2) not null default 0, -- calculated application-side
  within_threshold boolean not null default true,
  notes text
);

-- ============================================================
-- EXPENSES
-- ============================================================

create table expenses (
  id uuid primary key default uuid_generate_v4(),
  expense_date date not null default current_date,
  category expense_category not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  recorded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- ALERTS
-- ============================================================

create table alerts (
  id uuid primary key default uuid_generate_v4(),
  alert_type alert_type not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  title text not null,
  message text not null,
  related_entity_type text,
  related_entity_id uuid,
  status alert_status not null default 'open',
  acknowledged_by uuid references profiles(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================

create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- SYSTEM CONFIG
-- ============================================================

create table system_config (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique,
  value text not null,
  description text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- Default config values
insert into system_config (key, value, description) values
  ('global_variance_threshold_pct', '5', 'Default % variance allowed in stock audits'),
  ('low_stock_alert_enabled', 'true', 'Enable low stock alerts'),
  ('reconciliation_tolerance', '0', 'Cash reconciliation tolerance (0 = zero tolerance)'),
  ('fraud_adjustment_count_threshold', '3', 'Adjustments per day before fraud alert triggers'),
  ('store_name', 'Cold Store', 'Display name for the store'),
  ('currency_symbol', 'GHS', 'Currency symbol');

-- ============================================================
-- UPDATED_AT TRIGGER (shared)
-- ============================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_products_updated_at
  before update on products
  for each row execute procedure set_updated_at();

create trigger set_sales_updated_at
  before update on sales
  for each row execute procedure set_updated_at();

create trigger set_profiles_updated_at
  before update on profiles
  for each row execute procedure set_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_sales_date on sales(sale_date) where is_deleted = false;
create index idx_sales_recorded_by on sales(recorded_by);
create index idx_sale_items_sale_id on sale_items(sale_id);
create index idx_sale_items_product_id on sale_items(product_id);
create index idx_stock_adjustments_product on stock_adjustments(product_id);
create index idx_stock_adjustments_status on stock_adjustments(approval_status);
create index idx_audit_logs_user on audit_logs(user_id);
create index idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index idx_audit_logs_created_at on audit_logs(created_at desc);
create index idx_alerts_status on alerts(status);
create index idx_expenses_date on expenses(expense_date);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table stock_additions enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table stock_adjustments enable row level security;
alter table daily_reconciliations enable row level security;
alter table stock_audits enable row level security;
alter table stock_audit_items enable row level security;
alter table expenses enable row level security;
alter table alerts enable row level security;
alter table audit_logs enable row level security;
alter table system_config enable row level security;

-- Helper function to get current user role
create or replace function get_my_role()
returns user_role language sql security definer stable as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_approved()
returns boolean language sql security definer stable as $$
  select is_approved from profiles where id = auth.uid()
$$;

-- PROFILES policies
create policy "Users can view own profile" on profiles
  for select using (id = auth.uid());

create policy "Admins can view all profiles" on profiles
  for select using (get_my_role() in ('admin', 'supervisor'));

create policy "Admins can update profiles" on profiles
  for update using (get_my_role() = 'admin');

create policy "Users can update own profile limited" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));

-- CATEGORIES policies (all approved users read, admin/supervisor write)
create policy "Approved users can view categories" on categories
  for select using (is_approved());

create policy "Admin/Supervisor can manage categories" on categories
  for all using (get_my_role() in ('admin', 'supervisor'));

-- PRODUCTS policies
create policy "Approved users can view products" on products
  for select using (is_approved());

create policy "Admin/Supervisor can manage products" on products
  for all using (get_my_role() in ('admin', 'supervisor'));

-- STOCK ADDITIONS
create policy "Approved users can view stock additions" on stock_additions
  for select using (is_approved());

create policy "Admin/Supervisor can add stock" on stock_additions
  for insert with check (get_my_role() in ('admin', 'supervisor'));

-- SALES policies
create policy "Approved users can view sales" on sales
  for select using (is_approved());

create policy "Salesperson can record sales" on sales
  for insert with check (is_approved() and recorded_by = auth.uid());

create policy "Salesperson can soft delete own sales" on sales
  for update using (
    is_approved() and (
      recorded_by = auth.uid() or get_my_role() in ('admin', 'supervisor')
    )
  );

-- SALE ITEMS
create policy "Approved users can view sale items" on sale_items
  for select using (is_approved());

create policy "Approved users can insert sale items" on sale_items
  for insert with check (is_approved());

-- STOCK ADJUSTMENTS
create policy "Approved users can view adjustments" on stock_adjustments
  for select using (is_approved());

create policy "Supervisor/Admin can create adjustments" on stock_adjustments
  for insert with check (get_my_role() in ('admin', 'supervisor'));

create policy "Admin can approve adjustments" on stock_adjustments
  for update using (get_my_role() in ('admin', 'supervisor'));

-- DAILY RECONCILIATIONS
create policy "Approved users can view reconciliations" on daily_reconciliations
  for select using (is_approved());

create policy "Salesperson can submit reconciliation" on daily_reconciliations
  for insert with check (is_approved());

create policy "Supervisor/Admin can review reconciliation" on daily_reconciliations
  for update using (get_my_role() in ('admin', 'supervisor'));

-- STOCK AUDITS
create policy "Approved users can view audits" on stock_audits
  for select using (is_approved());

create policy "Supervisor/Admin can manage audits" on stock_audits
  for all using (get_my_role() in ('admin', 'supervisor'));

create policy "Approved users can view audit items" on stock_audit_items
  for select using (is_approved());

create policy "Supervisor/Admin can manage audit items" on stock_audit_items
  for all using (get_my_role() in ('admin', 'supervisor'));

-- EXPENSES
create policy "Approved users can view expenses" on expenses
  for select using (is_approved());

create policy "Approved users can record expenses" on expenses
  for insert with check (is_approved());

create policy "Admin can update/delete expenses" on expenses
  for all using (get_my_role() in ('admin', 'supervisor'));

-- ALERTS
create policy "Approved users can view alerts" on alerts
  for select using (is_approved());

create policy "System can insert alerts" on alerts
  for insert with check (true);

create policy "Supervisor/Admin can update alerts" on alerts
  for update using (get_my_role() in ('admin', 'supervisor'));

-- AUDIT LOGS (read only for admins/supervisors)
create policy "Admin/Supervisor can view audit logs" on audit_logs
  for select using (get_my_role() in ('admin', 'supervisor'));

create policy "System can write audit logs" on audit_logs
  for insert with check (true);

-- SYSTEM CONFIG
create policy "Approved users can view config" on system_config
  for select using (is_approved());

create policy "Admin can update config" on system_config
  for update using (get_my_role() = 'admin');
