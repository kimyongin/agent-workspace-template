import { type ComponentProps, useId } from "react";
import { DateInput } from "./DateInput.tsx";
import { Input } from "./ui/input.tsx";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "./ui/field.tsx";

export interface DateTimeDraft {
  date: string;
  time: string;
}

type DateTimeInputProps = Omit<ComponentProps<typeof DateInput>, "value" | "onValueChange"> & {
  value: DateTimeDraft;
  onValueChange: (value: DateTimeDraft) => void;
};

/** Both raw parts belong to the parent draft, including incomplete and invalid input. */
export function DateTimeInput({ label, value, onValueChange, id: suppliedId, ...props }: DateTimeInputProps) {
  const fallbackId = useId();
  const id = suppliedId ?? fallbackId;
  return (
    <FieldSet className="@container min-w-0">
      <FieldLegend className="sr-only">{label}</FieldLegend>
      <FieldGroup className="grid min-w-0 gap-2 @min-[24rem]:grid-cols-2">
        <Field data-invalid={!!props["aria-invalid"]} data-disabled={props.disabled}>
          <FieldLabel htmlFor={id}>날짜</FieldLabel>
          <DateInput
            {...props}
            id={id}
            label={`${label} 날짜`}
            aria-label={`${label} 날짜`}
            value={value.date}
            onValueChange={(date) => onValueChange({ ...value, date })}
          />
        </Field>
        <Field data-invalid={!!props["aria-invalid"]} data-disabled={props.disabled}>
          <FieldLabel htmlFor={`${id}-time`}>시간</FieldLabel>
          <Input
            {...props}
            id={`${id}-time`}
            aria-label={`${label} 시간`}
            type="time"
            value={value.time}
            onChange={(event) => onValueChange({ ...value, time: event.target.value })}
          />
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
