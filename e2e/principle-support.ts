import type { mcpClient } from "./support.ts";

/** Current is account-wide: integration runs must exclusively own their fixture account. */
export async function savePrinciple(mcp: Awaited<ReturnType<typeof mcpClient>>, text: {title:string;body?:string;change_note?:string}) {
  const {current}=await mcp.call("get_current_principle",{});
  return mcp.call(current ? "update_principle" : "create_principle",{...text,body:text.body??"",
    ...(current?{id:current.id,expected_version:current.version,change_note:text.change_note??"통합 검증용 새 판단 기준"}:{id:crypto.randomUUID()})});
}
