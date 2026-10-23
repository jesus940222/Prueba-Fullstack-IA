import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AccessStore } from "../../application/access-store";
import type { AuthStepResult, AuthWorkflows, IssuedSession } from "../../application/auth-workflows";
import type { DirectoryWorkflows } from "../../application/directory-workflows";
import type { ServiceAuthenticator } from "../../application/ports";
import { AccessError, httpStatusFor } from "../../domain/access-error";
import { assertInternalReturnTo } from "../../domain/identity";
import { pageResult, parsePageQuery, type PageQuery } from "../../domain/pagination";
import type { ApplicationRecord, RoleRecord, UserRecord } from "../../domain/records";
import { isRecentlyVerified } from "../../domain/session-policy";

const email = z.string().trim().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export interface AccessHttpDependencies {
  auth: AuthWorkflows;
  directory: DirectoryWorkflows;
  store: AccessStore;
  services: ServiceAuthenticator;
  jwks: () => Promise<{ keys: Record<string, unknown>[] }>;
  pageDefault: number;
  pageMax: number;
  accessTokenTtl: number;
  sessionAbsoluteTtl: number;
  recentVerificationTtl: number;
  now: () => Date;
}

export interface AccessHttpRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  cookie: string | undefined;
  csrf: string | undefined;
  authorization: string | undefined;
  correlationId: string;
  ip: string;
  secure: boolean;
}

export interface AccessHttpResult {
  status: number;
  body?: unknown;
  headers: Record<string, string | string[]>;
}

export async function handleAccess(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  try {
    return await dispatch(deps, request);
  } catch (error) {
    if (error instanceof AccessError) {
      return json(httpStatusFor(error.code), {
        code: error.code,
        message: error.message,
        correlationId: request.correlationId,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      });
    }
    return json(500, { code: "UNEXPECTED_FAILURE", message: "No se pudo completar la operación", correlationId: request.correlationId });
  }
}

export function mountAccess(app: { use: (handler: (req: Request, res: Response, next: NextFunction) => void) => void }, deps: AccessHttpDependencies): void {
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/v1/access") && req.path !== "/internal/v1/access/authorize" && req.path !== "/internal/v1/access/alert-recipients") {
      next();
      return;
    }
    const correlation = res.getHeader("x-correlation-id");
    void handleAccess(deps, {
      method: req.method,
      path: req.path,
      query: req.query as Record<string, unknown>,
      body: req.body,
      cookie: req.header("cookie"),
      csrf: req.header("x-csrf-token"),
      authorization: req.header("authorization"),
      correlationId: typeof correlation === "string" ? correlation : "00000000-0000-4000-8000-000000000000",
      ip: req.ip ?? "0.0.0.0",
      secure: req.secure || req.header("x-forwarded-proto") === "https",
    }).then((result) => {
      for (const [name, value] of Object.entries(result.headers)) {
        res.setHeader(name, value);
      }
      if (result.body === undefined) {
        res.status(result.status).end();
        return;
      }
      res.status(result.status).json(result.body);
    }).catch(() => {
      if (!res.headersSent) {
        res.status(500).json({ code: "UNEXPECTED_FAILURE" });
      }
    });
  });
}

async function dispatch(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const matched = match(request.method, request.path);
  if (!matched) {
    return json(404, { code: "RESOURCE_NOT_VISIBLE", message: "La ruta no está disponible", correlationId: request.correlationId });
  }
  if (matched.csrf) {
    assertCsrf(request);
  }
  return matched.run(deps, request, matched.params);
}

function match(method: string, path: string): { csrf: boolean; params: Record<string, string>; run: Route } | null {
  for (const candidate of ROUTES) {
    if (candidate.method !== method) {
      continue;
    }
    const found = candidate.pattern.exec(path);
    if (!found) {
      continue;
    }
    return { csrf: candidate.csrf, params: found.groups ?? {}, run: candidate.run };
  }
  return null;
}

type Route = (deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>) => Promise<AccessHttpResult>;

