export const config = { runtime: "edge" };

const upstream = (process.env.TARGET_DOMAIN ?? "").replace(/\/+$/, "");

const dropHeaders = new Set([
  "host",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "proxy-authenticate",
  "proxy-authorization",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

function resolveTarget(base, incoming) {
  const cut = incoming.indexOf("/", 8);
  return cut === -1 ? `${base}/` : `${base}${incoming.slice(cut)}`;
}

function prepareHeaders(source) {
  const result = new Headers();
  let clientIp = "";

  for (const [key, val] of source) {
    if (key.startsWith("x-vercel-")) continue;
    if (dropHeaders.has(key)) continue;
    if (key === "x-real-ip") { clientIp = val; continue; }
    if (key === "x-forwarded-for") { if (!clientIp) clientIp = val; continue; }
    result.set(key, val);
  }

  if (clientIp) result.set("x-forwarded-for", clientIp);
  return result;
}

export default async function handler(req) {
  if (!upstream) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    const abort = new AbortController();
    const watchdog = setTimeout(() => abort.abort(), 10_000);
    const sendBody = req.method !== "GET" && req.method !== "HEAD";

    const response = await fetch(resolveTarget(upstream, req.url), {
      method: req.method,
      headers: prepareHeaders(req.headers),
      body: sendBody ? req.body : undefined,
      duplex: "half",
      redirect: "manual",
      signal: abort.signal,
    });

    clearTimeout(watchdog);
    return response;

  } catch (e) {
    const isTimeout = e?.name === "AbortError";
    console.error("relay error:", e?.message);
    return new Response(
      isTimeout ? "Gateway Timeout" : "Bad Gateway: Tunnel Failed",
      { status: isTimeout ? 504 : 502 }
    );
  }
}