import { Button } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { accessRequest } from "../access/http";
import { usePasskey } from "../access/webauthn";
import { notifyDanger, notifyInfo, notifySuccess, notifyWarning } from "../shell/notify";

const credentials = z.object({
  email: z.string().trim().email("Escribe un correo válido"),
  password: z.string().min(1, "Escribe la contraseña").max(200),
});

const proofSchema = z.object({
  proof: z.string().trim().min(1, "Escribe el código").max(20),
});

type Credentials = z.infer<typeof credentials>;
type Proof = z.infer<typeof proofSchema>;

interface AuthStep {
  nextStep: string;
  challengeId?: string;
}

export function LoginPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const routedNotice = (location.state as { notice?: string } | null)?.notice ?? null;
  const [challenge, setChallenge] = useState<AuthStep | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (routedNotice) {
      notifyInfo(routedNotice);
    }
  }, [routedNotice]);
  const form = useForm<Credentials>({ resolver: zodResolver(credentials), defaultValues: { email: "", password: "" } });
  const proofForm = useForm<Proof>({ resolver: zodResolver(proofSchema), defaultValues: { proof: "" } });

  async function readStep(response: Response): Promise<void> {
    if (response.status === 401) {
      notifyDanger("Correo o contraseña incorrectos");
      return;
    }
    if (response.status === 503) {
      notifyWarning("El acceso externo no está disponible en este entorno.");
      return;
    }
    if (!response.ok) {
      notifyDanger("No se pudo iniciar la sesión.");
      return;
    }
    const step = (await response.json()) as AuthStep;
    if (step.nextStep === "AUTHENTICATED") {
      notifySuccess("Sesión iniciada.");
      client.setQueryData(["session"], "in");
      await client.invalidateQueries({ queryKey: ["permissions"] });
      await client.invalidateQueries({ queryKey: ["profile"] });
      await navigate("/");
      return;
    }
    setChallenge(step);
    const next = step.nextStep === "PASSKEY_CHALLENGE" ? "Confirma con tu passkey." : "Escribe el código que llegó al buzón local.";
    setMessage(next);
    notifyInfo(next);
  }

  return (
    <section className="login-screen">
      <div className="login-card">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          setMessage(null);
          const response = await accessRequest(client, "/api/v1/access/auth/login", { method: "POST", body: JSON.stringify(values) });
          await readStep(response);
        }, () => notifyWarning("Revisa el correo y la contraseña."))}
      >
        <label className="grid gap-1" htmlFor="email">
          Correo
          <input id="email" type="email" className="rounded-md border px-3 py-2" {...form.register("email")} />
        </label>
        {form.formState.errors.email ? <p role="alert">{form.formState.errors.email.message}</p> : null}
        <label className="grid gap-1" htmlFor="password">
          Contraseña
          <input id="password" type="password" className="rounded-md border px-3 py-2" {...form.register("password")} />
        </label>
        {form.formState.errors.password ? <p role="alert">{form.formState.errors.password.message}</p> : null}
        <Button type="submit">Continuar</Button>
      </form>
      {challenge?.nextStep === "PASSKEY_CHALLENGE" ? (
        <Button
          type="button"
          onPress={async () => {
            const response = await accessRequest(client, `/api/v1/access/auth/challenges/${challenge.challengeId}/passkey/options`, { method: "POST", body: "{}" });
            if (!response.ok) {
              notifyDanger("No se pudo preparar la passkey.");
              return;
            }
            const step = (await response.json()) as { options?: Record<string, unknown> };
            try {
              const credential = await usePasskey(step.options ?? {});
              const verified = await accessRequest(client, `/api/v1/access/auth/challenges/${challenge.challengeId}/passkey/verify`, {
                method: "POST",
                body: JSON.stringify({ proof: JSON.stringify(credential) }),
              });
              await readStep(verified);
            } catch (error) {
              notifyDanger(error instanceof Error && error.message === "authenticator_unavailable" ? "Este navegador no tiene un autenticador disponible." : "La passkey no se pudo comprobar.");
            }
          }}
        >
          Usar passkey
        </Button>
      ) : null}
      {challenge?.nextStep === "EMAIL_CHALLENGE" ? (
        <form
          className="grid gap-3"
          noValidate
          onSubmit={proofForm.handleSubmit(async (values) => {
            const response = await accessRequest(client, `/api/v1/access/auth/challenges/${challenge.challengeId}/email/verify`, {
              method: "POST",
              body: JSON.stringify(values),
            });
            await readStep(response);
          }, () => notifyWarning("Escribe el código antes de verificar."))}
        >
          <label className="grid gap-1" htmlFor="proof">
            Código
            <input id="proof" inputMode="numeric" autoComplete="one-time-code" className="rounded-md border px-3 py-2" {...proofForm.register("proof")} />
          </label>
          {proofForm.formState.errors.proof ? <p role="alert">{proofForm.formState.errors.proof.message}</p> : null}
          <Button type="submit">Verificar código</Button>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {!message && routedNotice ? <p role="status">{routedNotice}</p> : null}
      </div>
    </section>
  );
}
