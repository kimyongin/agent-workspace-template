import { createContext, type ReactNode, useContext, useId } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";
import { cn } from "../lib/utils.ts";

const TableColumns = createContext<{ columns: string[]; numeric: number[]; heading: string; disclosureColumn: boolean } | null>(null);

/** One semantic table; narrow containers reflow the same cells without hiding values. */
export function BusinessTable({ columns, numericColumns = [], label, children, disclosureColumn = true }: {
  columns: string[];
  numericColumns?: number[];
  label: string;
  children: ReactNode;
  disclosureColumn?: boolean;
}) {
  const heading = useId();
  return (
    <TableColumns.Provider value={{ columns, numeric: numericColumns, heading, disclosureColumn }}>
      <div className="@container/business min-w-0 rounded-lg border [&>[data-slot=table-container]]:overflow-visible">
        <Table role="table" aria-label={label} className="table-fixed @max-[64rem]/business:block">
          <colgroup className="@max-[64rem]/business:hidden">
            {disclosureColumn && <col className="w-14" />}
            {columns.map((column, index) => <col key={index} className={index === 0 && columns.length > 1 ? "w-2/5" : undefined} />)}
          </colgroup>
          <TableHeader role="rowgroup" className="@max-[64rem]/business:sr-only">
            <TableRow role="row">
              {disclosureColumn && <TableHead scope="col"><span className="sr-only">펼침</span></TableHead>}
              {columns.map((column, index) => (
                <TableHead key={index} id={`${heading}-${index}`} scope="col" className={cn("whitespace-normal", numericColumns.includes(index) && "text-right")}>
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup" className="@max-[64rem]/business:block">{children}</TableBody>
        </Table>
      </div>
    </TableColumns.Provider>
  );
}

export function BusinessRow({ children, className, ...props }: React.ComponentProps<typeof TableRow>) {
  const gutter = useContext(TableColumns)?.disclosureColumn ?? true;
  return <TableRow {...props} role="row" className={cn("@max-[64rem]/business:grid", gutter ? "@max-[64rem]/business:grid-cols-[3.5rem_minmax(0,1fr)]" : "@max-[64rem]/business:grid-cols-1", className)}>{children}</TableRow>;
}

export function BusinessCell({ index, children, className, ...props }: React.ComponentProps<typeof TableCell> & { index: number }) {
  const layout = useContext(TableColumns);
  const numeric = layout?.numeric.includes(index);
  return (
    <TableCell {...props} role="cell" headers={layout ? `${layout.heading}-${index}` : undefined}
      className={cn("min-w-0 whitespace-normal wrap-anywhere", numeric && "text-right tabular-nums", "@max-[64rem]/business:text-left", layout?.disclosureColumn === false ? "@max-[64rem]/business:col-start-1" : "@max-[64rem]/business:col-start-2", index === 0
        ? "@max-[64rem]/business:row-start-1"
        : "@max-[64rem]/business:grid @max-[64rem]/business:grid-cols-[minmax(0,7rem)_minmax(0,1fr)] @max-[64rem]/business:gap-x-3 @max-[16rem]/business:grid-cols-1 @max-[16rem]/business:gap-y-1", className)}>
      {index > 0 && <span aria-hidden="true" className="hidden text-muted-foreground @max-[64rem]/business:block">{layout?.columns[index]}</span>}
      <div className="min-w-0 wrap-anywhere">{children}</div>
    </TableCell>
  );
}

export function BusinessDisclosureCell({ children }: { children?: ReactNode }) {
  const gutter = useContext(TableColumns)?.disclosureColumn ?? true;
  if (!gutter) return null;
  return <TableCell role="cell" className="w-14 px-1 align-top @max-[64rem]/business:col-start-1 @max-[64rem]/business:row-start-1">{children}</TableCell>;
}

export function BusinessDetails({ children, hidden, ...props }: React.ComponentProps<"div">) {
  const layout = useContext(TableColumns);
  return (
    <BusinessRow hidden={hidden} className={hidden ? "hidden!" : undefined}>
      <TableCell role="cell" colSpan={(layout?.columns.length ?? 1) + (layout?.disclosureColumn === false ? 0 : 1)} className={cn("whitespace-normal @max-[64rem]/business:pl-2", layout?.disclosureColumn === false ? "@max-[64rem]/business:col-start-1" : "pl-16 @max-[64rem]/business:col-start-2")}>
        <div {...props} className={cn("flex min-w-0 flex-col gap-4", props.className)}>{children}</div>
      </TableCell>
    </BusinessRow>
  );
}
