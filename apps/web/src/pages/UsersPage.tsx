import { Button, Chip, Input, Label, ListBox, Modal, Select, Table, TextField } from "@heroui/react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";
import { accessRequest, parseFlag, parsePositive, readApiMessage } from "../access/http";
import { notifyDanger, notifySuccess } from "../shell/notify";
import { OptionsMenu, type MenuOption } from "../shell/options-menu";
import { OverlayDialog } from "../shell/overlay-dialog";

interface UserItem {
  id: string;
  email: string;
  givenName?: string;
  familyName?: string;
  status: string;
  deletedAt?: string | null;
}

interface UserPage {
  items: UserItem[];
  totalItems: number;
  page?: number;
  totalPages?: number;
}

interface RoleChoice {
  id: string;
  name: string;
}

interface UserRoleView {
  assignmentId: string;
  roleId: string;
  name: string;
}

const inviteSchema = z.object({
  email: z.string().trim().email("Escribe un correo válido").max(254),
  givenName: z.string().trim().min(1, "El nombre es obligatorio").max(80),
  familyName: z.string().trim().min(1, "Los apellidos son obligatorios").max(80),
});

const updateSchema = z.object({
  givenName: z.string().trim().min(1, "El nombre es obligatorio").max(80),
  familyName: z.string().trim().min(1, "Los apellidos son obligatorios").max(80),
});

const statusLabel: Record<string, string> = {
  invited: "Invitado",
  active: "Activo",
  disabled: "Deshabilitado",
};

