-- ============================================================
-- Database Data Reset Script
-- ============================================================
-- Wipes ALL business data and starts clean.
-- Preserves: profiles (user accounts), system_config, auth.users
--
-- ⚠️  THIS IS IRREVERSIBLE. Make sure you are certain before
--     running this. There is no undo.
-- ============================================================

TRUNCATE TABLE
  audit_logs,
  alerts,
  stock_audit_items,
  stock_audits,
  sale_items,
  credit_payments,
  daily_reconciliations,
  expenses,
  sales,
  stock_adjustments,
  stock_additions,
  customers,
  products,
  categories
RESTART IDENTITY CASCADE;

-- Confirm
SELECT 'Database reset complete. All business data has been cleared.' AS status;
