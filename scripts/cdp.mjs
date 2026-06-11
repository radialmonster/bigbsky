// Minimal Chrome DevTools Protocol client (no deps; uses Node's global WebSocket).
// Usage:
//   node scripts/cdp.mjs eval "document.title"
//   node scripts/cdp.mjs resize 390x844
//   node scripts/cdp.mjs screenshot out.png
//   node scripts/cdp.mjs screenshot out.png 390x844
//   node scripts/cdp.mjs console 8        # capture console+errors for 8 seconds
//   node scripts/cdp.mjs html             # outerHTML of <body>
const HOST = process.env.CDP_HOST || "http://127.0.0.1:9222";
const TARGET_URL = process.env.CDP_TARGET_URL || "";

async function pickPageTarget() {
  const list = await (await fetch(`${HOST}/json`)).json();
  const pages = list.filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && /^https?:\/\//.test(t.url)
  );
  // Prefer the requested target, then a local Vite app tab, else first real http page.
  const page =
    (TARGET_URL ? pages.find((t) => t.url.includes(TARGET_URL)) : null) ||
    pages.find((t) => /https?:\/\/(127\.0\.0\.1|localhost):517\d\b/.test(t.url)) ||
    pages[0];
  if (!page) throw new Error("No http page target found. Is the app tab open?");
  return page;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const msgId = ++id;
            pending.set(msgId, { res, rej });
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        on(fn) { listeners.push(fn); },
        close() { ws.close(); },
      });
    ws.onerror = (e) => reject(e.message || e);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        listeners.forEach((fn) => fn(msg));
      }
    };
  });
}

function parseSize(first, second) {
  const raw = second ? `${first}x${second}` : first;
  const match = String(raw || "").trim().match(/^(\d{2,5})\s*[x,]\s*(\d{2,5})$/i);
  if (!match) {
    throw new Error("Size must look like 390x844, or pass width height.");
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 320) {
    throw new Error("Size must be at least 320x320.");
  }
  return { width, height };
}

async function setViewport(c, target, width, height) {
  await c.send("Page.enable");
  await c.send("Page.bringToFront");
  try {
    const { windowId } = await c.send("Browser.getWindowForTarget", { targetId: target.id });
    await c.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal", width, height },
    });
  } catch {
    // Headless or embedded targets may not expose Browser window bounds; the
    // emulated viewport still makes screenshots and layout inspection useful.
  }
  await c.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 720,
  });
}

const [, , cmd, arg, arg2] = process.argv;
const target = await pickPageTarget();
const c = await connect(target.webSocketDebuggerUrl);

if (cmd === "eval") {
  await c.send("Runtime.enable");
  const r = await c.send("Runtime.evaluate", {
    expression: arg,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    console.log("ERROR:", r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  else console.log(JSON.stringify(r.result.value ?? r.result, null, 2));
  c.close();
} else if (cmd === "resize") {
  const { width, height } = parseSize(arg, arg2);
  await setViewport(c, target, width, height);
  console.log(`resized ${target.url} to ${width}x${height}`);
  c.close();
} else if (cmd === "screenshot") {
  if (arg2) {
    const { width, height } = parseSize(arg2);
    await setViewport(c, target, width, height);
  }
  await c.send("Page.enable");
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(arg || "screenshot.png", Buffer.from(r.data, "base64"));
  console.log("saved", arg || "screenshot.png");
  c.close();
} else if (cmd === "html") {
  await c.send("Runtime.enable");
  const r = await c.send("Runtime.evaluate", {
    expression: "document.body.outerHTML",
    returnByValue: true,
  });
  console.log(r.result.value);
  c.close();
} else if (cmd === "console") {
  const secs = Number(arg || 8);
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  await c.send("Network.enable");
  c.on((m) => {
    if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties)).join(" ");
      console.log(`[console.${m.params.type}]`, text);
    } else if (m.method === "Runtime.exceptionThrown") {
      console.log("[exception]", m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    } else if (m.method === "Log.entryAdded") {
      console.log(`[${m.params.entry.level}]`, m.params.entry.text);
    } else if (m.method === "Network.responseReceived" && m.params.response.status >= 400) {
      console.log(`[net ${m.params.response.status}]`, m.params.response.url);
    }
  });
  console.log(`Listening for ${secs}s…`);
  await new Promise((r) => setTimeout(r, secs * 1000));
  c.close();
} else {
  console.log("commands: eval <expr> | resize <WxH> | screenshot <path> [WxH] | html | console <secs>");
  c.close();
}
