import { Button, Card, Description, Input, Label, Tabs, TextField, useTheme } from "@heroui/react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { z } from "zod";
import { accessRequest, readApiMessage } from "../access/http";
import { createPasskey } from "../access/webauthn";
import { notifyDanger, notifySuccess, notifyWarning } from "../shell/notify";
import { LimitsPage } from "./LimitsPage";
import { SessionsPanel } from "./SessionsPage";

const identitySchema = z.object({
  givenName: z.string().trim().min(1, "Escribe tu nombre").max(80, "Usa 80 caracteres como máximo"),
  familyName: z.string().trim().min(1, "Escribe tus apellidos").max(80, "Usa 80 caracteres como máximo"),
  phoneCountryCode: z.literal("MX", { error: "Solo se captura un teléfono de México" }),
  phoneNumber: z.string().regex(/^[0-9]{10}$/, "Usa 10 dígitos"),
});

const themeSchema = z.object({
  themePreference: z.enum(["light", "dark", "system"]),
});

type ThemePreference = z.infer<typeof themeSchema>["themePreference"];

interface Profile {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  phoneE164?: string | null;
  themePreference: ThemePreference;
}

interface PasskeyItem {
  id: string;
  name: string;
}

const themeChoices: Array<{ value: ThemePreference; label: string; hint: string }> = [
  { value: "system", label: "Sistema", hint: "Sigue el dispositivo" },
  { value: "light", label: "Claro", hint: "Fondo claro" },
  { value: "dark", label: "Oscuro", hint: "Fondo carbón" },
];

function nationalPhone(phoneE164: string | null | undefined): string {
  if (!phoneE164?.startsWith("+52")) {
    return "";
  }
  const national = phoneE164.slice(3);
  return /^[0-9]{10}$/.test(national) ? national : "";
}

function fieldValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function patchProfile(client: QueryClient, body: Record<string, string>): Promise<Profile> {
  const response = await accessRequest(client, "/api/v1/access/me", { method: "PATCH", body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(await readApiMessage(response, "No se guardó el cambio."));
  }
  return (await response.json()) as Profile;
}

export function ProfilePage() {
  const client = useQueryClient();
  const { setTheme } = useTheme();
  const profile = useQuery({
    queryKey: ["profile"],
    retry: false,
    queryFn: async (): Promise<Profile> => {
      const response = await accessRequest(client, "/api/v1/access/me");
      if (!response.ok) {
        throw new Error("profile_failed");
      }
      return (await response.json()) as Profile;
    },
  });
  const savedTheme = profile.data?.themePreference;
  useEffect(() => {
    if (savedTheme) {
      setTheme(savedTheme);
    }
  }, [savedTheme, setTheme]);

  const identityKey = profile.data
    ? `${profile.data.givenName}|${profile.data.familyName}|${profile.data.phoneE164 ?? ""}`
    : "pending";

  return (
    <section className="grid max-w-3xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Perfil</h1>
        {profile.isLoading ? <p>Cargando perfil…</p> : null}
        {profile.data ? <p>{profile.data.givenName} {profile.data.familyName} · {profile.data.email}</p> : null}
        {profile.isError ? <p role="alert">Inicia sesión para ver el perfil.</p> : null}
      </header>

      <Tabs className="w-full" variant="secondary">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Secciones del perfil">
            <Tabs.Tab id="datos">
              Datos
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="apariencia">
              <Tabs.Separator />
              Apariencia
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="limites">
              <Tabs.Separator />
              Límites
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="seguridad">
              <Tabs.Separator />
              Seguridad
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="datos" className="pt-5">
          <IdentityPanel
            key={identityKey}
            client={client}
            profile={profile.data}
          />
        </Tabs.Panel>
        <Tabs.Panel id="apariencia" className="pt-5">
          <ThemePanel client={client} preference={profile.data?.themePreference ?? "system"} />
        </Tabs.Panel>
        <Tabs.Panel id="limites" className="pt-5">
          <LimitsPage embedded />
        </Tabs.Panel>
        <Tabs.Panel id="seguridad" className="pt-5">
          <div className="grid gap-4">
            <PasskeyPanel profileId={profile.data?.id} />
            <SessionsPanel />
          </div>
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}

function IdentityPanel(props: {
  client: QueryClient;
  profile?: Profile;
}) {
  const save = useMutation({
    mutationFn: (values: z.infer<typeof identitySchema>) => patchProfile(props.client, values),
    onSuccess: (saved) => {
      props.client.setQueryData(["profile"], saved);
      notifySuccess(`Datos guardados. Teléfono ${saved.phoneE164 ?? "sin número"}.`);
    },
    onError: (error) => {
      notifyDanger(error instanceof Error ? error.message : "No se guardaron los datos.");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = identitySchema.safeParse({
      givenName: fieldValue(form, "givenName"),
      familyName: fieldValue(form, "familyName"),
      phoneCountryCode: "MX",
      phoneNumber: fieldValue(form, "phoneNumber"),
    });
    if (!parsed.success) {
      notifyWarning(parsed.error.issues[0]?.message ?? "Revisa los datos antes de guardar.");
      return;
    }
    save.mutate(parsed.data);
  }

  const phone = nationalPhone(props.profile?.phoneE164);

  return (
    <Card>
      <Card.Header>
        <Card.Title>Datos personales</Card.Title>
        <Card.Description>Nombre y teléfono de México. El correo identifica la cuenta y no se cambia aquí.</Card.Description>
      </Card.Header>
      <form noValidate onSubmit={submit}>
        <Card.Content className="grid gap-4">
          <TextField name="givenName" defaultValue={props.profile?.givenName ?? ""} fullWidth>
            <Label>Nombre</Label>
            <Input autoComplete="given-name" />
            <Description>Como apareces en el portal.</Description>
          </TextField>
          <TextField name="familyName" defaultValue={props.profile?.familyName ?? ""} fullWidth>
            <Label>Apellidos</Label>
            <Input autoComplete="family-name" />
            <Description>Hasta 80 caracteres.</Description>
          </TextField>
          <TextField isReadOnly value={props.profile?.email ?? ""} fullWidth>
            <Label>Correo</Label>
            <Input />
            <Description>Solo lectura.</Description>
          </TextField>
          <TextField name="phoneNumber" defaultValue={phone} fullWidth>
            <Label>Teléfono</Label>
            <Input inputMode="numeric" autoComplete="tel-national" />
            <Description>10 dígitos, sin clave de país.</Description>
          </TextField>
        </Card.Content>
        <Card.Footer>
          <Button type="submit" isDisabled={save.isPending || !props.profile}>Guardar datos</Button>
        </Card.Footer>
      </form>
    </Card>
  );
}

function ThemePanel(props: { client: QueryClient; preference: ThemePreference }) {
  const { setTheme } = useTheme();
  const [value, setValue] = useState<ThemePreference>(props.preference);
  useEffect(() => {
    setValue(props.preference);
  }, [props.preference]);
  const save = useMutation({
    mutationFn: (themePreference: ThemePreference) => patchProfile(props.client, { themePreference }),
    onSuccess: (saved) => {
      props.client.setQueryData(["profile"], saved);
      setTheme(saved.themePreference);
      const label = themeChoices.find((item) => item.value === saved.themePreference)?.label ?? saved.themePreference;
      notifySuccess(`Tema guardado: ${label}.`);
    },
    onError: (error) => {
      notifyDanger(error instanceof Error ? error.message : "No se guardó el tema.");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = themeSchema.safeParse({ themePreference: value });
    if (!parsed.success) {
      return;
    }
    save.mutate(parsed.data.themePreference);
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Apariencia</Card.Title>
        <Card.Description>El tema se guarda en tu cuenta y se aplica en este navegador.</Card.Description>
      </Card.Header>
      <form noValidate onSubmit={submit}>
        <Card.Content>
          <div className="profile-theme-grid" role="radiogroup" aria-label="Tema">
            {themeChoices.map((item) => (
              <Button
                key={item.value}
                className="h-auto w-full flex-col items-start gap-1 px-4 py-3 text-left"
                type="button"
                variant={value === item.value ? "primary" : "secondary"}
                aria-pressed={value === item.value}
                onPress={() => setValue(item.value)}
              >
                {item.label}
                <span className="block text-xs font-normal opacity-70">{item.hint}</span>
              </Button>
            ))}
          </div>
        </Card.Content>
        <Card.Footer>
          <Button type="submit" isDisabled={save.isPending}>Guardar tema</Button>
        </Card.Footer>
      </form>
    </Card>
  );
}

function PasskeyPanel(props: { profileId?: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const passkeys = useQuery({
    queryKey: ["passkeys"],
    retry: false,
    queryFn: async (): Promise<PasskeyItem[]> => {
      const response = await accessRequest(client, "/api/v1/access/me/passkeys");
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as { items?: PasskeyItem[] };
      return body.items ?? [];
    },
  });

  return (
    <Card>
      <Card.Header>
        <Card.Title>Passkeys</Card.Title>
        <Card.Description>Habilitar o registrar una passkey cierra la sesión. Vuelve a entrar para completar el cambio.</Card.Description>
      </Card.Header>
      <Card.Content className="grid gap-4">
        {passkeys.data && passkeys.data.length === 0 ? <p>No hay passkeys registradas.</p> : null}
        <ul className="grid gap-2">
          {passkeys.data?.map((item) => (
            <li key={item.id} className="rounded-xl border px-3 py-2">{item.name}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onPress={async () => {
              if (!props.profileId) {
                notifyWarning("Inicia sesión para cambiar la política de passkey.");
                return;
              }
              const response = await accessRequest(client, `/api/v1/access/users/${props.profileId}/passkey-policy`, {
                method: "PATCH",
                body: JSON.stringify({ action: "enable" }),
              });
              if (!response.ok) {
                notifyDanger(await readApiMessage(response, "No se pudo habilitar la passkey."));
                return;
              }
              notifySuccess("Política de passkey actualizada. La sesión se cerró.");
              client.clear();
              client.setQueryData(["session"], "out");
              await navigate("/login", { state: { notice: "La política quedó pendiente y la sesión se cerró. Vuelve a entrar para registrar el autenticador." } });
            }}
          >
            Habilitar passkey
          </Button>
          <Button
            type="button"
            onPress={async () => {
              const response = await accessRequest(client, "/api/v1/access/me/passkeys/registration/options", { method: "POST", body: "{}" });
              if (!response.ok) {
                notifyDanger(await readApiMessage(response, "No se pudo preparar el alta de passkey."));
                return;
              }
              const step = (await response.json()) as { challengeId?: string; options?: Record<string, unknown> };
              try {
                const credential = await createPasskey(step.options ?? {});
                const verified = await accessRequest(client, "/api/v1/access/me/passkeys/registration/verify", {
                  method: "POST",
                  body: JSON.stringify({ challengeId: step.challengeId, response: credential }),
                });
                if (!verified.ok) {
                  notifyDanger("La passkey no se pudo comprobar.");
                  return;
                }
                notifySuccess("Passkey registrada. La sesión se cerró.");
                client.clear();
                client.setQueryData(["session"], "out");
                await navigate("/login", { state: { notice: "Passkey registrada. La sesión se cerró por el cambio de seguridad." } });
              } catch (error) {
                notifyDanger(error instanceof Error && error.message === "authenticator_unavailable" ? "Este navegador no tiene un autenticador disponible." : "No se pudo registrar la passkey.");
              }
            }}
          >
            Registrar passkey
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}