const ROUTES: Array<{ method: string; pattern: RegExp; csrf: boolean; run: Route }> = [
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/login$/, csrf: false, run: login },
  { method: "GET", pattern: /^\/api\/v1\/access\/auth\/oidc\/(?<provider>google|microsoft)\/start$/, csrf: false, run: oidcStart },
  { method: "GET", pattern: /^\/api\/v1\/access\/auth\/oidc\/(?<provider>google|microsoft)\/callback$/, csrf: false, run: oidcCallback },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/challenges\/(?<id>[0-9a-f-]{36})\/email\/resend$/i, csrf: true, run: resend },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/challenges\/(?<id>[0-9a-f-]{36})\/email\/verify$/i, csrf: true, run: verifyEmail },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/challenges\/(?<id>[0-9a-f-]{36})\/passkey\/options$/i, csrf: true, run: passkeyOptions },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/challenges\/(?<id>[0-9a-f-]{36})\/passkey\/verify$/i, csrf: true, run: verifyPasskey },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/challenges\/(?<id>[0-9a-f-]{36})\/recovery-code\/verify$/i, csrf: true, run: verifyRecovery },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/password\/forgot$/, csrf: false, run: forgot },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/password\/reset$/, csrf: false, run: reset },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/refresh$/, csrf: true, run: refresh },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/logout$/, csrf: true, run: logout },
  { method: "POST", pattern: /^\/api\/v1\/access\/auth\/logout-all$/, csrf: true, run: logoutAll },
  { method: "GET", pattern: /^\/api\/v1\/access\/me$/, csrf: false, run: profile },
  { method: "PATCH", pattern: /^\/api\/v1\/access\/me$/, csrf: true, run: updateProfile },
  { method: "GET", pattern: /^\/api\/v1\/access\/me\/permissions$/, csrf: false, run: permissions },
  { method: "POST", pattern: /^\/api\/v1\/access\/me\/password\/change$/, csrf: true, run: changePassword },
  { method: "GET", pattern: /^\/api\/v1\/access\/me\/sessions$/, csrf: false, run: sessions },
  { method: "DELETE", pattern: /^\/api\/v1\/access\/me\/sessions\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: revokeOwnSession },
  { method: "GET", pattern: /^\/api\/v1\/access\/me\/passkeys$/, csrf: false, run: passkeys },
  { method: "POST", pattern: /^\/api\/v1\/access\/me\/passkeys\/registration\/options$/, csrf: true, run: registrationOptions },
  { method: "POST", pattern: /^\/api\/v1\/access\/me\/passkeys\/registration\/verify$/, csrf: true, run: registrationVerify },
  { method: "PATCH", pattern: /^\/api\/v1\/access\/me\/passkeys\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: renamePasskey },
  { method: "DELETE", pattern: /^\/api\/v1\/access\/me\/passkeys\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: revokePasskey },
  { method: "POST", pattern: /^\/api\/v1\/access\/me\/recovery-codes\/regenerate$/, csrf: true, run: recoveryCodes },
  { method: "GET", pattern: /^\/api\/v1\/access\/me\/identities$/, csrf: false, run: identities },
  { method: "POST", pattern: /^\/api\/v1\/access\/me\/identities\/(?<provider>google|microsoft)\/link$/, csrf: true, run: linkIdentity },
  { method: "DELETE", pattern: /^\/api\/v1\/access\/me\/identities\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: unlinkIdentity },
  { method: "GET", pattern: /^\/api\/v1\/access\/users$/, csrf: false, run: users },
  { method: "POST", pattern: /^\/api\/v1\/access\/users$/, csrf: true, run: invite },
  { method: "GET", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: user },
  { method: "PATCH", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: updateUser },
  { method: "DELETE", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: deleteUser },
  { method: "POST", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})\/restore$/i, csrf: true, run: restoreUser },
  { method: "POST", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})\/sessions\/revoke$/i, csrf: true, run: revokeUserSessions },
  { method: "PATCH", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})\/passkey-policy$/i, csrf: true, run: passkeyPolicy },
  { method: "POST", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})\/recovery-requests$/i, csrf: true, run: recoveryRequest },
  { method: "POST", pattern: /^\/api\/v1\/access\/recovery-requests\/(?<id>[0-9a-f-]{36})\/complete$/i, csrf: true, run: completeRecovery },
  { method: "GET", pattern: /^\/api\/v1\/access\/applications$/, csrf: false, run: applications },
  { method: "POST", pattern: /^\/api\/v1\/access\/applications$/, csrf: true, run: createApplication },
  { method: "GET", pattern: /^\/api\/v1\/access\/applications\/(?<id>[0-9a-f-]{36})$/i, csrf: false, run: application },
  { method: "PATCH", pattern: /^\/api\/v1\/access\/applications\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: updateApplication },
  { method: "DELETE", pattern: /^\/api\/v1\/access\/applications\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: deleteApplication },
  { method: "POST", pattern: /^\/api\/v1\/access\/applications\/(?<id>[0-9a-f-]{36})\/restore$/i, csrf: true, run: restoreApplication },
  { method: "GET", pattern: /^\/api\/v1\/access\/applications\/(?<id>[0-9a-f-]{36})\/permissions$/i, csrf: false, run: permissionCatalog },
  { method: "GET", pattern: /^\/api\/v1\/access\/applications\/(?<id>[0-9a-f-]{36})\/roles$/i, csrf: false, run: roles },
  { method: "POST", pattern: /^\/api\/v1\/access\/applications\/(?<id>[0-9a-f-]{36})\/roles$/i, csrf: true, run: createRole },
  { method: "GET", pattern: /^\/api\/v1\/access\/applications\/(?<appId>[0-9a-f-]{36})\/roles\/(?<roleId>[0-9a-f-]{36})$/i, csrf: false, run: role },
  { method: "PATCH", pattern: /^\/api\/v1\/access\/applications\/(?<appId>[0-9a-f-]{36})\/roles\/(?<roleId>[0-9a-f-]{36})$/i, csrf: true, run: updateRole },
  { method: "DELETE", pattern: /^\/api\/v1\/access\/applications\/(?<appId>[0-9a-f-]{36})\/roles\/(?<roleId>[0-9a-f-]{36})$/i, csrf: true, run: deleteRole },
  { method: "POST", pattern: /^\/api\/v1\/access\/applications\/(?<appId>[0-9a-f-]{36})\/roles\/(?<roleId>[0-9a-f-]{36})\/restore$/i, csrf: true, run: restoreRole },
  { method: "PUT", pattern: /^\/api\/v1\/access\/applications\/(?<appId>[0-9a-f-]{36})\/roles\/(?<roleId>[0-9a-f-]{36})\/permissions$/i, csrf: true, run: replacePermissions },
  { method: "GET", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})\/role-assignments$/i, csrf: false, run: assignments },
  { method: "POST", pattern: /^\/api\/v1\/access\/users\/(?<id>[0-9a-f-]{36})\/role-assignments$/i, csrf: true, run: assignRole },
  { method: "DELETE", pattern: /^\/api\/v1\/access\/users\/(?<userId>[0-9a-f-]{36})\/role-assignments\/(?<id>[0-9a-f-]{36})$/i, csrf: true, run: revokeAssignment },
  { method: "GET", pattern: /^\/api\/v1\/access\/\.well-known\/jwks\.json$/, csrf: false, run: jwks },
  { method: "POST", pattern: /^\/internal\/v1\/access\/authorize$/, csrf: false, run: authorize },
  { method: "POST", pattern: /^\/internal\/v1\/access\/alert-recipients$/, csrf: false, run: alertRecipients },
];

