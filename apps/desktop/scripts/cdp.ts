// Inspect and drive the running desktop app over the WebView2 DevTools protocol.
// Start the app with `bun run tauri:debug` first, then:
//   bun scripts/cdp.ts screenshot [out.png] [WxH]   WxH emulates that viewport for the capture
//   bun scripts/cdp.ts logs [ms]            reload and print console output + exceptions
//   bun scripts/cdp.ts eval "<js expression>"
//   bun scripts/cdp.ts click "<css selector>"
//   bun scripts/cdp.ts type "<css selector>" "<text>"
//   bun scripts/cdp.ts insert "<text>"           real keyboard text into the focused element (Monaco)
//   bun scripts/cdp.ts key "Ctrl+S"              real key chord (Ctrl/Shift/Alt/Meta + key)
import { writeFile } from "node:fs/promises";

const PORT = Number(process.env.HARNESS_CDP_PORT ?? 9223);

interface CdpTarget {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

async function connect() {
  const targets: CdpTarget[] = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  // Headless Edge (scripts/preview.ts) also lists its own edge:// pages.
  const pages = targets.filter((t) => t.type === "page");
  const page = pages.find((t) => /^(https?|tauri):/.test(t.url)) ?? pages[0];
  if (!page) throw new Error(`No page target on port ${PORT}: ${JSON.stringify(targets)}`);

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map<number, (msg: any) => void>();
  const eventHandlers: ((msg: any) => void)[] = [];
  socket.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      for (const handler of eventHandlers) handler(msg);
    }
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send, onEvent: (h: (msg: any) => void) => eventHandlers.push(h), close: () => socket.close() };
}

async function evaluate(send: (m: string, p?: object) => Promise<any>, expression: string) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

const [command, ...args] = process.argv.slice(2);
const cdp = await connect();
try {
  switch (command) {
    case "screenshot": {
      const out = args[0] ?? "screenshot.png";
      const size = /^(\d+)x(\d+)$/.exec(args[1] ?? "");
      if (size) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(size[1]), height: Number(size[2]), deviceScaleFactor: 1, mobile: false });
        // Let resize listeners re-anchor before the capture.
        await Bun.sleep(400);
      }
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(out, Buffer.from(data, "base64"));
      console.log(out);
      break;
    }
    case "logs": {
      cdp.onEvent((msg) => {
        if (msg.method === "Runtime.consoleAPICalled") {
          const text = msg.params.args.map((a: any) => a.value ?? a.description ?? a.type).join(" ");
          console.log(`[console.${msg.params.type}] ${text}`);
        } else if (msg.method === "Runtime.exceptionThrown") {
          const d = msg.params.exceptionDetails;
          console.log(`[exception] ${d.exception?.description ?? d.text}`);
        } else if (msg.method === "Log.entryAdded") {
          console.log(`[log.${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
        }
      });
      await cdp.send("Runtime.enable");
      await cdp.send("Log.enable");
      await cdp.send("Page.reload");
      await Bun.sleep(Number(args[0] ?? 3000));
      break;
    }
    case "eval":
      console.log(JSON.stringify(await evaluate(cdp.send, args[0] ?? "document.title"), null, 2));
      break;
    case "click":
      await evaluate(cdp.send, `(() => {
        const el = document.querySelector(${JSON.stringify(args[0])});
        if (!el) throw new Error("no element for " + ${JSON.stringify(args[0])});
        el.click();
      })()`);
      break;
    case "type":
      // React tracks the value setter, so set through the prototype and fire input.
      await evaluate(cdp.send, `(() => {
        const el = document.querySelector(${JSON.stringify(args[0])});
        if (!el) throw new Error("no element for " + ${JSON.stringify(args[0])});
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
        setter.call(el, ${JSON.stringify(args[1] ?? "")});
        el.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      break;
    case "insert":
      await cdp.send("Input.insertText", { text: args[0] ?? "" });
      break;
    case "key": {
      const parts = (args[0] ?? "").split("+");
      const key = parts.pop()!;
      const modifiers = parts.reduce((m, p) => m | ({ Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 } as Record<string, number>)[p]!, 0);
      const named: Record<string, number> = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
      const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
      const keyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : (named[key] ?? 0);
      for (const type of ["keyDown", "keyUp"]) {
        await cdp.send("Input.dispatchKeyEvent", { type, modifiers, key, code, windowsVirtualKeyCode: keyCode });
      }
      break;
    }
    default:
      throw new Error(`unknown command ${command}`);
  }
} finally {
  cdp.close();
}
