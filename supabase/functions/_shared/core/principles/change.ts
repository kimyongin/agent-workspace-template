import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { ChangeFacts, ChangeTarget } from "../shared/changes.ts";

export function principleChangeFacts(principle: Pick<PrincipleCreate, "title" | "summary" | "body">): ChangeFacts {
  return { title: principle.title, summary: principle.summary, body: principle.body };
}

export function principleChangeTarget(principle: PrincipleResult): ChangeTarget {
  return { id: principle.id, title: principle.title, entity_ids: [], entity_context: [] };
}
