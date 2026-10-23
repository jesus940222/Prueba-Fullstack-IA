import { Card, Chip } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { accessRequest } from "../access/http";
import { accountStatusLabel, formatMexico, formatMxn, maskAccount } from "../accounts/money";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Account {
  id: string;
  name: string;
  accountNumber: string;
  currency?: string;
  balance: string;
  status: string;
}

interface Movement {
  id: string;
  direction: string;
  amount: string;
  recordedAt: string;
  balanceAfter?: string;
}

export function AccountDetailPage() {
  const client = useQueryClient();
  const { accountId = "" } = useParams();
  const valid = UUID.test(accountId);
  const account = useQuery({
    queryKey: ["accounts", "one", accountId],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<Account> => {
      const response = await accessRequest(client, `/api/v1/accounts/accounts/${accountId}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (response.status === 404) {
        throw new Error("hidden");
      }
      if (!response.ok) {
        throw new Error("account_failed");
      }
      return (await response.json()) as Account;
    },
  });
  const movements = useQuery({
    queryKey: ["accounts", "movements", accountId, "preview"],
    enabled: valid && account.isSuccess,
    retry: false,
    queryFn: async (): Promise<Movement[]> => {
      const response = await accessRequest(client, `/api/v1/accounts/accounts/${accountId}/movements?page=1&pageSize=5`);
      if (!response.ok) {
        throw new Error("movements_failed");
      }
      const body = (await response.json()) as { items?: Movement[] };
      return body.items ?? [];
    },
  });
  const forbidden = account.error instanceof Error && account.error.message === "forbidden";
  const hidden = account.error instanceof Error && account.error.message === "hidden";

  return (
    <section className="grid gap-4">
      <Link to="/cuentas">Volver a cuentas</Link>
      <h1 className="text-2xl font-semibold">Detalle de cuenta</h1>
      {!valid ? <p role="alert">La dirección no es válida. No se consultó la cuenta.</p> : null}
      {account.isLoading ? <p>Cargando la cuenta…</p> : null}
      {forbidden ? <p role="alert">No tienes permiso para ver cuentas.</p> : null}
      {hidden ? <p role="alert">La cuenta no está disponible.</p> : null}
      {account.isError && !forbidden && !hidden ? <p role="alert">No se pudo consultar la cuenta.</p> : null}
      {account.data ? (
        <Card>
          <Card.Header>
            <Card.Title>{account.data.name}</Card.Title>
            <Card.Description>
              {account.data.accountNumber ? maskAccount(account.data.accountNumber) : "Número no incluido"} · {account.data.currency ?? "MXN"}
            </Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-2">
            <p className="text-2xl font-semibold">Saldo de la cuenta {formatMxn(account.data.balance)}</p>
            <Chip size="sm" color={account.data.status === "active" ? "success" : "default"}>{accountStatusLabel(account.data.status)}</Chip>
          </Card.Content>
          <Card.Footer>
            <Link to={`/cuentas/${accountId}/movimientos?page=1&pageSize=20`}>Ver movimientos</Link>
          </Card.Footer>
        </Card>
      ) : null}
      {movements.data ? (
        <div className="grid gap-2">
          <h2 className="text-lg font-semibold">Últimos movimientos</h2>
          {movements.data.length === 0 ? <p>Esta cuenta no tiene movimientos en la primera página.</p> : null}
          <ul className="grid gap-2">
            {movements.data.map((item) => (
              <li key={item.id} className="rounded-lg border px-3 py-2">
                <p>{item.direction === "in" ? "Entrada" : item.direction === "out" ? "Salida" : item.direction} {formatMxn(item.amount)}</p>
                <p className="text-sm">{formatMexico(item.recordedAt)}</p>
                {item.balanceAfter ? <p className="text-sm">Saldo posterior {formatMxn(item.balanceAfter)}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {movements.isError ? <p role="alert">No se pudo consultar el historial reciente.</p> : null}
    </section>
  );
}
