import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { accessRequest, parsePositive } from "../access/http";

interface OfferPage {
  items: Array<{ id: string; code: string; title: string; eligible?: boolean; status: string; endsAt?: string | null }>;
  totalItems: number;
  page: number;
  totalPages: number;
}

export function OffersPage() {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const pageSize = parsePositive(params.get("pageSize"), 20, 100);
  const valid = page !== null && pageSize !== null;
  const offers = useQuery({
    queryKey: ["catalog", "offers", page, pageSize],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<OfferPage> => {
      const response = await accessRequest(client, `/api/v1/catalog/me/offers?page=${page}&pageSize=${pageSize}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (response.status === 503) {
        throw new Error("unavailable");
      }
      if (!response.ok) {
        throw new Error("offers_failed");
      }
      return (await response.json()) as OfferPage;
    },
  });
  const message = offers.error instanceof Error ? offers.error.message : "";
  return (
    <section className="grid gap-3">
      <h1 className="text-2xl font-semibold">Ofertas</h1>
      {!valid ? <p role="alert">Los filtros de la dirección no son válidos.</p> : null}
      {offers.isLoading ? <p>Cargando ofertas…</p> : null}
      {message === "forbidden" ? <p role="alert">No tienes permiso para ver ofertas.</p> : null}
      {message === "unavailable" ? <p role="alert">No se pudo comprobar la elegibilidad. No se concedió ninguna oferta por reglas.</p> : null}
      {offers.isError && message !== "forbidden" && message !== "unavailable" ? <p role="alert">No se pudieron consultar las ofertas.</p> : null}
      {offers.data && offers.data.items.length === 0 ? <p>No hay ofertas elegibles en esta página.</p> : null}
      <ul className="grid gap-3">
        {offers.data?.items.map((item) => (
          <li key={item.id} className="rounded-lg border px-3 py-2">
            {item.title} · {item.code} · {item.eligible ? "elegible" : "no elegible"} · {item.status}
          </li>
        ))}
      </ul>
    </section>
  );
}
