import { Card, Chip, Skeleton } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { accessRequest } from "../access/http";
import { accountStatusLabel, formatMexico, formatMxn, maskAccount } from "../accounts/money";

interface Summary {
  totalBalance: string;
  spendTotal?: string;
  recentMovements?: Array<{ id: string; direction: string; amount: string; recordedAt: string; balanceAfter?: string }>;
}

interface AccountItem {
  id: string;
  name: string;
  accountNumber?: string;
  currency?: string;
  balance: string;
  status: string;
}

interface OfferItem {
  id: string;
  title: string;
  code: string;
}

export function HomePage() {
  const client = useQueryClient();
  const permissions = useQuery({
    queryKey: ["permissions"],
    retry: false,
    queryFn: async (): Promise<string[]> => {
      const response = await accessRequest(client, "/api/v1/access/me/permissions");
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as { permissions?: string[] };
      return body.permissions ?? [];
    },
  });
  const granted = permissions.data ?? [];
  const ownAccounts = granted.includes("accounts:read:own");
  const ownTransfers = granted.includes("transfers:create:own");
  const ownBeneficiaries = granted.includes("beneficiaries:read:own");
  const summary = useQuery({
    queryKey: ["accounts", "summary"],
    retry: false,
    queryFn: async (): Promise<Summary | null> => {
      const response = await accessRequest(client, "/api/v1/accounts/summary");
      if (response.status === 401 || response.status === 403) {
        return null;
      }
      if (!response.ok) {
        throw new Error("summary_failed");
      }
      return (await response.json()) as Summary;
    },
  });
  const accounts = useQuery({
    queryKey: ["accounts", "list", "home"],
    retry: false,
    queryFn: async (): Promise<AccountItem[] | null> => {
      const response = await accessRequest(client, "/api/v1/accounts/accounts?page=1&pageSize=20");
      if (response.status === 401 || response.status === 403) {
        return null;
      }
      if (!response.ok) {
        throw new Error("accounts_failed");
      }
      const body = (await response.json()) as { items?: AccountItem[] };
      return body.items ?? [];
    },
  });
  const offers = useQuery({
    queryKey: ["catalog", "offers", "home"],
    retry: false,
    queryFn: async (): Promise<OfferItem[] | null> => {
      const response = await accessRequest(client, "/api/v1/catalog/me/offers?page=1&pageSize=3");
      if (response.status === 401 || response.status === 403) {
        return null;
      }
      if (!response.ok) {
        throw new Error("offers_failed");
      }
      const body = (await response.json()) as { items?: OfferItem[] };
      return body.items ?? [];
    },
  });
  const profile = useQuery({
    queryKey: ["profile"],
    retry: false,
    queryFn: async (): Promise<{ givenName: string } | null> => {
      const response = await accessRequest(client, "/api/v1/access/me");
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { givenName?: string };
      return body.givenName ? { givenName: body.givenName } : null;
    },
  });
  const severalAccounts = (accounts.data?.length ?? 0) > 1;
  const greeting = profile.data?.givenName ? `Hola, ${profile.data.givenName}.` : "Bienvenido a tu banca";

  return (
    <section className="home-page">
      <header className="home-intro">
        <div className="grid gap-1">
          <p className="home-kicker">Inicio</p>
          <h1 className="home-title">{greeting}</h1>
          <p className="home-lead">Consulta tus saldos, opera tus cuentas y accede a transferencias y beneficiarios desde un solo lugar.</p>
        </div>
      </header>

      {ownTransfers || ownBeneficiaries || ownAccounts ? (
        <div className="home-quick-actions" aria-label="Accesos rápidos">
          {ownTransfers ? (
            <Link to="/transferencias" className="home-action-link">
              <Card className="home-action-card">
                <Card.Header>
                  <Card.Title>Transferir</Card.Title>
                  <Card.Description>Envía dinero entre cuentas internas en MXN.</Card.Description>
                </Card.Header>
              </Card>
            </Link>
          ) : null}
          {ownBeneficiaries ? (
            <Link to="/beneficiarios" className="home-action-link">
              <Card className="home-action-card">
                <Card.Header>
                  <Card.Title>Beneficiarios</Card.Title>
                  <Card.Description>Administra destinatarios frecuentes para tus operaciones.</Card.Description>
                </Card.Header>
              </Card>
            </Link>
          ) : null}
          {ownAccounts ? (
            <Link to="/cuentas" className="home-action-link">
              <Card className="home-action-card">
                <Card.Header>
                  <Card.Title>Mis cuentas</Card.Title>
                  <Card.Description>Revisa el detalle y el historial de movimientos.</Card.Description>
                </Card.Header>
              </Card>
            </Link>
          ) : null}
        </div>
      ) : null}

      {summary.isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <p className="text-sm text-[var(--muted)]">Cargando saldo…</p>
        </div>
      ) : null}
      {summary.isError ? <p role="alert">No se pudo consultar el resumen.</p> : null}
      {summary.data ? (
        <Card className="home-balance-card">
          <Card.Header>
            <Card.Title>{severalAccounts ? "Saldo total de tus cuentas" : "Saldo de tu banca"}</Card.Title>
            <Card.Description>Resumen consolidado de tus productos activos.</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-2">
            <div className="home-balance-display">
              <p className="home-balance-label">Saldo disponible</p>
              <p className="home-balance-amount">{formatMxn(summary.data.totalBalance)}</p>
            </div>
            {summary.data.spendTotal !== undefined ? (
              <p className="home-balance-secondary text-sm">Gasto comercial de hoy {formatMxn(summary.data.spendTotal)}</p>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}
      {!summary.isLoading && !summary.data && !summary.isError ? (
        <Card>
          <Card.Content>
            <p>El resumen aparece cuando la sesión tiene cuentas.</p>
          </Card.Content>
        </Card>
      ) : null}

      {accounts.isLoading ? <p className="text-sm text-[var(--muted)]">Cargando cuentas…</p> : null}
      {accounts.isError ? <p role="alert">No se pudieron cargar las cuentas del inicio.</p> : null}
      {accounts.data && accounts.data.length > 0 ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-1">
              <h2 className="text-lg font-semibold">Tus cuentas</h2>
              <p className="text-sm text-[var(--muted)]">Tarjetas con el saldo y acceso rápido al detalle.</p>
            </div>
            {ownAccounts ? (
              <Link to="/cuentas" className="home-inline-link">
                Ver todas
              </Link>
            ) : null}
          </div>
          <ul className="home-account-grid">
            {accounts.data.map((item) => (
              <li key={item.id}>
                <Card className="home-account-card">
                  <Card.Header className="gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Card.Title className="text-base">
                        <Link to={`/cuentas/${item.id}`} className="font-semibold no-underline hover:underline">
                          {item.name}
                        </Link>
                      </Card.Title>
                      <Chip size="sm" color={item.status === "active" ? "success" : "default"}>
                        {accountStatusLabel(item.status)}
                      </Chip>
                    </div>
                    <Card.Description>
                      {item.accountNumber ? maskAccount(item.accountNumber) : "Número no incluido"} · {item.currency ?? "MXN"}
                    </Card.Description>
                  </Card.Header>
                  <Card.Content>
                    <p className="home-account-balance">Saldo de la cuenta {formatMxn(item.balance)}</p>
                  </Card.Content>
                  <Card.Footer className="home-account-actions">
                    <Link to={`/cuentas/${item.id}`} className="home-chip-link">
                      Ver cuenta
                    </Link>
                    <Link to={`/cuentas/${item.id}/movimientos`} className="home-chip-link">
                      Movimientos
                    </Link>
                    {ownTransfers ? (
                      <Link to="/transferencias" className="home-chip-link">
                        Transferir
                      </Link>
                    ) : null}
                  </Card.Footer>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.data?.recentMovements && summary.data.recentMovements.length > 0 ? (
        <Card>
          <Card.Header>
            <Card.Title>Movimientos recientes</Card.Title>
            <Card.Description>Últimas operaciones registradas en tus cuentas.</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-2">
            <ul className="grid gap-2">
              {summary.data.recentMovements.map((movement) => (
                <li key={movement.id} className="home-movement-row">
                  <span>
                    {movement.direction === "in" ? "Entrada" : movement.direction === "out" ? "Salida" : movement.direction}{" "}
                    {formatMxn(movement.amount)}
                  </span>
                  <span className="text-sm text-[var(--muted)]">{formatMexico(movement.recordedAt)}</span>
                </li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      ) : null}

      {offers.data ? (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">Ofertas para ti</h2>
            <p className="text-sm text-[var(--muted)]">Productos elegibles según tu perfil.</p>
          </div>
          {offers.data.length === 0 ? <p>No hay ofertas elegibles ahora.</p> : null}
          <ul className="home-offer-grid">
            {offers.data.map((item) => (
              <li key={item.id}>
                <Card>
                  <Card.Header>
                    <Card.Title className="text-base">{item.title}</Card.Title>
                    <Card.Description>Código {item.code}</Card.Description>
                  </Card.Header>
                </Card>
              </li>
            ))}
          </ul>
          <Link to="/ofertas" className="text-sm font-medium">
            Ver todas las ofertas
          </Link>
        </div>
      ) : null}
      {offers.isError ? <p role="alert">No se pudieron cargar las ofertas del inicio.</p> : null}
    </section>
  );
}
