import { InputGroup } from "@/components/ui/input-group";

import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { memoFragment, memoText, type MemoVariable } from "./template-memo-document.ts";

export type TemplateMemoHandle = { insert: (variable: string) => void; focus: () => void };

/** One native editable surface: plain text plus noneditable, canonically bound variable chips. */
export function TemplateMemoEditor({ value, variables, onChange, readOnly, disabled, editorRef, ...field }: {
  value: string;
  variables: MemoVariable[];
  onChange: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  editorRef?: Ref<TemplateMemoHandle>;
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null), selection = useRef<Range | null>(null), composing = useRef(false);
  const labelKey = JSON.stringify(variables);
  const previousLabels = useRef(labelKey);
  const remember = () => {
    const current = window.getSelection();
    if (
      current?.rangeCount && element.current?.contains(current.anchorNode) &&
      element.current.contains(current.focusNode)
    ) {
      selection.current = current.getRangeAt(0).cloneRange();
      return true;
    }
    return false;
  };
  useEffect(() => {
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);
  useEffect(() => {
    const label = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    const focus = () => {
      if (!disabled) element.current?.focus();
    };
    label?.addEventListener("click", focus);
    return () => label?.removeEventListener("click", focus);
  }, [field.id, disabled]);
  useEffect(() => {
    const root = element.current;
    const plainInput = (event: InputEvent) => {
      if (
        event.inputType.startsWith("format") ||
        ["insertOrderedList", "insertUnorderedList", "insertLink"].includes(event.inputType)
      ) {
        event.preventDefault();
      }
    };
    root?.addEventListener("beforeinput", plainInput);
    return () => root?.removeEventListener("beforeinput", plainInput);
  }, []);
  useLayoutEffect(() => {
    const root = element.current;
    if (!root || composing.current) return;
    if (memoText(root) !== value || previousLabels.current !== labelKey) {
      root.replaceChildren(memoFragment(value, variables));
      selection.current = null;
    }
    previousLabels.current = labelKey;
  }, [value, labelKey]);
  const freezeTokens = () => {
    const root = element.current;
    if (!root) return;
    const current = window.getSelection(), anchor = current?.anchorNode;
    const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
    const token = parent?.closest<HTMLElement>("[data-memo-token]");
    root.querySelectorAll<HTMLElement>("[data-memo-token]").forEach((item) => {
      item.contentEditable = "false";
    });
    // Native insertion/redo can leave the caret inside the now-frozen label text.
    // Continue typing in the surrounding editor, without adding sentinel characters.
    if (current?.isCollapsed && token && root.contains(token)) {
      const range = document.createRange();
      range.setStartAfter(token);
      range.collapse(true);
      current.removeAllRanges();
      current.addRange(range);
      selection.current = range.cloneRange();
    }
  };
  const changed = () => {
    // Native redo can recreate the editable insertion snapshot; freeze after its transaction.
    queueMicrotask(freezeTokens);
    remember();
    if (!composing.current && element.current) onChange(memoText(element.current));
  };
  const insert = (memo: string) => {
    const root = element.current;
    if (!root || readOnly || disabled) return;
    root.focus();
    let range = selection.current;
    if (!range || !root.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    const current = window.getSelection();
    current?.removeAllRanges();
    current?.addRange(range);
    // Native editing commands preserve the browser's undo transaction and IME history.
    // HTML is produced only by our text-node/token builder, never from clipboard HTML.
    const container = document.createElement("div");
    container.append(memoFragment(memo, variables));
    // WebKit excludes already-noneditable inserted spans from its undo transaction.
    // Insert editable nodes first, then freeze their labels after the native transaction.
    container.querySelectorAll<HTMLElement>("[data-memo-token]").forEach((token) => {
      token.contentEditable = "true";
    });
    document.execCommand("insertHTML", false, container.innerHTML);
    freezeTokens();
    remember();
    changed();
  };
  useImperativeHandle(
    editorRef,
    () => ({ insert: (variable) => insert(`$${variable}$`), focus: () => element.current?.focus() }),
  );
  return (
    <InputGroup className="h-auto">
    <div
      {...field}
      ref={element}
      data-slot="input-group-control"
      className="min-h-32 w-full min-w-0 whitespace-pre-wrap px-3 py-2 outline-none [overflow-wrap:anywhere]"
      role="textbox"
      aria-label="메모 템플릿"
      aria-multiline="true"
      aria-readonly={readOnly || undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      contentEditable={!readOnly && !disabled}
      suppressContentEditableWarning
      onInput={changed}
      onDrop={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && ["b", "i", "u"].includes(event.key.toLowerCase())) {
          event.preventDefault();
        }
      }}
      onBlur={remember}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        changed();
      }}
      onPaste={(event) => {
        event.preventDefault();
        insert(event.clipboardData.getData("text/plain"));
      }}
      onCopy={(event) => {
        if (!remember() || !selection.current || selection.current.collapsed) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", memoText(selection.current.cloneContents()));
      }}
      onCut={(event) => {
        if (readOnly || disabled || !remember() || !selection.current || selection.current.collapsed) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", memoText(selection.current.cloneContents()));
        document.execCommand("delete");
        changed();
      }}
    />
    </InputGroup>
  );
}
