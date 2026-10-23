import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  Skeleton,
  Spinner,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { accessRequest } from "../access/http";
import { classifyConfirm, formatMexico, formatMxn } from "../accounts/money";
import { notifyDanger, notifyInfo, notifySuccess, notifyWarning } from "../shell/notify";

const schema = z.object({
  sourceAccountId: z.string().uuid("Elige una cuenta de origen"),
  destinationAccountNumber: z.string().regex(/^[0-9]{10,18}$/, "La cuenta tiene entre 10 y 18 dígitos").optional().or(z.literal("")),
  beneficiaryId: z.string().uuid().optional().or(z.literal("")),
  amount: z.string().regex(/^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/, "Usa un importe con dos decimales"),
  concept: z.string().trim().min(1, "Escribe un concepto").max(140),
}).refine((value) => (value.beneficiaryId !== "" && value.beneficiaryId !== undefined) !== (value.destinationAccountNumber !== "" && value.destinationAccountNumber !== undefined), {
  path: ["destinationAccountNumber"],
  message: "Indica un beneficiario o una cuenta ocasional",
});

type TransferInput = z.infer<typeof schema>;

interface AccountItem {
  id: string;
  name: string;
  balance: string;
}

interface Proposal {
  id: string;
  status: string;
  amount: string;
  concept: string;
  destinationLabel?: string;
  expiresAt: string;
  sourceAccountId?: string;
}

interface TransferResult {
  id: string;
  reference: string;
  status: string;
  amount: string;
  concept?: string;
  completedAt?: string;
}

interface ResolvedRecipient {
  destinationAccountId: string;
  accountNumberMasked: string;
  holderLabel: string;
}

const prepareSteps = [
  { id: 1, title: "Origen", hint: "Cuenta a debitar" },
  { id: 2, title: "Destino", hint: "Beneficiario o cuenta" },
  { id: 3, title: "Validación", hint: "Titular confirmado" },
  { id: 4, title: "Importe", hint: "Monto y concepto" },
] as const;

