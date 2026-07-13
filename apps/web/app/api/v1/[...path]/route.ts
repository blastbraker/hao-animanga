import { buildApp, validateProductionEnvironment, type FastifyInstance } from "@hao/api";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

let appPromise: Promise<FastifyInstance> | undefined;

function getApp(): Promise<FastifyInstance> {
  if (appPromise) return appPromise;
  validateProductionEnvironment();
  const app = buildApp();
  appPromise = Promise.resolve(app.ready()).then(() => app);
  return appPromise;
}

async function handle(request: Request): Promise<Response> {
  try {
    const app = await getApp();
    const incomingUrl = new URL(request.url);
    const url = `${incomingUrl.pathname.replace(/^\/api/, "")}${incomingUrl.search}`;
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const method = request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
    const response = await app.inject({
      method,
      url,
      headers: Object.fromEntries(request.headers.entries()),
      ...(hasBody ? { payload: Buffer.from(await request.arrayBuffer()) } : {}),
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined || name.toLowerCase() === "transfer-encoding") continue;
      if (Array.isArray(value)) value.forEach((entry) => headers.append(name, String(entry)));
      else headers.set(name, String(value));
    }
    return new Response(response.body, { status: response.statusCode, headers });
  } catch (error) {
    console.error("HAO serverless API failed", error);
    return Response.json({ code: "UNAVAILABLE", message: "HAO API is unavailable", retryable: true }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
