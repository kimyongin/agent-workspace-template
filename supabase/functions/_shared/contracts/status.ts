import { z } from "zod";
import { codePointLength } from "./common.ts";

export const statusInput = z.strictObject({
  timezone: z.string().min(1).max(64).refine((value) => {
    try {
      const canonical = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
      return canonical === "UTC" || canonical.includes("/");
    } catch {
      return false;
    }
  }, "UTC 또는 IANA 시간대 이름을 입력하세요").transform((value) =>
    new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone
  ).default("Asia/Seoul"),
});
export type StatusInput = z.infer<typeof statusInput>;
export interface IndexingCounts {
  indexed: number;
  preparing: number;
  attention: number;
  excluded: number;
}
export interface IndexingWait {
  long_waiting: number;
  oldest_waiting_since: string | null;
  threshold_minutes: number;
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
  indexing: IndexingCounts & { total: number; waiting: IndexingWait };
  daily: StatusDay[];
}
export interface StatusOverview extends StatusData {
  timezone: string;
  queried_at: string;
}

export const indexingIssuesInput = z.strictObject({ cursor: z.string().min(1).max(2000).optional() });
export type IndexingIssuesInput = z.infer<typeof indexingIssuesInput>;
const count = z.number().int().nonnegative();
export const indexingIssue = z.strictObject({
  id: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  title: z.string().refine((value) => codePointLength(value) <= 100),
  reason: z.enum([
    "provider_unknown",
    "invalid_response",
    "configuration",
    "retry_exhausted",
    "input_limit",
    "transient",
  ]),
  attempts: count,
  chunks: z.strictObject({ total: count, succeeded: count, preparing: count, unknown: count, failed: count }),
});
export const indexingIssuesPage = z.strictObject({
  items: z.array(indexingIssue).max(5),
  next_cursor: z.string().nullable(),
});
export type IndexingIssue = z.infer<typeof indexingIssue>;
export type IndexingIssuesPage = z.infer<typeof indexingIssuesPage>;
export const indexingReasonLabels: Record<IndexingIssue["reason"], string> = {
  provider_unknown: "응답 확인 불가",
  invalid_response: "응답 확인 불가",
  configuration: "서비스 설정 오류",
  retry_exhausted: "자동 재시도 중단",
  input_limit: "본문 구간 제한",
  transient: "서비스 응답 확인 필요",
};

export const indexingReasonExplanations: Record<IndexingIssue["reason"], string> = {
  provider_unknown: "서비스 응답을 확인하지 못했습니다. 성공이나 실패로 확정할 수 없습니다.",
  invalid_response: "서비스 응답이 예상한 형식과 맞지 않아 결과를 확인하지 못했습니다.",
  configuration: "색인 서비스의 설정이나 접근 권한을 확인해야 합니다.",
  retry_exhausted: "구간의 자동 전송 시도 한도에 도달해 재시도가 중단되었습니다.",
  input_limit: "더 나누기 어려운 본문 구간이 서비스의 입력 제한을 넘었습니다.",
  transient: "서비스가 일시적으로 요청을 처리하지 못했습니다.",
};
