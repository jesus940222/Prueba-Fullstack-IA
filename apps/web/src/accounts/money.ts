const DECIMAL = /^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/;

export function formatMxn(value: string): string {
  if (!DECIMAL.test(value)) {
    return value;
  }
  const [whole, fraction] = value.split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${fraction} MXN`;
}

export function maskAccount(accountNumber: string | undefined): string {
  if (!accountNumber) {
    return "Número no incluido";
  }
  const digits = accountNumber.replace(/\s/g, "");
  if (!/^[0-9]{4,}$/.test(digits)) {
    return accountNumber;
  }
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function accountStatusLabel(status: string): string {
  if (status === "active") {
    return "Activa";
  }
  if (status === "closed") {
    return "Cerrada";
  }
  return status;
}

export function formatMexico(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(date);
}

export function classifyConfirm(status: number, body: { status?: string; id?: string } | null): "completed" | "uncertain" | "failed" {
  if (status === 200 && body?.status === "completed" && typeof body.id === "string") {
    return "completed";
  }
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return "uncertain";
  }
  return "failed";
}