async function login(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const body = parse(z.object({ email, password: z.string().min(1).max(200) }).strict(), request.body);
  return stepResult(deps, request, await deps.auth.login(body.email, body.password, request.ip));
}

async function oidcStart(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const provider = providerOf(params.provider);
  const returnTo = assertInternalReturnTo(typeof request.query.returnTo === "string" ? request.query.returnTo : undefined);
  const location = await deps.auth.startOidc(provider, "login", null, returnTo);
  return { status: 302, headers: { location } };
}

async function oidcCallback(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const provider = providerOf(params.provider);
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  const completed = await deps.auth.completeOidc(provider, code, state);
  const headers: Record<string, string | string[]> = { location: completed.returnTo };
  if (completed.step?.session) {
    headers["set-cookie"] = sessionCookies(completed.step.session, request.secure, deps);
  }
  return { status: 302, headers };
}

async function resend(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  return stepResult(deps, request, await deps.auth.resendEmail(params.id ?? ""));
}

async function verifyEmail(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const body = parse(z.object({ proof: z.string().min(1).max(8000) }).strict(), request.body);
  return stepResult(deps, request, await deps.auth.verifyEmail(params.id ?? "", body.proof));
}

async function passkeyOptions(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  return stepResult(deps, request, await deps.auth.passkeyOptions(params.id ?? ""));
}

