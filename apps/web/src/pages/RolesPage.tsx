import { Button, Checkbox, CheckboxGroup, Chip, Input, Label, Modal, Table, TextArea, TextField } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";
import { accessRequest, parsePositive, readApiMessage } from "../access/http";
import { notifyDanger, notifySuccess, notifyWarning } from "../shell/notify";
import { OptionsMenu, type MenuOption } from "../shell/options-menu";
import { OverlayDialog } from "../shell/overlay-dialog";

interface ApplicationPage {
  items: Array<{ id: string; code: string; name: string }>;
}

interface RoleItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  system: boolean;
  version?: number;
  permissions?: string[];
}

interface RolePage {
  items: RoleItem[];
  totalItems: number;
  page?: number;
  totalPages?: number;
}

interface PermissionItem {
  code: string;
  resource: string;
  action: string;
  scope: string;
}

const createSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa un código en minúsculas, números y guiones").max(64),
  name: z.string().trim().min(1, "El nombre es obligatorio").max(80),
  description: z.string().trim().max(500, "La descripción admite hasta 500 caracteres"),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(80),
  description: z.string().trim().max(500, "La descripción admite hasta 500 caracteres"),
});

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function sameCodes(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const pending = new Set(right);
  return left.every((code) => pending.has(code));
}

function permissionChoices(catalog: PermissionItem[], selected: readonly string[]): PermissionItem[] {
  const known = new Set(catalog.map((item) => item.code));
  const extra = selected.filter((code) => !known.has(code)).map((code) => ({ code, resource: "", action: "", scope: "" }));
  return [...catalog, ...extra];
}

