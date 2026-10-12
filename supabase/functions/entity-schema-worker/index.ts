import { entitySchemaWorker } from "../_shared/adapters/http/entity-schema-worker.ts";
Deno.serve(entitySchemaWorker((name) => Deno.env.get(name)));
