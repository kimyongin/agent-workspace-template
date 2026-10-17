export type FixtureScope = {
  ownerId: string;
  ids: {
    entities: string[];
    tasks: string[];
    records: string[];
    tags: string[];
    entity_types: string[];
    entity_issuers?: string[];
    entity_relation_definitions?: string[];
    data_model_changes?: string[];
    entity_identifier_rules?: string[];
  };
  requestKeys: string[];
};
export type FixtureEnvironment = {
  name: string;
  host: string;
  port: number;
  database: string;
};
export function cleanupOwnedFixture(
  databaseUrl: string,
  environment: FixtureEnvironment,
  scope: FixtureScope,
): Promise<
  Array<
    {
      environment: FixtureEnvironment;
      owner_id: string;
      counts: Record<string, number>;
      request_receipts: number;
      residual_rows: number;
    }
  >
>;

export function modelFixtureRoots(
  result: unknown,
): {
  data_model_changes: string[];
  entity_types: string[];
  entity_relation_definitions: string[];
  entity_issuers: string[];
  entity_identifier_rules: string[];
};
