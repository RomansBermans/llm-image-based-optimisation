import * as cheerio from "cheerio";
import crypto from "node:crypto";
import { canonicalUrl, fetchPublic } from "./security.js";

export interface DiscoveredProduct { externalId: string; title: string; canonicalUrl: string; originalImageUrl: string; }
type Candidate = Omit<DiscoveredProduct, "externalId"> & { externalId?: string };

function absolute(value: unknown, pageUrl: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const url = new URL(value, pageUrl); return /^https?:$/.test(url.protocol) ? canonicalUrl(url.href) : null; } catch { return null; }
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null; }
function firstImage(value: unknown, pageUrl: string): string | null {
  if (Array.isArray(value)) return value.map(item => firstImage(item, pageUrl)).find(Boolean) ?? null;
  if (value && typeof value === "object") return firstImage((value as Record<string, unknown>).url ?? (value as Record<string, unknown>).contentUrl, pageUrl);
  return absolute(value, pageUrl);
}
function productNodes(value: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) value.forEach(item => productNodes(item, found));
  else if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    const type = item["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) found.push(item);
    if (item["@graph"]) productNodes(item["@graph"], found);
  }
  return found;
}

function candidatesFromHtml(html: string, pageUrl: string): Candidate[] {
  const $ = cheerio.load(html);
  const out: Candidate[] = [];
  $("script[type='application/ld+json']").each((_, script) => {
    try {
      for (const node of productNodes(JSON.parse($(script).text()))) {
        const title = text(node.name); const image = firstImage(node.image, pageUrl); const url = absolute(node.url, pageUrl) ?? canonicalUrl(pageUrl);
        const externalId = text(node.productID) ?? text(node.sku) ?? text(node.gtin) ?? text(node.mpn) ?? undefined;
        if (title && image) out.push({ title, originalImageUrl: image, canonicalUrl: url, externalId });
      }
    } catch { /* Invalid publisher JSON-LD is ignored. */ }
  });
  const ogTitle = $("meta[property='og:title']").attr("content");
  const ogImage = $("meta[property='og:image']").attr("content");
  const ogType = $("meta[property='og:type']").attr("content");
  const ogImageUrl = absolute(ogImage, pageUrl);
  if (ogType?.toLowerCase().includes("product") && ogTitle && ogImageUrl) {
    out.push({ title: ogTitle.trim(), originalImageUrl: ogImageUrl, canonicalUrl: canonicalUrl($("link[rel='canonical']").attr("href") ? new URL($("link[rel='canonical']").attr("href")!, pageUrl).href : pageUrl) });
  }
  return out.filter(item => item.originalImageUrl);
}

function productLinks(html: string, pageUrl: string): Array<{ url: string; title: string }> {
  const $ = cheerio.load(html); const links = new Map<string, string>();
  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href"); if (!href || !/(^|\/)(products?|p|item)(\/|$)/i.test(href)) return;
    const url = absolute(href, pageUrl); const title = $(anchor).text().trim().replace(/\s+/g, " ");
    if (url && !links.has(url)) links.set(url, title || "Product");
  });
  return [...links].slice(0, 12).map(([url, title]) => ({ url, title }));
}
function finish(candidate: Candidate): DiscoveredProduct {
  const url = canonicalUrl(candidate.canonicalUrl);
  return { externalId: candidate.externalId ?? `url_${crypto.createHash("sha256").update(url).digest("hex").slice(0, 24)}`, title: candidate.title, canonicalUrl: url, originalImageUrl: canonicalUrl(candidate.originalImageUrl) };
}

export async function discoverProducts(storeUrl: string): Promise<{ domain: string; submittedUrl: string; products: DiscoveredProduct[] }> {
  const homepage = await fetchPublic(storeUrl, 2_000_000, /^text\/html\b/i);
  const collected = candidatesFromHtml(homepage.body.toString("utf8"), homepage.url.href);
  const links = productLinks(homepage.body.toString("utf8"), homepage.url.href);
  for (const link of links) {
    if (collected.length >= 5) break;
    try {
      const page = await fetchPublic(link.url, 2_000_000, /^text\/html\b/i);
      const candidate = candidatesFromHtml(page.body.toString("utf8"), page.url.href)[0];
      if (candidate) collected.push(candidate); else continue;
    } catch { /* A single unavailable product page should not discard the rest. */ }
  }
  const unique = new Map<string, DiscoveredProduct>();
  for (const candidate of collected) {
    try { const product = finish(candidate); if (!unique.has(product.canonicalUrl)) unique.set(product.canonicalUrl, product); } catch { /* Ignore malformed publisher data. */ }
    if (unique.size === 5) break;
  }
  if (!unique.size) throw new Error("No products with a title and primary image were found. This site may render its catalogue in JavaScript or use unsupported markup.");
  return { domain: homepage.url.hostname.toLowerCase(), submittedUrl: homepage.url.href, products: [...unique.values()] };
}
