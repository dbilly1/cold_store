import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface OfflineSaleItem {
  product_id: string;
  product_name: string;
  unit_type: string;
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  unit_price: number;
  discount_amount: number;
  line_total: number;
  cost_price_at_sale: number;
}

interface OfflineSale {
  id: string; // local UUID
  sale_date: string;
  recorded_by: string;
  notes: string | null;
  total_amount: number;
  discount_amount: number;
  payment_method: string;
  items: OfflineSaleItem[];
  synced: boolean;
  created_at: string;
}

interface OfflineExpense {
  id: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  recorded_by: string;
  synced: boolean;
  created_at: string;
}

interface ColdStoreDB extends DBSchema {
  offline_sales: {
    key: string;
    value: OfflineSale;
    indexes: { by_synced: string };
  };
  offline_expenses: {
    key: string;
    value: OfflineExpense;
    indexes: { by_synced: string };
  };
  cached_products: {
    key: string;
    value: {
      id: string;
      name: string;
      unit_type: string;
      units_per_box: number | null;
      current_stock_kg: number;
      current_stock_units: number;
      current_stock_boxes: number;
      selling_price: number;
      weighted_avg_cost: number;
      cached_at: string;
    };
  };
}

let db: IDBPDatabase<ColdStoreDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<ColdStoreDB>> {
  if (db) return db;
  db = await openDB<ColdStoreDB>("coldsore-offline", 1, {
    upgrade(db) {
      const salesStore = db.createObjectStore("offline_sales", { keyPath: "id" });
      salesStore.createIndex("by_synced", "synced");

      const expensesStore = db.createObjectStore("offline_expenses", { keyPath: "id" });
      expensesStore.createIndex("by_synced", "synced");

      db.createObjectStore("cached_products", { keyPath: "id" });
    },
  });
  return db;
}

// ─── Offline Sales ────────────────────────────────────────────────────────────

export async function saveOfflineSale(sale: OfflineSale): Promise<void> {
  const database = await getDB();
  await database.put("offline_sales", sale);
}

export async function getUnsynced(): Promise<{ sales: OfflineSale[]; expenses: OfflineExpense[] }> {
  const database = await getDB();
  const sales = await database.getAllFromIndex("offline_sales", "by_synced", "0");
  const expenses = await database.getAllFromIndex("offline_expenses", "by_synced", "0");
  return { sales, expenses };
}

export async function markSaleSynced(id: string): Promise<void> {
  const database = await getDB();
  const sale = await database.get("offline_sales", id);
  if (sale) await database.put("offline_sales", { ...sale, synced: true });
}

// ─── Offline Expenses ─────────────────────────────────────────────────────────

export async function saveOfflineExpense(expense: OfflineExpense): Promise<void> {
  const database = await getDB();
  await database.put("offline_expenses", expense);
}

export async function markExpenseSynced(id: string): Promise<void> {
  const database = await getDB();
  const expense = await database.get("offline_expenses", id);
  if (expense) await database.put("offline_expenses", { ...expense, synced: true });
}

// ─── Product Cache ────────────────────────────────────────────────────────────

export async function cacheProducts(products: ColdStoreDB["cached_products"]["value"][]): Promise<void> {
  const database = await getDB();
  const tx = database.transaction("cached_products", "readwrite");
  await Promise.all(products.map((p) => tx.store.put(p)));
  await tx.done;
}

export async function getCachedProducts(): Promise<ColdStoreDB["cached_products"]["value"][]> {
  const database = await getDB();
  return database.getAll("cached_products");
}
