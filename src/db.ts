import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type { Product, ProductWithVariants, Store, Variant, VariantStatus } from "./types.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const database = new Database(config.databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY, domain TEXT NOT NULL UNIQUE, submitted_url TEXT, public_token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id), external_id TEXT NOT NULL,
    title TEXT NOT NULL, canonical_url TEXT NOT NULL, original_image_url TEXT NOT NULL,
    local_image_path TEXT, created_at TEXT NOT NULL, UNIQUE(store_id, external_id)
  );
  CREATE TABLE IF NOT EXISTS variants (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), prompt TEXT NOT NULL,
    generated_image_path TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS variants_product_created ON variants(product_id, created_at DESC);
`);
const storeColumns = database.pragma("table_info(stores)") as Array<{ name: string }>;
if (!storeColumns.some(column => column.name === "submitted_url")) database.exec("ALTER TABLE stores ADD COLUMN submitted_url TEXT");

const now = () => new Date().toISOString();
const id = (prefix: string, source?: string) => `${prefix}_${source ? crypto.createHash("sha256").update(source).digest("hex").slice(0, 24) : crypto.randomUUID()}`;
const storeRow = (row: Record<string, unknown>): Store => ({
  id: String(row.id), domain: String(row.domain), submittedUrl: row.submitted_url ? String(row.submitted_url) : null,
  publicToken: String(row.public_token), createdAt: String(row.created_at)
});
const productRow = (row: Record<string, unknown>): Product => ({
  id: String(row.id), storeId: String(row.store_id), externalId: String(row.external_id), title: String(row.title),
  canonicalUrl: String(row.canonical_url), originalImageUrl: String(row.original_image_url),
  localImagePath: row.local_image_path ? String(row.local_image_path) : null, createdAt: String(row.created_at)
});
const variantRow = (row: Record<string, unknown>): Variant => ({
  id: String(row.id), productId: String(row.product_id), prompt: String(row.prompt), generatedImagePath: String(row.generated_image_path),
  status: row.status as VariantStatus, createdAt: String(row.created_at)
});

export function getOrCreateStore(domain: string, submittedUrl?: string): Store {
  const existing = database.prepare("SELECT * FROM stores WHERE domain = ?").get(domain) as Record<string, unknown> | undefined;
  if (existing) {
    if (submittedUrl) database.prepare("UPDATE stores SET submitted_url = ? WHERE id = ?").run(submittedUrl, existing.id);
    return { ...storeRow(existing), submittedUrl: submittedUrl ?? storeRow(existing).submittedUrl };
  }
  const store: Store = { id: id("store", domain), domain, submittedUrl: submittedUrl ?? null, publicToken: crypto.randomBytes(24).toString("base64url"), createdAt: now() };
  database.prepare("INSERT INTO stores (id, domain, submitted_url, public_token, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(store.id, store.domain, store.submittedUrl, store.publicToken, store.createdAt);
  return store;
}

export function listStores(): Store[] { return (database.prepare("SELECT * FROM stores ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(storeRow); }
export function getStore(storeId: string): Store | null {
  const row = database.prepare("SELECT * FROM stores WHERE id = ?").get(storeId) as Record<string, unknown> | undefined;
  return row ? storeRow(row) : null;
}

export function upsertProduct(product: Omit<Product, "id" | "createdAt" | "localImagePath">): Product {
  const found = database.prepare("SELECT * FROM products WHERE store_id = ? AND external_id = ?").get(product.storeId, product.externalId) as Record<string, unknown> | undefined;
  if (found) {
    database.prepare("UPDATE products SET title = ?, canonical_url = ?, original_image_url = ? WHERE id = ?")
      .run(product.title, product.canonicalUrl, product.originalImageUrl, found.id);
    return productRow(database.prepare("SELECT * FROM products WHERE id = ?").get(found.id) as Record<string, unknown>);
  }
  const created: Product = { ...product, id: id("product", `${product.storeId}:${product.externalId}`), localImagePath: null, createdAt: now() };
  database.prepare("INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(created.id, created.storeId, created.externalId, created.title, created.canonicalUrl, created.originalImageUrl, null, created.createdAt);
  return created;
}

export function setProductLocalImage(productId: string, imagePath: string): void { database.prepare("UPDATE products SET local_image_path = ? WHERE id = ?").run(imagePath, productId); }
export function getProduct(productId: string): Product | null {
  const row = database.prepare("SELECT * FROM products WHERE id = ?").get(productId) as Record<string, unknown> | undefined;
  return row ? productRow(row) : null;
}
export function getProducts(storeId: string): ProductWithVariants[] {
  const products = database.prepare("SELECT * FROM products WHERE store_id = ? ORDER BY created_at").all(storeId) as Record<string, unknown>[];
  const variantQuery = database.prepare("SELECT * FROM variants WHERE product_id = ? ORDER BY created_at DESC");
  return products.map(row => {
    const variants = variantQuery.all(row.id) as Record<string, unknown>[];
    return { ...productRow(row), variants: variants.map(variantRow) };
  });
}
export function createVariant(productId: string, prompt: string, generatedImagePath: string): Variant {
  const variant: Variant = { id: id("variant"), productId, prompt, generatedImagePath, status: "pending", createdAt: now() };
  database.prepare("INSERT INTO variants VALUES (?, ?, ?, ?, ?, ?)").run(variant.id, variant.productId, variant.prompt, variant.generatedImagePath, variant.status, variant.createdAt);
  return variant;
}
export function updateVariantStatus(variantId: string, status: VariantStatus): Variant | null {
  database.prepare("UPDATE variants SET status = ? WHERE id = ?").run(status, variantId);
  const row = database.prepare("SELECT * FROM variants WHERE id = ?").get(variantId) as Record<string, unknown> | undefined;
  return row ? variantRow(row) : null;
}
export function approvedMappings(token: string): Array<{ originalImageUrl: string; generatedImagePaths: string[] }> | null {
  const store = database.prepare("SELECT id FROM stores WHERE public_token = ?").get(token) as { id: string } | undefined;
  if (!store) return null;
  const rows = database.prepare(`SELECT p.original_image_url, v.generated_image_path FROM variants v
    JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND v.status = 'approved'
    ORDER BY p.id, v.created_at`).all(store.id) as Array<{ original_image_url: string; generated_image_path: string }>;
  const mappings = new Map<string, string[]>();
  for (const row of rows) mappings.set(row.original_image_url, [...(mappings.get(row.original_image_url) ?? []), row.generated_image_path]);
  return [...mappings].map(([originalImageUrl, generatedImagePaths]) => ({ originalImageUrl, generatedImagePaths }));
}
