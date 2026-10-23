import { Button } from "@heroui/react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { accessRequest } from "../access/http";
import { formatMexico, formatMxn } from "../accounts/money";
import { notifyDanger, notifySuccess, notifyWarning } from "../shell/notify";

export const ASSISTANT_OPEN_EVENT = "portal-open-assistant";

async function loadPermissions(client: QueryClient): Promise<string[]> {
  const response = await accessRequest(client, "/api/v1/access/me/permissions");
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as { permissions?: string[] };
  return body.permissions ?? [];
}

export function canSeeRunCosts(granted: readonly string[]): boolean {
  const customer = granted.includes("accounts:read:own") && !granted.includes("ai:metrics:read:any");
  return !customer && granted.includes("ai:metrics:read:own");
}

function visibleMessages(server: Message[], pending: Message[]): Message[] {
  const unmatched = [...pending];
  for (const message of server) {
    if (message.role !== "user") {
      continue;
    }
    const index = unmatched.findIndex((item) => item.content === message.content);
    if (index >= 0) {
      unmatched.splice(index, 1);
    }
  }
  return [...server, ...unmatched];
}

interface Conversation {
  id: string;
  title: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ProposalCard {
  id: string;
  status: string;
  amount: string;
  currency: string;
  concept: string;
  destinationLabel?: string;
  expiresAt: string;
}

interface RunMetrics {
  usageComplete: boolean;
  estimatedCostUsd: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  pricingVersion?: string;
}

export function ChatLanding() {
  return (
    <section className="grid gap-2">
      <h1 className="text-2xl font-semibold">Asistente</h1>
      <p>La conversación está en el panel de la esquina inferior derecha. Al cerrar el globo se borra el chat.</p>
    </section>
  );
}

export function ChatPage() {
  const client = useQueryClient();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [card, setCard] = useState<ProposalCard | null>(null);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [sources, setSources] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Message[]>([]);
  const permissions = useQuery({
    queryKey: ["permissions"],
    retry: false,
    queryFn: () => loadPermissions(client),
  });
  const showCosts = canSeeRunCosts(permissions.data ?? []);
  const requestIds = useRef(new Map<string, string>());
  const conversationRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const sendGen = useRef(0);
  const openRef = useRef(false);
  const busyRef = useRef(false);
  const sessionRef = useRef(0);
  const openedFor = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = useQuery({
    queryKey: ["ai", "messages", conversationId],
    enabled: conversationId !== null,
    retry: false,
    queryFn: async () => {
      const response = await accessRequest(client, `/api/v1/ai/conversations/${conversationId}/messages`);
      if (!response.ok) {
        throw new Error("messages_failed");
      }
      return (await response.json()) as { items: Message[] };
    },
  });
  const expired = card !== null && Date.parse(card.expiresAt) <= Date.now();
  const items = visibleMessages(messages.data?.items ?? [], pending);

  const closePanel = useCallback(async () => {
    sessionRef.current += 1;
    busyRef.current = false;
    openRef.current = false;
    const id = conversationRef.current;
    conversationRef.current = null;
    setOpen(false);
    setConversationId(null);
    setDraft("");
    setNotice(null);
    setCard(null);
    setMetrics(null);
    setSources(null);
    setForbidden(false);
    setBootError(null);
    setOpening(false);
    setSending(false);
    setPending([]);
    sendingRef.current = false;
    sendGen.current += 1;
    requestIds.current.clear();
    if (id) {
      const response = await accessRequest(client, `/api/v1/ai/conversations/${id}`, { method: "DELETE" });
      if (response.ok) {
        notifySuccess("Conversación cerrada.");
      } else {
        notifyDanger("No se pudo cerrar la conversación.");
      }
      client.removeQueries({ queryKey: ["ai", "messages", id] });
    }
  }, [client]);

  const openPanel = useCallback(async () => {
    if (openRef.current || busyRef.current) {
      return;
    }
    busyRef.current = true;
    const session = ++sessionRef.current;
    openRef.current = true;
    setOpen(true);
    setForbidden(false);
    setBootError(null);
    setOpening(true);
    try {
      const response = await accessRequest(client, "/api/v1/ai/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "Nueva conversación" }),
      });
      if (session !== sessionRef.current) {
        if (response.ok) {
          const created = (await response.json()) as Conversation;
          await accessRequest(client, `/api/v1/ai/conversations/${created.id}`, { method: "DELETE" });
        }
        return;
      }
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) {
        setBootError("No se pudo abrir el chat.");
        notifyDanger("No se pudo abrir el chat.");
        return;
      }
      const created = (await response.json()) as Conversation;
      conversationRef.current = created.id;
      setConversationId(created.id);
    } finally {
      if (session === sessionRef.current) {
        busyRef.current = false;
        setOpening(false);
      }
    }
  }, [client]);

  useEffect(() => {
    function onOpen(event: Event) {
      if (event.cancelable) {
        event.preventDefault();
      }
      void openPanel();
    }
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, [openPanel]);

  useEffect(() => {
    if (location.pathname !== "/chat") {
      return;
    }
    if (openedFor.current === location.key) {
      return;
    }
    openedFor.current = location.key;
    void openPanel();
  }, [location.key, location.pathname, openPanel]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        void closePanel();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  useEffect(() => {
    if (open && conversationId) {
      inputRef.current?.focus();
    }
  }, [open, conversationId]);

  useEffect(() => {
    const log = logRef.current;
    if (!log || typeof log.scrollTo !== "function") {
      return;
    }
    log.scrollTo({ top: log.scrollHeight });
  }, [items, card, notice, sending, open]);

  async function send() {
    const content = draft.trim();
    const activeId = conversationRef.current;
    if (!activeId || content === "" || sendingRef.current) {
      return;
    }
    const generation = ++sendGen.current;
    sendingRef.current = true;
    const key = `${activeId}:${content}`;
    const requestId = requestIds.current.get(key) ?? crypto.randomUUID();
    requestIds.current.set(key, requestId);
    const optimistic: Message = { id: `local-${requestId}`, role: "user", content };
    setPending((current) => [...current, optimistic]);
    setDraft("");
    setNotice(null);
    setSources(null);
    setMetrics(null);
    setSending(true);
    const response = await accessRequest(client, `/api/v1/ai/conversations/${activeId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, requestId }),
    });
    if (generation !== sendGen.current || conversationRef.current !== activeId) {
      return;
    }
    if (!response.ok) {
      sendingRef.current = false;
      setSending(false);
      setPending((current) => current.filter((item) => item.id !== optimistic.id));
      setDraft(content);
      const failure = response.status === 503 ? "El modelo no está disponible." : "No se pudo enviar el mensaje.";
      setNotice(failure);
      notifyDanger(failure);
      return;
    }
    const accepted = (await response.json()) as { runId: string };
    await readStream(accepted.runId, generation, activeId);
    if (generation !== sendGen.current || conversationRef.current !== activeId) {
      return;
    }
    sendingRef.current = false;
    setSending(false);
    await client.invalidateQueries({ queryKey: ["ai", "messages", activeId] });
    if (generation !== sendGen.current || conversationRef.current !== activeId) {
      return;
    }
    setPending((current) => current.filter((item) => item.id !== optimistic.id));
  }

  async function readStream(runId: string, generation: number, activeId: string) {
    const stream = await accessRequest(client, `/api/v1/ai/runs/${runId}/events`);
    const text = await stream.text();
    if (generation !== sendGen.current || conversationRef.current !== activeId) {
      return;
    }
    const proposal = text.match(/"proposalId":"([^"]+)"/)?.[1];
    if (proposal) {
      const proposalResponse = await accessRequest(client, `/api/v1/accounts/transfer-proposals/${proposal}`);
      if (generation !== sendGen.current || conversationRef.current !== activeId) {
        return;
      }
      if (proposalResponse.ok) {
        setCard((await proposalResponse.json()) as ProposalCard);
      }
    }
    if (generation !== sendGen.current || conversationRef.current !== activeId) {
      return;
    }
    if (text.includes("event: failed")) {
      const failure = "La ejecución no se completó. No se movió dinero.";
      setNotice(failure);
      notifyDanger(failure);
    }
    const sourceLine = text.match(/"text":"([^"]*v\d[^"]*)"/)?.[1];
    setSources(sourceLine ?? null);
    const granted = await client.fetchQuery({ queryKey: ["permissions"], queryFn: () => loadPermissions(client) });
    if (generation !== sendGen.current || conversationRef.current !== activeId || !canSeeRunCosts(granted)) {
      return;
    }
    const metricsResponse = await accessRequest(client, `/api/v1/ai/runs/${runId}/metrics`);
    if (generation !== sendGen.current || conversationRef.current !== activeId) {
      return;
    }
    if (metricsResponse.ok) {
      setMetrics((await metricsResponse.json()) as RunMetrics);
    }
  }

  async function confirm() {
    if (!card || expired || card.status !== "pending") {
      const blocked = "Esta propuesta ya no se puede confirmar.";
      setNotice(blocked);
      notifyWarning(blocked);
      return;
    }
    const response = await accessRequest(client, `/api/v1/accounts/transfer-proposals/${card.id}/confirm`, {
      method: "POST",
      body: "{}",
      headers: { "Idempotency-Key": card.id },
    });
    if (!response.ok) {
      const rejected = "Cuentas no confirmó la transferencia. El asistente no puede hacerlo por su cuenta.";
      setNotice(rejected);
      notifyDanger(rejected);
      return;
    }
    const confirmed = "Cuentas confirmó la transferencia.";
    setNotice(confirmed);
    notifySuccess(confirmed);
    setCard(null);
  }

  const ready = conversationId !== null && !forbidden && bootError === null;

  return createPortal(
    <div className="assistant-root">
      {open ? (
        <section className="assistant-panel" role="dialog" aria-labelledby="assistant-title" aria-modal="false">
          <header className="assistant-header">
            <span className="assistant-mark" aria-hidden="true">
              <ChatIcon />
            </span>
            <div className="min-w-0">
              <h2 id="assistant-title">Asistente</h2>
              <p>Tú confirmas las transferencias.</p>
            </div>
            <button type="button" className="assistant-icon-button" aria-label="Cerrar chat" onClick={() => void closePanel()}>
              <CloseIcon />
            </button>
          </header>
          <div className="assistant-log" ref={logRef}>
            {opening ? <p className="assistant-empty">Abriendo el chat…</p> : null}
            {forbidden ? <p role="alert">No tienes permiso para usar el asistente.</p> : null}
            {bootError ? <p role="alert">{bootError}</p> : null}
            {messages.isError ? <p role="alert">No se pudieron cargar los mensajes.</p> : null}
            {ready && !opening && items.length === 0 && !sending ? <p className="assistant-empty">Escribe un mensaje para empezar.</p> : null}
            {items.map((message) => (
              <div key={message.id} className={message.role === "user" ? "assistant-row is-user" : "assistant-row"}>
                <span className="assistant-author">{message.role === "assistant" ? "Asistente" : "Tú"}</span>
                <p className={message.role === "assistant" ? "assistant-bubble is-assistant" : "assistant-bubble is-user"}>{message.content}</p>
              </div>
            ))}
            {sending ? <p className="assistant-bubble is-assistant">Escribiendo…</p> : null}
            {sources ? (
              <details className="assistant-note">
                <summary>Referencias</summary>
                <p>Fuentes: {sources}</p>
              </details>
            ) : null}
            {card ? (
              <article className="assistant-card">
                <h3>Transferencia preparada</h3>
                <p>
                  {formatMxn(card.amount)} hacia {card.destinationLabel ?? "destino validado"} por {card.concept}
                </p>
                <p>Vence {formatMexico(card.expiresAt)}. Un sí en el chat no confirma.</p>
                <Button type="button" isDisabled={expired || card.status !== "pending"} onPress={() => void confirm()}>
                  Confirmar transferencia
                </Button>
                <Link to={`/transferencias/propuestas/${card.id}`}>Abrir la propuesta en Cuentas</Link>
              </article>
            ) : null}
            {showCosts && metrics ? (
              <details className="assistant-note">
                <summary>Métricas de la respuesta</summary>
                {metrics.usageComplete ? (
                  <p>
                    {metrics.model}. Entrada {metrics.inputTokens}, salida {metrics.outputTokens}, caché {metrics.cachedTokens}, total {metrics.totalTokens}. Coste estimado {metrics.estimatedCostUsd} USD. Latencia {metrics.latencyMs} ms. Tarifa {metrics.pricingVersion}.
                  </p>
                ) : (
                  <p>Medición incompleta. No se muestra el coste como cero.</p>
                )}
              </details>
            ) : null}
            {notice ? <p role="status">{notice}</p> : null}
          </div>
          {ready ? (
            <form
              className="assistant-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="chat-message">
                Mensaje
              </label>
              <textarea
                ref={inputRef}
                id="chat-message"
                rows={2}
                placeholder="Escribe un mensaje"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <Button type="submit" isDisabled={draft.trim() === "" || sending}>
                Enviar
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}
      <button
        type="button"
        className="assistant-launcher"
        aria-label={open ? "Cerrar asistente" : "Abrir asistente"}
        aria-expanded={open}
        onClick={() => {
          if (openRef.current) {
            void closePanel();
            return;
          }
          void openPanel();
        }}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>
    </div>,
    document.body,
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v7A2.5 2.5 0 0 1 16.5 15H12l-4.2 3.15A.75.75 0 0 1 6.5 17.5V15H7.5A2.5 2.5 0 0 1 5 12.5v-7Z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