async function verifyPasskey(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const body = parse(z.object({ proof: z.string().min(1).max(8000) }).strict(), request.body);
  return stepResult(deps, request, await deps.auth.verifyPasskey(params.id ?? "", proofObject(body.proof)));
}

async function verifyRecovery(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const body = parse(z.object({ proof: z.string().min(1).max(8000) }).strict(), request.body);
  return stepResult(deps, request, await deps.auth.verifyRecoveryCode(params.id ?? "", body.proof));
}

async function forgot(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const body = parse(z.object({ email }).strict(), request.body);
  await deps.auth.forgotPassword(body.email);
  return json(202, { accepted: true });
}

async function reset(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const body = parse(z.object({ token: z.string().min(1).max(8000), password: z.string().min(1).max(200) }).strict(), request.body);
  await deps.auth.resetPassword(body.token, body.password);
  return empty(204);
}

async function refresh(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const token = readCookie(request.cookie, "portal_refresh");
  const issued = await deps.auth.refresh(token ?? "");
  return { status: 204, headers: { "set-cookie": sessionCookies(issued, request.secure, deps) } };
}

async function logout(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request);
  await deps.auth.logout(current.session.id);
  return { status: 204, headers: { "set-cookie": clearCookies(request.secure) } };
}

async function logoutAll(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request);
  await deps.auth.logoutAll(current.user.id);
  return { status: 204, headers: { "set-cookie": clearCookies(request.secure) } };
}

async function profile(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "profile:read:own");
  return json(200, profileOf(current.user));
}

async function updateProfile(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "profile:update:own");
  const body = parse(z.object({
    givenName: z.string().trim().min(1).max(80).optional(),
    familyName: z.string().trim().min(1).max(80).optional(),
    phoneCountryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    phoneNumber: z.string().regex(/^[0-9]{4,15}$/).optional(),
    themePreference: z.enum(["light", "dark", "system"]).optional(),
  }).strict(), request.body);
  return json(200, profileOf(await deps.directory.updateProfile(current.user, body)));
}

async function permissions(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request);
  return json(200, { permissions: current.permissions });
}

async function changePassword(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:manage:own", true);
  const body = parse(z.object({ currentPassword: z.string().min(1).max(4000), newPassword: z.string().min(12).max(200) }).strict(), request.body);
  await deps.auth.changePassword(current.user.id, body.currentPassword, body.newPassword);
  return empty(204);
}

async function sessions(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "sessions:read:own");
  const query = page(deps, request);
  const found = await deps.directory.listSessions(current.user.id, query);
  return json(200, pageOf(found.items.map(sessionOf), found.totalItems, query));
}

async function revokeOwnSession(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "sessions:revoke:own");
  const target = await deps.store.findSession(params.id ?? "");
  if (!target || target.userId !== current.user.id) {
    throw new AccessError("RESOURCE_NOT_VISIBLE", "La sesión no está disponible");
  }
  await deps.auth.logout(target.id);
  return empty(204);
}

async function passkeys(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:manage:own");
  const query = page(deps, request);
  const found = await deps.directory.listPasskeys(current.user.id, query);
  return json(200, pageOf(found.items.map((item) => ({ id: item.id, name: item.name, createdAt: item.createdAt, lastUsedAt: item.lastUsedAt })), found.totalItems, query));
}

async function registrationOptions(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request);
  if (!current.session.restricted) {
    await deps.auth.assertPermission(current.permissions, "security:manage:own");
  }
  const step = await deps.auth.registrationOptions(current.user.id, current.session.restricted);
  return json(200, { challengeId: step.challengeId, options: step.options ?? {} });
}

