import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { TagsIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useSurfaceViewport } from "../../components/ConfirmDialog.tsx";
import { registerSurface } from "../../lib/surface-dom.ts";

/** Selection belongs to the parent's draft; closing the chooser never saves it. */
export function TagSelection(
  { label, tags, value, onChange, error, status, excludeId, maxSelected = 10, disabled = false }: {
    label: string;
    tags: { id: string; name: string }[] | null;
    value: string[];
    onChange: (ids: string[]) => void;
    error?: string;
    status?: ReactNode;
    excludeId?: string;
    maxSelected?: number;
    disabled?: boolean;
  },
) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const knownNames = useRef(new Map<string, string>());
  if (tags !== null) knownNames.current = new Map(tags.map((tag) => [tag.id, tag.name]));
  const [open, setOpen] = useState(false);
  const focusTrigger = () => {
    const control = trigger.current;
    const destination = control?.disabled
      ? control.closest<HTMLElement>('section[tabindex], [role="region"][tabindex]')
      : control;
    destination?.focus();
  };
  return (
    <FieldSet
      disabled={disabled}
      aria-labelledby={id}
      aria-describedby={error ? `${id}-error` : undefined}
      className="min-w-0"
    >
      <FieldLegend id={id}>{label}</FieldLegend>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          ref={trigger}
          variant="outline"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-label="태그 선택"
          onClick={() => setOpen(true)}
        >
          <TagsIcon data-icon="inline-start" />태그 선택
        </Button>
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            aria-label="모든 태그 선택 해제"
            onClick={() => {
              onChange([]);
              focusTrigger();
            }}
          >
            전체 해제
          </Button>
        )}
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      {status}
      {value.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-2" aria-label="선택한 태그">
          {value.map((selected, index) => {
            const name = knownNames.current.get(selected);
            return (
              <Badge key={selected} variant="secondary" className="h-auto max-w-full gap-1 whitespace-normal">
                <span className="min-w-0 wrap-anywhere">{name ?? "태그 확인 필요"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  aria-pressed="true"
                  aria-label={name ? `${name} 선택 해제` : `이름 확인이 필요한 태그 ${index + 1} 선택 해제`}
                  onClick={() => {
                    onChange(value.filter((item) => item !== selected));
                    focusTrigger();
                  }}
                >
                  <XIcon />
                </Button>
              </Badge>
            );
          })}
        </div>
      )}
      <TagPickerDialog
        open={open}
        onOpenChange={setOpen}
        label={label}
        onClosed={focusTrigger}
        tags={tags}
        value={value}
        onChange={onChange}
        status={status}
        excludeId={excludeId}
        maxSelected={maxSelected}
        disabled={disabled}
      />
    </FieldSet>
  );
}

function TagPickerDialog(
  { open, onOpenChange, label, onClosed, tags, value, onChange, status, excludeId, maxSelected, disabled }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    label: string;
    onClosed: () => void;
    tags: { id: string; name: string }[] | null;
    value: string[];
    onChange: (ids: string[]) => void;
    status?: ReactNode;
    excludeId?: string;
    maxSelected: number;
    disabled: boolean;
  },
) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  viewportRef.current = element;
  useSurfaceViewport(viewportRef, element);
  const heading = useRef<HTMLHeadingElement>(null),
    footer = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  useLayoutEffect(() => {
    if (!open || !element) return;
    setSearch("");
    return registerSurface(
      element,
      () => ({
        title: `${label} 선택`,
        body: element,
        heading: heading.current,
        footer: footer.current,
        active: open,
        modal: true,
        confirmation: true,
        ready: true,
      }),
    );
  }, [open, label, element]);
  const choices = (tags ?? []).filter((tag) =>
    tag.id !== excludeId && tag.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && disabled) return;
        if (next) setSearch("");
        onOpenChange(next);
      }}
    >
      <DialogContent
        ref={setElement}
        aria-modal={true}
        style={{
          maxHeight: "calc(var(--surface-height, 100dvh) - 1rem)",
          top: "calc(var(--surface-top, 0px) + var(--surface-height, 100dvh) / 2)",
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="flex min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="min-h-0 overflow-y-auto overscroll-contain p-4">
          <DialogTitle ref={heading}>{label} 선택</DialogTitle>
          <DialogDescription>태그를 선택한 뒤 완료하세요. 실제 저장은 원래 화면에서 진행합니다.</DialogDescription>
          {maxSelected > 1 && value.length >= maxSelected && (
            <p role="status" className="text-sm text-muted-foreground">
              태그는 최대 {maxSelected}개까지 선택할 수 있습니다.
            </p>
          )}
        </DialogHeader>
        <Command
          className="mx-4 mb-4 min-h-24 w-auto flex-1"
          shouldFilter={false}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
          }}
        >
          <CommandInput
            aria-label="태그 이름 검색"
            placeholder="태그 이름 검색"
            value={search}
            onValueChange={setSearch}
            disabled={disabled}
          />
          {status && <FieldSet disabled={disabled}>{status}</FieldSet>}
          <CommandList className="min-h-12" aria-label="태그 목록" aria-multiselectable={maxSelected !== 1}>
            {tags !== null && (
              <CommandEmpty>
                {search.trim()
                  ? "일치하는 태그가 없습니다."
                  : tags?.length === 0
                  ? "태그 관리에서 태그를 먼저 추가하세요."
                  : "선택할 수 있는 태그가 없습니다."}
              </CommandEmpty>
            )}
            <CommandGroup>
              {choices.map((tag) => {
                const selected = value.includes(tag.id);
                return (
                  <CommandItem
                    className="min-h-[max(44px,2.75rem)]"
                    key={tag.id}
                    value={tag.id}
                    keywords={[tag.name]}
                    aria-label={tag.name}
                    aria-checked={selected}
                    data-checked={selected}
                    disabled={disabled || (!selected && maxSelected !== 1 && value.length >= maxSelected)}
                    onSelect={() =>
                      onChange(
                        selected
                          ? value.filter((id) => id !== tag.id)
                          : maxSelected === 1
                          ? [tag.id]
                          : [...value, tag.id],
                      )}
                  >
                    <span className="min-w-0 wrap-anywhere">{tag.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <DialogFooter ref={footer} className="m-0 shrink-0 flex-row flex-wrap items-center">
          <span role="status" className="mr-auto text-sm text-muted-foreground">{value.length}개 선택</span>
          <DialogClose asChild>
            <Button type="button" variant="outline" aria-label="닫기">닫기</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button">선택 완료</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
