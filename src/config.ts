import "dotenv/config";
import path from "node:path";

function requiredUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required. Copy .env.example to .env and set it.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid HTTP or HTTPS URL.`); }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${name} must use HTTP or HTTPS.`);
  return url.origin;
}

const appBaseUrl = requiredUrl("APP_BASE_URL", process.env.APP_BASE_URL);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  appBaseUrl,
  databasePath: path.resolve(process.env.DATABASE_PATH ?? "./data/visual-merchandising.db"),
  imageStoragePath: path.resolve(process.env.IMAGE_STORAGE_PATH ?? "./data/images"),
  openaiApiKey: process.env.OPENAI_API_KEY,
  imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-sunburst"
};
