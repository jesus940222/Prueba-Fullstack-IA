"""Genera el OpenAPI 3.1 de cada servicio a partir del contrato de la fase 1.

La salida versionada es docs/openapi/*.yaml. Este generador existe para que
cada ruta lleve autorización, errores y allowlist sin atajos de una barra.
"""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
UNSAFE = {"post", "put", "patch", "delete"}


class Dumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def uuid_param(name):
    return {
        "name": name,
        "in": "path",
        "required": True,
        "schema": {"type": "string", "format": "uuid"},
    }


def query(name, schema, description):
    return {"name": name, "in": "query", "required": False, "schema": schema, "description": description}


PAGE = [
    query("page", {"type": "integer", "minimum": 1, "default": 1}, "La página fuera de rango devuelve items vacío."),
    query("pageSize", {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}, "Máximo 100."),
    query(
        "sort",
        {"type": "string", "enum": ["createdAt", "-createdAt"]},
        "Allowlist. El desempate estable es el id.",
    ),
]
DELETED = query(
    "includeDeleted",
    {"type": "boolean"},
    "Solo los literales true o false. false no es true. Sin el permiso de eliminados responde 403.",
)
CURSOR = [
    query("limit", {"type": "integer", "minimum": 1, "maximum": 50, "default": 20}, "Máximo 50."),
    query("cursor", {"type": "string", "minLength": 1, "maxLength": 512}, "Opaco, ligado a filtros. Inválido: 422."),
    query("search", {"type": "string", "maxLength": 80}, "Búsqueda acotada del propio recurso."),
]
IDEMPOTENCY = {
    "name": "Idempotency-Key",
    "in": "header",
    "required": True,
    "schema": {"type": "string", "minLength": 16, "maxLength": 200},
    "description": "Misma clave y mismo hash devuelven la operación. Otro hash responde 409.",
}


def errors(kind):
    if kind == "redirect":
        return ["422", "503"]
    if kind == "public":
        return ["401", "422", "429", "503"]
    return ["401", "403", "404", "409", "422", "429", "503"]


def operation(operation_id, summary, tag, method, auth, success, description, body=None, parameters=None, content_type="application/json"):
    kind = auth["kind"]
    op = {
        "operationId": operation_id,
        "tags": [tag],
        "summary": summary,
        "description": description,
        "x-authorization": auth,
        "responses": {},
    }
    if kind == "service":
        op["security"] = [{"serviceCredential": []}]
    elif kind in {"public", "redirect"}:
        op["security"] = []
    elif kind == "challenge":
        op["security"] = [{"csrfHeader": []}] if auth.get("csrf") else []
    else:
        scheme = {"sessionCookie": []}
        if method in UNSAFE:
            scheme["csrfHeader"] = []
        op["security"] = [scheme]
    if parameters:
        op["parameters"] = parameters
    if body is not None:
        schema = ref(body) if isinstance(body, str) else body
        op["requestBody"] = {"required": True, "content": {"application/json": {"schema": schema}}}
    if success == "204":
        op["responses"]["204"] = {"description": summary}
    elif success == "302":
        op["responses"]["302"] = {
            "description": summary,
            "headers": {"Location": {"description": "Destino interno o proveedor", "schema": {"type": "string"}}},
        }
    else:
        status, schema_name = success
        schema = ref(schema_name) if isinstance(schema_name, str) else schema_name
        op["responses"][status] = {"description": summary, "content": {content_type: {"schema": schema}}}
    names = {
        "401": "Unauthorized",
        "403": "Forbidden",
        "404": "NotFound",
        "409": "Conflict",
        "422": "Unprocessable",
        "429": "TooManyRequests",
        "503": "Unavailable",
    }
    for code in errors(kind):
        op["responses"][code] = {"$ref": f"#/components/responses/{names[code]}"}
    return op


def add(paths, method, path, **kwargs):
    paths.setdefault(path, {})
    paths[path][method] = operation(method=method, **kwargs)


def obj(required, properties, description=None):
    schema = {"type": "object", "additionalProperties": False, "required": required, "properties": properties}
    if description:
        schema["description"] = description
    return schema


def page_of(item):
    return obj(
        ["items", "totalItems", "totalPages", "page", "pageSize"],
        {
            "items": {"type": "array", "items": ref(item)},
            "totalItems": {"type": "integer", "minimum": 0},
            "totalPages": {"type": "integer", "minimum": 0},
            "page": {"type": "integer", "minimum": 1},
            "pageSize": {"type": "integer", "minimum": 1, "maximum": 100},
        },
    )


def cursor_of(item):
    return obj(
        ["items", "nextCursor", "hasMore"],
        {
            "items": {"type": "array", "items": ref(item)},
            "nextCursor": {"type": ["string", "null"]},
            "hasMore": {"type": "boolean"},
        },
    )


