export interface Keyset {
  at: string;
  id: string;
}
export interface IndexJob {
  kind: "task" | "record" | "principle";
  id: string;
  input_hash: string;
}
