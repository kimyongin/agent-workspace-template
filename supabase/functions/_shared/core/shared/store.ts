export interface Keyset {
  at: string;
  id: string;
}
export interface RequestStore {
  lockRequest(operation: string, requestId: string): Promise<void>;
  findRequest(operation: string, requestId: string): Promise<{ request_hash: string; response: unknown } | null>;
  saveRequest(operation: string, requestId: string, requestHash: string, response: unknown): Promise<void>;
}
export interface IndexJob {
  kind: "task" | "record" | "principle";
  id: string;
  input_hash: string;
}
