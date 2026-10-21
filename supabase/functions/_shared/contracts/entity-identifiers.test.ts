import { assertEquals, assertThrows } from "@std/assert";
import {
  decodeIdentifierReference,
  decodeIdentifierValue,
  encodeIdentifierReference,
  encodeIdentifierValue,
  identifierFieldSettings,
  identifierRawValue,
  identifierReference,
  identifierValue,
} from "./entity-identifiers.ts";

const kind = "22222222-2222-4222-8222-222222222222";
const type = "11111111-1111-4111-8111-111111111111";

Deno.test("identifier pairs and references preserve the entire original string across fixed UUID segments", () => {
  const raw = "001Ab:/한글%é😀";
  const value = "22222222-2222-4222-8222-222222222222:001Ab:/한글%é😀";
  const reference = "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:001Ab:/한글%é😀";
  assertEquals(encodeIdentifierValue(kind.toUpperCase(), raw), value);
  assertEquals(decodeIdentifierValue(value), { kind_id: kind, raw });
  assertEquals(encodeIdentifierReference(type, kind, raw), reference);
  assertEquals(decodeIdentifierReference(reference), { entity_type_id: type, kind_id: kind, raw });
  assertEquals(identifierValue.parse(value), value);
  assertEquals(identifierReference.parse(reference), reference);
});

Deno.test("identifier limits count raw Unicode code points and never normalize identity", () => {
  const raw = "😀".repeat(200);
  assertEquals(decodeIdentifierValue(encodeIdentifierValue(kind, raw)).raw, raw);
  for (
    const invalid of ["", "a".repeat(201), " leading", "trailing ", "a\n", "a\u0000", "a\u007f", "a\u0085", "\ud800"]
  ) {
    assertEquals(identifierRawValue.safeParse(invalid).success, false);
    assertThrows(() => encodeIdentifierValue(kind, invalid));
  }
  const originals = ["00123", "123", "Ab", "ab", "é", "e\u0301", ":", "/", "%"];
  const keys = originals.map((raw) => encodeIdentifierReference(type, kind, raw));
  assertEquals(new Set(keys).size, originals.length);
  assertEquals(keys.map((key) => decodeIdentifierReference(key).raw), originals);
});

Deno.test("identifier readers reject noncanonical and former source references", () => {
  for (const invalid of [`${kind}raw`, `${kind}:`, "source:raw"]) {
    assertEquals(identifierValue.safeParse(invalid).success, false);
  }
  const alphaKind = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assertThrows(() => decodeIdentifierValue(`${alphaKind.toUpperCase()}:raw`));
  for (const invalid of [`source:${type}:raw`, `${type}:${kind}:`, `${type}:${kind}raw`]) {
    assertEquals(identifierReference.safeParse(invalid).success, false);
    assertThrows(() => decodeIdentifierReference(invalid));
  }
});

Deno.test("identifier settings require a nonempty distinct kind set and a permitted default", () => {
  const other = "33333333-3333-4333-8333-333333333333";
  for (
    const settings of [
      { allowed_kind_ids: [], default_kind_id: kind },
      { allowed_kind_ids: [kind, kind], default_kind_id: kind },
      { allowed_kind_ids: [kind], default_kind_id: other },
    ]
  ) assertEquals(identifierFieldSettings.safeParse(settings).success, false);
  assertEquals(identifierFieldSettings.parse({ allowed_kind_ids: [kind, other], default_kind_id: other }), {
    allowed_kind_ids: [kind, other],
    default_kind_id: other,
  });
});
