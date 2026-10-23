import { Button } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { notifySuccess, notifyWarning } from "../shell/notify";
import { ThemeSwitcher } from "./ThemeSwitcher";

const schema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Escribe un nombre para mostrar")
    .max(80, "Usa 80 caracteres como máximo"),
});

type PreferencesInput = z.infer<typeof schema>;

export function PreferencesPage() {
  const [savedName, setSavedName] = useState<string | null>(null);
  const form = useForm<PreferencesInput>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: "" },
  });
  const error = form.formState.errors.displayName?.message;

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Preferencias</h1>
      </div>
      <ThemeSwitcher />
      <form
        className="grid max-w-md gap-3"
        onSubmit={form.handleSubmit((values) => {
          setSavedName(values.displayName);
          notifySuccess("Nombre guardado en este dispositivo.");
        }, () => notifyWarning("Revisa el nombre antes de guardar."))}
        noValidate
      >
        <label className="grid gap-1" htmlFor="display-name">
          Nombre para mostrar
          <input
            id="display-name"
            className="rounded-md border px-3 py-2"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "display-name-error" : undefined}
            {...form.register("displayName")}
          />
        </label>
        {error ? (
          <p id="display-name-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary">
          Guardar en este dispositivo
        </Button>
      </form>
      {savedName ? <p>El nombre queda solo en esta pantalla: {savedName}. No se envió a ningún servicio.</p> : null}
    </section>
  );
}
