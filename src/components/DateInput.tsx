import { type ComponentProps, useEffect, useRef, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { deferView } from "./DeferredView.tsx";
import { ScrollArea } from "./ui/scroll-area.tsx";

type CalendarProps = Parameters<typeof import("./DateCalendar.tsx").default>[0];
const DateCalendar = deferView<CalendarProps>(() => import("./DateCalendar.tsx"), "달력");

type DateInputProps = Omit<ComponentProps<typeof InputGroupInput>, "type" | "value" | "onChange" | "ref"> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
};

/** Keep raw civil-date drafts in the form; opening the calendar never commits a write. */
export function DateInput({ label, value, onValueChange, disabled, readOnly, ...props }: DateInputProps) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const frozen = disabled || readOnly;
  useEffect(() => {
    if (frozen) setOpen(false);
  }, [frozen]);
  return (
    <Popover
      open={open && !frozen}
      onOpenChange={(next) => {
        if (!frozen) setOpen(next);
      }}
    >
      <InputGroup>
        <InputGroupInput
          {...props}
          ref={input}
          type="text"
          placeholder="YYYY-MM-DD"
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <PopoverTrigger asChild>
            <InputGroupButton size="icon-sm" disabled={frozen} aria-label={`${label} 달력 열기`}>
              <CalendarIcon />
            </InputGroupButton>
          </PopoverTrigger>
        </InputGroupAddon>
      </InputGroup>
      {open && !frozen && (
        <PopoverContent
          aria-label={`${label} 달력`}
          align="start"
          className="w-84 max-w-(--radix-popover-content-available-width) p-0"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <ScrollArea className="max-h-(--radix-popover-content-available-height) [&>[data-slot=scroll-area-viewport]]:max-h-(--radix-popover-content-available-height)">
            <DateCalendar
              value={value}
              onSelect={(next) => {
                if (!frozen) {
                  onValueChange(next);
                  setOpen(false);
                }
              }}
            />
          </ScrollArea>
        </PopoverContent>
      )}
    </Popover>
  );
}