function PermissionChecklist(props: { items: PermissionItem[]; value: string[]; onChange: (codes: string[]) => void }) {
  return (
    <CheckboxGroup aria-label="Permisos del catálogo" value={props.value} onChange={(next) => props.onChange([...next])}>
      <div className="grid max-h-64 gap-2 overflow-auto">
        {props.items.map((item) => (
          <Checkbox key={item.code} value={item.code}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {item.code}
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
    </CheckboxGroup>
  );
}

export function RolesPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = parsePositive(params.get("page"), 1, 10000);
  const pageSize = parsePositive(params.get("pageSize"), 20, 100);
  const valid = page !== null && pageSize !== null;
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
  const applications = useQuery({
    queryKey: ["applications"],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<ApplicationPage> => {
      const response = await accessRequest(client, "/api/v1/access/applications?page=1&pageSize=20");
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("applications_failed");
      }
      return (await response.json()) as ApplicationPage;
    },
  });
  const portal = applications.data?.items.find((item) => item.code === "portal") ?? applications.data?.items[0];
  const roles = useQuery({
    queryKey: ["roles", portal?.id, page, pageSize],
    enabled: valid && Boolean(portal?.id),
    retry: false,
    queryFn: async (): Promise<RolePage> => {
      const response = await accessRequest(client, `/api/v1/access/applications/${portal?.id}/roles?page=${page}&pageSize=${pageSize}`);
      if (response.status === 403) {
        throw new Error("forbidden");
      }
      if (!response.ok) {
        throw new Error("roles_failed");
      }
      return (await response.json()) as RolePage;
    },
  });
  const forbidden = (applications.error instanceof Error && applications.error.message === "forbidden")
    || (roles.error instanceof Error && roles.error.message === "forbidden");

  function go(next: number) {
    const copy = new URLSearchParams(params);
    copy.set("page", String(next));
    setParams(copy);
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Roles</h1>
        {granted.includes("roles:create") && portal?.id ? (
          <CreateRoleDialog applicationId={portal.id} canReadPermissions={granted.includes("permissions:read")} onSaved={notifySuccess} />
        ) : null}
      </div>
      {!valid ? <p role="alert">Los filtros de la dirección no son válidos.</p> : null}
      {applications.isLoading || roles.isLoading ? <p>Cargando roles…</p> : null}
      {forbidden ? <p role="alert">No tienes permiso para ver roles.</p> : null}
      {applications.isError && !forbidden ? <p role="alert">No se pudieron consultar las aplicaciones.</p> : null}
      {roles.isError && !forbidden ? <p role="alert">No se pudieron consultar los roles.</p> : null}
      {applications.data && !portal ? <p>No hay una aplicación para listar roles.</p> : null}
      {roles.data && roles.data.items.length === 0 ? <p>No hay roles en esta página.</p> : null}
      {roles.data && roles.data.items.length > 0 ? (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Roles">
              <Table.Header>
                <Table.Column isRowHeader id="name">Nombre</Table.Column>
                <Table.Column id="code">Código</Table.Column>
                <Table.Column id="kind">Tipo</Table.Column>
                <Table.Column id="actions">Acciones</Table.Column>
              </Table.Header>
              <Table.Body>
                {roles.data.items.map((item) => (
                  <Table.Row key={item.id} id={item.id}>
                    <Table.Cell>{item.name}</Table.Cell>
                    <Table.Cell>{item.code}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={item.system ? "default" : "accent"}>{item.system ? "Sistema" : "Personalizado"}</Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <RoleActions
                        applicationId={portal?.id ?? ""}
                        role={item}
                        granted={granted}
                        canReadPermissions={granted.includes("permissions:read")}
                        canAssignPermissions={granted.includes("roles:permissions:assign")}
                        onSaved={notifySuccess}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : null}
      {roles.data && typeof roles.data.page === "number" && typeof roles.data.totalPages === "number" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Página {roles.data.page} de {roles.data.totalPages}</p>
          <Button type="button" variant="tertiary" isDisabled={roles.data.page <= 1} onPress={() => go(roles.data.page! - 1)}>Anterior</Button>
          <Button type="button" variant="tertiary" isDisabled={roles.data.page >= roles.data.totalPages} onPress={() => go(roles.data.page! + 1)}>Siguiente</Button>
        </div>
      ) : null}
    </section>
  );
}

function RoleActions(props: {
  applicationId: string;
  role: RoleItem;
  granted: string[];
  canReadPermissions: boolean;
  canAssignPermissions: boolean;
  onSaved: (message: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const options: MenuOption[] = [];
  if (props.granted.includes("roles:update")) {
    options.push({ label: "Editar", disabled: props.role.system, onPress: () => setEdit(true) });
  }
  if (props.granted.includes("roles:delete")) {
    options.push({ label: "Eliminar", danger: true, disabled: props.role.system, onPress: () => setRemove(true) });
  }

  return (
    <>
      <OptionsMenu label={`Opciones de ${props.role.name}`} options={options} />
      {edit && !props.role.system ? (
        <EditRoleDialog
          applicationId={props.applicationId}
          role={props.role}
          open={edit}
          canReadPermissions={props.canReadPermissions}
          canAssignPermissions={props.canAssignPermissions}
          onOpenChange={setEdit}
          onSaved={props.onSaved}
        />
      ) : null}
      {remove && !props.role.system ? (
        <DeleteRoleDialog applicationId={props.applicationId} role={props.role} open={remove} onOpenChange={setRemove} onSaved={props.onSaved} />
      ) : null}
    </>
  );
}

function CreateRoleDialog(props: { applicationId: string; canReadPermissions: boolean; onSaved: (message: string) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const catalog = useQuery({
    queryKey: ["permissions-catalog", props.applicationId],
    enabled: open && props.canReadPermissions,
    retry: false,
    queryFn: async (): Promise<PermissionItem[]> => {
      const items: PermissionItem[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const response = await accessRequest(client, `/api/v1/access/applications/${props.applicationId}/permissions?page=${page}&pageSize=100`);
        if (response.status === 403) {
          throw new Error("forbidden");
        }
        if (!response.ok) {
          throw new Error("permissions_failed");
        }
        const body = (await response.json()) as { items: PermissionItem[]; totalPages: number };
        items.push(...body.items);
        totalPages = body.totalPages;
        page += 1;
      } while (page <= totalPages && page <= 5);
      return items;
    },
  });
  useEffect(() => {
    if (!open) {
      return;
    }
    if (!props.canReadPermissions || (catalog.error instanceof Error && catalog.error.message === "forbidden")) {
      notifyDanger("No tienes permiso para leer el catálogo de permisos.");
      return;
    }
    if (catalog.isError) {
      notifyDanger("No se pudo leer el catálogo de permisos.");
    }
  }, [open, props.canReadPermissions, catalog.isError, catalog.error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createSchema.safeParse({
      code: field(new FormData(event.currentTarget), "code"),
      name: field(new FormData(event.currentTarget), "name"),
      description: field(new FormData(event.currentTarget), "description"),
    });
    if (!parsed.success) {
      notifyDanger(parsed.error.issues[0]?.message ?? "Revisa los datos.");
      return;
    }
    if (codes.length === 0) {
      notifyDanger("Elige al menos un permiso del catálogo.");
      return;
    }
    const body = {
      code: parsed.data.code,
      name: parsed.data.name,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
      permissionCodes: codes,
    };
    setPending(true);
    const response = await accessRequest(client, `/api/v1/access/applications/${props.applicationId}/roles`, { method: "POST", body: JSON.stringify(body) });
    setPending(false);
    if (!response.ok) {
      notifyDanger(await readApiMessage(response, "No se pudo crear el rol."));
      return;
    }
    await client.invalidateQueries({ queryKey: ["roles"] });
    setCodes([]);
    setOpen(false);
    props.onSaved("Rol creado.");
  }

  return (
    <OverlayDialog
      open={open}
      size="lg"
      title="Agregar rol"
      triggerLabel="Agregar rol"
      triggerClassName="button button--md button--primary"
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setCodes([]);
        }
      }}
    >
      <form className="grid gap-3" noValidate onSubmit={(event) => { void submit(event); }}>
        <Modal.Body className="grid gap-3">
          <TextField name="code" fullWidth>
            <Label>Código</Label>
            <Input />
          </TextField>
          <TextField name="name" fullWidth>
            <Label>Nombre</Label>
            <Input />
          </TextField>
          <TextField name="description" fullWidth>
            <Label>Descripción</Label>
            <TextArea />
          </TextField>
          {catalog.isLoading ? <p>Cargando permisos…</p> : null}
          {catalog.data && catalog.data.length === 0 ? <p>El catálogo de permisos está vacío.</p> : null}
          {catalog.data && catalog.data.length > 0 ? <PermissionChecklist items={catalog.data} value={codes} onChange={setCodes} /> : null}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="tertiary" onPress={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" isDisabled={pending || !catalog.data || catalog.data.length === 0}>Crear rol</Button>
        </Modal.Footer>
      </form>
    </OverlayDialog>
  );
}

function EditRoleDialog(props: {
  applicationId: string;
  role: RoleItem;
  open: boolean;
  canReadPermissions: boolean;
  canAssignPermissions: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["role", props.applicationId, props.role.id],
    enabled: props.open && !props.role.system && props.applicationId.length > 0,
    retry: false,
    queryFn: async (): Promise<RoleItem> => {
      const response = await accessRequest(client, `/api/v1/access/applications/${props.applicationId}/roles/${props.role.id}`);
      if (!response.ok) {
        throw new Error("role_failed");
      }
      return (await response.json()) as RoleItem;
    },
  });
  useEffect(() => {
    if (props.open && detail.isError) {
      notifyDanger("No se pudo leer el rol.");
    }
  }, [props.open, detail.isError]);

  return (
    <OverlayDialog open={props.open} size="lg" title="Editar rol" onOpenChange={props.onOpenChange}>
      {detail.isLoading ? <Modal.Body><p>Cargando rol…</p></Modal.Body> : null}
      {detail.data ? (
        <EditRoleForm
          applicationId={props.applicationId}
          role={detail.data}
          canReadPermissions={props.canReadPermissions}
          canAssignPermissions={props.canAssignPermissions}
          onClose={() => props.onOpenChange(false)}
          onSaved={props.onSaved}
        />
      ) : null}
    </OverlayDialog>
  );
}

function EditRoleForm(props: {
  applicationId: string;
  role: RoleItem;
  canReadPermissions: boolean;
  canAssignPermissions: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const client = useQueryClient();
  const current = props.role.permissions ?? [];
  const canEditPermissions = props.canReadPermissions && props.canAssignPermissions;
  const [codes, setCodes] = useState<string[]>(current);
  const [pending, setPending] = useState(false);
  const catalog = useQuery({
    queryKey: ["permissions-catalog", props.applicationId],
    enabled: canEditPermissions,
    retry: false,
    queryFn: async (): Promise<PermissionItem[]> => {
      const items: PermissionItem[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const response = await accessRequest(client, `/api/v1/access/applications/${props.applicationId}/permissions?page=${page}&pageSize=100`);
        if (response.status === 403) {
          throw new Error("forbidden");
        }
        if (!response.ok) {
          throw new Error("permissions_failed");
        }
        const body = (await response.json()) as { items: PermissionItem[]; totalPages: number };
        items.push(...body.items);
        totalPages = body.totalPages;
        page += 1;
      } while (page <= totalPages && page <= 5);
      return items;
    },
  });
  const choices = permissionChoices(catalog.data ?? [], current);
  useEffect(() => {
    if (!canEditPermissions) {
      return;
    }
    if (catalog.error instanceof Error && catalog.error.message === "forbidden") {
      notifyDanger("No tienes permiso para leer el catálogo de permisos.");
      return;
    }
    if (catalog.isError) {
      notifyDanger("No se pudo leer el catálogo de permisos.");
    }
  }, [canEditPermissions, catalog.isError, catalog.error]);
  useEffect(() => {
    if (!props.canAssignPermissions && props.canReadPermissions) {
      notifyWarning("No tienes permiso para cambiar los permisos de este rol.");
    }
  }, [props.canAssignPermissions, props.canReadPermissions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = updateSchema.safeParse({
      name: field(new FormData(event.currentTarget), "name"),
      description: field(new FormData(event.currentTarget), "description"),
    });
    if (!parsed.success) {
      notifyDanger(parsed.error.issues[0]?.message ?? "Revisa los datos.");
      return;
    }
    const permissionsChanged = canEditPermissions && !sameCodes(codes, current);
    if (permissionsChanged && codes.length === 0) {
      notifyDanger("Elige al menos un permiso del catálogo.");
      return;
    }
    if (permissionsChanged && props.role.version === undefined) {
      notifyDanger("No se pudo leer la versión del rol para actualizar sus permisos.");
      return;
    }
    setPending(true);
    const response = await accessRequest(client, `/api/v1/access/applications/${props.applicationId}/roles/${props.role.id}`, {
      method: "PATCH",
      body: JSON.stringify(parsed.data),
    });
    if (!response.ok) {
      setPending(false);
      notifyDanger(await readApiMessage(response, "No se pudo actualizar el rol."));
      return;
    }
    if (permissionsChanged) {
      const replaced = await accessRequest(client, `/api/v1/access/applications/${props.applicationId}/roles/${props.role.id}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ version: props.role.version, permissionCodes: codes }),
      });
      if (!replaced.ok) {
        setPending(false);
        await client.invalidateQueries({ queryKey: ["roles"] });
        await client.invalidateQueries({ queryKey: ["role", props.applicationId, props.role.id] });
        notifyDanger(await readApiMessage(replaced, "El nombre se guardó, pero los permisos no se actualizaron."));
        return;
      }
    }
    setPending(false);
    await client.invalidateQueries({ queryKey: ["roles"] });
    await client.invalidateQueries({ queryKey: ["role", props.applicationId, props.role.id] });
    props.onClose();
    props.onSaved("Rol actualizado.");
  }

  return (
    <form className="grid gap-3" noValidate onSubmit={(event) => { void submit(event); }}>
      <Modal.Body className="grid gap-3">
        <p className="text-sm">Código {props.role.code}</p>
        <TextField name="name" defaultValue={props.role.name} fullWidth>
          <Label>Nombre</Label>
          <Input />
        </TextField>
        <TextField name="description" defaultValue={props.role.description ?? ""} fullWidth>
          <Label>Descripción</Label>
          <TextArea />
        </TextField>
        {canEditPermissions && catalog.isLoading ? <p>Cargando permisos…</p> : null}
        {canEditPermissions && choices.length > 0 ? <PermissionChecklist items={choices} value={codes} onChange={setCodes} /> : null}
        {!canEditPermissions && current.length > 0 ? <p>Permisos: {current.join(", ")}</p> : null}
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="tertiary" onPress={props.onClose}>Cancelar</Button>
        <Button type="submit" isDisabled={pending || (canEditPermissions && catalog.isLoading)}>Guardar cambios</Button>
      </Modal.Footer>
    </form>
  );
}

function DeleteRoleDialog(props: { applicationId: string; role: RoleItem; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (message: string) => void }) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    const response = await accessRequest(client, `/api/v1/access/applications/${props.applicationId}/roles/${props.role.id}`, { method: "DELETE" });
    setPending(false);
    if (!response.ok) {
      notifyDanger(await readApiMessage(response, "No se pudo eliminar el rol."));
      return;
    }
    await client.invalidateQueries({ queryKey: ["roles"] });
    props.onOpenChange(false);
    props.onSaved("Rol eliminado.");
  }

  return (
    <OverlayDialog
      open={props.open}
      size="sm"
      title="Eliminar rol"
      onOpenChange={props.onOpenChange}
    >
      <Modal.Body className="grid gap-3">
        <p>Se eliminará el rol {props.role.name}. Si tiene asignaciones activas, Acceso rechazará la operación.</p>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="tertiary" onPress={() => props.onOpenChange(false)}>Cancelar</Button>
        <Button type="button" variant="danger" isDisabled={pending} onPress={() => { void remove(); }}>Confirmar eliminación</Button>
      </Modal.Footer>
    </OverlayDialog>
  );
}
