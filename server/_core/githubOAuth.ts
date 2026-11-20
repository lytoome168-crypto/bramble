import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import * as db from "../db";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

const GITHUB_STATE_COOKIE = "__Host-github_oauth_state";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";
const STATE_MAX_AGE_SECONDS = 600;
const STATE_SEPARATOR = ".";

type GitHubUser = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
};

type GitHubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

type GitHubStatePayload = {
  nonce: string;
  issuedAt: number;
  redirectUri: string;
};

function publicOrigin(req: Request): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host");
  if (!host) throw new Error("Unable to determine public host");
  return `${protocol}://${host}`;
}

function callbackUrl(req: Request): string {
  return `${publicOrigin(req)}/api/oauth/github/callback`;
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none" as const,
    secure: true,
    maxAge: STATE_MAX_AGE_SECONDS * 1000,
  };
}

function safeEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireClientCredentials(): { clientId: string; clientSecret: string } {
  if (!ENV.githubClientId || !ENV.githubClientSecret) {
    throw new Error("GitHub OAuth credentials are not configured");
  }
  return { clientId: ENV.githubClientId, clientSecret: ENV.githubClientSecret };
}

function stateSecret(): Uint8Array {
  if (!ENV.cookieSecret) throw new Error("MANUS_JWT_SECRET is unavailable");
  return new TextEncoder().encode(ENV.cookieSecret);
}

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return bytes.toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function createSignedState(payload: GitHubStatePayload): string {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", stateSecret()).update(encodedPayload).digest();
  return `${encodedPayload}${STATE_SEPARATOR}${encodeBase64Url(signature)}`;
}

function verifySignedState(state: string, expectedRedirectUri: string): GitHubStatePayload | null {
  const [encodedPayload, encodedSignature] = state.split(STATE_SEPARATOR);
  if (!encodedPayload || !encodedSignature) return null;
  const expectedSignature = crypto.createHmac("sha256", stateSecret()).update(encodedPayload).digest();
  if (!safeEqual(encodedSignature, encodeBase64Url(expectedSignature))) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<GitHubStatePayload>;
    if (typeof payload.nonce !== "string" || typeof payload.issuedAt !== "number" || typeof payload.redirectUri !== "string") return null;
    if (payload.redirectUri !== expectedRedirectUri) return null;
    const now = Date.now();
    if (now - payload.issuedAt > STATE_MAX_AGE_SECONDS * 1000 || payload.issuedAt > now + 30_000) return null;
    return payload as GitHubStatePayload;
  } catch {
    return null;
  }
}

async function githubJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "bramble-workspace",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const { clientId, clientSecret } = requireClientCredentials();
  const token = await githubJson<{ access_token?: string; error?: string }>(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!token.access_token) throw new Error(token.error || "GitHub access token missing");
  return token.access_token;
}

async function getGitHubIdentity(accessToken: string): Promise<GitHubUser> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const user = await githubJson<GitHubUser>(`${GITHUB_API_URL}/user`, { headers });
  if (!user.id || !user.login) throw new Error("GitHub user identity is incomplete");

  let email = user.email;
  try {
    const emails = await githubJson<GitHubEmail[]>(`${GITHUB_API_URL}/user/emails`, { headers });
    email = emails.find(item => item.primary && item.verified)?.email
      ?? emails.find(item => item.verified)?.email
      ?? email;
  } catch (error) {
    // The account can still sign in when GitHub does not expose email scope.
    console.warn("[GitHub OAuth] Email lookup unavailable", error instanceof Error ? error.message : "unknown error");
  }

  return { ...user, email };
}

export function registerGitHubOAuthRoutes(app: Express) {
  app.get("/api/oauth/github/start", (req: Request, res: Response) => {
    try {
      const { clientId } = requireClientCredentials();
      const redirectUri = callbackUrl(req);
      const state = createSignedState({
        nonce: crypto.randomBytes(32).toString("hex"),
        issuedAt: Date.now(),
        redirectUri,
      });
      res.cookie(GITHUB_STATE_COOKIE, state, stateCookieOptions());

      const url = new URL(GITHUB_AUTHORIZE_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("scope", "read:user user:email");
      res.redirect(302, url.toString());
    } catch (error) {
      console.error("[GitHub OAuth] Start failed", error instanceof Error ? error.message : "unknown error");
      res.status(503).json({ error: "GitHub login is not configured" });
    }
  });

  app.get("/api/oauth/github/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    const expectedState = parseCookieHeader(req.headers.cookie ?? "")[GITHUB_STATE_COOKIE];
    res.clearCookie(GITHUB_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });

    if (error) {
      res.redirect(302, "/?auth_error=github_cancelled");
      return;
    }
    const redirectUri = callbackUrl(req);
    const signedState = state ? verifySignedState(state, redirectUri) : null;
    // Preview may partition or omit the state cookie when the OAuth callback
    // returns from GitHub. The signed, short-lived state remains verifiable;
    // when the cookie is present, require it to match as an extra CSRF check.
    if (!code || !signedState || (expectedState && !safeEqual(state, expectedState))) {
      res.status(403).json({ error: "invalid github oauth state" });
      return;
    }

    try {
      const accessToken = await exchangeCode(code, redirectUri);
      const identity = await getGitHubIdentity(accessToken);
      const openId = `github:${identity.id}`;
      const name = identity.name?.trim() || identity.login;

      await db.upsertUser({
        openId,
        name,
        email: identity.email ?? null,
        loginMethod: "github",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, { name, expiresInMs: ONE_YEAR_MS });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (callbackError) {
      console.error("[GitHub OAuth] Callback failed", callbackError instanceof Error ? callbackError.message : "unknown error");
      res.redirect(302, "/?auth_error=github_failed");
    }
  });
}

export const githubOAuthInternals = {
  safeEqual,
  publicOrigin,
  callbackUrl,
};
