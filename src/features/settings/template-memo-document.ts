import { badgeVariants } from "@/components/ui/badge";
import { cn } from "../../lib/utils.ts";
/** Display labels never participate in the persisted template grammar. */
export type MemoVariable = { value: string; label: string };
export type MemoPart = { text: string; variable?: MemoVariable };

/** Unknown/incomplete syntax and literal dollar escapes remain exact editable text. */
export function memoDocument(memo: string, variables: MemoVariable[]): MemoPart[] {
  const known = new Map(variables.map((variable) => [variable.value, variable]));
  const parts: MemoPart[] = [];
  let from = 0;
  for (const match of memo.matchAll(/\$\{([^$]*?)\$\}|\$\$|\$([^$]*?)\$/g)) {
    const variable = known.get(match[1] ?? match[2]);
    if (!variable) continue;
    if (match.index! > from) parts.push({ text: memo.slice(from, match.index) });
    parts.push({ text: match[0], variable });
    from = match.index! + match[0].length;
  }
  if (from < memo.length) parts.push({ text: memo.slice(from) });
  return parts;
}

/** DOM carries canonical token text separately from its arbitrary, possibly duplicate label. */
export function memoText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return "";
  if (node instanceof HTMLElement && node.dataset.memoToken !== undefined) return node.dataset.memoToken;
  if (node instanceof HTMLBRElement) return "\n";
  const children = Array.from(node.childNodes);
  // A single BR inside a browser-created block is the empty-line caret placeholder.
  if (
    node instanceof HTMLElement && /^(DIV|P)$/.test(node.tagName) && children.length === 1 &&
    children[0] instanceof HTMLBRElement
  ) return "";
  return children.map((child, index) => {
    const block = child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName);
    const previous = children[index - 1];
    const followsBlock = previous instanceof HTMLElement && /^(DIV|P)$/.test(previous.tagName);
    return (index && (block || followsBlock) ? "\n" : "") + memoText(child);
  }).join("");
}

export function memoFragment(memo: string, variables: MemoVariable[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const part of memoDocument(memo, variables)) {
    if (!part.variable) fragment.append(document.createTextNode(part.text));
    else {
      const token = document.createElement("span");
      token.className = cn(badgeVariants({ variant: "secondary" }), "h-auto max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]");
      token.dataset.slot = "badge";
      token.dataset.variant = "secondary";
      token.contentEditable = "false";
      token.dataset.memoToken = part.text;
      token.setAttribute("aria-label", `변수: ${part.variable.label}`);
      token.textContent = part.variable.label;
      fragment.append(token);
    }
  }
  return fragment;
}
