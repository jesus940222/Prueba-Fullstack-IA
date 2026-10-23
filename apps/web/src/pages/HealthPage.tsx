import { useQuery } from "@tanstack/react-query";

interface HealthBody {
  status?: string;
}

export function HealthPage() {
  const health = useQuery({
    queryKey: ["access-health"],
    retry: false,
    queryFn: async (): Promise<HealthBody> => {
      const response = await fetch("/services/access/health");
      if (!response.ok) {
        throw new Error("salud_no_disponible");
      }
      return (await response.json()) as HealthBody;
    },
  });

  return (
    <section className="grid gap-3">
      <h1 className="text-2xl font-semibold">Salud</h1>
      {health.isPending ? <p>Consultando la salud del servicio…</p> : null}
      {health.isError ? <p role="alert">No se pudo consultar la salud. El servicio no está disponible.</p> : null}
      {health.data ? <p>Respuesta del servicio: {health.data.status ?? "sin estado"}</p> : null}
    </section>
  );
}