async function registrationVerify(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request);
  if (!current.session.restricted) {
    await deps.auth.assertPermission(current.permissions, "security:manage:own");
    await deps.auth.assertRecent(current.session);
  }
  const body = parse(z.object({ challengeId: uuid, response: z.record(z.string(), z.unknown()) }).strict(), request.body);
  await deps.auth.verifyRegistration(current.user.id, body.challengeId, body.response);
  return empty(204);
}

async function renamePasskey(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:manage:own");
  const body = parse(z.object({ name: z.string().trim().min(1).max(80) }).strict(), request.body);
  await deps.auth.renamePasskey(current.user.id, params.id ?? "", body.name);
  return empty(204);
}

async function revokePasskey(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:manage:own");
  await deps.auth.revokePasskey(current.user.id, params.id ?? "");
  return empty(204);
}

async function recoveryCodes(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:manage:own", true);
  return json(200, { codes: await deps.auth.regenerateRecoveryCodes(current.user.id) });
}

async function identities(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:manage:own");
  const query = page(deps, request);
  const found = await deps.directory.listIdentities(current.user.id, query);
  return json(200, pageOf(found.items.map((item) => ({ id: item.id, provider: item.provider, linkedAt: item.linkedAt })), found.totalItems, query));
}

async function linkIdentity(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:manage:own");
  const body = parse(z.object({ returnTo: z.string().optional() }).strict(), request.body);
  const authorizationUrl = await deps.auth.startOidc(providerOf(params.provider), "link", current.user.id, assertInternalReturnTo(body.returnTo));
  return json(200, { authorizationUrl });
}

async function unlinkIdentity(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:manage:own");
  await deps.auth.unlinkIdentity(current.user.id, params.id ?? "");
  return empty(204);
}

async function users(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "users:read");
  const query = page(deps, request);
  const found = await deps.directory.listUsers(current.permissions, query);
  return json(200, pageOf(found.items.map(userOf), found.totalItems, query));
}

async function invite(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "users:create");
  const body = parse(z.object({ email, givenName: z.string().trim().min(1).max(80), familyName: z.string().trim().min(1).max(80) }).strict(), request.body);
  return json(201, userOf(await deps.directory.invite(current.user.id, body)));
}

async function user(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "users:read");
  return json(200, userOf(await visibleUser(deps, params.id ?? "", current.permissions)));
}

async function updateUser(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "users:update");
  const body = parse(z.object({
    givenName: z.string().trim().min(1).max(80).optional(),
    familyName: z.string().trim().min(1).max(80).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  }).strict(), request.body);
  return json(200, userOf(await deps.directory.updateUser(current.user.id, params.id ?? "", body)));
}

async function deleteUser(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "users:delete");
  await deps.directory.deleteUser(current.user.id, params.id ?? "");
  return empty(204);
}

async function restoreUser(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "users:restore");
  void current;
  return json(200, userOf(await deps.directory.restoreUser(params.id ?? "")));
}

async function revokeUserSessions(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "sessions:revoke:any");
  void current;
  await visibleUser(deps, params.id ?? "", ["users:read"]);
  await deps.auth.logoutAll(params.id ?? "");
  return empty(204);
}

async function passkeyPolicy(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:passkeys:configure");
  const body = parse(z.object({ action: z.enum(["enable", "disable"]) }).strict(), request.body);
  await deps.directory.configurePasskey(current.user.id, params.id ?? "", body.action);
  return empty(204);
}

async function recoveryRequest(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:recovery:initiate");
  const body = parse(z.object({ reason: z.string().trim().min(1).max(500) }).strict(), request.body);
  return json(201, await deps.directory.initiateRecovery(current.user.id, params.id ?? "", body.reason));
}

async function completeRecovery(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "security:recovery:complete");
  await deps.auth.completeRecovery(params.id ?? "", current.user.id);
  return empty(204);
}

async function applications(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "applications:read");
  const query = page(deps, request);
  const found = await deps.directory.listApplications(current.permissions, query);
  return json(200, pageOf(found.items.map(applicationOf), found.totalItems, query));
}

async function createApplication(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  await actor(deps, request, "applications:create");
  const body = parse(z.object({ code: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(80), description: z.string().max(500).optional() }).strict(), request.body);
  return json(201, applicationOf(await deps.directory.createApplication(body)));
}

