import { z } from "zod";
import { taskCreate, taskUpdate } from "./task.ts";
import { expectedVersion, id, isoDate } from "./common.ts";
const version = z.strictObject({ expected_version: expectedVersion });
export const taskChangePreview = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), input: taskCreate }),
  z.strictObject({ action: z.literal("update"), id, input: taskUpdate }),
  z.strictObject({ action: z.literal("delete"), id, input: version }),
  z.strictObject({ action: z.literal("stop"), id, input: version }),
  z.strictObject({ action: z.literal("resume"), id, input: version }),
  z.strictObject({ action: z.literal("complete"), id, input: version }),
  z.strictObject({ action: z.literal("occurrence"), id, date: isoDate, input: version }),
]);
export type TaskChangePreview = z.infer<typeof taskChangePreview>;
