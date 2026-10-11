import { z } from "zod";

export const statusInput = z.strictObject({
  timezone: z.string().min(1).max(64).refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "지원하는 시간대를 입력하세요").default("Asia/Seoul"),
});
export type StatusInput = z.infer<typeof statusInput>;
export interface IndexingCounts {
  indexed: number;
  preparing: number;
  attention: number;
  excluded: number;
}
export interface StatusDay {
  date: string;
  entities_created: number;
  tasks_created: number;
  once_completed: number;
  records_created: number;
  indexing: IndexingCounts;
}
export interface StatusData {
  period: { from: string; to: string; days: number };
  entities: { total: number; active: number; deleted: number };
  tasks: { total: number; open: number; done: number; active: number; stopped: number };
  records: { total: number; user: number; result: number; change: number };
  indexing: IndexingCounts & { total: number };
  daily: StatusDay[];
}
export interface StatusOverview extends StatusData {
  timezone: string;
  queried_at: string;
}