async function application(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "applications:read");
  const found = await deps.store.findApplication(params.id ?? "");
  if (!found || (found.deletedAt !== null && !current.permissions.includes("applications:read:deleted"))) {
    throw new AccessError("RESOURCE_NOT_VISIBLE", "La aplicación no está disponible");
  }
  return json(200, applicationOf(found));
}

async function updateApplication(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  await actor(deps, request, "applications:update");
  const body = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(500).optional(), status: z.enum(["active", "disabled"]).optional() }).strict(), request.body);
  return json(200, applicationOf(await deps.directory.updateApplication(params.id ?? "", body)));
}

async function deleteApplication(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  await actor(deps, request, "applications:delete");
  await deps.directory.deleteApplication(params.id ?? "");
  return empty(204);
}

async function restoreApplication(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  await actor(deps, request, "applications:restore");
  return json(200, applicationOf(await deps.directory.restoreApplication(params.id ?? "")));
}

async function permissionCatalog(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  await actor(deps, request, "permissions:read");
  const query = page(deps, request);
  const items = deps.directory.listPermissions();
  const window = items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  return json(200, pageOf(window, items.length, query));
}

async function roles(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "roles:read");
  const query = page(deps, request);
  const found = await deps.directory.listRoles(params.id ?? "", current.permissions, query);
  return json(200, pageOf(found.items.map(roleOf), found.totalItems, query));
}

async function createRole(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  await actor(deps, request, "roles:create");
  const body = parse(z.object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).optional(),
    permissionCodes: z.array(z.string()).default([]),
  }).strict(), request.body);
  return json(201, roleOf(await deps.directory.createRole(params.id ?? "", body)));
}

async function role(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "roles:read");
  const found = await deps.store.findRole(params.roleId ?? "");
  if (!found || found.applicationId !== params.appId || (found.deletedAt !== null && !current.permissions.includes("roles:read:deleted"))) {
    throw new AccessError("RESOURCE_NOT_VISIBLE", "El rol no está disponible");
  }
  return json(200, roleOf(found));
}

async function updateRole(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  await actor(deps, request, "roles:update");
  const body = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(500).optional() }).strict(), request.body);
  return json(200, roleOf(await deps.directory.updateRole(params.roleId ?? "", body)));
}

async function deleteRole(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  await actor(deps, request, "roles:delete");
  await deps.directory.deleteRole(params.roleId ?? "");
  return empty(204);
}

async function restoreRole(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  await actor(deps, request, "roles:restore");
  return json(200, roleOf(await deps.directory.restoreRole(params.roleId ?? "")));
}

async function replacePermissions(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "roles:permissions:assign");
  const body = parse(z.object({ version: z.number().int().min(1), permissionCodes: z.array(z.string()) }).strict(), request.body);
  return json(200, roleOf(await deps.directory.replacePermissions(current.user.id, params.roleId ?? "", body.version, body.permissionCodes)));
}

async function assignments(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  await actor(deps, request, "users:roles:read");
  const query = page(deps, request);
  const found = await deps.directory.listAssignments(params.id ?? "", query);
  return json(200, pageOf(found.items.map((item) => ({ id: item.id, roleId: item.roleId, userId: item.userId, expiresAt: item.expiresAt })), found.totalItems, query));
}

async function assignRole(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "users:roles:assign");
  const body = parse(z.object({ roleId: uuid, expiresAt: z.string().nullable().optional() }).strict(), request.body);
  await deps.directory.assignRole(current.user.id, params.id ?? "", body.roleId, body.expiresAt ?? null);
  return empty(204);
}

async function revokeAssignment(deps: AccessHttpDependencies, request: AccessHttpRequest, params: Record<string, string>): Promise<AccessHttpResult> {
  const current = await actor(deps, request, "users:roles:revoke");
  await deps.directory.revokeAssignment(current.user.id, params.userId ?? "", params.id ?? "");
  return empty(204);
}

async function jwks(deps: AccessHttpDependencies): Promise<AccessHttpResult> {
  return json(200, await deps.jwks());
}

