import { Button, Card } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { accessRequest, parsePositive } from "../access/http";
import { notifyDanger, notifySuccess } from "../shell/notify";
import { OptionsMenu } from "../shell/options-menu";

interface SessionPage {
  items: Array<{ id: string; authenticationMethod?: string; revoked: boolean }>;
  totalItems: number;
  page: number;
  pageSize: number;
}

export function SessionsPanel() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const pageSize = parsePositive(params.get("pageSize"), 20, 100);
  const valid = page !== null && pageSize !== null;
  const sessions = useQuery({
    queryKey: ["sessions", page, pageSize],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<SessionPage> => {
      if (page === null || pageSize === null) {
        throw new Error("sessions_failed");
      }
      const response = await accessRequest(client, `/api/v1/access/me/sessions?page=${page}&pageSize=${pageSize}`);
      if (response.status === 401) {
        throw new Error("unauthenticated");
      }
      if (!response.ok) {
        throw new Error("sessions_failed");
      }
      const body = (await response.json()) as Partial<SessionPage>;
      return {
        items: Array.isArray(body.items) ? body.items : [],
        totalItems: body.totalItems ?? 0,
        page: body.page ?? page,
        pageSize: body.pageSize ?? pageSize,
      };
    },
  });

  return (
    <Card>
      <Card.Header>
        <Card.Title>Sesiones</Card.Title>
        <Card.Description>Accesos abiertos de tu cuenta. Revocar uno deja sin efecto ese inicio de sesión.</Card.Description>
      </Card.Header>
      <Card.Content className="grid gap-3">
        {!valid ? <p role="alert">La página indicada en la dirección no es válida.</p> : null}
        {sessions.isError ? <p role="alert">No se pudieron consultar las sesiones.</p> : null}
        {sessions.data && sessions.data.items.length === 0 ? <p>No hay sesiones en esta página.</p> : null}
        <ul className="grid gap-2">
          {sessions.data?.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
              <span>{item.authenticationMethod ?? "sesión"}{item.revoked ? " revocada" : ""}</span>
              <OptionsMenu
                label={`Opciones de ${item.authenticationMethod ?? "sesión"}`}
                options={[{
                  label: "Revocar",
                  danger: true,
                  disabled: item.revoked,
                  onPress: () => {
                    void accessRequest(client, `/api/v1/access/me/sessions/${item.id}`, { method: "DELETE" }).then(async (response) => {
                      if (!response.ok) {
                        notifyDanger("No se pudo revocar la sesión.");
                        return;
                      }
                      notifySuccess("Sesión revocada.");
                      await client.invalidateQueries({ queryKey: ["sessions"] });
                    });
                  },
                }]}
              />
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          onPress={async () => {
            const response = await accessRequest(client, "/api/v1/access/auth/logout", { method: "POST" });
            if (!response.ok) {
              notifyDanger("No se pudo cerrar la sesión.");
              return;
            }
            notifySuccess("Sesión cerrada.");
            client.clear();
            client.setQueryData(["session"], "out");
            await navigate("/login");
          }}
        >
          Cerrar sesión
        </Button>
      </Card.Content>
    </Card>
  );
}

export function SessionsPage() {
  return (
    <section className="grid max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold">Sesiones</h1>
      <SessionsPanel />
    </section>
  );
}
