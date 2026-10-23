import { AccessError } from "./access-error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase().normalize("NFKC");
  if (normalized.length === 0 || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new AccessError("VALIDATION_ERROR", "El correo no es válido", [{ field: "email", code: "invalid" }]);
  }
  return normalized;
}

export function assertPasswordPolicy(password: string, minLength: number): void {
  if (password.length < minLength || password.length > 200 || password.trim().length === 0) {
    throw new AccessError("VALIDATION_ERROR", "La contraseña no cumple la política", [
      { field: "password", code: "policy" },
    ]);
  }
}

export function normalizePhone(countryCode: string, nationalNumber: string): {
  countryCode: string;
  callingCode: string;
  nationalNumber: string;
  e164: string;
} {
  if (countryCode !== "MX" || !/^[0-9]{10}$/.test(nationalNumber)) {
    throw new AccessError("VALIDATION_ERROR", "El teléfono debe ser un número mexicano de 10 dígitos", [
      { field: "phoneNumber", code: "invalid" },
    ]);
  }
  return {
    countryCode,
    callingCode: "+52",
    nationalNumber,
    e164: `+52${nationalNumber}`,
  };
}

export function assertDisplayName(value: string, field: "givenName" | "familyName"): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new AccessError("VALIDATION_ERROR", "El nombre no es válido", [{ field, code: "invalid" }]);
  }
  return trimmed;
}

export function assertInternalReturnTo(value: string | undefined): string {
  if (value === undefined || value === "") {
    return "/";
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://") || value.length > 200) {
    throw new AccessError("VALIDATION_ERROR", "El retorno solo puede ser una ruta interna", [
      { field: "returnTo", code: "invalid" },
    ]);
  }
  return value;
}

export function assertRoleCode(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw new AccessError("VALIDATION_ERROR", "El código no es válido", [{ field: "code", code: "invalid" }]);
  }
  return value;
}
