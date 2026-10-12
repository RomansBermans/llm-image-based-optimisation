import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import OpenAI, { toFile } from "openai";
import { config } from "./config.js";
import { fetchPublic } from "./security.js";

const MIME_EXTENSIONS: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const EXTENSION_MIMES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function extensionFor(contentType: string): string {
  const type = contentType.split(";", 1)[0].toLowerCase();
  const extension = MIME_EXTENSIONS[type];
  if (!extension) throw new Error("The product image must be PNG, JPEG, or WebP for image editing.");
  return extension;
}

export function mimeTypeForPath(filePath: string): string {
  const mimeType = EXTENSION_MIMES[path.extname(filePath).toLowerCase()];
  if (!mimeType) throw new Error("The cached product image has an unsupported format.");
  return mimeType;
}

export async function cacheOriginalImage(productId: string, originalImageUrl: string): Promise<string> {
  const result = await fetchPublic(originalImageUrl, 15_000_000, /^image\/(jpeg|png|webp)\b/i);
  const fileName = `original-${productId}${extensionFor(result.contentType)}`;
  const relativePath = `/assets/images/${fileName}`;
  await fs.mkdir(config.imageStoragePath, { recursive: true });
  await fs.writeFile(path.join(config.imageStoragePath, fileName), result.body, { flag: "w" });
  return relativePath;
}

export async function generateVariant(productId: string, localImagePath: string, prompt: string): Promise<string> {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is not configured. Add it to .env before generating variants.");
  const source = path.join(config.imageStoragePath, path.basename(localImagePath));
  const client = new OpenAI({ apiKey: config.openaiApiKey, timeout: 120_000, maxRetries: 1 });
  let response;
  try {
    const image = await toFile(createReadStream(source), path.basename(source), { type: mimeTypeForPath(source) });
    response = await client.images.edit({ model: config.imageModel, image, prompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown image generation error";
    throw new Error(`Image generation failed: ${message}`);
  }
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) throw new Error("Image generation returned no image data.");
  const fileName = `variant-${productId}-${crypto.randomUUID()}.png`;
  await fs.writeFile(path.join(config.imageStoragePath, fileName), Buffer.from(encoded, "base64"));
  return `/assets/images/${fileName}`;
}
