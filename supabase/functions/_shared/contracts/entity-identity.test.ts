import { assertEquals } from "@std/assert";
import { entityIdentityLabel, entityReferenceId } from "./entity-identity.ts";
import { encodeIdentifierReference } from "./entity-identifiers.ts";
Deno.test("References accept kind UUID keys and reject retired source keys", () => {
  const id = encodeIdentifierReference(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "001A:B/한글_%",
  );
  assertEquals(entityReferenceId.safeParse(id).success, true);
  assertEquals(entityReferenceId.safeParse("crm:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:001").success, false);
  assertEquals(entityIdentityLabel({ id, identity_label: "CRM · 상품 · 001" }), "CRM · 상품 · 001");
});
