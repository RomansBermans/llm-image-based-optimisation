import assert from "node:assert/strict";
import test from "node:test";

process.env.APP_BASE_URL = "http://localhost:3000";
process.env.DATABASE_PATH = `/tmp/avm-test-${process.pid}.db`;

test("every approved variant is included in the public mapping", async () => {
  const db = await import("../src/db.js");
  const store = db.getOrCreateStore(`example-${process.pid}.test`, "https://example.test/storefront");
  const product = db.upsertProduct({
    storeId: store.id, externalId: "sku-1", title: "Jacket", canonicalUrl: "https://example.test/products/jacket", originalImageUrl: "https://cdn.example.test/jacket.jpg"
  });
  const rejected = db.createVariant(product.id, "different room", "/assets/images/rejected.png");
  db.updateVariantStatus(rejected.id, "rejected");
  assert.deepEqual(db.approvedMappings(store.publicToken), []);
  const approved = db.createVariant(product.id, "different model", "/assets/images/approved.png");
  db.updateVariantStatus(approved.id, "approved");
  const secondApproved = db.createVariant(product.id, "different setting", "/assets/images/also-approved.png");
  db.updateVariantStatus(secondApproved.id, "approved");
  assert.deepEqual(db.approvedMappings(store.publicToken), [{ originalImageUrl: product.originalImageUrl, generatedImagePaths: [approved.generatedImagePath, secondApproved.generatedImagePath] }]);
  const variants = db.getProducts(store.id)[0].variants;
  assert.equal(variants.length, 3);
  assert.equal(db.getStore(store.id)?.submittedUrl, "https://example.test/storefront");
});

test("the connection-time DNS guard supplies concrete public IP addresses", async () => {
  const { selectPublicAddresses } = await import("../src/security.js");
  assert.deepEqual(selectPublicAddresses([{ address: "203.0.113.4", family: 4 }, { address: "1.1.1.1", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]), [{ address: "1.1.1.1", family: 4 }]);
  assert.deepEqual(selectPublicAddresses([{ address: "127.0.0.1", family: 4 }, { address: undefined }]), []);
});

test("cached product images keep their supported MIME type for OpenAI uploads", async () => {
  const { mimeTypeForPath } = await import("../src/image-generator.js");
  assert.equal(mimeTypeForPath("/tmp/product.jpg"), "image/jpeg");
  assert.equal(mimeTypeForPath("/tmp/product.png"), "image/png");
  assert.equal(mimeTypeForPath("/tmp/product.webp"), "image/webp");
});
