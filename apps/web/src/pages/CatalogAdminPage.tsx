import { Button } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router";
import { z } from "zod";
import { accessRequest, parseFlag, parsePositive } from "../access/http";
import { notifyDanger, notifySuccess, notifyWarning } from "../shell/notify";

const schema = z.object({
  code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa un código en minúsculas"),
  name: z.string().trim().min(1, "El nombre es obligatorio").max(80),
});
type CategoryInput = z.infer<typeof schema>;

interface CategoryPage {
  items: Array<{ id: string; code: string; name: string; status: string }>;
  totalItems: number;
}

export function CatalogAdminPage() {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const includeDeleted = parseFlag(params.get("includeDeleted"));
  const valid = page !== null && includeDeleted !== null;
  const form = useForm<CategoryInput>({ resolver: zodResolver(schema), defaultValues: { code: "", name: "" } });
  const categories = useQuery({
    queryKey: ["catalog", "admin", page, includeDeleted],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<CategoryPage> => {
      const response = await accessRequest(client, `/api/v1/catalog/admin/categories?page=${page}&pageSize=20&includeDeleted=${includeDeleted}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("catalog_failed");
      }
      return (await response.json()) as CategoryPage;
    },
  });
  const forbidden = categories.error instanceof Error && categories.error.message === "forbidden";
  return (
    <section className="grid max-w-xl gap-3">
      <h1 className="text-2xl font-semibold">Catálogo</h1>
      {!valid ? <p role="alert">Los filtros de la dirección no son válidos.</p> : null}
      {categories.isLoading ? <p>Cargando catálogo…</p> : null}
      {forbidden ? <p role="alert">No tienes permiso para administrar el catálogo.</p> : null}
      {categories.isError && !forbidden ? <p role="alert">No se pudo consultar el catálogo.</p> : null}
      {categories.data && categories.data.items.length === 0 ? <p>No hay categorías en esta página.</p> : null}
      <ul>
        {categories.data?.items.map((item) => (
          <li key={item.id}>{item.name} · {item.code} · {item.status}</li>
        ))}
      </ul>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          const response = await accessRequest(client, "/api/v1/catalog/admin/categories", { method: "POST", body: JSON.stringify(values) });
          if (response.status === 403) {
            notifyDanger("No tienes permiso para crear categorías.");
            return;
          }
          if (!response.ok) {
            notifyDanger("No se pudo crear la categoría.");
            return;
          }
          await client.invalidateQueries({ queryKey: ["catalog", "admin"] });
          form.reset();
          notifySuccess("Categoría creada.");
        }, () => notifyWarning("Revisa los datos antes de crear la categoría."))}
      >
        <label className="grid gap-1" htmlFor="category-code">
          Código
          <input id="category-code" className="rounded-md border px-3 py-2" {...form.register("code")} />
        </label>
        {form.formState.errors.code ? <p role="alert">{form.formState.errors.code.message}</p> : null}
        <label className="grid gap-1" htmlFor="category-name">
          Nombre
          <input id="category-name" className="rounded-md border px-3 py-2" {...form.register("name")} />
        </label>
        {form.formState.errors.name ? <p role="alert">{form.formState.errors.name.message}</p> : null}
        <Button type="submit">Crear categoría</Button>
      </form>
    </section>
  );
}
