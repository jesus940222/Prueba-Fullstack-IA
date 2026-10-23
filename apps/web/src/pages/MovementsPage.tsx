import { Button } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { accessRequest, parsePositive } from "../access/http";
import { formatMexico, formatMxn, maskAccount } from "../accounts/money";
import { OptionsMenu } from "../shell/options-menu";

const directions = new Set(["in", "out"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Movement {
  id: string;
  direction: "in" | "out" | string;
  amount: string;
  recordedAt: string;
  balanceAfter?: string;
  transferId?: string;
}

interface MovementPage {
  items: Movement[];
  totalItems: number;
  page?: number;
  totalPages?: number;
}

interface TransferDetail {
  id: string;
  reference?: string;
  concept?: string;
  amount: string;
  status?: string;
  destinationLabel?: string;
  completedAt?: string | null;
}

export function MovementsPage() {
  const client = useQueryClient();
  const { accountId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const pageSize = parsePositive(params.get("pageSize"), 20, 100);
  const direction = params.get("direction");
  const movementId = params.get("movement");
  const directionValid = direction === null || direction === "" || directions.has(direction);
  const idValid = UUID.test(accountId);
  const movementValid = movementId === null || movementId === "" || UUID.test(movementId);
  const valid = page !== null && pageSize !== null && directionValid && idValid && movementValid;
  const account = useQuery({
    queryKey: ["accounts", "one", accountId],
    enabled: idValid,
    retry: false,
    queryFn: async () => {
      const response = await accessRequest(client, `/api/v1/accounts/accounts/${accountId}`);
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { name?: string; accountNumber?: string; currency?: string; balance?: string; status?: string };
      return body.name && body.balance ? body : null;
    },
  });
  const movements = useQuery({
    queryKey: ["accounts", "movements", accountId, page, pageSize, direction],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<MovementPage> => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (direction === "in" || direction === "out") {
        query.set("direction", direction);
      }
      const response = await accessRequest(client, `/api/v1/accounts/accounts/${accountId}/movements?${query.toString()}`);
      if (response.status === 404) {
        throw new Error("hidden");
      }
      if (!response.ok) {
        throw new Error("movements_failed");
      }
      return (await response.json()) as MovementPage;
    },
  });
  const selected = movements.data?.items.find((item) => item.id === movementId) ?? null;
  const transfer = useQuery({
    queryKey: ["accounts", "transfer", selected?.transferId],
    enabled: valid && Boolean(selected?.transferId),
    retry: false,
    queryFn: async (): Promise<TransferDetail | null> => {
      const response = await accessRequest(client, `/api/v1/accounts/transfers/${selected?.transferId}`);
      if (!response.ok) {
        throw new Error("transfer_failed");
      }
      return (await response.json()) as TransferDetail;
    },
  });

  function setFilter(next: string | null) {
    const copy = new URLSearchParams(params);
    copy.set("page", "1");
    if (next) {
      copy.set("direction", next);
    } else {
      copy.delete("direction");
    }
    setParams(copy);
  }

  function openMovement(id: string) {
    const copy = new URLSearchParams(params);
    copy.set("movement", id);
    setParams(copy);
  }

  function go(next: number) {
    const copy = new URLSearchParams(params);
    copy.set("page", String(next));
    setParams(copy);
  }

  return (
    <section className="grid gap-4">
      <Link to={idValid ? `/cuentas/${accountId}` : "/cuentas"}>Volver a la cuenta</Link>
      <h1 className="text-2xl font-semibold">Movimientos</h1>
      {account.data ? (
        <p>
          {account.data.name}
          {account.data.accountNumber ? ` · ${maskAccount(account.data.accountNumber)}` : ""}
          {account.data.currency ? ` · ${account.data.currency}` : ""}
          {" · "}Saldo de la cuenta {formatMxn(account.data.balance ?? "")}
        </p>
      ) : null}
      {!valid ? <p role="alert">La dirección no es válida. No se consultó el historial.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={direction ? "tertiary" : "primary"} onPress={() => setFilter(null)}>Todos</Button>
        <Button type="button" variant={direction === "in" ? "primary" : "tertiary"} onPress={() => setFilter("in")}>Solo entradas</Button>
        <Button type="button" variant={direction === "out" ? "primary" : "tertiary"} onPress={() => setFilter("out")}>Solo salidas</Button>
      </div>
      {movements.isLoading ? <p>Cargando movimientos…</p> : null}
      {movements.error instanceof Error && movements.error.message === "hidden" ? <p role="alert">La cuenta no está disponible.</p> : null}
      {movements.isError && !(movements.error instanceof Error && movements.error.message === "hidden") ? <p role="alert">No se pudo consultar el historial.</p> : null}
      {movements.data?.items.length === 0 ? <p>No hay movimientos con ese filtro.</p> : null}
      <ul className="grid gap-2">
        {movements.data?.items.map((item, index) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <div className="grid gap-1">
              <p>{item.direction === "in" ? "Entrada" : item.direction === "out" ? "Salida" : item.direction} {formatMxn(item.amount)}</p>
              <p className="text-sm">{formatMexico(item.recordedAt)}</p>
              {item.balanceAfter ? <p className="text-sm">Saldo posterior {formatMxn(item.balanceAfter)}</p> : null}
            </div>
            <OptionsMenu
              label={`Opciones del movimiento ${index + 1}`}
              options={[{ label: "Detalle de la operación", onPress: () => openMovement(item.id) }]}
            />
          </li>
        ))}
      </ul>
      {selected ? (
        <article className="grid gap-2 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">Detalle de la operación</h2>
          <p>{selected.direction === "in" ? "Entrada" : selected.direction === "out" ? "Salida" : selected.direction} {formatMxn(selected.amount)}</p>
          <p>{formatMexico(selected.recordedAt)}</p>
          {selected.balanceAfter ? <p>Saldo posterior {formatMxn(selected.balanceAfter)}</p> : <p>El servicio no envió saldo posterior.</p>}
          {selected.transferId ? null : <p>Este movimiento no trae concepto. No es una transferencia identificada.</p>}
          {transfer.isLoading ? <p>Cargando la transferencia…</p> : null}
          {transfer.isError ? <p role="alert">No se pudo consultar el detalle de la transferencia.</p> : null}
          {transfer.data?.concept ? <p>Concepto {transfer.data.concept}</p> : null}
          {transfer.data?.reference ? <p>Referencia {transfer.data.reference}</p> : null}
          {transfer.data?.destinationLabel ? <p>Destino {transfer.data.destinationLabel}</p> : null}
          {transfer.data?.completedAt ? <p>Completada {formatMexico(transfer.data.completedAt)}</p> : null}
        </article>
      ) : null}
      {movements.data ? (
        <div className="flex flex-wrap items-center gap-3">
          {movements.data.page && movements.data.totalPages ? (
            <>
              <p>Página {movements.data.page} de {movements.data.totalPages}</p>
              <Button type="button" variant="tertiary" isDisabled={movements.data.page <= 1} onPress={() => go(movements.data.page! - 1)}>Anterior</Button>
              <Button type="button" variant="tertiary" isDisabled={movements.data.page >= movements.data.totalPages} onPress={() => go((movements.data.page ?? 1) + 1)}>Siguiente</Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
