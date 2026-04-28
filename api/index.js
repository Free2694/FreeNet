export const config = { runtime: "edge" };

const TARGETS = [
  process.env.TARGET_DOMAIN_1,
  process.env.TARGET_DOMAIN_2,
  process.env.TARGET_DOMAIN_3,
].map(t => (t ?? "").replace(/\/+$/, "")).filter(Boolean);

const SKIP = new Set([
  "host", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
]);

function buildUrl(base, reqUrl) {
  const i = reqUrl.indexOf("/", 8);
  return i === -1 ? `${base}/` : `${base}${reqUrl.slice(i)}`;
}

function cloneHeaders(src) {
  const headers = new Headers();
  let ip = "";
  for (const [k, v] of src) {
    if (k.startsWith("x-vercel-")) continue;
    if (SKIP.has(k)) continue;
    if (k === "x-real-ip") { ip = v; continue; }
    if (k === "x-forwarded-for") { if (!ip) ip = v; continue; }
    headers.set(k, v);
  }
  if (ip) headers.set("x-forwarded-for", ip);
  return headers;
}

export default async function handler(req) {
  if (!TARGETS.length) {
    return new Response("Misconfigured: no TARGET_DOMAIN set", { status: 500 });
  }

  const headers = cloneHeaders(req.headers);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const bodyBuffer = hasBody ? await req.arrayBuffer() : null;

  for (let i = 0; i < TARGETS.length; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(buildUrl(TARGETS[i], req.url), {
        method: req.method,
        headers,
        body: bodyBuffer ?? undefined,
        duplex: "half",
        redirect: "manual",
        signal: controller.signal,
      });

      clearTimeout(timer);
      return res;

    } catch (err) {
      console.warn(`Server ${i + 1} failed (${TARGETS[i]}):`, err?.message);
      if (i === TARGETS.length - 1) {
        const timedOut = err?.name === "AbortError";
        return new Response(
          timedOut ? "Gateway Timeout" : "Bad Gateway: All servers failed",
          { status: timedOut ? 504 : 502 }
        );
      }
    }
  }
}