async function alertRecipients(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const service = await deps.services.verify(request.authorization, "access.alert-recipients");
  if (service !== "ai") {
    throw new AccessError("SESSION_INVALID", "La credencial de servicio no es válida");
  }
  const body = parse(z.object({ userIds: z.array(uuid).max(20).optional() }).strict(), request.body ?? {});
  let ids = body.userIds ?? [];
  if (ids.length === 0) {
    const page = await deps.store.listUsers({ page: 1, pageSize: 20, sort: "createdAt", includeDeleted: false, status: "active" });
    ids = page.items.map((user) => user.id);
  }
  const recipients = [];
  for (const userId of ids) {
    const user = await deps.store.findUserById(userId);
    if (!user || user.deletedAt !== null || user.status !== "active") {
      continue;
    }
    const permissions = await deps.store.permissionsFor(user.id, deps.now().toISOString());
    if (!permissions.includes("ai:alerts:read")) {
      continue;
    }
    recipients.push({ userId: user.id, email: user.email });
  }
  return json(200, { recipients });
}

async function authorize(deps: AccessHttpDependencies, request: AccessHttpRequest): Promise<AccessHttpResult> {
  const service = await deps.services.verify(request.authorization);
  if (!service) {
    throw new AccessError("SESSION_INVALID", "La credencial de servicio no es válida");
  }
  void service;
  const body = parse(z.object({
    sessionToken: z.string().min(20),
    applicationCode: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    permission: z.string().min(1),
    context: z.object({
      resourceType: z.string().optional(),
      resourceId: z.string().optional(),
      customerId: z.string().optional(),
    }).strict().optional(),
    requireRecentVerification: z.boolean().optional(),
  }).strict(), request.body);
  const current = await deps.auth.currentSession(body.sessionToken);
  const recentlyVerified = isRecentlyVerified(current.session.verifiedAt, deps.now(), deps.recentVerificationTtl);
  const allowed = !current.session.restricted && current.session.applicationCode === body.applicationCode && current.permissions.includes(body.permission);
  const reasonCode = body.requireRecentVerification === true && !recentlyVerified
    ? "recent_verification_required"
    : current.session.restricted
      ? "restricted_session"
      : current.session.applicationCode !== body.applicationCode
        ? "application"
        : allowed
          ? "authorized"
          : "permission";
  const decision = reasonCode === "authorized" ? "allow" : "deny";
  return json(200, {
    decision,
    authorizationVersion: current.user.authorizationVersion,
    reasonCode,
    recentlyVerified,
    principal: { userId: current.user.id, sessionId: current.session.id, customerId: null },
  });
}

async function actor(deps: AccessHttpDependencies, request: AccessHttpRequest, permission?: string, recent = false) {
  const current = await deps.auth.currentSession(readCookie(request.cookie, "portal_session"));
  if (request.method !== "GET") {
    assertSessionCsrf(request, current.session.csrfHash);
  }
  if (permission) {
    await deps.auth.assertPermission(current.permissions, permission);
  }
  if (recent) {
    await deps.auth.assertRecent(current.session);
  }
  return current;
}

function assertCsrf(request: AccessHttpRequest): void {
  const cookie = readCookie(request.cookie, "portal_csrf");
  if (!same(cookie, request.csrf)) {
    throw new AccessError("CSRF_INVALID", "La verificación CSRF no es válida");
  }
}

function assertSessionCsrf(request: AccessHttpRequest, csrfHash: string): void {
  const cookie = readCookie(request.cookie, "portal_csrf");
  if (!same(cookie, request.csrf) || hash(cookie ?? "") !== csrfHash) {
    throw new AccessError("CSRF_INVALID", "La verificación CSRF no es válida");
  }
}

async function visibleUser(deps: AccessHttpDependencies, id: string, permissions: readonly string[]): Promise<UserRecord> {
  const userRecord = await deps.store.findUserById(id);
  if (!userRecord || (userRecord.deletedAt !== null && !permissions.includes("users:read:deleted"))) {
    throw new AccessError("RESOURCE_NOT_VISIBLE", "El usuario no está disponible");
  }
  return userRecord;
}

