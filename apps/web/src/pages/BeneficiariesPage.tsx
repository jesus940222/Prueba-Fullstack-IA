import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  Skeleton,
  Spinner,
  Table,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";
import { accessRequest } from "../access/http";
import { maskAccount } from "../accounts/money";
import { notifyDanger, notifySuccess, notifyWarning } from "../shell/notify";
import { OptionsMenu } from "../shell/options-menu";

const schema = z.object({
  destinationAccountId: z.string().trim().min(1, "Indica la cuenta destino"),
  alias: z.string().trim().min(1, "Escribe un alias").max(80),
});

type BeneficiaryInput = z.infer<typeof schema>;

interface Beneficiary {
  id: string;
  alias: string;
  destinationAccountId: string;
}

interface BeneficiaryPage {
  items: Beneficiary[];
  nextCursor: string | null;
  hasMore: boolean;
}

function FieldAlert(props: { message?: string }) {
  if (!props.message) {
    return null;
  }
  return (
    <p className="transfer-field-error" role="alert">
      {props.message}
    </p>
  );
}

function destinationLabel(id: string): string {
  const digits = id.replace(/\s/g, "");
  if (/^[0-9]{10,18}$/.test(digits)) {
    return maskAccount(digits);
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return `Referencia ····${id.slice(-8)}`;
  }
  return id;
}

