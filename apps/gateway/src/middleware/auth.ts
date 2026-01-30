import type { Context, Next } from "hono";
import { sendError } from "../utils/response";
import type { AuthContext } from "../ws/hub";

const AUTH_EXEMPT_PATH_PREFIXES = ["/health", "/openapi", "/docs", "/redoc"];

const textEncoder = new TextEncoder();

type JwtPayload = Record<string, unknown>;

type VerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: "invalid" | "expired" | "not_active" };

function isExemptPath(path: string): boolean {
  return AUTH_EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function getBearerToken(
  headerValue?: string | null,
): string | undefined {
  if (!headerValue) return undefined;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function parseWorkspaceIds(payload: JwtPayload): string[] {
  const raw = payload["workspaceIds"];
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === "string");
  }
  const workspaceId = payload["workspaceId"];
  if (typeof workspaceId === "string") return [workspaceId];
  return [];
}

function getUserId(payload: JwtPayload): string | undefined {
  const userId = payload["userId"];
  if (typeof userId === "string") return userId;
  const sub = payload["sub"];
  if (typeof sub === "string") return sub;
  const uid = payload["uid"];
  if (typeof uid === "string") return uid;
  return undefined;
}

function getApiKeyId(payload: JwtPayload): string | undefined {
  const apiKeyId = payload["apiKeyId"];
  if (typeof apiKeyId === "string") return apiKeyId;
  return undefined;
}

export async function verifyJwtHs256(
  token: string,
  secret: string,
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "invalid" };
  }

  const headerB64 = parts[0]!;
  const payloadB64 = parts[1]!;
  const signatureB64 = parts[2]!;

  let header: JwtPayload;
  let payload: JwtPayload;

  try {
    header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf8"),
    ) as JwtPayload;
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as JwtPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (header["alg"] !== "HS256") {
    return { ok: false, reason: "invalid" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = textEncoder.encode(`${headerB64}.${payloadB64}`);
  const signatureBuffer = Buffer.from(signatureB64, "base64url");
  const signatureUint8 = new Uint8Array(
    signatureBuffer.buffer,
    signatureBuffer.byteOffset,
    signatureBuffer.byteLength,
  );
  const valid = await crypto.subtle.verify("HMAC", key, signatureUint8, data);

  if (!valid) {
    return { ok: false, reason: "invalid" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = payload["exp"];
  if (typeof exp === "number" && nowSeconds >= exp) {
    return { ok: false, reason: "expired" };
  }
  const nbf = payload["nbf"];
  if (typeof nbf === "number" && nowSeconds < nbf) {
    return { ok: false, reason: "not_active" };
  }

  return { ok: true, payload };
}

export function buildAuthContext(
  payload: JwtPayload,
  isAdmin?: boolean,
): AuthContext {
  const ctx: AuthContext = {
    workspaceIds: parseWorkspaceIds(payload),
    isAdmin: isAdmin ?? payload["isAdmin"] === true,
  };
  const userId = getUserId(payload);
  if (userId !== undefined) {
    ctx.userId = userId;
  }
  const apiKeyId = getApiKeyId(payload);
  if (apiKeyId !== undefined) {
    ctx.apiKeyId = apiKeyId;
  }
  return ctx;
}

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    if (c.req.method === "OPTIONS" || isExemptPath(c.req.path)) {
      await next();
      return;
    }

    const adminKey = process.env["GATEWAY_ADMIN_KEY"]?.trim();
    const jwtSecret = process.env["JWT_SECRET"]?.trim();

    if (!adminKey && !jwtSecret) {
      await next();
      return;
    }

    const token = getBearerToken(c.req.header("Authorization"));
    if (!token) {
      return sendError(
        c,
        "AUTH_TOKEN_INVALID",
        "Authorization token required",
        401,
      );
    }

    if (adminKey && token === adminKey) {
      c.set("auth", buildAuthContext({}, true));
      await next();
      return;
    }

    if (!jwtSecret) {
      return sendError(
        c,
        "AUTH_TOKEN_INVALID",
        "Authentication token invalid",
        401,
      );
    }

    const result = await verifyJwtHs256(token, jwtSecret);
    if (!result.ok) {
      const code =
        result.reason === "expired"
          ? "AUTH_TOKEN_EXPIRED"
          : "AUTH_TOKEN_INVALID";
      const message =
        result.reason === "expired"
          ? "Authentication token expired"
          : "Authentication token invalid";
      return sendError(c, code, message, 401);
    }

    c.set("auth", buildAuthContext(result.payload));
    await next();
  };
}
