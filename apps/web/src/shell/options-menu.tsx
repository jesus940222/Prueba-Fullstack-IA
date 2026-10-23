import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

export interface MenuOption {
  label: string;
  to?: string;
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function OptionsMenu(props: { label: string; title?: string; options: MenuOption[] }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  if (props.options.length === 0) {
    return null;
  }

  return (
    <div className="options-anchor" ref={anchorRef}>
      <button
        type="button"
        className="options-trigger"
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="3.2" r="1.35" fill="currentColor" />
          <circle cx="8" cy="8" r="1.35" fill="currentColor" />
          <circle cx="8" cy="12.8" r="1.35" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <OptionsPopover
          anchorRef={anchorRef}
          menuRef={menuRef}
          title={props.title ?? "Opciones"}
          options={props.options}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function OptionsPopover(props: {
  anchorRef: RefObject<HTMLDivElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  title: string;
  options: MenuOption[];
  onClose: () => void;
}) {
  useLayoutEffect(() => {
    const anchor = props.anchorRef.current;
    const menu = props.menuRef.current;
    if (!anchor || !menu) {
      return;
    }
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const gap = 4;
      let top = rect.bottom + gap;
      let left = rect.right - width;
      if (left < 8) {
        left = 8;
      }
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - height - gap);
      }
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [props.anchorRef, props.menuRef]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (props.anchorRef.current?.contains(target) || props.menuRef.current?.contains(target)) {
        return;
      }
      props.onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        props.onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [props]);

  return createPortal(
    <div ref={props.menuRef} className="options-popover" role="menu" aria-label={props.title}>
      {props.options.map((option) =>
        option.to ? (
          <Link key={option.label} className="options-item" role="menuitem" to={option.to} onClick={props.onClose}>
            {option.label}
          </Link>
        ) : (
          <button
            key={option.label}
            type="button"
            className={option.danger ? "options-item is-danger" : "options-item"}
            role="menuitem"
            disabled={option.disabled}
            aria-disabled={option.disabled ? "true" : undefined}
            onClick={() => {
              props.onClose();
              option.onPress?.();
            }}
          >
            {option.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
