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

function getBearerToken(headerValue?: string | null): string | undefined {
  if (!headerValue) return undefined;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function parseWorkspaceIds(payload: JwtPayload): string[] {
  const raw = payload.workspaceIds;
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === "string");
  }
  if (typeof payload.workspaceId === "string") return [payload.workspaceId];
  return [];
}

function getUserId(payload: JwtPayload): string | undefined {
  if (typeof payload.userId === "string") return payload.userId;
  if (typeof payload.sub === "string") return payload.sub;
  if (typeof payload.uid === "string") return payload.uid;
  return undefined;
}

function getApiKeyId(payload: JwtPayload): string | undefined {
  if (typeof payload.apiKeyId === "string") return payload.apiKeyId;
  return undefined;
}

async function verifyJwtHs256(
  token: string,
  secret: string,
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "invalid" };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
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

  if (header.alg !== "HS256") {
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
  const signature = Buffer.from(signatureB64, "base64url");
  const valid = await crypto.subtle.verify("HMAC", key, signature, data);

  if (!valid) {
    return { ok: false, reason: "invalid" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && nowSeconds >= payload.exp) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && nowSeconds < payload.nbf) {
    return { ok: false, reason: "not_active" };
  }

  return { ok: true, payload };
}

function buildAuthContext(payload: JwtPayload, isAdmin?: boolean): AuthContext {
  return {
    userId: getUserId(payload),
    apiKeyId: getApiKeyId(payload),
    workspaceIds: parseWorkspaceIds(payload),
    isAdmin: isAdmin ?? payload.isAdmin === true,
  };
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
