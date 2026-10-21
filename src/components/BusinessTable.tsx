import { createContext, type ReactNode, useContext, useId } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";
import { cn } from "../lib/utils.ts";

// Container breakpoints grow with the number of visible columns, including nested tables.
const layouts = {
  compact: {
    table: "@max-[36rem]/business:block",
    colgroup: "@max-[36rem]/business:hidden",
    header: "@max-[36rem]/business:sr-only",
    body: "@max-[36rem]/business:block",
    row: "@max-[36rem]/business:grid",
    withGutter: "@max-[36rem]/business:grid-cols-[3.5rem_minmax(0,1fr)]",
    withoutGutter: "@max-[36rem]/business:grid-cols-1",
    text: "@max-[36rem]/business:text-left",
    first: "@max-[36rem]/business:col-start-1",
    second: "@max-[36rem]/business:col-start-2",
    title: "@max-[36rem]/business:row-start-1",
    property: "@max-[36rem]/business:grid @max-[36rem]/business:grid-cols-1 @max-[36rem]/business:gap-x-4 @max-[36rem]/business:gap-y-1 @max-[36rem]/business:@min-[16rem]/business-cell:grid-cols-[minmax(5rem,28%)_minmax(0,1fr)]",
    label: "@max-[36rem]/business:block",
    disclosure: "@max-[36rem]/business:col-start-1 @max-[36rem]/business:row-start-1",
    details: "@max-[36rem]/business:pl-2",
    nested: "@max-[36rem]/business:-ml-16",
  },
  regular: {
    table: "@max-[64rem]/business:block",
    colgroup: "@max-[64rem]/business:hidden",
    header: "@max-[64rem]/business:sr-only",
    body: "@max-[64rem]/business:block",
    row: "@max-[64rem]/business:grid",
    withGutter: "@max-[64rem]/business:grid-cols-[3.5rem_minmax(0,1fr)]",
    withoutGutter: "@max-[64rem]/business:grid-cols-1",
    text: "@max-[64rem]/business:text-left",
    first: "@max-[64rem]/business:col-start-1",
    second: "@max-[64rem]/business:col-start-2",
    title: "@max-[64rem]/business:row-start-1",
    property: "@max-[64rem]/business:grid @max-[64rem]/business:grid-cols-1 @max-[64rem]/business:gap-x-4 @max-[64rem]/business:gap-y-1 @max-[64rem]/business:@min-[16rem]/business-cell:grid-cols-[minmax(5rem,28%)_minmax(0,1fr)]",
    label: "@max-[64rem]/business:block",
    disclosure: "@max-[64rem]/business:col-start-1 @max-[64rem]/business:row-start-1",
    details: "@max-[64rem]/business:pl-2",
    nested: "@max-[64rem]/business:-ml-16",
  },
  wide: {
    table: "@max-[128rem]/business:block",
    colgroup: "@max-[128rem]/business:hidden",
    header: "@max-[128rem]/business:sr-only",
    body: "@max-[128rem]/business:block",
    row: "@max-[128rem]/business:grid",
    withGutter: "@max-[128rem]/business:grid-cols-[3.5rem_minmax(0,1fr)]",
    withoutGutter: "@max-[128rem]/business:grid-cols-1",
    text: "@max-[128rem]/business:text-left",
    first: "@max-[128rem]/business:col-start-1",
    second: "@max-[128rem]/business:col-start-2",
    title: "@max-[128rem]/business:row-start-1",
    property: "@max-[128rem]/business:grid @max-[128rem]/business:grid-cols-1 @max-[128rem]/business:gap-x-4 @max-[128rem]/business:gap-y-1 @max-[128rem]/business:@min-[16rem]/business-cell:grid-cols-[minmax(5rem,28%)_minmax(0,1fr)]",
    label: "@max-[128rem]/business:block",
    disclosure: "@max-[128rem]/business:col-start-1 @max-[128rem]/business:row-start-1",
    details: "@max-[128rem]/business:pl-2",
    nested: "@max-[128rem]/business:-ml-16",
  },
  many: {
    table: "@max-[192rem]/business:block",
    colgroup: "@max-[192rem]/business:hidden",
    header: "@max-[192rem]/business:sr-only",
    body: "@max-[192rem]/business:block",
    row: "@max-[192rem]/business:grid",
    withGutter: "@max-[192rem]/business:grid-cols-[3.5rem_minmax(0,1fr)]",
    withoutGutter: "@max-[192rem]/business:grid-cols-1",
    text: "@max-[192rem]/business:text-left",
    first: "@max-[192rem]/business:col-start-1",
    second: "@max-[192rem]/business:col-start-2",
    title: "@max-[192rem]/business:row-start-1",
    property: "@max-[192rem]/business:grid @max-[192rem]/business:grid-cols-1 @max-[192rem]/business:gap-x-4 @max-[192rem]/business:gap-y-1 @max-[192rem]/business:@min-[16rem]/business-cell:grid-cols-[minmax(5rem,28%)_minmax(0,1fr)]",
    label: "@max-[192rem]/business:block",
    disclosure: "@max-[192rem]/business:col-start-1 @max-[192rem]/business:row-start-1",
    details: "@max-[192rem]/business:pl-2",
    nested: "@max-[192rem]/business:-ml-16",
  },
  extensive: {
    table: "@max-[512rem]/business:block",
    colgroup: "@max-[512rem]/business:hidden",
    header: "@max-[512rem]/business:sr-only",
    body: "@max-[512rem]/business:block",
    row: "@max-[512rem]/business:grid",
    withGutter: "@max-[512rem]/business:grid-cols-[3.5rem_minmax(0,1fr)]",
    withoutGutter: "@max-[512rem]/business:grid-cols-1",
    text: "@max-[512rem]/business:text-left",
    first: "@max-[512rem]/business:col-start-1",
    second: "@max-[512rem]/business:col-start-2",
    title: "@max-[512rem]/business:row-start-1",
    property: "@max-[512rem]/business:grid @max-[512rem]/business:grid-cols-1 @max-[512rem]/business:gap-x-4 @max-[512rem]/business:gap-y-1 @max-[512rem]/business:@min-[16rem]/business-cell:grid-cols-[minmax(5rem,28%)_minmax(0,1fr)]",
    label: "@max-[512rem]/business:block",
    disclosure: "@max-[512rem]/business:col-start-1 @max-[512rem]/business:row-start-1",
    details: "@max-[512rem]/business:pl-2",
    nested: "@max-[512rem]/business:-ml-16",
  },
};
type TableLayout = typeof layouts.regular;

