import { z } from "zod";
export const requestKey = z.uuid().length(36).transform((value) => value.toLowerCase());
/** Successful keys/results replay for 30 days. After cleanup the same key can execute anew. */
export const requestMeta = { request_key: requestKey };

/** Maximum replay JSON bytes; business-settings input keeps its separate 128 KiB limit. */
export const REQUEST_RESULT_MAX_BYTES = 1_048_576;
