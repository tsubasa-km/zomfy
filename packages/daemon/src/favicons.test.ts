import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FaviconCache, fetchFavicon, isPublicDomain, pickIconHref, siteDomain } from "./favicons.ts";

describe("isPublicDomain", () => {
  test("takes public names", () => {
    for (const name of ["notion.com", "mcp.notion.com", "mail.google.com", "cybozu.co.jp"]) expect(isPublicDomain(name)).toBe(true);
  });
  test("refuses local names and addresses", () => {
    for (const name of ["localhost", "intranet", "127.0.0.1", "10.0.0.5", "printer.local", "api.internal", "box.lan", "[::1]", "a..b", "-x.com", "x.123"])
      expect(isPublicDomain(name)).toBe(false);
  });
});

describe("siteDomain", () => {
  test("drops subdomains, keeping a country's second level", () => {
    expect(siteDomain("mcp.notion.com")).toBe("notion.com");
    expect(siteDomain("notion.com")).toBe("notion.com");
    expect(siteDomain("a.b.cybozu.co.jp")).toBe("cybozu.co.jp");
    expect(siteDomain("mcp.atlassian.io")).toBe("atlassian.io");
  });
});

describe("pickIconHref", () => {
  const base = "https://www.example.org/app/";
  test("prefers a touch icon, then a large or SVG icon, then any icon", () => {
    const html = `<link rel="icon" href="/small.ico"><link rel='icon' type='image/svg+xml' href='logo.svg'><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">`;
    expect(pickIconHref(html, base)).toBe("https://www.example.org/touch.png");
    expect(pickIconHref(`<link rel="shortcut icon" href="/a.ico"><link rel=icon href=logo.svg>`, base)).toBe("https://www.example.org/app/logo.svg");
  });
  test("skips mask icons, plain http and links that are not icons", () => {
    expect(pickIconHref(`<link rel="mask-icon" href="/mask.svg"><link rel="stylesheet" href="/a.css">`, base)).toBeNull();
    expect(pickIconHref(`<link rel="icon" href="http://cdn.example.org/a.png">`, base)).toBeNull();
  });
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function fakeFetch(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const impl = async (url: string) => {
    asked.push(url);
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  };
  return { impl, asked };
}

describe("fetchFavicon", () => {
  test("follows a redirect to the declared icon", async () => {
    const { impl } = fakeFetch({
      "https://notion.com/": () => new Response(null, { status: 301, headers: { location: "https://www.notion.com/" } }),
      "https://www.notion.com/": () => new Response(`<link rel="icon" sizes="32x32" href="/i.png">`, { headers: { "content-type": "text/html" } }),
      "https://www.notion.com/i.png": () => new Response(png, { headers: { "content-type": "image/png" } }),
    });
    expect(await fetchFavicon("notion.com", impl)).toBe(`data:image/png;base64,${Buffer.from(png).toString("base64")}`);
  });

  test("falls back to the site's favicon.ico, typed or not", async () => {
    const { impl, asked } = fakeFetch({
      "https://notion.com/favicon.ico": () => new Response(png),
    });
    expect(await fetchFavicon("mcp.notion.com", impl)).toStartWith("data:image/x-icon;base64,");
    expect(asked).toContain("https://mcp.notion.com/favicon.ico");
  });

  test("refuses a redirect to a local address and an answer that is not an image", async () => {
    const { impl, asked } = fakeFetch({
      "https://evil.example.com/": () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }),
      "https://evil.example.com/favicon.ico": () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    });
    expect(await fetchFavicon("evil.example.com", impl)).toBeNull();
    expect(asked.some((url) => url.includes("127.0.0.1"))).toBe(false);
  });

  test("refuses an icon over the size cap", async () => {
    const { impl } = fakeFetch({
      "https://big.example.com/favicon.ico": () => new Response(new Uint8Array(300 * 1024), { headers: { "content-type": "image/x-icon" } }),
    });
    expect(await fetchFavicon("big.example.com", impl)).toBeNull();
  });
});

describe("FaviconCache", () => {
  test("fetches a domain once, shares a running fetch, and keeps the answer on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "favicons-"));
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return "data:image/png;base64,AA==";
    };
    const cache = new FaviconCache(dir, fetcher);
    const [a, b] = await Promise.all([cache.get("Notion.com"), cache.get("notion.com")]);
    expect(a).toBe("data:image/png;base64,AA==");
    expect(b).toBe(a);
    expect(calls).toBe(1);
    expect(readdirSync(dir)).toEqual(["notion.com.json"]);
    // A new cache (a restarted daemon) reads the file instead of fetching.
    expect(await new FaviconCache(dir, fetcher).get("notion.com")).toBe(a);
    expect(calls).toBe(1);
  });

  test("asks again for a miss after a day, and never for a local name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "favicons-"));
    let now = 0;
    let calls = 0;
    const cache = new FaviconCache(
      dir,
      async () => {
        calls++;
        return null;
      },
      () => now,
    );
    expect(await cache.get("none.example.com")).toBeNull();
    expect(await cache.get("none.example.com")).toBeNull();
    expect(calls).toBe(1);
    now = 25 * 3_600_000;
    await cache.get("none.example.com");
    expect(calls).toBe(2);
    expect(await cache.get("localhost")).toBeNull();
    expect(calls).toBe(2);
  });
});
