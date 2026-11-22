import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Site icons for the Session panel's connectors. The desktop never loads a remote image itself: the
// daemon fetches a public domain's icon once, keeps it on disk, and answers a data: URL. Only public
// names are fetched, every redirect is checked again, and answers are capped in size.

const HIT_TTL_MS = 30 * 24 * 3_600_000;
const MISS_TTL_MS = 24 * 3_600_000;
const TIMEOUT_MS = 5_000;
const PAGE_CAP = 512 * 1024;
const ICON_CAP = 256 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; Zomfy)";

/** A name that resolves on the public internet: no IP address, localhost, or local-only suffix. */
export function isPublicDomain(domain: string): boolean {
  const name = domain.toLowerCase();
  if (name.length > 253 || !/^[a-z0-9.-]+$/.test(name)) return false;
  const labels = name.split(".");
  if (labels.length < 2) return false;
  if (labels.some((l) => l.length === 0 || l.length > 63 || l.startsWith("-") || l.endsWith("-"))) return false;
  if (labels.every((l) => /^\d+$/.test(l))) return false;
  const tld = labels[labels.length - 1]!;
  if (/^\d+$/.test(tld)) return false;
  if (["localhost", "local", "internal", "lan", "home", "test", "invalid", "example", "arpa", "intranet", "corp"].includes(tld)) return false;
  return true;
}

const SECOND_LEVELS = new Set(["co", "com", "ne", "net", "or", "org", "ac", "go", "gov", "edu", "gr", "ed", "lg"]);

/** The site a subdomain belongs to: `mcp.notion.com` → `notion.com`, `x.example.co.jp` → `example.co.jp`. */
export function siteDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".");
  const keep = labels.length >= 3 && labels[labels.length - 1]!.length === 2 && SECOND_LEVELS.has(labels[labels.length - 2]!) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/** The best icon a page declares, as an absolute URL: a touch icon, then a large or SVG icon, then any. */
export function pickIconHref(html: string, base: string): string | null {
  let best: { href: string; rank: number } | null = null;
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = attribute(tag, "href")?.trim();
    if (!href) continue;
    let rank = 0;
    if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) rank = 4;
    else if (rel.includes("icon")) {
      const sizes = attribute(tag, "sizes") ?? "";
      const size = Number(/(\d+)x\d+/i.exec(sizes)?.[1] ?? 0);
      const svg = (attribute(tag, "type") ?? "").includes("svg") || /\.svg(\?|$)/i.test(href);
      rank = svg || size >= 32 ? 3 : size > 0 ? 2 : 1;
      // A mask icon is one colour on transparent: it reads as a blot.
      if (rel.includes("mask-icon")) rank = 0;
    }
    if (rank === 0) continue;
    let url: string;
    try {
      url = new URL(href.replace(/&amp;/g, "&"), base).toString();
    } catch {
      continue;
    }
    if (!/^(https:|data:image\/)/.test(url)) continue;
    if (!best || rank > best.rank) best = { href: url, rank };
  }
  return best?.href ?? null;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** GET that follows redirects by hand, refusing any hop off https or to a non-public name. */
