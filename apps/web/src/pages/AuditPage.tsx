import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { z } from "zod";
import { accessRequest, parsePositive } from "../access/http";

const filters = z.object({
  sourceService: z.enum(["", "access", "accounts", "catalog", "audit", "ai"]).optional(),
  outcome: z.enum(["", "success", "failure", "denied"]).optional(),
  eventType: z.string().max(80).optional(),
});

interface AuditPageBody {
  items: Array<{ eventId: string; eventType: string; occurredAt: string; sourceService: string; outcome: string; correlationId: string; actorId: string }>;
  totalItems: number;
  page: number;
  totalPages: number;
}

const mexico = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" });

export function formatMexico(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : mexico.format(new Date(parsed));
}

export function AuditPage() {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const pageSize = parsePositive(params.get("pageSize"), 20, 100);
  const parsed = filters.safeParse({
    sourceService: params.get("sourceService") ?? "",
    outcome: params.get("outcome") ?? "",
    eventType: params.get("eventType") ?? "",
  });
  const valid = page !== null && pageSize !== null && parsed.success;
  const events = useQuery({
    queryKey: ["audit", "events", page, pageSize, params.toString()],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<AuditPageBody> => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (parsed.success && parsed.data.sourceService) {
        query.set("sourceService", parsed.data.sourceService);
      }
      if (parsed.success && parsed.data.outcome) {
        query.set("outcome", parsed.data.outcome);
      }
      if (parsed.success && parsed.data.eventType) {
        query.set("eventType", parsed.data.eventType);
      }
      const response = await accessRequest(client, `/api/v1/audit/events?${query.toString()}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("audit_failed");
      }
      return (await response.json()) as AuditPageBody;
    },
  });
  const forbidden = events.error instanceof Error && events.error.message === "forbidden";
  return (
    <section className="grid gap-3">
      <h1 className="text-2xl font-semibold">Auditoría</h1>
      {!valid ? <p role="alert">Los filtros de la dirección no son válidos.</p> : null}
      {events.isLoading ? <p>Cargando eventos…</p> : null}
      {forbidden ? <p role="alert">No tienes permiso para consultar la auditoría.</p> : null}
      {events.isError && !forbidden ? <p role="alert">No se pudieron consultar los eventos.</p> : null}
      {events.data && events.data.items.length === 0 ? <p>No hay eventos en este rango.</p> : null}
      <ul>
        {events.data?.items.map((item) => (
          <li key={item.eventId}>
            {formatMexico(item.occurredAt)} · {item.sourceService} · {item.eventType} · {item.outcome}
            {" · "}
            <Link to={`/auditoria?page=1&pageSize=20&eventType=${encodeURIComponent(item.eventType)}`}>Misma correlación {item.correlationId.slice(0, 8)}</Link>
          </li>
        ))}
      </ul>
      {events.data && events.data.totalPages > 1 ? <p>Página {events.data.page} de {events.data.totalPages}</p> : null}
    </section>
  );
}
