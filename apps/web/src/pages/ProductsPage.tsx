import { Button, Card } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { accessRequest, parsePositive } from "../access/http";

interface ProductPage {
  items: Array<{ id: string; code: string; name: string; summary?: string; currency: string; termsVersion?: number }>;
  totalItems: number;
  page: number;
  totalPages: number;
}

export function ProductsPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const pageSize = parsePositive(params.get("pageSize"), 20, 100);
  const categoryId = params.get("categoryId");
  const categoryValid = categoryId === null || categoryId === "" || /^[0-9a-f-]{36}$/i.test(categoryId);
  const valid = page !== null && pageSize !== null && categoryValid;
  const products = useQuery({
    queryKey: ["catalog", "products", page, pageSize, categoryId],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<ProductPage> => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (categoryId) {
        query.set("categoryId", categoryId);
      }
      const response = await accessRequest(client, `/api/v1/catalog/products?${query.toString()}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("products_failed");
      }
      return (await response.json()) as ProductPage;
    },
  });
  const forbidden = products.error instanceof Error && products.error.message === "forbidden";
  const offers = useQuery({
    queryKey: ["catalog", "offers", "products"],
    retry: false,
    queryFn: async () => {
      const response = await accessRequest(client, "/api/v1/catalog/me/offers?page=1&pageSize=3");
      if (response.status === 401 || response.status === 403) {
        return null;
      }
      if (response.status === 503) {
        throw new Error("unavailable");
      }
      if (!response.ok) {
        throw new Error("offers_failed");
      }
      const body = (await response.json()) as { items?: Array<{ id: string; title: string; code: string }> };
      return body.items ?? [];
    },
  });

  function go(next: number) {
    const copy = new URLSearchParams(params);
    copy.set("page", String(next));
    setParams(copy);
  }

  return (
    <section className="grid gap-3">
      <h1 className="text-2xl font-semibold">Productos</h1>
      {!valid ? <p role="alert">Los filtros de la dirección no son válidos.</p> : null}
      {products.isLoading ? <p>Cargando productos…</p> : null}
      {forbidden ? <p role="alert">No tienes permiso para ver productos.</p> : null}
      {products.isError && !forbidden ? <p role="alert">No se pudieron consultar los productos.</p> : null}
      {products.data && products.data.items.length === 0 ? <p>No hay productos en esta página.</p> : null}
      <ul className="grid gap-3">
        {products.data?.items.map((item) => (
          <li key={item.id}>
            <Card>
              <Card.Header>
                <Card.Title>
                  <Link to={`/productos/${item.id}`}>{item.name}</Link>
                </Card.Title>
                <Card.Description>{item.code} · {item.currency}</Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-1">
                {item.summary ? <p>{item.summary}</p> : null}
                {item.termsVersion ? <p>Términos v{item.termsVersion}</p> : null}
              </Card.Content>
            </Card>
          </li>
        ))}
      </ul>
      {products.data ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="tertiary" isDisabled={products.data.page <= 1} onPress={() => go(products.data.page - 1)}>Anterior</Button>
          <Button type="button" variant="tertiary" isDisabled={products.data.page >= products.data.totalPages} onPress={() => go(products.data.page + 1)}>Siguiente</Button>
        </div>
      ) : null}
      {offers.data ? (
        <div className="grid gap-2">
          <h2 className="text-lg font-semibold">Ofertas</h2>
          {offers.data.length === 0 ? <p>No hay ofertas elegibles ahora.</p> : null}
          <ul>
            {offers.data.map((item) => <li key={item.id}>{item.title} · {item.code}</li>)}
          </ul>
          <Link to="/ofertas">Ver todas las ofertas</Link>
        </div>
      ) : null}
      {offers.error instanceof Error && offers.error.message === "unavailable" ? <p role="alert">No se pudo comprobar la elegibilidad. No se concedió ninguna oferta por reglas.</p> : null}
    </section>
  );
}
