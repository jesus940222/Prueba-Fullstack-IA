import { Button } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import { accessRequest } from "./access/http";
import { notifySuccess } from "./shell/notify";
import { isAdminPath, useNavigation } from "./shell/navigation";
import { AccountDetailPage } from "./pages/AccountDetailPage";
import { AccountsPage } from "./pages/AccountsPage";
import { AiAdminPage } from "./pages/AiAdminPage";
import { AuditPage } from "./pages/AuditPage";
import { ChatLanding, ChatPage } from "./pages/ChatPage";
import { BeneficiariesPage } from "./pages/BeneficiariesPage";
import { CatalogAdminPage } from "./pages/CatalogAdminPage";
import { HealthPage } from "./pages/HealthPage";
import { HomePage } from "./pages/HomePage";
import { LimitsPage } from "./pages/LimitsPage";
import { LoginPage } from "./pages/LoginPage";
import { MovementsPage } from "./pages/MovementsPage";
import { OffersPage } from "./pages/OffersPage";
import { PreferencesPage } from "./pages/PreferencesPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RolesPage } from "./pages/RolesPage";
import { SessionsPage } from "./pages/SessionsPage";
import { TransferPage } from "./pages/TransferPage";
import { UsersPage } from "./pages/UsersPage";

export function AppRoutes() {
  const navigation = useNavigation();
  const location = useLocation();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    retry: false,
    queryFn: async () => {
      const response = await accessRequest(client, "/api/v1/access/me");
      return response.ok ? ("in" as const) : ("out" as const);
    },
  });
  const permissions = useQuery({
    queryKey: ["permissions"],
    enabled: session.data === "in",
    retry: false,
    queryFn: async () => {
      const response = await accessRequest(client, "/api/v1/access/me/permissions");
      if (!response.ok) {
        return [] as string[];
      }
      const body = (await response.json()) as { permissions?: string[] };
      return body.permissions ?? [];
    },
  });
  const granted = permissions.data ?? [];
  const directory = granted.includes("users:read");
  const roleDirectory = granted.includes("roles:read");
  const ownAccounts = granted.includes("accounts:read:own");
  const ownTransfers = granted.includes("transfers:create:own");
  const ownBeneficiaries = granted.includes("beneficiaries:read:own");
  const products = granted.includes("products:read");
  const offers = granted.includes("offers:read:own");
  const catalogAdmin = granted.includes("categories:read");
  const audit = granted.includes("audit:read:any");
  const chat = granted.includes("ai:chat:use");
  const aiAdmin = granted.includes("ai:metrics:read:any");
  const aiAlerts = granted.includes("ai:alerts:read");
  const adminPath = isAdminPath(location.pathname);
  const adminLinks = [
    directory ? ["/usuarios", "Usuarios"] : null,
    roleDirectory ? ["/roles", "Roles"] : null,
    catalogAdmin ? ["/catalogo", "Catálogo"] : null,
    audit ? ["/auditoria", "Auditoría"] : null,
    aiAdmin || aiAlerts ? ["/ia", "Métricas IA"] : null,
    ["/salud", "Salud"],
  ].filter((item): item is [string, string] => item !== null);
  const clientLinks = [
    ["/", "Inicio"],
    ownAccounts ? ["/cuentas", "Cuentas"] : null,
    ownTransfers ? ["/transferencias", "Transferir"] : null,
    ownBeneficiaries ? ["/beneficiarios", "Beneficiarios"] : null,
    products ? ["/productos", "Productos"] : null,
    !products && offers ? ["/ofertas", "Ofertas"] : null,
    ["/perfil", "Perfil"],
  ].filter((item): item is [string, string] => item !== null);
  const links = adminPath ? adminLinks : clientLinks;
  const adminHome = adminLinks.find((item) => item[0] !== "/salud")?.[0] ?? "/salud";

  if (session.isPending) {
    return (
      <div className="login-screen">
        <p role="status">Comprobando la sesión…</p>
      </div>
    );
  }

  if (session.data !== "in") {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className={chat ? "portal-shell has-assistant" : "portal-shell"}>
      <aside className={`portal-sidebar${navigation.open ? " is-open" : ""}`}>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide opacity-70">{adminPath ? "Administración" : "Banca"}</p>
            <p className="text-lg font-semibold">Portal local</p>
          </div>
          {adminLinks.some((item) => item[0] !== "/salud") ? (
            <NavLink
              to={adminPath ? "/" : adminHome}
              onClick={navigation.close}
              className="rounded-lg border px-3 py-2 text-sm font-medium no-underline"
            >
              {adminPath ? "Mi banca" : "Administración"}
            </NavLink>
          ) : null}
          <nav aria-label={adminPath ? "Administración" : "Banca"} className="grid gap-1">
            {links.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                onClick={navigation.close}
                className={({ isActive }) => `portal-nav-link${isActive ? " is-active" : ""}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <Button
            className="mt-auto"
            variant="tertiary"
            onPress={() => {
              void accessRequest(client, "/api/v1/access/auth/logout", { method: "POST" }).finally(() => {
                notifySuccess("Sesión cerrada.");
                client.clear();
                navigation.close();
                window.location.assign("/login");
              });
            }}
          >
            Salir
          </Button>
        </aside>
        <div className="portal-main">
          <header className="portal-topbar">
            <p className="font-semibold">Portal local</p>
            <Button variant="tertiary" aria-expanded={navigation.open} onPress={navigation.toggle}>
              Menú
            </Button>
          </header>
          <main className="portal-content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/cuentas" element={<AccountsPage />} />
              <Route path="/cuentas/:accountId" element={<AccountDetailPage />} />
              <Route path="/cuentas/:accountId/movimientos" element={<MovementsPage />} />
              <Route path="/beneficiarios" element={<BeneficiariesPage />} />
              <Route path="/transferencias" element={<TransferPage />} />
              <Route path="/transferencias/propuestas/:proposalId" element={<TransferPage />} />
              <Route path="/limites" element={<LimitsPage />} />
              <Route path="/productos" element={<ProductsPage />} />
              <Route path="/productos/:productId" element={<ProductDetailPage />} />
              <Route path="/ofertas" element={<OffersPage />} />
              <Route path="/catalogo" element={<CatalogAdminPage />} />
              <Route path="/auditoria" element={<AuditPage />} />
              <Route
                path="/chat"
                element={
                  chat ? (
                    <ChatLanding />
                  ) : (
                    <p role="alert">No tienes permiso para usar el asistente.</p>
                  )
                }
              />
              <Route path="/ia" element={<AiAdminPage />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/entrar" element={<Navigate to="/" replace />} />
              <Route path="/perfil" element={<ProfilePage />} />
              <Route path="/sesiones" element={<SessionsPage />} />
              <Route path="/usuarios" element={<UsersPage />} />
              <Route path="/usuarios/:userId/asignaciones" element={<Navigate to="/usuarios" replace />} />
              <Route path="/roles" element={<RolesPage />} />
              <Route path="/preferencias" element={<PreferencesPage />} />
              <Route path="/salud" element={<HealthPage />} />
            </Routes>
          </main>
        </div>
        {chat ? <ChatPage /> : null}
    </div>
  );
}
