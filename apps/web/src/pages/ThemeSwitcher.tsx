import { Button, useTheme } from "@heroui/react";
import { notifySuccess } from "../shell/notify";

const options = [
  ["light", "Claro"],
  ["dark", "Oscuro"],
  ["system", "Sistema"],
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Tema">
      {options.map(([value, label]) => (
        <Button key={value} variant={theme === value ? "primary" : "secondary"} onPress={() => {
          setTheme(value);
          notifySuccess(`Tema ${label} aplicado en este navegador.`);
        }}>
          {label}
        </Button>
      ))}
    </div>
  );
}