UUID = {"type": "string", "format": "uuid"}
MONEY = {"type": "string", "pattern": "^(0|[1-9][0-9]{0,15})\\.[0-9]{2}$"}
COST = {"type": "string", "pattern": "^(0|[1-9][0-9]{0,15})\\.[0-9]{2,6}$"}
NAME = {"type": "string", "minLength": 1, "maxLength": 80}
CODE = {"type": "string", "minLength": 1, "maxLength": 64, "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}
WHEN = {"type": "string", "format": "date-time"}


def base_components(schemas):
    shared = {
        "Error": obj(
            ["code", "message", "correlationId"],
            {
                "code": {
                    "type": "string",
                    "enum": [
                        "SESSION_INVALID",
                        "PERMISSION_DENIED",
                        "RESOURCE_NOT_VISIBLE",
                        "CONFLICT",
                        "IDEMPOTENCY_CONFLICT",
                        "VALIDATION_ERROR",
                        "BUSINESS_RULE",
                        "RATE_LIMITED",
                        "DEPENDENCY_UNAVAILABLE",
                        "CSRF_INVALID",
                        "RECENT_VERIFICATION_REQUIRED",
                        "RECOVERY_POLICY_DISABLED",
                        "CHALLENGE_INVALID",
                    ],
                },
                "message": {"type": "string", "maxLength": 300},
                "correlationId": UUID,
                "fieldErrors": {
                    "type": "array",
                    "items": obj(["field", "code"], {"field": {"type": "string"}, "code": {"type": "string"}}),
                },
            },
        )
    }
    shared.update(schemas)
    response = {
        "description": "Error uniforme",
        "content": {"application/json": {"schema": ref("Error")}},
    }
    return {
        "securitySchemes": {
            "sessionCookie": {"type": "apiKey", "in": "cookie", "name": "portal_session"},
            "csrfHeader": {"type": "apiKey", "in": "header", "name": "X-CSRF-Token"},
            "serviceCredential": {"type": "http", "scheme": "bearer", "bearerFormat": "service-jwt"},
        },
        "schemas": shared,
        "responses": {name: response for name in ["Unauthorized", "Forbidden", "NotFound", "Conflict", "Unprocessable", "TooManyRequests", "Unavailable"]},
    }


def document(title, description, paths, schemas):
    return {
        "openapi": "3.1.0",
        "info": {"title": title, "version": "1.0.0", "description": description},
        "servers": [{"url": "/"}],
        "paths": paths,
        "components": base_components(schemas),
    }


def perm(code, recent=False):
    value = {"kind": "permission", "permission": code}
    if recent:
        value["recentVerification"] = True
    return value


def any_of(rules):
    return {"kind": "permission", "anyOf": rules}


def access():
    paths = {}
    add(paths, "post", "/api/v1/access/auth/login", operation_id="login", summary="Inicia desafío con correo y contraseña", tag="auth", auth={"kind": "public"}, success=("200", "AuthStep"), description="No crea sesión plena.", body="LoginRequest")
    add(paths, "get", "/api/v1/access/auth/oidc/{provider}/start", operation_id="oidcStart", summary="Inicia OIDC", tag="auth", auth={"kind": "redirect"}, success="302", description="Google o Microsoft, con state, nonce y PKCE. returnTo solo interno.", parameters=[{"name": "provider", "in": "path", "required": True, "schema": {"enum": ["google", "microsoft"]}}, query("returnTo", {"type": "string"}, "Ruta interna.")] )
    add(paths, "get", "/api/v1/access/auth/oidc/{provider}/callback", operation_id="oidcCallback", summary="Callback OIDC", tag="auth", auth={"kind": "redirect"}, success="302", description="Valida issuer, audience, firma, nonce, state y distingue login de vinculación.", parameters=[{"name": "provider", "in": "path", "required": True, "schema": {"enum": ["google", "microsoft"]}}, query("code", {"type": "string"}, "Código del proveedor."), query("state", {"type": "string"}, "Estado emitido por Acceso.")])
    for name, step in (
        ("resendEmailChallenge", "Reenvía el código e invalida el anterior"),
        ("verifyEmailChallenge", "Consume el código"),
        ("passkeyOptions", "Opciones WebAuthn del desafío"),
        ("verifyPasskey", "Verifica la passkey"),
        ("verifyRecoveryCode", "Código de recuperación restringido"),
    ):
        suffix = {
            "resendEmailChallenge": "email/resend",
            "verifyEmailChallenge": "email/verify",
            "passkeyOptions": "passkey/options",
            "verifyPasskey": "passkey/verify",
            "verifyRecoveryCode": "recovery-code/verify",
        }[name]
        body = "Empty" if name in {"resendEmailChallenge", "passkeyOptions"} else "ChallengeProof"
        add(paths, "post", f"/api/v1/access/auth/challenges/{{id}}/{suffix}", operation_id=name, summary=step, tag="auth", auth={"kind": "challenge", "csrf": True}, success=("200", "AuthStep"), description="El desafío no otorga autorización funcional.", body=body, parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/auth/password/forgot", operation_id="forgotPassword", summary="Solicita recuperación", tag="auth", auth={"kind": "public"}, success=("202", "Accepted"), description="Respuesta genérica, exista o no la cuenta.", body="ForgotPassword")
    add(paths, "post", "/api/v1/access/auth/password/reset", operation_id="resetPassword", summary="Restablece contraseña", tag="auth", auth={"kind": "public"}, success=("204"), description="Token de un uso. Revoca sesiones y no omite la passkey.", body="ResetPassword")
    add(paths, "post", "/api/v1/access/auth/refresh", operation_id="refreshSession", summary="Rota el refresh", tag="auth", auth={"kind": "session"}, success="204", description="Reutilizar un refresh revoca la familia.", body="Empty")
    add(paths, "post", "/api/v1/access/auth/logout", operation_id="logout", summary="Cierra la sesión actual", tag="auth", auth={"kind": "session"}, success="204", description="Idempotente.", body="Empty")
    add(paths, "post", "/api/v1/access/auth/logout-all", operation_id="logoutAll", summary="Cierra todas las sesiones propias", tag="auth", auth={"kind": "session"}, success="204", description="Revoca refresh de la persona.", body="Empty")
    add(paths, "get", "/api/v1/access/me", operation_id="getMe", summary="Lee el perfil", tag="profile", auth=perm("profile:read:own"), success=("200", "Profile"), description="Sin roles ni secretos.")
    add(paths, "patch", "/api/v1/access/me", operation_id="updateMe", summary="Actualiza el perfil", tag="profile", auth=perm("profile:update:own"), success=("200", "Profile"), description="Allowlist: nombre, teléfono y tema. El correo no es editable en v1.", body="ProfileUpdate")
    add(paths, "get", "/api/v1/access/me/permissions", operation_id="listMyPermissions", summary="Permisos efectivos", tag="profile", auth={"kind": "session"}, success=("200", "PermissionList"), description="La UI no los convierte en autorización.")
    add(paths, "post", "/api/v1/access/me/password/change", operation_id="changePassword", summary="Cambia la contraseña", tag="security", auth=perm("security:manage:own", recent=True), success="204", description="Exige verificación reciente y revoca las otras sesiones.", body="PasswordChange")
    add(paths, "get", "/api/v1/access/me/sessions", operation_id="listMySessions", summary="Lista sesiones propias", tag="security", auth=perm("sessions:read:own"), success=("200", "SessionPage"), description="Paginada.", parameters=PAGE)
    add(paths, "delete", "/api/v1/access/me/sessions/{id}", operation_id="revokeMySession", summary="Revoca una sesión propia", tag="security", auth=perm("sessions:revoke:own"), success="204", description="Idempotente si ya estaba revocada. La ajena responde 404.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/access/me/passkeys", operation_id="listPasskeys", summary="Lista passkeys", tag="security", auth=perm("security:manage:own"), success=("200", "PasskeyPage"), description="El identificador de UI es interno.", parameters=PAGE)
    enrollment = any_of([{"permission": "security:manage:own"}, {"sessionState": "passkey-enrollment"}])
    add(paths, "post", "/api/v1/access/me/passkeys/registration/options", operation_id="passkeyRegistrationOptions", summary="Opciones de alta", tag="security", auth=enrollment, success=("200", "PasskeyOptions"), description="Sesión propia o sesión restringida de alta.", body="Empty")
    verify_enrollment = any_of([{"permission": "security:manage:own", "recentVerification": True}, {"sessionState": "passkey-enrollment"}])
    add(paths, "post", "/api/v1/access/me/passkeys/registration/verify", operation_id="passkeyRegistrationVerify", summary="Verifica el alta", tag="security", auth=verify_enrollment, success=("201", "Passkey"), description="Ata el desafío y no guarda biometría ni clave privada.", body="PasskeyAttestation")
    add(paths, "patch", "/api/v1/access/me/passkeys/{id}", operation_id="renamePasskey", summary="Renombra una passkey", tag="security", auth=perm("security:manage:own"), success=("200", "Passkey"), description="Solo el nombre.", body="PasskeyRename", parameters=[uuid_param("id")])
    add(paths, "delete", "/api/v1/access/me/passkeys/{id}", operation_id="revokePasskey", summary="Revoca una passkey", tag="security", auth=perm("security:manage:own"), success="204", description="No desactiva la política al revocar la última.", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/me/recovery-codes/regenerate", operation_id="regenerateRecoveryCodes", summary="Regenera códigos", tag="security", auth=perm("security:manage:own", recent=True), success=("200", "RecoveryCodes"), description="Se muestran una vez. Revoca los anteriores.", body="Empty")
    add(paths, "get", "/api/v1/access/me/identities", operation_id="listIdentities", summary="Lista identidades vinculadas", tag="security", auth=perm("security:manage:own"), success=("200", "IdentityPage"), description="Sin tokens del proveedor.", parameters=PAGE)
    add(paths, "post", "/api/v1/access/me/identities/{provider}/link", operation_id="linkIdentity", summary="Inicia vinculación", tag="security", auth=perm("security:manage:own"), success=("200", "LinkStart"), description="Exige sesión reciente y no vincula por coincidencia de correo.", parameters=[{"name": "provider", "in": "path", "required": True, "schema": {"enum": ["google", "microsoft"]}}])
    add(paths, "delete", "/api/v1/access/me/identities/{id}", operation_id="unlinkIdentity", summary="Revoca una identidad", tag="security", auth=perm("security:manage:own"), success="204", description="No deja a la persona sin un acceso utilizable.", parameters=[uuid_param("id")])
    user_filters = PAGE + [DELETED, query("status", {"enum": ["invited", "active", "disabled"]}, "Estado.")]
    add(paths, "get", "/api/v1/access/users", operation_id="listUsers", summary="Lista usuarios", tag="users", auth=perm("users:read"), success=("200", "UserPage"), description="Soporte recibe proyección mínima.", parameters=user_filters)
    add(paths, "get", "/api/v1/access/users/{id}", operation_id="getUser", summary="Lee un usuario", tag="users", auth=perm("users:read"), success=("200", "User"), description="Sin credenciales ni finanzas.", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/users", operation_id="createUser", summary="Invita un usuario", tag="users", auth=perm("users:create"), success=("201", "User"), description="No devuelve contraseña.", body="UserCreate")
    add(paths, "patch", "/api/v1/access/users/{id}", operation_id="updateUser", summary="Actualiza campos permitidos", tag="users", auth=perm("users:update"), success=("200", "User"), description="No cambia roles, passkeys ni recuperación.", body="UserUpdate", parameters=[uuid_param("id")])
    add(paths, "delete", "/api/v1/access/users/{id}", operation_id="deleteUser", summary="Borrado lógico", tag="users", auth=perm("users:delete"), success="204", description="Revoca sesiones.", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/users/{id}/restore", operation_id="restoreUser", summary="Restaura el usuario", tag="users", auth=perm("users:restore"), success=("200", "User"), description="No reactiva credenciales ni asignaciones.", body="Empty", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/users/{id}/sessions/revoke", operation_id="revokeUserSessions", summary="Revoca sesiones de un usuario", tag="users", auth=perm("sessions:revoke:any"), success="204", description="Idempotente.", body="Empty", parameters=[uuid_param("id")])
    add(paths, "patch", "/api/v1/access/users/{id}/passkey-policy", operation_id="configurePasskeyPolicy", summary="Habilita o deshabilita passkey", tag="users", auth=perm("security:passkeys:configure"), success=("200", "PasskeyPolicy"), description="El administrador no marca active. Desactivar una passkey activa queda cerrado por la política.", body="PasskeyPolicyChange", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/users/{id}/recovery-requests", operation_id="initiateRecovery", summary="Inicia recuperación", tag="users", auth=perm("security:recovery:initiate"), success=("202", "RecoveryRequest"), description="No completa la recuperación.", body="RecoveryInitiate", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/recovery-requests/{id}/complete", operation_id="completeRecovery", summary="Completa recuperación", tag="users", auth=perm("security:recovery:complete"), success="204", description="En v1 responde RECOVERY_POLICY_DISABLED. No hay bypass.", body="Empty", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/access/applications", operation_id="listApplications", summary="Lista aplicaciones", tag="applications", auth=perm("applications:read"), success=("200", "ApplicationPage"), description="Paginada.", parameters=PAGE + [DELETED])
    add(paths, "get", "/api/v1/access/applications/{id}", operation_id="getApplication", summary="Lee una aplicación", tag="applications", auth=perm("applications:read"), success=("200", "Application"), description="Sin secretos.", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/applications", operation_id="createApplication", summary="Crea una aplicación", tag="applications", auth=perm("applications:create"), success=("201", "Application"), description="Código estable.", body="ApplicationWrite")
    add(paths, "patch", "/api/v1/access/applications/{id}", operation_id="updateApplication", summary="Actualiza una aplicación", tag="applications", auth=perm("applications:update"), success=("200", "Application"), description="Nombre y descripción.", body="ApplicationUpdate", parameters=[uuid_param("id")])
    add(paths, "delete", "/api/v1/access/applications/{id}", operation_id="deleteApplication", summary="Borra una aplicación", tag="applications", auth=perm("applications:delete"), success="204", description="Borrado lógico.", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/access/applications/{id}/restore", operation_id="restoreApplication", summary="Restaura una aplicación", tag="applications", auth=perm("applications:restore"), success=("200", "Application"), description="No reactiva roles retirados.", body="Empty", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/access/applications/{appId}/permissions", operation_id="listPermissions", summary="Lee el catálogo de permisos", tag="roles", auth=perm("permissions:read"), success=("200", "PermissionCatalog"), description="Sin alta ni edición.", parameters=[uuid_param("appId")] + PAGE)
    add(paths, "get", "/api/v1/access/applications/{appId}/roles", operation_id="listRoles", summary="Lista roles", tag="roles", auth=perm("roles:read"), success=("200", "RolePage"), description="Paginada.", parameters=[uuid_param("appId")] + PAGE + [DELETED])
    add(paths, "get", "/api/v1/access/applications/{appId}/roles/{roleId}", operation_id="getRole", summary="Lee un rol", tag="roles", auth=perm("roles:read"), success=("200", "Role"), description="Incluye códigos de permiso.", parameters=[uuid_param("appId"), uuid_param("roleId")])
    add(paths, "post", "/api/v1/access/applications/{appId}/roles", operation_id="createRole", summary="Crea un rol personalizado", tag="roles", auth=perm("roles:create"), success=("201", "Role"), description="Solo permisos delegables.", body="RoleCreate", parameters=[uuid_param("appId")])
    add(paths, "patch", "/api/v1/access/applications/{appId}/roles/{roleId}", operation_id="updateRole", summary="Actualiza nombre y descripción", tag="roles", auth=perm("roles:update"), success=("200", "Role"), description="No cambia permisos ni un rol de sistema.", body="RoleUpdate", parameters=[uuid_param("appId"), uuid_param("roleId")])
    add(paths, "delete", "/api/v1/access/applications/{appId}/roles/{roleId}", operation_id="deleteRole", summary="Borra un rol", tag="roles", auth=perm("roles:delete"), success="204", description="Bloqueado si tiene asignaciones activas o es de sistema.", parameters=[uuid_param("appId"), uuid_param("roleId")])
    add(paths, "post", "/api/v1/access/applications/{appId}/roles/{roleId}/restore", operation_id="restoreRole", summary="Restaura un rol", tag="roles", auth=perm("roles:restore"), success=("200", "Role"), description="No devuelve asignaciones retiradas.", body="Empty", parameters=[uuid_param("appId"), uuid_param("roleId")])
    add(paths, "put", "/api/v1/access/applications/{appId}/roles/{roleId}/permissions", operation_id="replaceRolePermissions", summary="Reemplaza permisos", tag="roles", auth=perm("roles:permissions:assign"), success=("200", "Role"), description="Atómico, con versión. No edita el rol propio ni un rol de sistema.", body="RolePermissions", parameters=[uuid_param("appId"), uuid_param("roleId")])
    add(paths, "get", "/api/v1/access/users/{userId}/role-assignments", operation_id="listRoleAssignments", summary="Lista asignaciones", tag="roles", auth=perm("users:roles:read"), success=("200", "AssignmentPage"), description="Paginada.", parameters=[uuid_param("userId")] + PAGE)
    add(paths, "post", "/api/v1/access/users/{userId}/role-assignments", operation_id="assignRole", summary="Asigna un rol", tag="roles", auth=perm("users:roles:assign"), success=("201", "RoleAssignment"), description="No al propio usuario. Cada permiso del rol debe ser delegable o el rol de sistema debe estar permitido.", body="AssignmentCreate", parameters=[uuid_param("userId")])
    add(paths, "delete", "/api/v1/access/users/{userId}/role-assignments/{id}", operation_id="revokeRoleAssignment", summary="Revoca una asignación", tag="roles", auth=perm("users:roles:revoke"), success="204", description="Protege al último administrador.", parameters=[uuid_param("userId"), uuid_param("id")])
    add(paths, "get", "/api/v1/access/.well-known/jwks.json", operation_id="jwks", summary="Claves públicas", tag="auth", auth={"kind": "public"}, success=("200", "Jwks"), description="Solo claves públicas para validar firma. No sustituye a authorize.")
    add(paths, "post", "/internal/v1/access/authorize", operation_id="authorize", summary="Autorización authoritative", tag="internal", auth={"kind": "service", "audience": "access.authorize"}, success=("200", "AuthorizeResult"), description="No está en el proxy público. Niega si la sesión o la versión no sirven. 503 si la base no responde.", body="AuthorizeRequest")
    text = {"type": "string", "minLength": 1, "maxLength": 4000}
    schemas = {
        "Empty": obj([], {}),
        "Accepted": obj(["accepted"], {"accepted": {"const": True}}),
        "LoginRequest": obj(["email", "password"], {"email": {"type": "string", "format": "email", "maxLength": 254}, "password": {"type": "string", "minLength": 1, "maxLength": 200}}),
        "AuthStep": obj(["nextStep"], {"challengeId": UUID, "nextStep": {"enum": ["EMAIL_CHALLENGE", "PASSKEY_CHALLENGE", "PASSKEY_ENROLLMENT_REQUIRED", "RECOVERY_RESTRICTED", "AUTHENTICATED"]}, "expiresAt": WHEN}),
        "ChallengeProof": obj(["proof"], {"proof": {"type": "string", "minLength": 1, "maxLength": 8000}}),
        "ForgotPassword": obj(["email"], {"email": {"type": "string", "format": "email", "maxLength": 254}}),
        "ResetPassword": obj(["token", "password"], {"token": {"type": "string", "minLength": 20, "maxLength": 512}, "password": {"type": "string", "minLength": 12, "maxLength": 200}}),
        "Profile": obj(["id", "email", "givenName", "familyName", "themePreference", "status"], {"id": UUID, "email": {"type": "string", "format": "email"}, "givenName": NAME, "familyName": NAME, "phoneE164": {"type": ["string", "null"]}, "themePreference": {"enum": ["light", "dark", "system"]}, "status": {"enum": ["invited", "active", "disabled"]}}),
        "ProfileUpdate": obj([], {"givenName": NAME, "familyName": NAME, "phoneCountryCode": {"type": "string", "pattern": "^[A-Z]{2}$"}, "phoneNumber": {"type": "string", "pattern": "^[0-9]{4,15}$"}, "themePreference": {"enum": ["light", "dark", "system"]}}, "Al menos un campo. El servidor rechaza el objeto vacío."),
        "PermissionList": obj(["permissions"], {"permissions": {"type": "array", "items": {"type": "string"}}}),
        "PasswordChange": obj(["currentPassword", "newPassword"], {"currentPassword": text, "newPassword": {"type": "string", "minLength": 12, "maxLength": 200}}),
        "Session": obj(["id", "createdAt", "expiresAt", "revoked"], {"id": UUID, "authenticationMethod": {"type": "string"}, "createdAt": WHEN, "expiresAt": WHEN, "lastSeenAt": WHEN, "revoked": {"type": "boolean"}}),
        "SessionPage": page_of("Session"),
        "Passkey": obj(["id", "name"], {"id": UUID, "name": NAME, "createdAt": WHEN, "lastUsedAt": {"type": ["string", "null"], "format": "date-time"}}),
        "PasskeyPage": page_of("Passkey"),
        "PasskeyOptions": obj(["challengeId", "options"], {"challengeId": UUID, "options": {"type": "object", "description": "Opciones públicas de WebAuthn. El servidor las genera y no incluyen clave privada."}}),
        "PasskeyAttestation": obj(["challengeId", "response"], {"challengeId": UUID, "response": {"type": "object"}}),
        "PasskeyRename": obj(["name"], {"name": NAME}),
        "RecoveryCodes": obj(["codes"], {"codes": {"type": "array", "minItems": 1, "items": {"type": "string"}}}),
        "Identity": obj(["id", "provider"], {"id": UUID, "provider": {"enum": ["google", "microsoft"]}, "linkedAt": WHEN}),
        "IdentityPage": page_of("Identity"),
        "LinkStart": obj(["authorizationUrl"], {"authorizationUrl": {"type": "string"}}),
        "User": obj(["id", "email", "status"], {"id": UUID, "email": {"type": "string"}, "givenName": NAME, "familyName": NAME, "status": {"enum": ["invited", "active", "disabled"]}, "deletedAt": {"type": ["string", "null"], "format": "date-time"}}),
        "UserPage": page_of("User"),
        "UserCreate": obj(["email", "givenName", "familyName"], {"email": {"type": "string", "format": "email", "maxLength": 254}, "givenName": NAME, "familyName": NAME}),
        "UserUpdate": obj([], {"givenName": NAME, "familyName": NAME, "status": {"enum": ["active", "disabled"]}}),
        "PasskeyPolicy": obj(["status"], {"status": {"enum": ["disabled", "pending", "active"]}, "enabledAt": {"type": ["string", "null"], "format": "date-time"}}),
        "PasskeyPolicyChange": obj(["action"], {"action": {"enum": ["enable", "disable"]}}),
        "RecoveryInitiate": obj(["reason"], {"reason": {"type": "string", "minLength": 1, "maxLength": 300}}),
        "RecoveryRequest": obj(["id", "status"], {"id": UUID, "status": {"const": "pending"}}),
        "Application": obj(["id", "code", "name", "status"], {"id": UUID, "code": CODE, "name": NAME, "description": {"type": "string", "maxLength": 500}, "status": {"enum": ["active", "disabled"]}}),
        "ApplicationPage": page_of("Application"),
        "ApplicationWrite": obj(["code", "name"], {"code": CODE, "name": NAME, "description": {"type": "string", "maxLength": 500}}),
        "ApplicationUpdate": obj([], {"name": NAME, "description": {"type": "string", "maxLength": 500}}),
        "PermissionCatalog": page_of("PermissionItem"),
        "PermissionItem": obj(["code", "resource", "action", "scope"], {"code": {"type": "string"}, "resource": {"type": "string"}, "action": {"type": "string"}, "scope": {"type": "string"}}),
        "Role": obj(["id", "code", "name", "version", "system"], {"id": UUID, "code": CODE, "name": NAME, "description": {"type": "string"}, "version": {"type": "integer"}, "system": {"type": "boolean"}, "permissions": {"type": "array", "items": {"type": "string"}}}),
        "RolePage": page_of("Role"),
        "RoleCreate": obj(["code", "name", "permissionCodes"], {"code": CODE, "name": NAME, "description": {"type": "string", "maxLength": 500}, "permissionCodes": {"type": "array", "items": {"type": "string"}}}),
        "RoleUpdate": obj([], {"name": NAME, "description": {"type": "string", "maxLength": 500}}),
        "RolePermissions": obj(["version", "permissionCodes"], {"version": {"type": "integer", "minimum": 1}, "permissionCodes": {"type": "array", "items": {"type": "string"}}}),
        "RoleAssignment": obj(["id", "roleId", "userId"], {"id": UUID, "roleId": UUID, "userId": UUID, "expiresAt": {"type": ["string", "null"], "format": "date-time"}}),
        "AssignmentPage": page_of("RoleAssignment"),
        "AssignmentCreate": obj(["roleId"], {"roleId": UUID, "expiresAt": {"type": ["string", "null"], "format": "date-time"}}),
        "Jwks": obj(["keys"], {"keys": {"type": "array", "items": {"type": "object"}}}),
        "AuthorizeRequest": obj(["sessionToken", "applicationCode", "permission"], {"sessionToken": {"type": "string", "minLength": 20}, "applicationCode": CODE, "permission": {"type": "string"}, "context": obj([], {"resourceType": {"type": "string"}, "resourceId": UUID, "customerId": UUID})}),
        "AuthorizeResult": obj(["decision", "authorizationVersion"], {"decision": {"enum": ["allow", "deny"]}, "authorizationVersion": {"type": "integer"}, "reasonCode": {"type": "string"}, "principal": obj(["userId", "sessionId"], {"userId": UUID, "sessionId": UUID, "customerId": {"type": ["string", "null"], "format": "uuid"}})}),
    }
    return document(
        "Acceso",
        "API /api/v1/access e interna de autorización. El correo no se edita en v1. La recuperación completa queda cerrada.",
        paths,
        schemas,
    )


def accounts():
    paths = {}
    add(paths, "get", "/api/v1/accounts/summary", operation_id="getSummary", summary="Resumen propio", tag="accounts", auth=perm("accounts:read:own"), success=("200", "Summary"), description="El gasto comercial no incluye toda transferencia.")
    add(paths, "get", "/api/v1/accounts/accounts", operation_id="listAccounts", summary="Lista cuentas propias", tag="accounts", auth=perm("accounts:read:own"), success=("200", "AccountPage"), description="Solo cuentas del cliente vinculado.", parameters=PAGE)
    add(paths, "get", "/api/v1/accounts/accounts/{id}", operation_id="getAccount", summary="Detalle de cuenta propia", tag="accounts", auth=perm("accounts:read:own"), success=("200", "Account"), description="La ajena responde 404.", parameters=[uuid_param("id")])
    movement_query = PAGE + [
        query("direction", {"enum": ["in", "out"]}, "Dirección."),
        query("from", {"type": "string", "format": "date-time"}, "Inicio UTC."),
        query("to", {"type": "string", "format": "date-time"}, "Fin UTC."),
    ]
    add(paths, "get", "/api/v1/accounts/accounts/{id}/movements", operation_id="listMovements", summary="Movimientos", tag="accounts", auth=perm("transactions:read:own"), success=("200", "MovementPage"), description="No se editan desde esta ruta.", parameters=[uuid_param("id")] + movement_query)
    add(paths, "get", "/api/v1/accounts/transfers", operation_id="listTransfers", summary="Transferencias propias", tag="transfers", auth=perm("transfers:read:own"), success=("200", "TransferPage"), description="Paginada.", parameters=PAGE)
    add(paths, "get", "/api/v1/accounts/transfers/{id}", operation_id="getTransfer", summary="Detalle de transferencia", tag="transfers", auth=perm("transfers:read:own"), success=("200", "Transfer"), description="Solo las propias.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/accounts/transfers/{id}/receipt", operation_id="getReceipt", summary="Comprobante", tag="transfers", auth=perm("transfers:read:own"), success=("200", "Receipt"), description="Solo si está confirmada. Usa datos inmutables.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/accounts/beneficiaries", operation_id="listBeneficiaries", summary="Beneficiarios propios", tag="beneficiaries", auth=perm("beneficiaries:read:own"), success=("200", "BeneficiaryCursor"), description="Cursor y búsqueda. No lista clientes.", parameters=CURSOR)
    add(paths, "post", "/api/v1/accounts/beneficiaries", operation_id="createBeneficiary", summary="Guarda beneficiario", tag="beneficiaries", auth=perm("beneficiaries:create:own"), success=("201", "Beneficiary"), description="Operación separada de la transferencia.", body="BeneficiaryCreate")
    add(paths, "patch", "/api/v1/accounts/beneficiaries/{id}", operation_id="renameBeneficiary", summary="Cambia el alias", tag="beneficiaries", auth=perm("beneficiaries:update:own"), success=("200", "Beneficiary"), description="Solo alias.", body="BeneficiaryUpdate", parameters=[uuid_param("id")])
    add(paths, "delete", "/api/v1/accounts/beneficiaries/{id}", operation_id="deleteBeneficiary", summary="Borra beneficiario", tag="beneficiaries", auth=perm("beneficiaries:delete:own"), success="204", description="No altera históricos.", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/accounts/recipients/resolve", operation_id="resolveRecipient", summary="Resuelve destinatario", tag="transfers", auth=perm("transfers:create:own"), success=("200", "ResolvedRecipient"), description="Datos mínimos y rate limit. No abre un directorio.", body="ResolveRecipient")
    add(paths, "post", "/api/v1/accounts/transfer-proposals", operation_id="createProposal", summary="Prepara una transferencia", tag="transfers", auth=perm("transfers:create:own"), success=("201", "Proposal"), description="No reserva fondos. beneficiaryId o número, nunca ambos.", body="ProposalCreate")
    add(paths, "get", "/api/v1/accounts/transfer-proposals/{id}", operation_id="getProposal", summary="Lee la propuesta propia", tag="transfers", auth=perm("transfers:create:own"), success=("200", "Proposal"), description="Limitada a su usuario y sesión.", parameters=[uuid_param("id")])
    add(paths, "delete", "/api/v1/accounts/transfer-proposals/{id}", operation_id="cancelProposal", summary="Cancela una propuesta pendiente", tag="transfers", auth=perm("transfers:create:own"), success="204", description="No cancela una transferencia confirmada.", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/accounts/transfer-proposals/{id}/confirm", operation_id="confirmProposal", summary="Confirma la propuesta", tag="transfers", auth=perm("transfers:create:own", recent=True), success=("200", "Transfer"), description="Idempotency-Key obligatoria. No acepta cambios de importe. Authorize se repite antes del débito.", body="Empty", parameters=[uuid_param("id"), IDEMPOTENCY])
    add(paths, "get", "/api/v1/accounts/me/transfer-limits", operation_id="getLimits", summary="Lee límites", tag="limits", auth=perm("transfer-limits:read:own"), success=("200", "TransferLimits"), description="MXN.")
    add(paths, "patch", "/api/v1/accounts/me/transfer-limits", operation_id="updateLimits", summary="Actualiza límites", tag="limits", auth=perm("transfer-limits:update:own", recent=True), success=("200", "TransferLimits"), description="Dentro del techo. La operación no supera el diario.", body="TransferLimitsUpdate")
    add(paths, "post", "/internal/v1/accounts/eligibility-context", operation_id="eligibilityContext", summary="Contexto mínimo de elegibilidad", tag="internal", auth={"kind": "service", "audience": "accounts.eligibility"}, success=("200", "EligibilityContext"), description="Si no es verificable, verifiable=false. No concede la oferta.", body="EligibilityRequest")
    add(paths, "post", "/internal/v1/accounts/customer-link", operation_id="customerLink", summary="Cliente del usuario", tag="internal", auth={"kind": "service", "audience": "accounts.eligibility"}, success=("200", "CustomerLink"), description="Resuelve el usuario de la sesión al cliente dueño. No comparte la base. Sin vínculo activo, customerId es null.", body="CustomerLinkRequest")
    schemas = {
        "Empty": obj([], {}),
        "Summary": obj(["totalBalance", "currency"], {"totalBalance": MONEY, "currency": {"const": "MXN"}, "spendTotal": MONEY, "recentMovements": {"type": "array", "items": ref("Movement")}}),
        "Account": obj(["id", "accountNumber", "name", "currency", "status", "balance"], {"id": UUID, "accountNumber": {"type": "string"}, "name": NAME, "currency": {"const": "MXN"}, "status": {"enum": ["active", "closed"]}, "balance": MONEY}),
        "AccountPage": page_of("Account"),
        "Movement": obj(["id", "direction", "amount", "currency", "recordedAt"], {"id": UUID, "direction": {"enum": ["in", "out"]}, "amount": MONEY, "currency": {"const": "MXN"}, "balanceAfter": MONEY, "recordedAt": WHEN, "transferId": UUID}),
        "MovementPage": page_of("Movement"),
        "Transfer": obj(["id", "reference", "status", "amount", "currency"], {"id": UUID, "reference": {"type": "string"}, "proposalId": UUID, "status": {"enum": ["completed", "rejected"]}, "amount": MONEY, "currency": {"const": "MXN"}, "concept": {"type": "string"}, "completedAt": {"type": ["string", "null"], "format": "date-time"}}),
        "TransferPage": page_of("Transfer"),
        "Receipt": obj(["transferId", "reference", "amount", "currency", "concept", "completedAt"], {"transferId": UUID, "reference": {"type": "string"}, "sourceAccountId": UUID, "destinationAccountId": UUID, "destinationLabel": {"type": "string"}, "amount": MONEY, "currency": {"const": "MXN"}, "concept": {"type": "string"}, "completedAt": WHEN}),
        "Beneficiary": obj(["id", "alias", "destinationAccountId", "status"], {"id": UUID, "alias": NAME, "destinationAccountId": UUID, "status": {"enum": ["active", "deleted"]}}),
        "BeneficiaryCursor": cursor_of("Beneficiary"),
        "BeneficiaryCreate": obj(["destinationAccountId", "alias"], {"destinationAccountId": UUID, "alias": NAME}),
        "BeneficiaryUpdate": obj(["alias"], {"alias": NAME}),
        "ResolveRecipient": obj(["destinationAccountNumber"], {"destinationAccountNumber": {"type": "string", "pattern": "^[0-9]{10,18}$"}}),
        "ResolvedRecipient": obj(["destinationAccountId", "accountNumberMasked"], {"destinationAccountId": UUID, "accountNumberMasked": {"type": "string"}, "holderLabel": {"type": "string", "maxLength": 40}}),
        "ProposalCreate": {
            "description": "Exactamente uno de beneficiaryId o destinationAccountNumber.",
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "sourceAccountId": UUID,
                "beneficiaryId": UUID,
                "destinationAccountNumber": {"type": "string", "pattern": "^[0-9]{10,18}$"},
                "amount": MONEY,
                "currency": {"const": "MXN"},
                "concept": {"type": "string", "minLength": 1, "maxLength": 140},
            },
            "oneOf": [
                {"required": ["sourceAccountId", "beneficiaryId", "amount", "currency", "concept"]},
                {"required": ["sourceAccountId", "destinationAccountNumber", "amount", "currency", "concept"]},
            ],
        },
        "Proposal": obj(["id", "status", "amount", "currency", "expiresAt"], {"id": UUID, "status": {"enum": ["pending", "confirmed", "cancelled", "rejected", "expired"]}, "sourceAccountId": UUID, "destinationAccountId": UUID, "destinationLabel": {"type": "string"}, "amount": MONEY, "currency": {"const": "MXN"}, "concept": {"type": "string"}, "expiresAt": WHEN}),
        "TransferLimits": obj(["currency", "perTransferLimit", "dailyLimit"], {"currency": {"const": "MXN"}, "perTransferLimit": MONEY, "dailyLimit": MONEY, "perTransferMax": MONEY, "dailyMax": MONEY}),
        "TransferLimitsUpdate": obj(["perTransferLimit", "dailyLimit"], {"perTransferLimit": MONEY, "dailyLimit": MONEY}),
        "EligibilityRequest": obj(["customerId", "fields"], {"customerId": UUID, "fields": {"type": "array", "items": {"enum": ["totalBalance", "accountAgeDays"]}}}),
        "EligibilityContext": obj(["customerId", "verifiable"], {"customerId": UUID, "verifiable": {"type": "boolean"}, "attributes": {"type": "object", "additionalProperties": False, "properties": {"totalBalance": MONEY, "accountAgeDays": {"type": "integer", "minimum": 0}}}}),
        "CustomerLinkRequest": obj(["userId"], {"userId": UUID}),
        "CustomerLink": obj(["userId", "customerId"], {"userId": UUID, "customerId": {"type": ["string", "null"], "format": "uuid"}}),
    }
    return document("Cuentas", "API /api/v1/accounts. La confirmación no acepta un importe distinto ni una decisión del modelo.", paths, schemas)


def catalog():
    paths = {}
    add(paths, "get", "/api/v1/catalog/categories", operation_id="listPublicCategories", summary="Categorías activas", tag="public", auth=perm("products:read"), success=("200", "CategoryPage"), description="Solo activas.", parameters=PAGE)
    add(paths, "get", "/api/v1/catalog/products", operation_id="listPublicProducts", summary="Productos activos", tag="public", auth=perm("products:read"), success=("200", "ProductPage"), description="Sin borradores.", parameters=PAGE + [query("categoryId", UUID, "Filtro.")])
    add(paths, "get", "/api/v1/catalog/products/{id}", operation_id="getPublicProduct", summary="Producto activo", tag="public", auth=perm("products:read"), success=("200", "Product"), description="El inactivo responde 404.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/catalog/me/offers", operation_id="listMyOffers", summary="Ofertas propias vigentes", tag="public", auth=perm("offers:read:own"), success=("200", "OfferPage"), description="No concede si el contexto no es verificable.", parameters=PAGE)
    add(paths, "get", "/api/v1/catalog/me/offers/{id}", operation_id="getMyOffer", summary="Oferta propia", tag="public", auth=perm("offers:read:own"), success=("200", "Offer"), description="404 si no es elegible.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/catalog/customers/{customerId}/offers", operation_id="listCustomerOffers", summary="Ofertas de un cliente", tag="public", auth=perm("offers:read:any"), success=("200", "OfferPage"), description="Ningún rol inicial tiene este permiso.", parameters=[uuid_param("customerId")] + PAGE)
    resources = [
        ("categories", "categories:read", "categories:create", "categories:update", "categories:delete", "categories:restore", "Category", "CategoryWrite"),
        ("products", "products:manage:read", "products:create", "products:update", "products:delete", "products:restore", "ProductAdmin", "ProductWrite"),
        ("offers", "offers:read", "offers:create", "offers:update", "offers:delete", "offers:restore", "OfferAdmin", "OfferWrite"),
    ]
    for path, read, create, update, delete, restore, schema, write in resources:
        singular = {"categories": "category", "products": "product", "offers": "offer"}[path]
        add(paths, "get", f"/api/v1/catalog/admin/{path}", operation_id=f"listAdmin{path.title()}", summary=f"Lista admin de {path}", tag="admin", auth=perm(read), success=("200", f"{schema}Page"), description="Incluye borradores. Eliminados solo con permiso adicional.", parameters=PAGE + [DELETED])
        add(paths, "get", f"/api/v1/catalog/admin/{path}/{{id}}", operation_id=f"getAdmin{singular.title()}", summary=f"Detalle admin de {singular}", tag="admin", auth=perm(read), success=("200", schema), description="Detalle administrativo.", parameters=[uuid_param("id")])
        add(paths, "post", f"/api/v1/catalog/admin/{path}", operation_id=f"create{singular.title()}", summary=f"Crea {singular}", tag="admin", auth=perm(create), success=("201", schema), description="Allowlist del recurso.", body=write)
        add(paths, "patch", f"/api/v1/catalog/admin/{path}/{{id}}", operation_id=f"update{singular.title()}", summary=f"Actualiza {singular}", tag="admin", auth=perm(update), success=("200", schema), description="No reactiva ofertas al restaurar un producto.", body=write, parameters=[uuid_param("id")])
        add(paths, "delete", f"/api/v1/catalog/admin/{path}/{{id}}", operation_id=f"delete{singular.title()}", summary=f"Borra {singular}", tag="admin", auth=perm(delete), success="204", description="Borrado lógico.", parameters=[uuid_param("id")])
        add(paths, "post", f"/api/v1/catalog/admin/{path}/{{id}}/restore", operation_id=f"restore{singular.title()}", summary=f"Restaura {singular}", tag="admin", auth=perm(restore), success=("200", schema), description="Restaurar producto no reactiva ofertas previas.", body="Empty", parameters=[uuid_param("id")])
    add(paths, "put", "/api/v1/catalog/admin/offers/{id}/eligibility-rules", operation_id="replaceEligibilityRules", summary="Reemplaza reglas", tag="admin", auth=perm("offers:rules:manage"), success=("200", "OfferAdmin"), description="Conjunción de campos y operadores compilados. Sin expresiones libres.", body="EligibilityRules", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/catalog/admin/offers/{id}/assignments", operation_id="listAssignments", summary="Lista asignaciones", tag="admin", auth=perm("offers:assignments:read"), success=("200", "OfferAssignmentPage"), description="Paginada.", parameters=[uuid_param("id")] + PAGE)
    add(paths, "post", "/api/v1/catalog/admin/offers/{id}/assignments", operation_id="createAssignment", summary="Asigna una oferta", tag="admin", auth=perm("offers:assign"), success=("201", "OfferAssignment"), description="Asignación directa.", body="OfferAssignmentCreate", parameters=[uuid_param("id")])
    add(paths, "delete", "/api/v1/catalog/admin/offers/{id}/assignments/{assignmentId}", operation_id="deleteAssignment", summary="Retira una asignación", tag="admin", auth=perm("offers:assign"), success="204", description="Comparte offers:assign con el alta, según el contrato.", parameters=[uuid_param("id"), uuid_param("assignmentId")])
    schemas = {
        "Empty": obj([], {}),
        "Category": obj(["id", "code", "name", "status"], {"id": UUID, "code": CODE, "name": NAME, "description": {"type": "string"}, "status": {"enum": ["active", "disabled"]}}),
        "CategoryPage": page_of("Category"),
        "CategoryWrite": obj(["code", "name"], {"code": CODE, "name": NAME, "description": {"type": "string", "maxLength": 500}, "status": {"enum": ["active", "disabled"]}}),
        "Product": obj(["id", "code", "name", "currency"], {"id": UUID, "categoryId": UUID, "code": CODE, "name": NAME, "summary": {"type": "string"}, "description": {"type": "string"}, "currency": {"const": "MXN"}, "termsVersion": {"type": "integer"}, "termsText": {"type": "string"}}),
        "ProductPage": page_of("Product"),
        "ProductAdmin": obj(["id", "code", "name", "status"], {"id": UUID, "categoryId": UUID, "code": CODE, "name": NAME, "summary": {"type": "string"}, "description": {"type": "string"}, "currency": {"const": "MXN"}, "termsVersion": {"type": "integer"}, "termsText": {"type": "string"}, "status": {"enum": ["draft", "active", "disabled"]}, "conditions": ref("ProductConditions")}),
        "ProductAdminPage": page_of("ProductAdmin"),
        "ProductWrite": obj(["categoryId", "code", "name", "currency"], {"categoryId": UUID, "code": CODE, "name": NAME, "summary": {"type": "string", "maxLength": 300}, "description": {"type": "string", "maxLength": 4000}, "currency": {"const": "MXN"}, "termsText": {"type": "string", "maxLength": 8000}, "status": {"enum": ["draft", "active", "disabled"]}, "conditions": ref("ProductConditions")}),
        "ProductConditions": obj(["schemaVersion", "attributes"], {"schemaVersion": {"type": "integer", "minimum": 1}, "attributes": {"type": "object", "maxProperties": 30, "additionalProperties": {"type": ["string", "number", "boolean"]}, "description": "El servidor solo acepta claves del esquema compilado para esa categoría y versión."}}),
        "Offer": obj(["id", "title", "status"], {"id": UUID, "productId": UUID, "code": CODE, "title": NAME, "description": {"type": "string"}, "benefitType": {"type": "string"}, "benefitValue": {"type": "string"}, "startsAt": WHEN, "endsAt": WHEN, "eligible": {"type": "boolean"}, "status": {"const": "active"}}),
        "OfferPage": page_of("Offer"),
        "OfferAdmin": obj(["id", "code", "title", "status"], {"id": UUID, "productId": UUID, "code": CODE, "title": NAME, "description": {"type": "string"}, "benefitType": {"enum": ["information"]}, "benefitValue": {"type": "string", "maxLength": 200}, "startsAt": WHEN, "endsAt": WHEN, "priority": {"type": "integer"}, "audienceType": {"enum": ["general", "rules", "direct"]}, "status": {"enum": ["draft", "active", "disabled"]}}),
        "OfferAdminPage": page_of("OfferAdmin"),
        "OfferWrite": obj(["productId", "code", "title", "audienceType"], {"productId": UUID, "code": CODE, "title": NAME, "description": {"type": "string", "maxLength": 4000}, "benefitType": {"const": "information"}, "benefitValue": {"type": "string", "maxLength": 200}, "startsAt": WHEN, "endsAt": WHEN, "priority": {"type": "integer", "minimum": 0, "maximum": 1000}, "audienceType": {"enum": ["general", "rules", "direct"]}, "status": {"enum": ["draft", "active", "disabled"]}}),
        "EligibilityRules": obj(["rules"], {"rules": {"type": "array", "maxItems": 10, "items": obj(["field", "operator", "value"], {"field": {"enum": ["totalBalance", "accountAgeDays"]}, "operator": {"enum": ["eq", "gte", "lte"]}, "value": {"type": "string", "maxLength": 40}})}}),
        "OfferAssignment": obj(["id", "offerId", "customerId"], {"id": UUID, "offerId": UUID, "customerId": UUID, "reason": {"type": "string"}}),
        "OfferAssignmentPage": page_of("OfferAssignment"),
        "OfferAssignmentCreate": obj(["customerId", "reason"], {"customerId": UUID, "reason": {"type": "string", "minLength": 1, "maxLength": 300}}),
    }
    return document("Catálogo", "API /api/v1/catalog. No hay contratación ni registro de interés. Cada verbo tiene su permiso.", paths, schemas)


def audit():
    paths = {}
    filters = PAGE + [
        query("from", {"type": "string", "format": "date-time"}, "Inicio UTC. El rango máximo es 31 días."),
        query("to", {"type": "string", "format": "date-time"}, "Fin UTC."),
        query("actorId", UUID, "Actor."),
        query("sourceService", {"enum": ["access", "accounts", "catalog", "audit", "ai"]}, "Servicio."),
        query("eventType", {"type": "string", "maxLength": 80}, "Tipo conocido."),
        query("resourceType", {"type": "string", "maxLength": 80}, "Recurso."),
        query("outcome", {"enum": ["success", "failure", "denied"]}, "Resultado."),
    ]
    add(paths, "get", "/api/v1/audit/events", operation_id="listEvents", summary="Busca eventos", tag="audit", auth=perm("audit:read:any"), success=("200", "AuditPage"), description="La consulta genera su evento sin volver a la cola.", parameters=filters)
    add(paths, "get", "/api/v1/audit/events/{id}", operation_id="getEvent", summary="Detalle de evento", tag="audit", auth=perm("audit:read:any"), success=("200", "AuditEvent"), description="Sin secretos ni prompts.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/audit/me/events", operation_id="listMyEvents", summary="Eventos propios", tag="audit", auth=perm("audit:read:own"), success=("200", "AuditPage"), description="Ningún rol inicial tiene audit:read:own.", parameters=filters)
    add(paths, "get", "/api/v1/audit/correlations/{id}/events", operation_id="listCorrelationEvents", summary="Eventos de una correlación", tag="audit", auth=perm("audit:read:any"), success=("200", "AuditPage"), description="Mismo permiso global.", parameters=[uuid_param("id")] + PAGE)
    schemas = {
        "AuditEvent": obj(
            ["eventId", "eventType", "occurredAt", "outcome", "correlationId"],
            {
                "eventId": UUID,
                "eventType": {"type": "string"},
                "schemaVersion": {"type": "integer"},
                "occurredAt": WHEN,
                "receivedAt": WHEN,
                "sourceService": {"type": "string"},
                "actorType": {"enum": ["user", "service", "system"]},
                "actorId": UUID,
                "customerId": {"type": ["string", "null"], "format": "uuid"},
                "resourceType": {"type": "string"},
                "resourceId": {"type": "string"},
                "action": {"type": "string"},
                "outcome": {"enum": ["success", "failure", "denied"]},
                "reasonCode": {"type": ["string", "null"]},
                "channel": {"enum": ["web", "service", "system"]},
                "correlationId": UUID,
            },
        ),
        "AuditPage": page_of("AuditEvent"),
    }
    return document("Auditoría", "API de solo lectura /api/v1/audit. No hay escrituras HTTP públicas.", paths, schemas)


def ai():
    paths = {}
    add(paths, "post", "/api/v1/ai/conversations", operation_id="createConversation", summary="Crea una conversación", tag="chat", auth=perm("ai:chat:use"), success=("201", "Conversation"), description="Solo propia.", body="ConversationCreate")
    add(paths, "get", "/api/v1/ai/conversations", operation_id="listConversations", summary="Lista conversaciones propias", tag="chat", auth=perm("ai:chat:use"), success=("200", "ConversationPage"), description="No existe ruta de conversaciones ajenas.", parameters=PAGE)
    add(paths, "get", "/api/v1/ai/conversations/{id}", operation_id="getConversation", summary="Lee una conversación", tag="chat", auth=perm("ai:chat:use"), success=("200", "Conversation"), description="404 si es de otra persona.", parameters=[uuid_param("id")])
    add(paths, "patch", "/api/v1/ai/conversations/{id}", operation_id="renameConversation", summary="Cambia el título", tag="chat", auth=perm("ai:chat:use"), success=("200", "Conversation"), description="Solo título.", body="ConversationUpdate", parameters=[uuid_param("id")])
    add(paths, "delete", "/api/v1/ai/conversations/{id}", operation_id="deleteConversation", summary="Oculta la conversación", tag="chat", auth=perm("ai:chat:use"), success="204", description="No borra auditoría ni movimientos.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/ai/conversations/{id}/messages", operation_id="listMessages", summary="Mensajes", tag="chat", auth=perm("ai:chat:use"), success=("200", "MessageCursor"), description="Cursor.", parameters=[uuid_param("id")] + CURSOR)
    add(paths, "post", "/api/v1/ai/conversations/{id}/messages", operation_id="createMessage", summary="Envía un mensaje", tag="chat", auth=perm("ai:chat:use"), success=("202", "RunAccepted"), description="requestId evita un duplicado. No ejecuta una transferencia.", body="MessageCreate", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/ai/runs/{id}", operation_id="getRun", summary="Estado de la ejecución", tag="chat", auth=perm("ai:chat:use"), success=("200", "Run"), description="Solo la propia.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/ai/runs/{id}/events", operation_id="streamRun", summary="Stream de la ejecución", tag="chat", auth=perm("ai:chat:use"), success=("200", "RunStreamEvent"), description="Sin token en la query. Reconectar no relanza el modelo.", parameters=[uuid_param("id")], content_type="text/event-stream")
    add(paths, "post", "/api/v1/ai/runs/{id}/cancel", operation_id="cancelRun", summary="Cancela la ejecución", tag="chat", auth=perm("ai:chat:use"), success=("202", "Run"), description="No revierte una transferencia confirmada.", body="Empty", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/ai/me/metrics", operation_id="getMyMetrics", summary="Métricas propias", tag="metrics", auth=perm("ai:metrics:read:own"), success=("200", "Metrics"), description="Sin contenido de mensajes.")
    add(paths, "get", "/api/v1/ai/runs/{id}/metrics", operation_id="getRunMetrics", summary="Métricas de una ejecución", tag="metrics", auth=any_of([{"permission": "ai:metrics:read:own", "ownership": True}, {"permission": "ai:metrics:read:any"}]), success=("200", "RunMetrics"), description="Own exige ser el dueño. Any no devuelve el mensaje.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/ai/admin/metrics", operation_id="getAdminMetrics", summary="Métricas globales", tag="admin", auth=perm("ai:metrics:read:any"), success=("200", "Metrics"), description="Sin conversaciones.", parameters=[query("from", {"type": "string", "format": "date-time"}, "Inicio."), query("to", {"type": "string", "format": "date-time"}, "Fin."), query("model", {"type": "string"}, "Modelo.")])
    add(paths, "get", "/api/v1/ai/admin/users/{id}/metrics", operation_id="getUserMetrics", summary="Métricas de un usuario", tag="admin", auth=perm("ai:metrics:read:any"), success=("200", "Metrics"), description="Sin mensajes.", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/ai/admin/alerts", operation_id="listAlerts", summary="Alertas", tag="admin", auth=perm("ai:alerts:read"), success=("200", "AlertPage"), description="Solo administradores con el permiso.", parameters=PAGE)
    add(paths, "post", "/api/v1/ai/admin/alerts/{id}/acknowledge", operation_id="acknowledgeAlert", summary="Reconoce una alerta", tag="admin", auth=perm("ai:alerts:acknowledge"), success=("200", "Alert"), description="No deshace el consumo.", body="Empty", parameters=[uuid_param("id")])
    add(paths, "get", "/api/v1/ai/admin/alert-rules", operation_id="listAlertRules", summary="Reglas de alerta", tag="admin", auth=perm("ai:alerts:configure"), success=("200", "AlertRulePage"), description="Sin correo libre.", parameters=PAGE)
    add(paths, "put", "/api/v1/ai/admin/alert-rules", operation_id="replaceAlertRules", summary="Reemplaza reglas", tag="admin", auth=perm("ai:alerts:configure"), success=("200", "AlertRulePage"), description="Destinatarios administrativos ya existentes.", body="AlertRuleReplace")
    add(paths, "get", "/api/v1/ai/admin/documents", operation_id="listDocuments", summary="Documentos RAG", tag="documents", auth=perm("ai:documents:read"), success=("200", "DocumentPage"), description="Permiso del gestor de catálogo.", parameters=PAGE)
    add(paths, "get", "/api/v1/ai/admin/indexing-jobs/{id}", operation_id="getIndexingJob", summary="Trabajo de indexación", tag="documents", auth=perm("ai:documents:read"), success=("200", "IndexingJob"), description="Sin el texto completo del proveedor.", parameters=[uuid_param("id")])
    add(paths, "post", "/api/v1/ai/admin/documents/{id}/reindex", operation_id="reindexDocument", summary="Reindexa un documento", tag="documents", auth=perm("ai:documents:reindex"), success=("202", "IndexingJob"), description="Idempotente por versión y hash.", body="Empty", parameters=[uuid_param("id")])
    schemas = {
        "Empty": obj([], {}),
        "Conversation": obj(["id", "title", "status"], {"id": UUID, "title": {"type": "string"}, "status": {"enum": ["active", "deleted"]}, "createdAt": WHEN}),
        "ConversationPage": page_of("Conversation"),
        "ConversationCreate": obj([], {"title": {"type": "string", "maxLength": 120}}),
        "ConversationUpdate": obj(["title"], {"title": {"type": "string", "minLength": 1, "maxLength": 120}}),
        "Message": obj(["id", "role", "content", "createdAt"], {"id": UUID, "role": {"enum": ["user", "assistant"]}, "content": {"type": "string"}, "createdAt": WHEN, "runId": UUID}),
        "MessageCursor": cursor_of("Message"),
        "MessageCreate": obj(["content", "requestId"], {"content": {"type": "string", "minLength": 1, "maxLength": 4000}, "requestId": UUID}),
        "RunAccepted": obj(["runId", "conversationId"], {"runId": UUID, "conversationId": UUID}),
        "Run": obj(["id", "status", "model"], {"id": UUID, "conversationId": UUID, "status": {"enum": ["queued", "running", "completed", "failed", "cancelled"]}, "model": {"type": "string"}, "usageComplete": {"type": "boolean"}, "estimatedCostUsd": {"type": ["string", "null"]}}),
        "RunStreamEvent": obj(["type"], {"type": {"enum": ["content", "tool_status", "confirmation_required", "metrics", "completed", "failed"]}, "proposalId": UUID, "text": {"type": "string"}}),
        "Metrics": obj(["usageComplete"], {"from": WHEN, "to": WHEN, "runCount": {"type": "integer"}, "estimatedCostUsd": {"type": ["string", "null"]}, "usageComplete": {"type": "boolean"}, "inputTokens": {"type": ["integer", "null"]}, "outputTokens": {"type": ["integer", "null"]}, "cachedTokens": {"type": ["integer", "null"]}, "totalTokens": {"type": ["integer", "null"]}}),
        "RunMetrics": obj(["runId", "model", "usageComplete"], {"runId": UUID, "model": {"type": "string"}, "latencyMs": {"type": ["integer", "null"]}, "timeToFirstContentMs": {"type": ["integer", "null"]}, "usageComplete": {"type": "boolean"}, "estimatedCostUsd": {"type": ["string", "null"]}, "pricingVersion": {"type": "string"}, "inputTokens": {"type": ["integer", "null"]}, "outputTokens": {"type": ["integer", "null"]}, "cachedTokens": {"type": ["integer", "null"]}, "totalTokens": {"type": ["integer", "null"]}}),
        "Alert": obj(["id", "status", "observedValueUsd"], {"id": UUID, "ruleId": UUID, "scope": {"enum": ["run", "user_day", "global_day"]}, "observedValueUsd": COST, "status": {"enum": ["open", "acknowledged"]}}),
        "AlertPage": page_of("Alert"),
        "AlertRule": obj(["id", "scope", "metric", "threshold", "enabled", "version"], {"id": UUID, "scope": {"enum": ["run", "user_day", "global_day"]}, "metric": {"const": "estimated_cost_usd"}, "threshold": COST, "window": {"enum": ["run", "day"]}, "cooldownSeconds": {"type": "integer", "minimum": 1}, "enabled": {"type": "boolean"}, "version": {"type": "integer"}, "administrativeRecipientIds": {"type": "array", "items": UUID}}),
        "AlertRulePage": page_of("AlertRule"),
        "AlertRuleReplace": obj(["version", "rules"], {"version": {"type": "integer", "minimum": 1}, "rules": {"type": "array", "items": ref("AlertRule")}}),
        "KnowledgeDocument": obj(["id", "code", "version", "status"], {"id": UUID, "code": CODE, "title": NAME, "version": {"type": "integer"}, "contentHash": {"type": "string"}, "audience": {"enum": ["general", "administrative"]}, "status": {"enum": ["active", "disabled"]}}),
        "DocumentPage": page_of("KnowledgeDocument"),
        "IndexingJob": obj(["id", "documentId", "status"], {"id": UUID, "documentId": UUID, "embeddingModel": {"type": "string"}, "dimensions": {"type": "integer"}, "status": {"enum": ["queued", "running", "completed", "failed"]}, "processedChunks": {"type": "integer"}, "errorCode": {"type": ["string", "null"]}}),
    }
    return document("IA", "API /api/v1/ai. El modelo no confirma transferencias ni lee conversaciones ajenas.", paths, schemas)


def prune_security(spec):
    used = set()
    for methods in spec["paths"].values():
        for operation_data in methods.values():
            for requirement in operation_data.get("security", []):
                used.update(requirement)
    schemes = spec["components"]["securitySchemes"]
    spec["components"]["securitySchemes"] = {name: scheme for name, scheme in schemes.items() if name in used}


def main():
    specs = {
        "access.yaml": access(),
        "accounts.yaml": accounts(),
        "catalog.yaml": catalog(),
        "audit.yaml": audit(),
        "ai.yaml": ai(),
    }
    for name, spec in specs.items():
        prune_security(spec)
        target = ROOT / name
        target.write_text(yaml.dump(spec, Dumper=Dumper, sort_keys=False, allow_unicode=True), encoding="utf-8")
        count = sum(len(methods) for methods in spec["paths"].values())
        print(f"{name}: {count} operaciones, {len(spec['paths'])} rutas")


if __name__ == "__main__":
    main()
