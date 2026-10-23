import { Card } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { accessRequest } from "../access/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Product {
  id: string;
  code: string;
  name: string;
  summary?: string;
  description?: string;
  currency?: string;
  termsVersion?: number;
  termsText?: string;
}

export function ProductDetailPage() {
  const client = useQueryClient();
  const { productId = "" } = useParams();
  const valid = UUID.test(productId);
  const product = useQuery({
    queryKey: ["catalog", "product", productId],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<Product> => {
      const response = await accessRequest(client, `/api/v1/catalog/products/${productId}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (response.status === 404) {
        throw new Error("hidden");
      }
      if (!response.ok) {
        throw new Error("product_failed");
      }
      return (await response.json()) as Product;
    },
  });
  const forbidden = product.error instanceof Error && product.error.message === "forbidden";
  const hidden = product.error instanceof Error && product.error.message === "hidden";

  return (
    <section className="grid gap-4">
      <Link to="/productos">Volver a productos</Link>
      <h1 className="text-2xl font-semibold">Producto</h1>
      {!valid ? <p role="alert">La dirección no es válida. No se consultó el producto.</p> : null}
      {product.isLoading ? <p>Cargando el producto…</p> : null}
      {forbidden ? <p role="alert">No tienes permiso para ver productos.</p> : null}
      {hidden ? <p role="alert">El producto no está disponible.</p> : null}
      {product.isError && !forbidden && !hidden ? <p role="alert">No se pudo consultar el producto.</p> : null}
      {product.data ? (
        <Card>
          <Card.Header>
            <Card.Title>{product.data.name}</Card.Title>
            <Card.Description>{product.data.code}{product.data.currency ? ` · ${product.data.currency}` : ""}</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-2">
            {product.data.summary ? <p>{product.data.summary}</p> : null}
            {product.data.description ? <p>{product.data.description}</p> : null}
            {product.data.termsVersion ? <p>Términos v{product.data.termsVersion}</p> : null}
            {product.data.termsText ? <p>{product.data.termsText}</p> : null}
          </Card.Content>
        </Card>
      ) : null}
    </section>
  );
}
