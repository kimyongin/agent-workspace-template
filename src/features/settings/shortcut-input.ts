import { type KeyboardEvent, useRef } from "react";

/** Keep composition confirmation within the shortcut's text input. */
export function useShortcutImeGuard() {
  const composing = useRef(false);
  return {
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onBlur: () => {
      composing.current = false;
    },
    onKeyDownCapture: (event: KeyboardEvent<HTMLInputElement>) => {
      if (
        event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}

/** Runs after the choice handles Enter; a query is never an implicit save. */
export function preventShortcutSubmit(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
}
