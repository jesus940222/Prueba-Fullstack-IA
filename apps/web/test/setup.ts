import { Toast, toast } from "@heroui/react";
import { act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverStub });

const toastRegion = document.createElement("div");
document.body.appendChild(toastRegion);
act(() => {
  createRoot(toastRegion).render(createElement(Toast.Provider, { placement: "top end" }));
});

afterEach(() => {
  act(() => {
    toast.clear();
  });
});
