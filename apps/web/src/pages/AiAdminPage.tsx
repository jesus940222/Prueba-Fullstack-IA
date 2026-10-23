import { Button, Card, Chip, Table } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { accessRequest, parsePositive } from "../access/http";
import { notifyDanger, notifySuccess } from "../shell/notify";
import { OptionsMenu } from "../shell/options-menu";

interface Metrics {
  from?: string;
  to?: string;
  runCount: number;
  usageComplete: boolean;
  estimatedCostUsd: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
}

interface Alert {
  id: string;
  scope: string;
  observedValueUsd: string;
  status: string;
}

interface AlertPage {
  items: Alert[];
  totalItems?: number;
  totalPages?: number;
  page?: number;
}

function formatWhen(value: string | undefined): string {
  if (!value) {
    return "Sin periodo";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "No medido";
  }
  return new Intl.NumberFormat("es-MX").format(value);
}

function alertStatusLabel(status: string): string {
  if (status === "open") return "Abierta";
  if (status === "acknowledged") return "Reconocida";
  return status;
}

export function AiAdminPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const metrics = useQuery({
    queryKey: ["ai", "admin-metrics"],
    retry: false,
    queryFn: async (): Promise<Metrics> => {
      const response = await accessRequest(client, "/api/v1/ai/admin/metrics");
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("metrics_failed");
      }
      return (await response.json()) as Metrics;
    },
  });
  const alerts = useQuery({
    queryKey: ["ai", "alerts", page],
    enabled: page !== null,
    retry: false,
    queryFn: async () => {
      const response = await accessRequest(client, `/api/v1/ai/admin/alerts?page=${page ?? 1}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("alerts_failed");
      }
      return (await response.json()) as AlertPage;
    },
  });
  const forbidden = (metrics.error instanceof Error && metrics.error.message === "forbidden") || (alerts.error instanceof Error && alerts.error.message === "forbidden");
  const alertTotal = alerts.data?.totalItems ?? alerts.data?.items.length;

  function go(next: number) {
    const copy = new URLSearchParams(params);
    copy.set("page", String(next));
    setParams(copy);
  }

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">Métricas y alertas</h1>
      {page === null ? <p role="alert">La página indicada en la dirección no es válida.</p> : null}
      {metrics.isLoading ? <p>Cargando métricas…</p> : null}
      {forbidden ? <p role="alert">No tienes permiso para consultar las métricas o las alertas.</p> : null}
      {metrics.isError && !forbidden ? <p role="alert">No se pudieron consultar las métricas.</p> : null}
      {alerts.isError && !forbidden ? <p role="alert">No se pudieron consultar las alertas.</p> : null}
      {metrics.data ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <Card.Header>
              <Card.Title>Ejecuciones</Card.Title>
            </Card.Header>
            <Card.Content>
              <p className="text-3xl font-semibold">{metrics.data.runCount} ejecuciones</p>
            </Card.Content>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>Coste estimado</Card.Title>
            </Card.Header>
            <Card.Content>
              {metrics.data.usageComplete ? (
                <p className="text-3xl font-semibold">Coste estimado {metrics.data.estimatedCostUsd} USD.</p>
              ) : (
                <p>Medición incompleta. No se muestra el coste como cero.</p>
              )}
            </Card.Content>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>Tokens</Card.Title>
            </Card.Header>
            <Card.Content className="grid gap-1">
              {metrics.data.usageComplete ? (
                <>
                  <p>Entrada {formatCount(metrics.data.inputTokens)}</p>
                  <p>Salida {formatCount(metrics.data.outputTokens)}</p>
                  <p>Caché {formatCount(metrics.data.cachedTokens)}</p>
                  <p>Total {formatCount(metrics.data.totalTokens)}</p>
                </>
              ) : (
                <p>Tokens no disponibles mientras la medición esté incompleta.</p>
              )}
            </Card.Content>
          </Card>
          <Card>
            <Card.Header>
              <Card.Title>Periodo</Card.Title>
            </Card.Header>
            <Card.Content className="grid gap-1">
              <p>Desde {formatWhen(metrics.data.from)}</p>
              <p>Hasta {formatWhen(metrics.data.to)}</p>
            </Card.Content>
          </Card>
          {typeof alertTotal === "number" ? (
            <Card>
              <Card.Header>
                <Card.Title>Alertas</Card.Title>
              </Card.Header>
              <Card.Content>
                <p className="text-3xl font-semibold">{alertTotal === 1 ? "1 alerta registrada" : `${alertTotal} alertas registradas`}</p>
              </Card.Content>
            </Card>
          ) : null}
        </div>
      ) : null}
      {alerts.data?.items.length === 0 ? <p>No hay alertas.</p> : null}
      {alerts.data && alerts.data.items.length > 0 ? (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Alertas">
              <Table.Header>
                <Table.Column isRowHeader id="scope">Ámbito</Table.Column>
                <Table.Column id="amount">Importe USD</Table.Column>
                <Table.Column id="status">Estado</Table.Column>
                <Table.Column id="action">Acción</Table.Column>
              </Table.Header>
              <Table.Body>
                {alerts.data.items.map((alert) => (
                  <Table.Row key={alert.id} id={alert.id}>
                    <Table.Cell>{alert.scope}</Table.Cell>
                    <Table.Cell>{alert.observedValueUsd}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={alert.status === "open" ? "warning" : "success"}>{alertStatusLabel(alert.status)}</Chip>
                    </Table.Cell>
                    <Table.Cell>
                      {alert.status === "open" ? (
                        <OptionsMenu
                          label={`Opciones de ${alert.scope}`}
                          options={[{
                            label: "Reconocer",
                            onPress: () => {
                              void accessRequest(client, `/api/v1/ai/admin/alerts/${alert.id}/acknowledge`, { method: "POST", body: "{}" }).then(async (response) => {
                                if (!response.ok) {
                                  notifyDanger("No se pudo reconocer la alerta.");
                                  return;
                                }
                                notifySuccess("Alerta reconocida.");
                                await client.invalidateQueries({ queryKey: ["ai", "alerts"] });
                              });
                            },
                          }]}
                        />
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : null}
      {alerts.data && typeof alerts.data.page === "number" && typeof alerts.data.totalPages === "number" && alerts.data.totalPages > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Página {alerts.data.page} de {alerts.data.totalPages}</p>
          <Button type="button" variant="tertiary" isDisabled={alerts.data.page <= 1} onPress={() => go(alerts.data.page! - 1)}>Anterior</Button>
          <Button type="button" variant="tertiary" isDisabled={alerts.data.page >= alerts.data.totalPages} onPress={() => go(alerts.data.page! + 1)}>Siguiente</Button>
        </div>
      ) : null}
    </section>
  );
}
