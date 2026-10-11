import { z } from "zod";
export const requestKey = z.uuid().length(36).transform((value) => value.toLowerCase());
export const requestMeta = { request_key: requestKey };
