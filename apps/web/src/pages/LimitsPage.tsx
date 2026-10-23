import { Button, Card } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { accessRequest } from "../access/http";
import { formatMxn } from "../accounts/money";
import { notifyDanger, notifySuccess, notifyWarning } from "../shell/notify";

const money = z.string().regex(/^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/, "Usa un importe con dos decimales");
const schema = z.object({ perTransferLimit: money, dailyLimit: money });
type LimitsInput = z.infer<typeof schema>;

interface Limits {
  perTransferLimit: string;
  dailyLimit: string;
  perTransferMax?: string;
  dailyMax?: string;
}

export function LimitsPage(props: { embedded?: boolean } = {}) {
  const client = useQueryClient();
  const form = useForm<LimitsInput>({ resolver: zodResolver(schema), defaultValues: { perTransferLimit: "", dailyLimit: "" } });
  const limits = useQuery({
    queryKey: ["accounts", "limits"],
    retry: false,
    queryFn: async (): Promise<Limits> => {
      const response = await accessRequest(client, "/api/v1/accounts/me/transfer-limits");
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("limits_failed");
      }
      const body = (await response.json()) as Limits;
      form.reset({ perTransferLimit: body.perTransferLimit, dailyLimit: body.dailyLimit });
      return body;
    },
  });
  const forbidden = limits.error instanceof Error && limits.error.message === "forbidden";
  const perMaximum = limits.data?.perTransferMax ?? limits.data?.perTransferLimit;
  const dailyMaximum = limits.data?.dailyMax ?? limits.data?.dailyLimit;
  const formBody = (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        const response = await accessRequest(client, "/api/v1/accounts/me/transfer-limits", { method: "PATCH", body: JSON.stringify(values) });
        if (response.status === 422) {
          notifyWarning("Esos límites quedan fuera del máximo o requieren una verificación reciente.");
          return;
        }
        if (!response.ok) {
          notifyDanger("No se pudieron actualizar los límites.");
          return;
        }
        await client.invalidateQueries({ queryKey: ["accounts", "limits"] });
        notifySuccess("Límites actualizados.");
      }, (errors) => notifyWarning(errors.perTransferLimit?.message ?? errors.dailyLimit?.message ?? "Revisa los importes antes de guardar."))}
    >
      <label className="grid gap-1" htmlFor="perTransferLimit">
        Por transferencia
        <input id="perTransferLimit" inputMode="decimal" className="rounded-xl border px-3 py-2" {...form.register("perTransferLimit")} />
      </label>
      <label className="grid gap-1" htmlFor="dailyLimit">
        Diario
        <input id="dailyLimit" inputMode="decimal" className="rounded-xl border px-3 py-2" {...form.register("dailyLimit")} />
      </label>
      <Button type="submit">Guardar límites</Button>
    </form>
  );
  const card = (
      <Card>
        <Card.Header>
          <Card.Title>Transferencias</Card.Title>
          <Card.Description>Estos topes se guardan en Cuentas y aplican a tus transferencias en MXN.</Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-3">
          {limits.isLoading ? <p>Cargando límites…</p> : null}
          {forbidden ? <p role="alert">No tienes permiso para ver los límites.</p> : null}
          {limits.isError && !forbidden ? <p role="alert">No se pudieron consultar los límites.</p> : null}
          {perMaximum && dailyMaximum ? <p>Máximo por transferencia {formatMxn(perMaximum)}. Máximo diario {formatMxn(dailyMaximum)}.</p> : null}
          {formBody}
        </Card.Content>
      </Card>
  );
  if (props.embedded) {
    return card;
  }
  return (
    <section className="grid max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold">Límites</h1>
      {card}
    </section>
  );
}