function stepResult(deps: AccessHttpDependencies, request: AccessHttpRequest, step: AuthStepResult): AccessHttpResult {
  const headers: Record<string, string | string[]> = {
    "set-cookie": step.session ? sessionCookies(step.session, request.secure, deps) : [csrfCookie(request.secure)],
  };
  return {
    status: 200,
    headers,
    body: {
      nextStep: step.nextStep,
      ...(step.challengeId ? { challengeId: step.challengeId } : {}),
      ...(step.expiresAt ? { expiresAt: step.expiresAt } : {}),
      ...(step.options ? { options: step.options } : {}),
    },
  };
}

function sessionCookies(issued: IssuedSession, secure: boolean, deps: AccessHttpDependencies): string[] {
  return [
    writeCookie("portal_session", issued.accessToken, { httpOnly: true, path: "/", secure, maxAge: deps.accessTokenTtl }),
    writeCookie("portal_refresh", issued.refreshToken, { httpOnly: true, path: "/api/v1/access/auth", secure, maxAge: deps.sessionAbsoluteTtl }),
    writeCookie("portal_csrf", issued.csrfToken, { httpOnly: false, path: "/", secure, maxAge: deps.sessionAbsoluteTtl }),
  ];
}

function clearCookies(secure: boolean): string[] {
  return [
    writeCookie("portal_session", "", { httpOnly: true, path: "/", secure, maxAge: 0 }),
    writeCookie("portal_refresh", "", { httpOnly: true, path: "/api/v1/access/auth", secure, maxAge: 0 }),
    writeCookie("portal_csrf", "", { httpOnly: false, path: "/", secure, maxAge: 0 }),
  ];
}

function csrfCookie(secure: boolean): string {
  return writeCookie("portal_csrf", randomBytes(32).toString("base64url"), { httpOnly: false, path: "/", secure, maxAge: 300 });
}

function writeCookie(name: string, value: string, options: { httpOnly: boolean; path: string; secure: boolean; maxAge: number }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, "SameSite=Lax", `Max-Age=${options.maxAge}`];
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function same(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function page(deps: AccessHttpDependencies, request: AccessHttpRequest): PageQuery {
  return parsePageQuery({
    page: request.query.page,
    pageSize: request.query.pageSize,
    sort: request.query.sort,
    includeDeleted: request.query.includeDeleted,
    status: request.query.status,
    pageDefault: deps.pageDefault,
    pageMax: deps.pageMax,
  });
}

function pageOf(items: unknown[], totalItems: number, query: PageQuery) {
  return { ...pageResult(items, totalItems, query.page, query.pageSize), items };
}

function profileOf(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    givenName: user.givenName,
    familyName: user.familyName,
    phoneE164: user.phoneE164,
    themePreference: user.themePreference,
    status: user.status,
  };
}

function userOf(user: UserRecord) {
  return { id: user.id, email: user.email, givenName: user.givenName, familyName: user.familyName, status: user.status, deletedAt: user.deletedAt };
}

function applicationOf(application: ApplicationRecord) {
  return { id: application.id, code: application.code, name: application.name, description: application.description, status: application.status };
}

function roleOf(role: RoleRecord) {
  return { id: role.id, code: role.code, name: role.name, description: role.description, version: role.version, system: role.system, permissions: role.permissions };
}

function sessionOf(session: { id: string; authenticationMethod: string; createdAt: string; expiresAt: string; lastSeenAt: string; revokedAt: string | null }) {
  return { id: session.id, authenticationMethod: session.authenticationMethod, createdAt: session.createdAt, expiresAt: session.expiresAt, lastSeenAt: session.lastSeenAt, revoked: session.revokedAt !== null };
}

function providerOf(value: string | undefined): "google" | "microsoft" {
  if (value === "google" || value === "microsoft") {
    return value;
  }
  throw new AccessError("VALIDATION_ERROR", "El proveedor no está permitido");
}

function proofObject(proof: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(proof) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AccessError("VALIDATION_ERROR", "La prueba de passkey no es válida");
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new AccessError("VALIDATION_ERROR", "La solicitud no es válida", parsed.error.issues.slice(0, 8).map((issue) => ({
      field: issue.path.join(".") || "body",
      code: "invalid",
    })));
  }
  return parsed.data;
}

function json(status: number, body: unknown): AccessHttpResult {
  return { status, body, headers: {} };
}

function empty(status: number): AccessHttpResult {
  return { status, headers: {} };
}