function TransferPageIntro(props: { title: string; lead: string; backTo?: string; backLabel?: string }) {
  return (
    <header className="transfer-intro">
      <div className="grid gap-1">
        <p className="home-kicker">Transferencias</p>
        <h1 className="home-title">{props.title}</h1>
        <p className="home-lead">{props.lead}</p>
      </div>
      {props.backTo ? (
        <Link to={props.backTo} className="home-inline-link transfer-back-link">
          {props.backLabel ?? "Volver"}
        </Link>
      ) : null}
    </header>
  );
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

function DetailRow(props: { label: string; value: ReactNode; emphasize?: boolean }) {
  return (
    <div className={`transfer-detail-row${props.emphasize ? " transfer-detail-row--emphasis" : ""}`}>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

export function TransferPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { proposalId = "" } = useParams();
  const reviewing = proposalId !== "";
  const idempotencyKey = useRef(globalThis.crypto.randomUUID());
  const [phase, setPhase] = useState<"review" | "sending" | "completed" | "uncertain" | "failed">("review");
  const [result, setResult] = useState<TransferResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<ResolvedRecipient | null>(null);
  const form = useForm<TransferInput>({
    resolver: zodResolver(schema),
    defaultValues: { sourceAccountId: "", destinationAccountNumber: "", beneficiaryId: "", amount: "", concept: "" },
  });
  const beneficiaryId = form.watch("beneficiaryId");
  const accountNumber = form.watch("destinationAccountNumber");
  const sourceAccountId = form.watch("sourceAccountId");
  const accounts = useQuery({
    queryKey: ["accounts", "list", "transfer"],
    enabled: !reviewing,
    retry: false,
    queryFn: async (): Promise<AccountItem[]> => {
      const response = await accessRequest(client, "/api/v1/accounts/accounts?page=1&pageSize=20");
      if (!response.ok) {
        throw new Error("accounts_failed");
      }
      const body = (await response.json()) as { items: AccountItem[] };
      return body.items;
    },
  });
  const beneficiaries = useQuery({
    queryKey: ["accounts", "beneficiaries", "transfer"],
    enabled: !reviewing,
    retry: false,
    queryFn: async () => {
      const response = await accessRequest(client, "/api/v1/accounts/beneficiaries?limit=20");
      if (!response.ok) {
        return [] as Array<{ id: string; alias: string }>;
      }
      const body = (await response.json()) as { items?: Array<{ id: string; alias: string }> };
      return body.items ?? [];
    },
  });
  const proposal = useQuery({
    queryKey: ["accounts", "proposal", proposalId],
    enabled: reviewing,
    retry: false,
    queryFn: async (): Promise<Proposal> => {
      const response = await accessRequest(client, `/api/v1/accounts/transfer-proposals/${proposalId}`);
      if (!response.ok) {
        throw new Error("proposal_failed");
      }
      return (await response.json()) as Proposal;
    },
  });

  const selectedSource = accounts.data?.find((item) => item.id === sourceAccountId);

  async function resolveRecipient(account: string): Promise<ResolvedRecipient | null> {
    const response = await accessRequest(client, "/api/v1/accounts/recipients/resolve", {
      method: "POST",
      body: JSON.stringify({ destinationAccountNumber: account }),
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Partial<ResolvedRecipient>;
    if (!body.destinationAccountId || !body.accountNumberMasked || !body.holderLabel) {
      return null;
    }
    return {
      destinationAccountId: body.destinationAccountId,
      accountNumberMasked: body.accountNumberMasked,
      holderLabel: body.holderLabel,
    };
  }

  async function confirm(key: string) {
    setPhase("sending");
    setMessage(null);
    try {
      const response = await accessRequest(client, `/api/v1/accounts/transfer-proposals/${proposalId}/confirm`, {
        method: "POST",
        body: "{}",
        headers: { "Idempotency-Key": key },
        signal: AbortSignal.timeout(20000),
      });
      const body = response.status === 200 ? (await response.json()) as TransferResult : null;
      const outcome = classifyConfirm(response.status, body);
      if (outcome === "completed" && body) {
        setResult(body);
        setPhase("completed");
        notifySuccess("Transferencia confirmada.");
        await client.invalidateQueries({ queryKey: ["accounts", "summary"] });
        await client.invalidateQueries({ queryKey: ["accounts", "list"] });
        return;
      }
      if (outcome === "uncertain") {
        setPhase("uncertain");
        notifyWarning("No se conoce el resultado. El saldo no se actualizó. Comprueba la operación antes de intentar otra.");
        return;
      }
      setPhase("failed");
      setMessage("La transferencia no se confirmó. El saldo no se modificó en pantalla.");
      notifyDanger("La transferencia no se confirmó. El saldo no se modificó en pantalla.");
    } catch {
      setPhase("uncertain");
      notifyWarning("No se conoce el resultado. El saldo no se actualizó. Comprueba la operación antes de intentar otra.");
    }
  }

  async function recover() {
    setMessage(null);
    const listed = await accessRequest(client, "/api/v1/accounts/transfers?page=1&pageSize=20");
    if (listed.ok) {
      const page = (await listed.json()) as { items: Array<TransferResult & { proposalId?: string }> };
      const found = page.items.find((item) => item.proposalId === proposalId && item.status === "completed");
      if (found) {
        setResult(found);
        setPhase("completed");
        notifySuccess("Transferencia confirmada.");
        await client.invalidateQueries({ queryKey: ["accounts", "summary"] });
        return;
      }
    }
    const current = await accessRequest(client, `/api/v1/accounts/transfer-proposals/${proposalId}`);
    if (current.ok) {
      const body = (await current.json()) as Proposal;
      if (body.status === "pending") {
        await confirm(idempotencyKey.current);
        return;
      }
    }
    const pending = "Todavía no hay un resultado confirmado. No se creó otra operación.";
    setMessage(pending);
    notifyWarning(pending);
  }

  if (!reviewing) {
    return (
      <section className="transfer-page">
        <TransferPageIntro
          title="Transferir"
          lead="Envía dinero entre cuentas internas en MXN. Revisa los datos antes de confirmar; el débito ocurre solo en el paso final."
        />

        <ol className="transfer-steps" aria-label="Pasos para preparar la transferencia">
          {prepareSteps.map((step) => (
            <li key={step.id} className="transfer-step">
              <span className="transfer-step-index" aria-hidden="true">
                {step.id}
              </span>
              <span className="transfer-step-copy">
                <span className="transfer-step-title">{step.title}</span>
                <span className="transfer-step-hint">{step.hint}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="transfer-layout">
          <form
            className="transfer-form grid gap-4"
            noValidate
            onSubmit={form.handleSubmit(async (values) => {
              setMessage(null);
              if (!values.beneficiaryId && values.destinationAccountNumber) {
                const resolved = await resolveRecipient(values.destinationAccountNumber);
                if (!resolved) {
                  setRecipient(null);
                  notifyDanger("No se pudo validar el destinatario. No se preparó la transferencia.");
                  return;
                }
                setRecipient(resolved);
              }
              const payload = {
                sourceAccountId: values.sourceAccountId,
                amount: values.amount,
                currency: "MXN",
                concept: values.concept,
                ...(values.beneficiaryId ? { beneficiaryId: values.beneficiaryId } : { destinationAccountNumber: values.destinationAccountNumber }),
              };
              const response = await accessRequest(client, "/api/v1/accounts/transfer-proposals", { method: "POST", body: JSON.stringify(payload) });
              if (!response.ok) {
                notifyDanger("No se pudo preparar la transferencia.");
                return;
              }
              const created = (await response.json()) as Proposal;
              notifyInfo("Transferencia lista para confirmar.");
              await navigate(`/transferencias/propuestas/${created.id}`);
            }, () => notifyWarning("Revisa los datos antes de preparar la transferencia."))}
          >
            <Card>
              <Card.Header>
                <Card.Title>Cuenta de origen</Card.Title>
                <Card.Description>El saldo se consulta al momento de preparar la operación.</Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-3">
                {accounts.isLoading ? (
                  <div className="grid gap-2">
                    <Skeleton className="h-11 w-full rounded-xl" />
                    <p className="text-sm text-[var(--muted)]">Cargando cuentas…</p>
                  </div>
                ) : null}
                {accounts.isError ? <p role="alert">No se pudieron cargar las cuentas de origen.</p> : null}
                {!accounts.isLoading && !accounts.isError ? (
                  <>
                    <label className="transfer-native-field" htmlFor="sourceAccountId">
                      <span className="transfer-native-label">Cuenta origen</span>
                      <select id="sourceAccountId" className="transfer-native-select" {...form.register("sourceAccountId")}>
                        <option value="">Elige una cuenta</option>
                        {accounts.data?.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {formatMxn(item.balance)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <FieldAlert message={form.formState.errors.sourceAccountId?.message} />
                    {selectedSource ? (
                      <div className="transfer-inline-balance">
                        <span>Saldo disponible</span>
                        <strong>{formatMxn(selectedSource.balance)}</strong>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </Card.Content>
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>Destinatario</Card.Title>
                <Card.Description>Usa un beneficiario guardado o captura una cuenta interna ocasional, no ambos.</Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-4">
                <label className="transfer-native-field" htmlFor="beneficiaryId">
                  <span className="transfer-native-label">Beneficiario guardado</span>
                  <select id="beneficiaryId" className="transfer-native-select" {...form.register("beneficiaryId")}>
                    <option value="">Sin beneficiario guardado</option>
                    {beneficiaries.data?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.alias}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="transfer-or-divider" aria-hidden="true">
                  <span>o cuenta ocasional</span>
                </div>
                <TextField fullWidth>
                  <Label htmlFor="destinationAccountNumber">Cuenta ocasional</Label>
                  <Input
                    id="destinationAccountNumber"
                    inputMode="numeric"
                    autoComplete="off"
                    {...form.register("destinationAccountNumber", { onChange: () => setRecipient(null) })}
                  />
                  <Description>Entre 10 y 18 dígitos. Valida el titular antes de continuar.</Description>
                </TextField>
                <FieldAlert message={form.formState.errors.destinationAccountNumber?.message} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onPress={() => {
                      const current = form.getValues("destinationAccountNumber") ?? "";
                      if (!/^[0-9]{10,18}$/.test(current)) {
                        notifyWarning("Escribe la cuenta interna antes de validar.");
                        return;
                      }
                      void resolveRecipient(current).then((resolved) => {
                        setRecipient(resolved);
                        if (resolved) {
                          notifySuccess("Destinatario validado.");
                          return;
                        }
                        notifyDanger("No se pudo validar el destinatario.");
                      });
                    }}
                  >
                    Validar destinatario
                  </Button>
                  <Link to="/beneficiarios" className="home-inline-link">
                    Administrar beneficiarios
                  </Link>
                </div>
                {recipient ? (
                  <Card className="transfer-recipient-card">
                    <Card.Content className="flex flex-wrap items-center justify-between gap-3">
                      <div className="grid gap-0.5">
                        <p className="transfer-recipient-name">{recipient.holderLabel}</p>
                        <p className="text-sm text-[var(--muted)]">Cuenta {recipient.accountNumberMasked}</p>
                      </div>
                      <Chip size="sm" color="success">
                        Validado
                      </Chip>
                    </Card.Content>
                  </Card>
                ) : null}
                {recipient ? (
                  <p role="status" className="sr-only">
                    Destinatario {recipient.holderLabel}. Cuenta {recipient.accountNumberMasked}.
                  </p>
                ) : null}
                {beneficiaryId && !accountNumber ? (
                  <p role="status" className="transfer-status-note">
                    Beneficiario guardado seleccionado. El titular se confirma al preparar la transferencia.
                  </p>
                ) : null}
              </Card.Content>
            </Card>

            <Card className="transfer-amount-card">
              <Card.Header>
                <Card.Title>Importe y concepto</Card.Title>
                <Card.Description>Captura el monto con dos decimales y un concepto visible en el comprobante.</Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-4">
                <TextField fullWidth>
                  <Label htmlFor="amount">Importe MXN</Label>
                  <Input id="amount" inputMode="decimal" placeholder="0.00" {...form.register("amount")} />
                </TextField>
                <FieldAlert message={form.formState.errors.amount?.message} />
                <TextField fullWidth>
                  <Label htmlFor="concept">Concepto</Label>
                  <Input id="concept" maxLength={140} placeholder="Ej. Renta, nómina, pago a proveedor" {...form.register("concept")} />
                </TextField>
                <FieldAlert message={form.formState.errors.concept?.message} />
              </Card.Content>
              <Card.Footer className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="transfer-security-note">No se debitará tu cuenta hasta que confirmes en la pantalla siguiente.</p>
                <Button type="submit" className="transfer-primary-action">
                  Revisar transferencia
                </Button>
              </Card.Footer>
            </Card>
          </form>

          <aside className="transfer-aside" aria-label="Información de la operación">
            <Card>
              <Card.Header>
                <Card.Title>Antes de confirmar</Card.Title>
              </Card.Header>
              <Card.Content className="grid gap-3 text-sm text-[var(--muted)]">
                <p>Las transferencias internas en MXN quedan sujetas a tus límites configurados.</p>
                <Link to="/perfil" className="home-inline-link">
                  Revisar límites en tu perfil
                </Link>
              </Card.Content>
            </Card>
          </aside>
        </div>
      </section>
    );
  }

  const blocked = proposal.data?.status !== "pending";
  const proposalPending = proposal.data?.status === "pending";

  return (
    <section className="transfer-page transfer-page--confirm">
      <TransferPageIntro
        title="Confirmar transferencia"
        lead="Verifica destinatario, importe y concepto. Esta acción debitará tu cuenta de origen."
        backTo="/transferencias"
        backLabel="Preparar otra"
      />

      {proposal.isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <p>Cargando la propuesta…</p>
        </div>
      ) : null}
      {proposal.isError ? <p role="alert">La propuesta no está disponible.</p> : null}

      {proposal.data ? (
        <div className="transfer-confirm-layout">
          <Card className="transfer-confirm-summary">
            <Card.Header>
              <Card.Title>Resumen de la operación</Card.Title>
              <Card.Description>
                Vence {formatMexico(proposal.data.expiresAt)}
              </Card.Description>
            </Card.Header>
            <Card.Content className="grid gap-4">
              <p className="transfer-confirm-amount">
                Importe {formatMxn(proposal.data.amount)}
              </p>
              <dl className="transfer-detail-list">
                <DetailRow label="Destinatario" value={`Destinatario validado ${proposal.data.destinationLabel ?? "—"}`} />
                <DetailRow label="Concepto" value={proposal.data.concept} />
                <DetailRow
                  label="Estado"
                  value={
                    <Chip size="sm" color={proposalPending ? "warning" : "default"}>
                      {proposal.data.status}
                    </Chip>
                  }
                />
              </dl>
            </Card.Content>
            {phase === "review" ? (
              <Card.Footer>
                <Button
                  type="button"
                  className="transfer-primary-action w-full sm:w-auto"
                  isDisabled={blocked}
                  onPress={() => {
                    void confirm(idempotencyKey.current);
                  }}
                >
                  Confirmar transferencia
                </Button>
              </Card.Footer>
            ) : null}
          </Card>

          <div className="transfer-confirm-side grid gap-4">
            {phase === "sending" ? (
              <Card>
                <Card.Content className="flex items-center gap-3">
                  <Spinner size="sm" />
                  <p role="status">Confirmando…</p>
                </Card.Content>
              </Card>
            ) : null}

            {phase === "completed" && result ? (
              <Card className="home-balance-card transfer-receipt-card">
                <Card.Header>
                  <Card.Title className="transfer-receipt-heading">Comprobante</Card.Title>
                  <Card.Description>Operación confirmada en Cuentas.</Card.Description>
                </Card.Header>
                <Card.Content className="grid gap-2">
                  <dl className="transfer-detail-list transfer-detail-list--receipt">
                    <DetailRow label="Referencia" value={result.reference} />
                    <DetailRow label="Importe" value={formatMxn(result.amount)} emphasize />
                    {result.concept ? <DetailRow label="Concepto" value={result.concept} /> : null}
                    {result.completedAt ? <DetailRow label="Completada" value={formatMexico(result.completedAt)} /> : null}
                    <DetailRow label="Estado" value="Estado confirmado" />
                  </dl>
                </Card.Content>
              </Card>
            ) : null}

            {phase === "uncertain" ? (
              <Card className="transfer-alert-card">
                <Card.Content className="grid gap-3">
                  <p role="status">No se conoce el resultado. El saldo no se actualizó. Comprueba la operación antes de intentar otra.</p>
                  <Button type="button" variant="secondary" onPress={() => { void recover(); }}>
                    Comprobar estado
                  </Button>
                </Card.Content>
              </Card>
            ) : null}

            {phase === "failed" && message ? (
              <Card className="transfer-alert-card">
                <Card.Content>
                  <p role="alert">{message}</p>
                </Card.Content>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
