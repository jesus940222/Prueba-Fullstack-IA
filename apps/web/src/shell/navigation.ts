import { create } from "zustand";

interface NavigationState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const ADMIN_PATH = /^\/(usuarios|roles|catalogo|auditoria|ia|salud)(\/|$)/;

export function isAdminPath(pathname: string): boolean {
  return ADMIN_PATH.test(pathname);
}

export const useNavigation = create<NavigationState>((set) => ({
  open: false,
  toggle: () => set((state) => ({ open: !state.open })),
  close: () => set({ open: false }),
}));
