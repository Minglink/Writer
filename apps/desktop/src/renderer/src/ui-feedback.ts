import { readonly, shallowRef } from "vue";

export type UiMessageKind = "success" | "error" | "warning" | "info";

export interface UiMessageAction {
  label: string;
  run: () => void;
}

export interface UiMessageItem {
  id: number;
  kind: UiMessageKind;
  content: string;
  action?: UiMessageAction;
}

export interface UiMessageOptions {
  duration?: number;
  action?: UiMessageAction;
}

const DEFAULT_DURATION_MS = 3_200;
const MAX_VISIBLE_MESSAGES = 3;
const items = shallowRef<UiMessageItem[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let messageId = 0;

function remove(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  if (items.value.some((item) => item.id === id)) {
    items.value = items.value.filter((item) => item.id !== id);
  }
}

function show(
  kind: UiMessageKind,
  content: string,
  options: UiMessageOptions = {}
): number {
  const normalized = String(content).trim();
  if (!normalized) return -1;
  const { action } = options;
  const duration = Math.max(0, options.duration ?? DEFAULT_DURATION_MS);
  if (!action) {
    const existing = items.value.find(
      (item) =>
        item.kind === kind && item.content === normalized && !item.action
    );
    if (existing) {
      const timer = timers.get(existing.id);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(existing.id);
      if (duration > 0) {
        timers.set(
          existing.id,
          setTimeout(() => remove(existing.id), duration)
        );
      }
      return existing.id;
    }
  }
  const id = ++messageId;
  const overflow = Math.max(0, items.value.length + 1 - MAX_VISIBLE_MESSAGES);
  items.value.slice(0, overflow).forEach((item) => remove(item.id));
  items.value = [
    ...items.value,
    { id, kind, content: normalized, ...(action && { action }) }
  ];
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => remove(id), duration)
    );
  }
  return id;
}

export const uiMessageItems = readonly(items);
export const dismissUiMessage = remove;
export const uiMessage = {
  success: (content: string, options?: UiMessageOptions) =>
    show("success", content, options),
  error: (content: string, options?: UiMessageOptions) =>
    show("error", content, options),
  warning: (content: string, options?: UiMessageOptions) =>
    show("warning", content, options),
  info: (content: string, options?: UiMessageOptions) =>
    show("info", content, options)
};
