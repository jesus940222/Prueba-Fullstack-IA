import { toast } from "@heroui/react";

export function notifySuccess(message: string) {
  toast.success(message);
}

export function notifyDanger(message: string) {
  toast.danger(message);
}

export function notifyWarning(message: string) {
  toast.warning(message);
}

export function notifyInfo(message: string) {
  toast.info(message);
}