async function safeGet(fetchImpl: Fetch, url: string): Promise<{ response: Response; url: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || !isPublicDomain(parsed.hostname)) return null;
    const response = await fetchImpl(current, {
      redirect: "manual",
      credentials: "omit",
      headers: { "user-agent": USER_AGENT, accept: "text/html,image/*;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return response.ok ? { response, url: current } : null;
  }
  return null;
}

async function readCapped(response: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > cap) return null;
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

async function fetchImage(fetchImpl: Fetch, url: string): Promise<string | null> {
  if (url.startsWith("data:image/")) return url.length <= ICON_CAP * 1.4 ? url : null;
  const got = await safeGet(fetchImpl, url);
  if (!got) return null;
  const { response } = got;
  let type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!type.startsWith("image/")) {
    // favicon.ico is often served untyped.
    if (/\.ico(\?|$)/i.test(url) && (type === "" || type === "application/octet-stream")) type = "image/x-icon";
    else return null;
  }
  const bytes = await readCapped(response, ICON_CAP);
  if (!bytes || bytes.byteLength === 0) return null;
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * Domains whose home page answers a sign-in or a shared parent's icon, mapped to the product's own
 * published icon, so Gmail, Calendar and Drive do not all read as one Google "G".
 */
const PRODUCT_ICONS: Record<string, string> = {
  "mail.google.com": "https://ssl.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png",
  "calendar.google.com": "https://ssl.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png",
  "drive.google.com": "https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
  "docs.google.com": "https://ssl.gstatic.com/images/branding/product/2x/docs_2020q4_48dp.png",
};

/** Fetches one domain's icon: what its home page declares, else /favicon.ico; then the same for its site. */
export async function fetchFavicon(domain: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const product = PRODUCT_ICONS[domain];
  if (product) {
    const found = await fetchImage(fetchImpl, product).catch(() => null);
    if (found) return found;
  }
  const hosts = [domain, siteDomain(domain)].filter((host, i, all) => all.indexOf(host) === i);
  for (const host of hosts) {
    const tried = new Set<string>();
    const attempt = async (url: string) => {
      if (tried.has(url)) return null;
      tried.add(url);
      return fetchImage(fetchImpl, url).catch(() => null);
    };
    let origin = `https://${host}`;
    try {
      const page = await safeGet(fetchImpl, `${origin}/`);
      // A home page that redirects to another site (a project's GitHub page) would lend it that site's icon.
      if (page && siteDomain(new URL(page.url).hostname) === siteDomain(host)) {
        const finalUrl = page.url;
        origin = new URL(finalUrl).origin;
        const html = await readCapped(page.response, PAGE_CAP);
        const href = html ? pickIconHref(new TextDecoder().decode(html), finalUrl) : null;
        const found = href ? await attempt(href) : null;
        if (found) return found;
      }
    } catch {
      // Unreachable or slow: /favicon.ico may still answer.
    }
    const found = (await attempt(`${origin}/favicon.ico`)) ?? (origin !== `https://${host}` ? await attempt(`https://${host}/favicon.ico`) : null);
    if (found) return found;
  }
  return null;
}

interface Entry {
  at: number;
  dataUrl: string | null;
}

/** Icons by domain, in memory and on disk; hits kept a month, misses a day, one fetch per domain at a time. */
export class FaviconCache {
  private readonly memory = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly dir: string,
    private readonly fetcher: (domain: string) => Promise<string | null> = (domain) => fetchFavicon(domain),
    private readonly now: () => number = Date.now,
  ) {}

  private fresh(entry: Entry | undefined): entry is Entry {
    return !!entry && this.now() - entry.at < (entry.dataUrl ? HIT_TTL_MS : MISS_TTL_MS);
  }

  get(rawDomain: string): Promise<string | null> {
    const domain = rawDomain.trim().toLowerCase().replace(/\.$/, "");
    if (!isPublicDomain(domain)) return Promise.resolve(null);
    const known = this.memory.get(domain);
    if (this.fresh(known)) return Promise.resolve(known.dataUrl);
    const running = this.inFlight.get(domain);
    if (running) return running;
    const file = join(this.dir, `${domain}.json`);
    const request = (async () => {
      const stored = await readFile(file, "utf8")
        .then((text) => JSON.parse(text) as Entry)
        .catch(() => undefined);
      if (this.fresh(stored)) {
        this.memory.set(domain, stored);
        return stored.dataUrl;
      }
      const dataUrl = await this.fetcher(domain).catch(() => null);
      const entry = { at: this.now(), dataUrl };
      this.memory.set(domain, entry);
      await mkdir(this.dir, { recursive: true })
        .then(() => writeFile(file, JSON.stringify(entry)))
        .catch(() => {});
      return dataUrl;
    })().finally(() => this.inFlight.delete(domain));
    this.inFlight.set(domain, request);
    return request;
  }
}
