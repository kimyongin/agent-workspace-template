import { type SelectHTMLAttributes, useMemo } from "react";
import { browserTimezone, timezoneOptions } from "../lib/timezone.ts";

/** Keep the stored IANA value while showing a recognizable time-zone name. */
export function TimezoneSelect(
  { deviceDefault = false, ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
    value: string;
    deviceDefault?: boolean;
  },
) {
  const options = useMemo(() =>
    timezoneOptions(props.value || null).map((zone) => {
      let label = zone;
      try {
        const name = new Intl.DateTimeFormat("ko-KR", { timeZone: zone, timeZoneName: "longGeneric" })
          .formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
        if (name) label = `${name} · ${zone}`;
      } catch { /* Retain an unfamiliar stored value so validation can report it. */ }
      return { zone, label };
    }), [props.value]);
  return (
    <select {...props} className={props.className ?? "input"}>
      {deviceDefault && <option value="">기기 시간대 사용 ({browserTimezone()})</option>}
      {options.map((option) => <option key={option.zone} value={option.zone}>{option.label}</option>)}
    </select>
  );
}
