import type { PrincipleCreate, PrincipleResult } from "../../contracts/principle.ts";
import type { ChangeFacts, ChangeTarget } from "../shared/changes.ts";

export function principleChangeFacts(principle: Pick<PrincipleCreate, "title" | "body">): ChangeFacts {
  return { title: principle.title, body: principle.body };
}

export function principleChangeTarget(principle: PrincipleResult): ChangeTarget {
  return { id: principle.id, title: principle.title, entity_ids: [], entity_context: [] };
}