function statusColor(status: string): "success" | "warning" | "default" {
  if (status === "active") return "success";
  if (status === "disabled") return "warning";
  return "default";
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function portalApplicationId(client: QueryClient): Promise<string | null> {
  const response = await accessRequest(client, "/api/v1/access/applications?page=1&pageSize=20");
  if (response.status === 403) {
    throw new Error("forbidden");
  }
  if (!response.ok) {
    throw new Error("roles_failed");
  }
  const body = (await response.json()) as { items?: Array<{ id: string; code: string }> };
  return body.items?.find((item) => item.code === "portal")?.id ?? body.items?.[0]?.id ?? null;
}

async function loadRoleChoices(client: QueryClient): Promise<RoleChoice[]> {
  const applicationId = await portalApplicationId(client);
  if (!applicationId) {
    return [];
  }
  const items: RoleChoice[] = [];
  let next = 1;
  let totalPages = 1;
  do {
    const response = await accessRequest(client, `/api/v1/access/applications/${applicationId}/roles?page=${next}&pageSize=100`);
    if (response.status === 403) {
      throw new Error("forbidden");
    }
    if (!response.ok) {
      throw new Error("roles_failed");
    }
    const body = (await response.json()) as { items?: Array<{ id: string; name: string }>; totalPages?: number };
    for (const item of body.items ?? []) {
      if (item.name.trim().length > 0) {
        items.push({ id: item.id, name: item.name });
      }
    }
    totalPages = body.totalPages ?? next;
    next += 1;
  } while (next <= totalPages && next <= 5);
  return items;
}

async function loadUserRoles(client: QueryClient, userIds: string[]): Promise<Record<string, UserRoleView[]>> {
  const roles = await loadRoleChoices(client);
  const names = new Map(roles.map((role) => [role.id, role.name]));
  const pairs = await Promise.all(userIds.map(async (userId) => {
    const response = await accessRequest(client, `/api/v1/access/users/${userId}/role-assignments?page=1&pageSize=20`);
    if (response.status === 403) {
      throw new Error("forbidden");
    }
    if (!response.ok) {
      throw new Error("assignments_failed");
    }
    const body = (await response.json()) as { items?: Array<{ id: string; roleId: string }> };
    const views = (body.items ?? []).map((item) => ({
      assignmentId: item.id,
      roleId: item.roleId,
      name: names.get(item.roleId) ?? "Rol no disponible",
    }));
    return [userId, views] as const;
  }));
  return Object.fromEntries(pairs);
}

function roleChanged(current: UserRoleView[], nextRoleId: string): boolean {
  if (nextRoleId === "") {
    return false;
  }
  return current.length !== 1 || current[0]?.roleId !== nextRoleId;
}

async function applyRole(client: QueryClient, userId: string, current: UserRoleView[], nextRoleId: string): Promise<string | null> {
  if (!roleChanged(current, nextRoleId)) {
    return null;
  }
  const kept = current.some((item) => item.roleId === nextRoleId);
  if (!kept) {
    const assigned = await accessRequest(client, `/api/v1/access/users/${userId}/role-assignments`, {
      method: "POST",
      body: JSON.stringify({ roleId: nextRoleId }),
    });
    if (!assigned.ok) {
      return readApiMessage(assigned, "No se pudo asignar el rol.");
    }
  }
  for (const item of current) {
    if (item.roleId === nextRoleId) {
      continue;
    }
    const revoked = await accessRequest(client, `/api/v1/access/users/${userId}/role-assignments/${item.assignmentId}`, { method: "DELETE" });
    if (!revoked.ok) {
      return readApiMessage(revoked, "No se pudo quitar el rol anterior.");
    }
  }
  return null;
}

export function UsersPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const pageSize = parsePositive(params.get("pageSize"), 20, 100);
  const includeDeleted = parseFlag(params.get("includeDeleted"));
  const valid = page !== null && pageSize !== null && includeDeleted !== null;
  const permissions = useQuery({
    queryKey: ["permissions"],
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
  const canReadRoles = granted.includes("users:roles:read");
  const canAssign = granted.includes("users:roles:assign");
  const canRevoke = granted.includes("users:roles:revoke");
  const users = useQuery({
    queryKey: ["users", page, pageSize, includeDeleted],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<UserPage> => {
      const response = await accessRequest(client, `/api/v1/access/users?page=${page}&pageSize=${pageSize}&includeDeleted=${includeDeleted}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("users_failed");
      }
      return (await response.json()) as UserPage;
    },
  });
  const userIds = users.data?.items.map((item) => item.id) ?? [];
  const roleLabels = useQuery({
    queryKey: ["user-roles", userIds],
    enabled: valid && permissions.isSuccess && canReadRoles && userIds.length > 0,
    retry: false,
    queryFn: () => loadUserRoles(client, userIds),
  });

  function go(next: number) {
    const copy = new URLSearchParams(params);
    copy.set("page", String(next));
    setParams(copy);
  }

  function roleText(userId: string): string {
    if (!permissions.isSuccess || (canReadRoles && roleLabels.isLoading)) {
      return "…";
    }
    if (!canReadRoles || roleLabels.isError) {
      return roleLabels.isError ? "No disponible" : "—";
    }
    const names = roleLabels.data?.[userId]?.map((item) => item.name) ?? [];
    return names.length > 0 ? names.join(", ") : "Sin rol";
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        {granted.includes("users:create") ? <CreateUserDialog canAssign={canAssign} onSaved={notifySuccess} /> : null}
      </div>
      {!valid ? <p role="alert">Los filtros de la dirección no son válidos.</p> : null}
      {users.isLoading ? <p>Cargando usuarios…</p> : null}
      {users.error instanceof Error && users.error.message === "forbidden" ? <p role="alert">No tienes permiso para ver usuarios.</p> : null}
      {users.isError && !(users.error instanceof Error && users.error.message === "forbidden") ? <p role="alert">No se pudo consultar el directorio.</p> : null}
      {includeDeleted ? <p>La lista incluye usuarios eliminados.</p> : null}
      {users.data && users.data.items.length === 0 ? <p>No hay usuarios en esta página.</p> : null}
      {users.data && users.data.items.length > 0 ? (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Usuarios">
              <Table.Header>
                <Table.Column isRowHeader id="email">Correo</Table.Column>
                <Table.Column id="name">Nombre</Table.Column>
                <Table.Column id="role">Rol</Table.Column>
                <Table.Column id="status">Estado</Table.Column>
                <Table.Column id="actions">Acciones</Table.Column>
              </Table.Header>
              <Table.Body>
                {users.data.items.map((item) => (
                  <Table.Row key={item.id} id={item.id}>
                    <Table.Cell>{item.email}</Table.Cell>
                    <Table.Cell>{[item.givenName, item.familyName].filter(Boolean).join(" ") || "—"}</Table.Cell>
                    <Table.Cell>{roleText(item.id)}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={statusColor(item.status)}>{statusLabel[item.status] ?? item.status}</Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <UserActions user={item} granted={granted} canReadRoles={canReadRoles} canAssign={canAssign} canRevoke={canRevoke} onSaved={notifySuccess} />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : null}
      {users.data && typeof users.data.page === "number" && typeof users.data.totalPages === "number" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Página {users.data.page} de {users.data.totalPages}</p>
          <Button type="button" variant="tertiary" isDisabled={users.data.page <= 1} onPress={() => go(users.data.page! - 1)}>Anterior</Button>
          <Button type="button" variant="tertiary" isDisabled={users.data.page >= users.data.totalPages} onPress={() => go(users.data.page! + 1)}>Siguiente</Button>
        </div>
      ) : null}
    </section>
  );
}

function UserActions(props: {
  user: UserItem;
  granted: string[];
  canReadRoles: boolean;
  canAssign: boolean;
  canRevoke: boolean;
  onSaved: (message: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const options: MenuOption[] = [];
  if (props.granted.includes("users:update")) {
    options.push({ label: "Editar", onPress: () => setEdit(true) });
  }
  if (props.granted.includes("users:delete") && !props.user.deletedAt) {
    options.push({ label: "Eliminar", danger: true, onPress: () => setRemove(true) });
  }

  return (
    <>
      <OptionsMenu label={`Opciones de ${props.user.email}`} options={options} />
      {edit ? (
        <EditUserDialog
          user={props.user}
          open={edit}
          canReadRoles={props.canReadRoles}
          canAssign={props.canAssign}
          canRevoke={props.canRevoke}
          onOpenChange={setEdit}
          onSaved={props.onSaved}
        />
      ) : null}
      {remove ? <DeleteUserDialog user={props.user} open={remove} onOpenChange={setRemove} onSaved={props.onSaved} /> : null}
    </>
  );
}

function RoleSelect(props: { roles: RoleChoice[]; value: string; pending?: boolean; onChange: (roleId: string) => void }) {
  return (
    <Select
      aria-label="Rol"
      placeholder="Elige un rol"
      isDisabled={props.pending || props.roles.length === 0}
      selectedKey={props.value === "" ? null : props.value}
      onSelectionChange={(key) => {
        if (typeof key === "string") {
          props.onChange(key);
        }
      }}
    >
      <Label>Rol</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {props.roles.map((role) => (
            <ListBox.Item key={role.id} id={role.id} textValue={role.name}>{role.name}</ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function CreateUserDialog(props: { canAssign: boolean; onSaved: (message: string) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [pending, setPending] = useState(false);
  const roles = useQuery({
    queryKey: ["roles", "portal-labels"],
    enabled: open && props.canAssign,
    retry: false,
    queryFn: () => loadRoleChoices(client),
  });
  useEffect(() => {
    if (open && props.canAssign && roles.isError) {
      notifyDanger("No se pudieron consultar los roles.");
    }
  }, [open, props.canAssign, roles.isError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = inviteSchema.safeParse({
      email: field(new FormData(event.currentTarget), "email"),
      givenName: field(new FormData(event.currentTarget), "givenName"),
      familyName: field(new FormData(event.currentTarget), "familyName"),
    });
    if (!parsed.success) {
      notifyDanger(parsed.error.issues[0]?.message ?? "Revisa los datos.");
      return;
    }
    if (props.canAssign && roles.isError) {
      notifyDanger("No se pudieron consultar los roles.");
      return;
    }
    if (props.canAssign && (roles.data?.length ?? 0) > 0 && roleId === "") {
      notifyDanger("Elige un rol.");
      return;
    }
    setPending(true);
    const response = await accessRequest(client, "/api/v1/access/users", { method: "POST", body: JSON.stringify(parsed.data) });
    if (!response.ok) {
      setPending(false);
      notifyDanger(await readApiMessage(response, "No se pudo invitar al usuario."));
      return;
    }
    if (props.canAssign && roleId !== "") {
      const created = (await response.json()) as { id?: string };
      if (!created.id) {
        setPending(false);
        await client.invalidateQueries({ queryKey: ["users"] });
        notifyDanger("El usuario se invitó, pero no se pudo leer su identificador para asignar el rol.");
        return;
      }
      const roleError = await applyRole(client, created.id, [], roleId);
      if (roleError) {
        setPending(false);
        await client.invalidateQueries({ queryKey: ["users"] });
        notifyDanger(roleError);
        return;
      }
    }
    setPending(false);
    await client.invalidateQueries({ queryKey: ["users"] });
    await client.invalidateQueries({ queryKey: ["user-roles"] });
    setOpen(false);
    setRoleId("");
    props.onSaved("Usuario invitado. La contraseña no se muestra.");
  }

  return (
    <OverlayDialog
      open={open}
      title="Agregar usuario"
      triggerLabel="Agregar usuario"
      triggerClassName="button button--md button--primary"
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRoleId("");
        }
      }}
    >
      <form className="grid gap-3" noValidate onSubmit={(event) => { void submit(event); }}>
        <Modal.Body className="grid gap-3">
          <TextField name="email" type="email" fullWidth>
            <Label>Correo</Label>
            <Input />
          </TextField>
          <TextField name="givenName" fullWidth>
            <Label>Nombre</Label>
            <Input />
          </TextField>
          <TextField name="familyName" fullWidth>
            <Label>Apellidos</Label>
            <Input />
          </TextField>
          {props.canAssign && roles.isLoading ? <p>Cargando roles…</p> : null}
          {props.canAssign && roles.data && roles.data.length === 0 ? <p>No hay roles disponibles.</p> : null}
          {props.canAssign && roles.data && roles.data.length > 0 ? (
            <RoleSelect roles={roles.data} value={roleId} pending={pending} onChange={setRoleId} />
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" isDisabled={pending || (props.canAssign && roles.isLoading)}>Invitar</Button>
        </Modal.Footer>
      </form>
    </OverlayDialog>
  );
}

function EditUserDialog(props: {
  user: UserItem;
  open: boolean;
  canReadRoles: boolean;
  canAssign: boolean;
  canRevoke: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["user", props.user.id],
    enabled: props.open,
    retry: false,
    queryFn: async (): Promise<UserItem> => {
      const response = await accessRequest(client, `/api/v1/access/users/${props.user.id}`);
      if (!response.ok) {
        throw new Error("user_failed");
      }
      return (await response.json()) as UserItem;
    },
  });
  useEffect(() => {
    if (props.open && detail.isError) {
      notifyDanger("No se pudo leer el usuario.");
    }
  }, [props.open, detail.isError]);

  return (
    <OverlayDialog open={props.open} title="Editar usuario" onOpenChange={props.onOpenChange}>
      {detail.isLoading ? <Modal.Body><p>Cargando usuario…</p></Modal.Body> : null}
      {detail.data ? (
        <EditUserForm
          user={detail.data}
          canReadRoles={props.canReadRoles}
          canAssign={props.canAssign}
          canRevoke={props.canRevoke}
          onClose={() => props.onOpenChange(false)}
          onSaved={props.onSaved}
        />
      ) : null}
    </OverlayDialog>
  );
}

function EditUserForm(props: {
  user: UserItem;
  canReadRoles: boolean;
  canAssign: boolean;
  canRevoke: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const client = useQueryClient();
  const editableStatus = props.user.status === "active" || props.user.status === "disabled";
  const [status, setStatus] = useState<"active" | "disabled">(props.user.status === "disabled" ? "disabled" : "active");
  const [chosenRole, setChosenRole] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const needsRoles = props.canReadRoles || props.canAssign;
  const roles = useQuery({
    queryKey: ["roles", "portal-labels"],
    enabled: needsRoles,
    retry: false,
    queryFn: () => loadRoleChoices(client),
  });
  const assignments = useQuery({
    queryKey: ["assignments", props.user.id],
    enabled: props.canReadRoles,
    retry: false,
    queryFn: async (): Promise<UserRoleView[]> => {
      const loaded = await loadUserRoles(client, [props.user.id]);
      return loaded[props.user.id] ?? [];
    },
  });
  const current = assignments.data ?? [];
  const roleId = chosenRole ?? current[0]?.roleId ?? "";
  const showSelect = props.canAssign && assignments.isSuccess && roles.isSuccess && (current.length === 0 || props.canRevoke);
  const rolePending = needsRoles && (roles.isLoading || (props.canReadRoles && assignments.isLoading));
  useEffect(() => {
    if (props.canReadRoles && assignments.isError) {
      notifyDanger("No se pudo consultar el rol.");
    }
  }, [props.canReadRoles, assignments.isError]);
  useEffect(() => {
    if (needsRoles && roles.isError) {
      notifyDanger("No se pudieron consultar los roles.");
    }
  }, [needsRoles, roles.isError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = updateSchema.safeParse({
      givenName: field(new FormData(event.currentTarget), "givenName"),
      familyName: field(new FormData(event.currentTarget), "familyName"),
    });
    if (!parsed.success) {
      notifyDanger(parsed.error.issues[0]?.message ?? "Revisa los datos.");
      return;
    }
    if (showSelect && (roles.data?.length ?? 0) > 0 && roleId === "") {
      notifyDanger("Elige un rol.");
      return;
    }
    const body = editableStatus ? { ...parsed.data, status } : parsed.data;
    setPending(true);
    const response = await accessRequest(client, `/api/v1/access/users/${props.user.id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!response.ok) {
      setPending(false);
      notifyDanger(await readApiMessage(response, "No se pudo actualizar el usuario."));
      return;
    }
    if (showSelect && roleId !== "") {
      const roleError = await applyRole(client, props.user.id, current, roleId);
      if (roleError) {
        setPending(false);
        await client.invalidateQueries({ queryKey: ["users"] });
        await client.invalidateQueries({ queryKey: ["user", props.user.id] });
        await client.invalidateQueries({ queryKey: ["assignments", props.user.id] });
        notifyDanger(roleError);
        return;
      }
    }
    setPending(false);
    await client.invalidateQueries({ queryKey: ["users"] });
    await client.invalidateQueries({ queryKey: ["user", props.user.id] });
    await client.invalidateQueries({ queryKey: ["user-roles"] });
    await client.invalidateQueries({ queryKey: ["assignments", props.user.id] });
    props.onClose();
    props.onSaved("Usuario actualizado.");
  }

  const roleNames = current.map((item) => item.name).join(", ");

  return (
    <form className="grid gap-3" noValidate onSubmit={(event) => { void submit(event); }}>
      <Modal.Body className="grid gap-3">
        <p className="text-sm">{props.user.email}</p>
        <TextField name="givenName" defaultValue={props.user.givenName ?? ""} fullWidth>
          <Label>Nombre</Label>
          <Input />
        </TextField>
        <TextField name="familyName" defaultValue={props.user.familyName ?? ""} fullWidth>
          <Label>Apellidos</Label>
          <Input />
        </TextField>
        {rolePending ? <p>Cargando rol…</p> : null}
        {showSelect && roles.data ? (
          <>
            <RoleSelect roles={roles.data} value={roleId} pending={pending} onChange={setChosenRole} />
            {current.length > 1 ? <p>Al guardar se conserva solo el rol elegido.</p> : null}
          </>
        ) : null}
        {!showSelect && props.canReadRoles && assignments.isSuccess ? <p>Rol: {roleNames || "Sin rol"}</p> : null}
        {editableStatus ? (
          <Select aria-label="Estado" selectedKey={status} onSelectionChange={(key) => {
            if (key === "active" || key === "disabled") setStatus(key);
          }}>
            <Label>Estado</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="active" textValue="Activo">Activo</ListBox.Item>
                <ListBox.Item id="disabled" textValue="Deshabilitado">Deshabilitado</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        ) : (
          <p>El estado invitado cambia cuando la persona activa su acceso.</p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="tertiary" onPress={props.onClose}>Cancelar</Button>
        <Button type="submit" isDisabled={pending || rolePending}>Guardar cambios</Button>
      </Modal.Footer>
    </form>
  );
}

function DeleteUserDialog(props: { user: UserItem; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (message: string) => void }) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    const response = await accessRequest(client, `/api/v1/access/users/${props.user.id}`, { method: "DELETE" });
    setPending(false);
    if (!response.ok) {
      notifyDanger(await readApiMessage(response, "No se pudo eliminar el usuario."));
      return;
    }
    await client.invalidateQueries({ queryKey: ["users"] });
    props.onOpenChange(false);
    props.onSaved("Usuario eliminado. Sus sesiones quedan revocadas.");
  }

  return (
    <OverlayDialog
      open={props.open}
      size="sm"
      title="Eliminar usuario"
      onOpenChange={props.onOpenChange}
    >
      <Modal.Body className="grid gap-3">
        <p>Se eliminará de forma lógica a {props.user.email}. Sus sesiones activas se revocan.</p>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="tertiary" onPress={() => props.onOpenChange(false)}>Cancelar</Button>
        <Button type="button" variant="danger" isDisabled={pending} onPress={() => { void remove(); }}>Confirmar eliminación</Button>
      </Modal.Footer>
    </OverlayDialog>
  );
}
