import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.0\.0\./, /^192\.0\.2\./, /^192\.168\./, /^198\.(1[89])\./, /^198\.51\.100\./, /^203\.0\.113\./, /^22[4-9]\./, /^23\d\./
];

function isPrivateAddress(address: string): boolean {
  if (net.isIP(address) === 4) return PRIVATE_V4.some(pattern => pattern.test(address));
  const value = address.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:") || value.startsWith("::ffff:127.");
}

type LookupRecord = string | { address?: unknown; family?: unknown };

export function selectPublicAddresses(records: LookupRecord[]): Array<{ address: string; family: 4 | 6 }> {
  const addresses: Array<{ address: string; family: 4 | 6 }> = [];
  for (const record of records) {
    const address = typeof record === "string" ? record : record.address;
    if (typeof address !== "string") continue;
    const family = net.isIP(address);
    if ((family === 4 || family === 6) && !isPrivateAddress(address)) addresses.push({ address, family });
  }
  const ipv4 = addresses.filter(entry => entry.family === 4);
  return ipv4.length ? ipv4 : addresses;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a complete HTTP or HTTPS URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS URLs are allowed.");
  if (!url.hostname || url.username || url.password || url.hostname.toLowerCase() === "localhost" || url.hostname.endsWith(".localhost")) throw new Error("Local addresses are not allowed.");
  const addresses = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) throw new Error("Private or local network addresses are not allowed.");
  return url;
}

interface PublicResponse { url: URL; body: Buffer; contentType: string; }

async function download(url: URL, maxBytes: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(url, {
      headers: { "user-agent": "AI-Visual-Merchandising-MVP/0.1" },
      lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { all: true }).then(addresses => {
          const publicAddresses = selectPublicAddresses(addresses);
          if (!publicAddresses.length) return callback(new Error("Private or local network addresses are not allowed."), "", 4);
          if ((options as { all?: boolean }).all) {
            // Node enables this while selecting between IPv4 and IPv6 addresses.
            return (callback as unknown as (error: Error | null, results: typeof publicAddresses) => void)(null, publicAddresses);
          }
          const address = publicAddresses[0];
          callback(null, address.address, address.family);
        }).catch(error => callback(error, "", 4));
      }
    }, response => {
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > maxBytes) { response.resume(); reject(new Error("The response is too large to process.")); return; }
      const chunks: Buffer[] = []; let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > maxBytes) { request.destroy(new Error("The response is too large to process.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.setTimeout(12_000, () => request.destroy(new Error("request timed out")));
    request.on("error", error => {
      const message = error.message === "request timed out"
        ? "The request timed out. This storefront may block server-side requests."
        : error.message;
      reject(new Error(`Could not retrieve ${url.hostname}: ${message}`));
    });
  });
}

export async function fetchPublic(raw: string, maxBytes: number, acceptedContent: RegExp): Promise<PublicResponse> {
  let url = await assertPublicHttpUrl(raw);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await download(url, maxBytes);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location) throw new Error("The site returned an invalid redirect.");
      url = await assertPublicHttpUrl(new URL(Array.isArray(location) ? location[0] : location, url).href);
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new Error(`The store refused server-side access (HTTP ${response.status}). It may block automated requests.`);
    if (response.status < 200 || response.status >= 300) throw new Error(`The site returned HTTP ${response.status}.`);
    const contentType = String(response.headers["content-type"] ?? "");
    if (!acceptedContent.test(contentType)) throw new Error(`The response was not an allowed content type (${contentType || "unknown"}).`);
    if (!response.body.length) throw new Error("The site returned an empty response.");
    return { url, body: response.body, contentType };
  }
  throw new Error("The site redirected too many times.");
}

export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  return url.href;
}