export function BeneficiariesPage() {
  const client = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<Beneficiary[]>([]);
  const [resolved, setResolved] = useState<{ holderLabel: string; accountNumberMasked: string } | null>(null);
  const form = useForm<BeneficiaryInput>({ resolver: zodResolver(schema), defaultValues: { destinationAccountId: "", alias: "" } });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch((current) => {
        const next = searchInput.trim();
        if (next === current) {
          return current;
        }
        setCursor(undefined);
        setItems([]);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const list = useQuery({
    queryKey: ["accounts", "beneficiaries", search, cursor],
    retry: false,
    queryFn: async (): Promise<BeneficiaryPage> => {
      const params = new URLSearchParams({ limit: "20" });
      if (search !== "") {
        params.set("search", search);
      }
      if (cursor) {
        params.set("cursor", cursor);
      }
      const response = await accessRequest(client, `/api/v1/accounts/beneficiaries?${params.toString()}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("beneficiaries_failed");
      }
      const page = (await response.json()) as BeneficiaryPage;
      setItems((current) => {
        const merged = cursor ? [...current] : [];
        for (const item of page.items) {
          if (!merged.some((existing) => existing.id === item.id)) {
            merged.push(item);
          }
        }
        return merged;
      });
      return page;
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await accessRequest(client, `/api/v1/accounts/beneficiaries/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("delete_failed");
      }
    },
    onSuccess: async () => {
      notifySuccess("Beneficiario eliminado.");
      setCursor(undefined);
      setItems([]);
      await client.invalidateQueries({ queryKey: ["accounts", "beneficiaries"] });
    },
    onError: () => {
      notifyDanger("No se pudo eliminar el beneficiario.");
    },
  });
  const forbidden = list.error instanceof Error && list.error.message === "forbidden";
  const listFailed = list.isError && !forbidden;
  const showEmpty = list.isSuccess && items.length === 0 && !forbidden && !listFailed;

  return (
    <section className="transfer-page">
      <header className="transfer-intro">
        <div className="grid gap-1">
          <p className="home-kicker">Transferencias</p>
          <h1 className="home-title">Beneficiarios</h1>
          <p className="home-lead">
            Guarda cuentas frecuentes con un alias para usarlas al transferir sin volver a capturar el número.
          </p>
        </div>
        <Link to="/transferencias" className="home-inline-link transfer-back-link">
          Ir a transferir
        </Link>
      </header>

      <div className="transfer-layout">
        <Card>
          <Card.Header>
            <Card.Title>Tus beneficiarios</Card.Title>
            <Card.Description>
              {items.length > 0 ? `${items.length} en esta vista` : "Aparecen aquí los que guardes en Cuentas."}
            </Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-4">
            <TextField fullWidth>
              <Label htmlFor="beneficiary-search">Buscar</Label>
              <Input
                id="beneficiary-search"
                value={searchInput}
                autoComplete="off"
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <Description>Filtra por alias; la búsqueda se aplica al dejar de escribir.</Description>
            </TextField>

            {list.isLoading && items.length === 0 ? (
              <div className="grid gap-3" aria-busy="true">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <p className="text-sm text-[var(--muted)]">Cargando beneficiarios…</p>
              </div>
            ) : null}

            {forbidden ? <p role="alert">No tienes permiso para ver beneficiarios.</p> : null}
            {listFailed ? <p role="alert">No se pudieron consultar los beneficiarios.</p> : null}
            {showEmpty ? <p>No hay beneficiarios guardados.</p> : null}

            {items.length > 0 ? (
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="Beneficiarios guardados">
                    <Table.Header>
                      <Table.Column isRowHeader id="alias">
                        Alias
                      </Table.Column>
                      <Table.Column id="destination">Cuenta</Table.Column>
                      <Table.Column id="actions">
                        Acciones
                      </Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {items.map((item) => (
                        <Table.Row key={item.id} id={item.id}>
                          <Table.Cell>
                            <span className="font-medium">{item.alias}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip size="sm" variant="soft">
                              {destinationLabel(item.destinationAccountId)}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            <OptionsMenu
                              label={`Opciones de ${item.alias}`}
                              options={[{
                                label: "Quitar",
                                danger: true,
                                onPress: () => { remove.mutate(item.id); },
                              }]}
                            />
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            ) : null}

            {list.data?.hasMore ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={list.isFetching}
                  onPress={() => {
                    if (list.data?.nextCursor) {
                      setCursor(list.data.nextCursor);
                    }
                  }}
                >
                  {list.isFetching ? (
                    <>
                      <Spinner size="sm" />
                      Cargando…
                    </>
                  ) : (
                    "Cargar más"
                  )}
                </Button>
              </div>
            ) : null}
          </Card.Content>
        </Card>

        <aside className="transfer-aside">
          <Card>
            <Card.Header>
              <Card.Title>Agregar beneficiario</Card.Title>
              <Card.Description>
                Indica el número de cuenta interno o su identificador y un alias fácil de reconocer.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <form
                className="grid gap-4"
                noValidate
                onSubmit={form.handleSubmit(async (values) => {
                  const typed = values.destinationAccountId.trim();
                  let destinationAccountId = typed;
                  if (/^[0-9]{10,18}$/.test(typed)) {
                    const resolvedResponse = await accessRequest(client, "/api/v1/accounts/recipients/resolve", {
                      method: "POST",
                      body: JSON.stringify({ destinationAccountNumber: typed }),
                    });
                    if (!resolvedResponse.ok) {
                      form.setError("destinationAccountId", { message: "No se pudo validar la cuenta destino" });
                      notifyDanger("No se pudo validar la cuenta destino");
                      return;
                    }
                    const body = (await resolvedResponse.json()) as { destinationAccountId?: string; holderLabel?: string; accountNumberMasked?: string };
                    if (!body.destinationAccountId) {
                      form.setError("destinationAccountId", { message: "No se pudo validar la cuenta destino" });
                      notifyDanger("No se pudo validar la cuenta destino");
                      return;
                    }
                    destinationAccountId = body.destinationAccountId;
                    if (body.holderLabel && body.accountNumberMasked) {
                      setResolved({ holderLabel: body.holderLabel, accountNumberMasked: body.accountNumberMasked });
                    }
                  } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(typed)) {
                    form.setError("destinationAccountId", { message: "Usa el número de cuenta o su identificador" });
                    notifyWarning("Usa el número de cuenta o su identificador");
                    return;
                  }
                  const response = await accessRequest(client, "/api/v1/accounts/beneficiaries", {
                    method: "POST",
                    body: JSON.stringify({ destinationAccountId, alias: values.alias }),
                  });
                  if (!response.ok) {
                    form.setError("alias", { message: "No se pudo guardar el beneficiario" });
                    notifyDanger("No se pudo guardar el beneficiario");
                    return;
                  }
                  form.reset();
                  setResolved(null);
                  setCursor(undefined);
                  setItems([]);
                  notifySuccess("Beneficiario guardado.");
                  await client.invalidateQueries({ queryKey: ["accounts", "beneficiaries"] });
                }, () => notifyWarning("Revisa la cuenta y el alias antes de guardar."))}
              >
                <TextField fullWidth>
                  <Label htmlFor="destinationAccountId">Cuenta destino</Label>
                  <Input
                    id="destinationAccountId"
                    autoComplete="off"
                    {...form.register("destinationAccountId", { onChange: () => setResolved(null) })}
                  />
                  <Description>Número de 10 a 18 dígitos o UUID de la cuenta en Cuentas.</Description>
                </TextField>
                {resolved ? (
                  <div className="transfer-recipient-card" role="status">
                    <p className="transfer-recipient-name">{resolved.holderLabel}</p>
                    <p className="text-sm text-[var(--muted)]">Cuenta {resolved.accountNumberMasked}</p>
                  </div>
                ) : null}
                <FieldAlert message={form.formState.errors.destinationAccountId?.message} />

                <TextField fullWidth>
                  <Label htmlFor="alias">Alias</Label>
                  <Input id="alias" autoComplete="off" {...form.register("alias")} />
                  <Description>Nombre corto que verás al elegir destinatario en una transferencia.</Description>
                </TextField>
                <FieldAlert message={form.formState.errors.alias?.message} />

                <Button type="submit" className="transfer-primary-action">
                  Guardar beneficiario
                </Button>
              </form>
            </Card.Content>
          </Card>
        </aside>
      </div>
    </section>
  );
}