// Nested disclosures reuse the 3.5rem gutter and 0.5rem cell inset.
// Repeated indentation would otherwise narrow editors at each level.
const DetailsGutter = createContext(false);
const TableColumns = createContext<{ columns: string[]; numeric: number[]; heading: string; disclosureColumn: boolean; style: TableLayout } | null>(null);

/** One semantic table; narrow containers reflow the same cells without hiding values. */
export function BusinessTable({ columns, numericColumns = [], label, children, disclosureColumn = true }: {
  columns: string[];
  numericColumns?: number[];
  label: string;
  children: ReactNode;
  disclosureColumn?: boolean;
}) {
  const heading = useId();
  const parent = useContext(TableColumns);
  const sharesGutter = useContext(DetailsGutter) && disclosureColumn;
  const style = columns.length <= 3 ? layouts.compact : columns.length <= 7 ? layouts.regular : columns.length <= 12 ? layouts.wide : columns.length <= 20 ? layouts.many : layouts.extensive;
  return (
    <TableColumns.Provider value={{ columns, numeric: numericColumns, heading, disclosureColumn, style }}>
      <DetailsGutter.Provider value={false}>
        <div className={cn("@container/business min-w-0 [&>[data-slot=table-container]]:overflow-visible", sharesGutter && parent?.style.nested)}>
          <Table role="table" aria-label={label} className={cn("table-fixed", style.table)}>
            <colgroup className={style.colgroup}>
              {disclosureColumn && <col className="w-14" />}
              {columns.map((column, index) => <col key={index} className={index === 0 && columns.length > 1 ? "w-2/5" : undefined} />)}
            </colgroup>
            <TableHeader role="rowgroup" className={style.header}>
              <TableRow role="row">
                {disclosureColumn && <TableHead scope="col"><span className="sr-only">펼침</span></TableHead>}
                {columns.map((column, index) => (
                  <TableHead key={index} id={`${heading}-${index}`} scope="col" className={cn("whitespace-normal text-xs font-normal text-muted-foreground", numericColumns.includes(index) && "text-right")}>
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody role="rowgroup" className={style.body}>{children}</TableBody>
          </Table>
        </div>
      </DetailsGutter.Provider>
    </TableColumns.Provider>
  );
}

export function BusinessRow({ children, className, ...props }: React.ComponentProps<typeof TableRow>) {
  const layout = useContext(TableColumns);
  const gutter = layout?.disclosureColumn ?? true;
  const style = layout?.style ?? layouts.regular;
  return <TableRow {...props} role="row" className={cn(style.row, gutter ? style.withGutter : style.withoutGutter, "data-[expanded=true]:border-b-0", className)}>{children}</TableRow>;
}

export function BusinessCell({ index, children, className, ...props }: React.ComponentProps<typeof TableCell> & { index: number }) {
  const layout = useContext(TableColumns);
  const numeric = layout?.numeric.includes(index);
  const style = layout?.style ?? layouts.regular;
  return (
    <TableCell {...props} role="cell" headers={layout ? `${layout.heading}-${index}` : undefined}
      className={cn("min-w-0 whitespace-normal wrap-anywhere", numeric && "text-right tabular-nums", style.text, layout?.disclosureColumn === false ? style.first : style.second, index === 0 && style.title, className)}>
      {index === 0 ? <div className="min-w-0 wrap-anywhere">{children}</div> : <div className="@container/business-cell min-w-0">
        <div className={cn("min-w-0", style.property)}>
          <span aria-hidden="true" className={cn("hidden text-xs text-muted-foreground @min-[16rem]/business-cell:text-sm", style.label)}>{layout?.columns[index]}</span>
          <div className="min-w-0 wrap-anywhere">{children}</div>
        </div>
      </div>}
    </TableCell>
  );
}

export function BusinessDisclosureCell({ children }: { children?: ReactNode }) {
  const layout = useContext(TableColumns);
  const gutter = layout?.disclosureColumn ?? true;
  const style = layout?.style ?? layouts.regular;
  if (!gutter) return null;
  return <TableCell role="cell" className={cn("w-14 px-1 align-top", style.disclosure)}>{children}</TableCell>;
}

export function BusinessDetails({ children, hidden, ...props }: React.ComponentProps<"div">) {
  const layout = useContext(TableColumns);
  const style = layout?.style ?? layouts.regular;
  return (
    <BusinessRow hidden={hidden} className={hidden ? "hidden!" : undefined}>
      <TableCell role="cell" colSpan={(layout?.columns.length ?? 1) + (layout?.disclosureColumn === false ? 0 : 1)} className={cn("whitespace-normal @max-[16rem]/business:pr-0", style.details, layout?.disclosureColumn === false ? style.first : cn("pl-16", style.second))}>
        <DetailsGutter.Provider value={layout?.disclosureColumn !== false}>
          <div {...props} className={cn("flex min-w-0 flex-col gap-4", props.className)}>{children}</div>
        </DetailsGutter.Provider>
      </TableCell>
    </BusinessRow>
  );
}
