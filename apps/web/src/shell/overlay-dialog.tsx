import { Modal } from "@heroui/react";
import type { ReactNode } from "react";

type DialogSize = "sm" | "md" | "lg";

export function OverlayDialog(props: {
  open: boolean;
  title: string;
  size?: DialogSize;
  triggerLabel?: string;
  triggerClassName?: string;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Modal isOpen={props.open} onOpenChange={props.onOpenChange}>
      {props.triggerLabel ? <Modal.Trigger className={props.triggerClassName}>{props.triggerLabel}</Modal.Trigger> : null}
      <Modal.Backdrop>
        <Modal.Container size={props.size ?? "md"} scroll="inside">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{props.title}</Modal.Heading>
            </Modal.Header>
            {props.children}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
