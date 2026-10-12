import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "./config.js";
import { approvedMappings, createVariant, getOrCreateStore, getProduct, getProducts, getStore, listStores, setProductLocalImage, updateVariantStatus, upsertProduct } from "./db.js";
import { discoverProducts } from "./discovery.js";
import { cacheOriginalImage, generateVariant } from "./image-generator.js";
import type { VariantStatus } from "./types.js";

const app = express();
const publicDir = path.resolve("public");
fs.mkdirSync(config.imageStoragePath, { recursive: true });
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use("/assets/images", express.static(config.imageStoragePath, { immutable: true, maxAge: "30d", fallthrough: false }));
app.use(express.static(publicDir, { maxAge: "1h" }));

function fail(res: express.Response, status: number, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  res.status(status).json({ error: message });
}
function storePayload(storeId: string): object | null {
  const store = getStore(storeId); if (!store) return null;
  const scriptUrl = `${config.appBaseUrl}/visual-merchandising.js`;
  return {
    store, products: getProducts(storeId),
    snippet: `<script async src="${scriptUrl}" data-avm-store="${store.publicToken}"><\/script>`,
    consoleSnippet: `(()=>{const s=document.createElement("script");s.src=${JSON.stringify(scriptUrl)};s.dataset.avmStore=${JSON.stringify(store.publicToken)};document.body.append(s)})()`
  };
}

app.get("/api/stores", (_req, res) => res.json({ stores: listStores().map(({ id, domain, submittedUrl, createdAt }) => ({ id, domain, submittedUrl, createdAt })) }));
app.get("/api/stores/:storeId", (req, res) => {
  const data = storePayload(req.params.storeId);
  if (!data) return fail(res, 404, new Error("Store not found."));
  res.json(data);
});
app.post("/api/discover", async (req, res) => {
  const storeUrl = typeof req.body?.storeUrl === "string" ? req.body.storeUrl.trim() : "";
  if (!storeUrl || storeUrl.length > 2_000) return fail(res, 400, new Error("Enter a valid store URL."));
  try {
    const discovered = await discoverProducts(storeUrl);
    const store = getOrCreateStore(discovered.domain, discovered.submittedUrl);
    for (const product of discovered.products) upsertProduct({ storeId: store.id, ...product });
    res.status(201).json(storePayload(store.id));
  } catch (error) { fail(res, 422, error); }
});
app.post("/api/products/:productId/variants", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt || prompt.length > 4_000) return fail(res, 400, new Error("Enter an image prompt under 4,000 characters."));
  const product = getProduct(req.params.productId);
  if (!product) return fail(res, 404, new Error("Product not found."));
  try {
    const localImagePath = product.localImagePath ?? await cacheOriginalImage(product.id, product.originalImageUrl);
    if (!product.localImagePath) setProductLocalImage(product.id, localImagePath);
    const generatedImagePath = await generateVariant(product.id, localImagePath, prompt);
    res.status(201).json({ variant: createVariant(product.id, prompt, generatedImagePath) });
  } catch (error) { fail(res, 422, error); }
});
app.post("/api/variants/:variantId/status", (req, res) => {
  const status = req.body?.status as VariantStatus;
  if (status !== "approved" && status !== "rejected") return fail(res, 400, new Error("Status must be approved or rejected."));
  const variant = updateVariantStatus(req.params.variantId, status);
  if (!variant) return fail(res, 404, new Error("Variant not found."));
  res.json({ variant });
});
app.get("/api/public/stores/:token/variants", (req, res) => {
  const mappings = approvedMappings(req.params.token);
  if (!mappings) return fail(res, 404, new Error("Store integration token not found."));
  res.set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60, stale-while-revalidate=300" });
  res.json({ variants: mappings.map(item => ({ originalImageUrl: item.originalImageUrl, variantImageUrls: item.generatedImagePaths.map(imagePath => new URL(imagePath, config.appBaseUrl).href) })) });
});
app.get("*splat", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

app.listen(config.port, () => {
  console.log(`AI Visual Merchandising is running at ${config.appBaseUrl}`);
  if (!config.openaiApiKey) console.warn("OPENAI_API_KEY is absent. Discovery works, but image generation is disabled.");
});
