import { Button, Card, Chip } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { accessRequest, parsePositive } from "../access/http";
import { accountStatusLabel, formatMxn, maskAccount } from "../accounts/money";

interface AccountPage {
  items: Array<{ id: string; name: string; accountNumber: string; currency?: string; balance: string; status: string }>;
  totalItems: number;
  page: number;
  totalPages: number;
}

export function AccountsPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const pageSize = parsePositive(params.get("pageSize"), 20, 100);
  const valid = page !== null && pageSize !== null;
  const accounts = useQuery({
    queryKey: ["accounts", "list", page, pageSize],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<AccountPage> => {
      const response = await accessRequest(client, `/api/v1/accounts/accounts?page=${page}&pageSize=${pageSize}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("accounts_failed");
      }
      return (await response.json()) as AccountPage;
    },
  });
  const forbidden = accounts.error instanceof Error && accounts.error.message === "forbidden";

  function go(next: number) {
    const copy = new URLSearchParams(params);
    copy.set("page", String(next));
    setParams(copy);
  }

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">Cuentas</h1>
      {!valid ? <p role="alert">Los filtros de la dirección no son válidos.</p> : null}
      {accounts.isLoading ? <p>Cargando cuentas…</p> : null}
      {forbidden ? <p role="alert">No tienes permiso para ver cuentas.</p> : null}
      {accounts.isError && !forbidden ? <p role="alert">No se pudieron consultar las cuentas.</p> : null}
      {accounts.data && accounts.data.items.length === 0 ? <p>No hay cuentas en esta página.</p> : null}
      <ul className="grid gap-3">
        {accounts.data?.items.map((item) => (
          <li key={item.id}>
            <Card>
              <Card.Header>
                <Card.Title>
                  <Link to={`/cuentas/${item.id}`}>{item.name}</Link>
                </Card.Title>
                <Card.Description>
                  {item.accountNumber ? maskAccount(item.accountNumber) : "Número no incluido"} · {item.currency ?? "MXN"}
                </Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-wrap items-center justify-between gap-3">
                <p>Saldo de la cuenta {formatMxn(item.balance)}</p>
                <Chip size="sm" color={item.status === "active" ? "success" : "default"}>{accountStatusLabel(item.status)}</Chip>
              </Card.Content>
              <Card.Footer>
                <Link to={`/cuentas/${item.id}/movimientos?page=1&pageSize=20`}>Movimientos</Link>
              </Card.Footer>
            </Card>
          </li>
        ))}
      </ul>
      {accounts.data ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="tertiary" isDisabled={accounts.data.page <= 1} onPress={() => go(accounts.data.page - 1)}>Anterior</Button>
          <Button type="button" variant="tertiary" isDisabled={accounts.data.page >= accounts.data.totalPages} onPress={() => go(accounts.data.page + 1)}>Siguiente</Button>
        </div>
      ) : null}
    </section>
  );
}
