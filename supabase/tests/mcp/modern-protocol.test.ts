// Pin the new wire revision: a successful legacy initialize must never satisfy this contract.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp } from "../http/_workspace-activity-fixture.ts";
import { MCP_URL } from "./_mcp.ts";
import { parse as parseToml } from "smol-toml";

const REVISION = "2026-07-28";
const VERSION = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const SERVER = "io.modelcontextprotocol/serverInfo";

// deno-lint-ignore no-explicit-any
type Json = any;

async function responseBody(response: Response): Promise<Json> {
  const text = await response.text();
  if (!text) return null;
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return JSON.parse(text);
  const messages = text.split(/\r?\n/).filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
  return messages.findLast((message) => "result" in message || "error" in message);
}

async function rpc(
  token: string | null,
  method: string,
  input: Json = {},
  headers: Record<string, string> = {},
) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": REVISION,
      "Mcp-Method": method,
      ...(input.name ? { "Mcp-Name": input.name } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: { _meta: { [VERSION]: REVISION, [CAPABILITIES]: {} }, ...input },
    }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, headers: response.headers, body: await responseBody(response) };
}

activityWorkspaceSuite(
  "2026-07-28 real OAuth MCP discovery, wire validation, writes, replay and workspace isolation",
  async ({ A, B, workspaceA, workspaceB, mcpTokenA, mcpTokenB, clientA }, context) => {
    assert(mcpTokenA && mcpTokenB && clientA);
    const clients: Client[] = [];
    const requests: { method: string; version: string | null; name: string | null; meta: Json }[] = [];
    const modern = async (token: string) => {
      const client = new Client({ name: "workspace-modern-contract", version: "0.0.0" }, {
        versionNegotiation: { mode: { pin: REVISION } },
      });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(MCP_URL), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
          fetch: async (input, init) => {
            const request = new Request(input, init);
            if (request.method === "POST") {
              const body = await request.clone().json();
              requests.push({
                method: body.method,
                version: request.headers.get("MCP-Protocol-Version"),
                name: request.headers.get("Mcp-Name"),
                meta: body.params?._meta,
              });
            }
            return fetch(request);
          },
        }),
      );
      assertEquals(client.getNegotiatedProtocolVersion(), REVISION);
      assertEquals(client.getProtocolEra(), "modern");
      return client;
    };
    try {
      await context.step("OAuth metadata and audience reject anonymous, forged and web tokens", async () => {
        for (const token of [null, "invalid-token", A]) {
          const denied = await rpc(token, "server/discover");
          assertEquals(denied.status, 401);
          assert(denied.headers.get("www-authenticate")?.includes("resource_metadata="));
        }
      });

      const client = await modern(mcpTokenA);
      await context.step("discovery and list return modern result and private cache metadata", async () => {
        const discovery = await rpc(mcpTokenA, "server/discover");
        assertEquals(discovery.status, 200);
        assertEquals(discovery.body.result.supportedVersions, [REVISION]);
        assertEquals(discovery.body.result.resultType, "complete");
        assertEquals(discovery.body.result._meta[SERVER].name, "workspace");
        assert(discovery.body.result.capabilities.tools);
        const first = await rpc(mcpTokenA, "tools/list");
        const second = await rpc(mcpTokenA, "tools/list");
        assertEquals(first.status, 200);
        assertEquals(first.body.result.resultType, "complete");
        assertEquals(first.body.result.cacheScope, "private");
        assert(Number.isInteger(first.body.result.ttlMs) && first.body.result.ttlMs >= 0);
        const names = first.body.result.tools.map((tool: Json) => tool.name);
        assertEquals(names, second.body.result.tools.map((tool: Json) => tool.name));
        assertEquals(names.length, new Set(names).size);
        assert(names.includes("create_task") && names.includes("get_task"));
        const legacy = await clientA.listTools();
        assertEquals(names, legacy.tools.map((tool) => tool.name));
        assertEquals(first.headers.get("mcp-session-id"), null);
        console.info(JSON.stringify({ modern_protocol: REVISION, tools: names.length, cacheScope: "private" }));
      });

      let created: Json;
      const requestKey = crypto.randomUUID();
      const input = { kind: "once", title: `modern-contract-${crypto.randomUUID()}` };
      await context.step("real tool write, HTTP read and same-key replay across SDK connections", async () => {
        const args = { workspace_id: workspaceA, ...input, request_key: requestKey };
        const result = await client.callTool({ name: "create_task", arguments: args });
        assertEquals(result.isError ?? false, false);
        created = result.structuredContent;
        assert(typeof created.id === "string");
        const http = await scopedHttp(A, workspaceA, "GET", `/tasks/${created.id}`);
        assertEquals(http.status, 200);
        assertEquals(http.body.id, created.id);
        assertEquals(http.body.title, input.title);
        const reconnected = await modern(mcpTokenA);
        const replay = await reconnected.callTool({ name: "create_task", arguments: args });
        assertEquals(replay.structuredContent, created);
        const listed = await scopedHttp(A, workspaceA, "GET", `/tasks?keyword=${input.title}&limit=100`);
        assertEquals(listed.body.items.map((item: Json) => item.id), [created.id]);
        const raw = await rpc(mcpTokenA, "tools/call", {
          name: "get_task",
          arguments: { workspace_id: workspaceA, id: created.id },
        });
        assertEquals(raw.status, 200);
        assertEquals(raw.body.result.resultType, "complete");
        assertEquals(raw.body.result.structuredContent.id, created.id);
      });

      await context.step("business errors and another workspace remain isolated on modern requests", async () => {
        const foreign = await modern(mcpTokenB);
        const denied = await foreign.callTool({
          name: "get_task",
          arguments: { workspace_id: workspaceB, id: created.id },
        });
        assertEquals(denied.isError, true);
        assertEquals((denied.structuredContent as Json).code, "not_found");
        const invalid = await client.callTool({
          name: "create_task",
          arguments: { workspace_id: workspaceA, kind: "once", request_key: crypto.randomUUID() },
        });
        assertEquals(invalid.isError, true);
        assertEquals((invalid.structuredContent as Json).code, "invalid_input");
        assertEquals((await scopedHttp(B, workspaceB, "GET", `/tasks/${created.id}`)).status, 404);
      });

      await context.step("protocol version, method and name mismatches fail without legacy fallback", async () => {
        for (
          const [method, input, headers, status, code] of [
            ["tools/list", {}, { "Mcp-Method": "tools/call" }, 400, -32020],
            ["tools/call", { name: "get_task", arguments: {} }, { "Mcp-Name": "create_task" }, 400, -32020],
            ["tools/list", {}, { "MCP-Protocol-Version": "2025-11-25" }, 400, -32020],
            [
              "tools/list",
              { _meta: { [VERSION]: "2099-01-01", [CAPABILITIES]: {} } },
              { "MCP-Protocol-Version": "2099-01-01" },
              400,
              -32022,
            ],
            ["not/a-method", {}, {}, 404, -32601],
          ] as const
        ) {
          const response = await rpc(mcpTokenA, method, input, headers);
          assertEquals(response.status, status, method);
          assertEquals(response.body.error.code, code, method);
        }
      });

      await context.step("SDK sends only modern RPCs with per-request metadata and required headers", () => {
        assert(requests.some((request) => request.method === "server/discover"));
        assert(requests.some((request) => request.method === "tools/call"));
        for (const request of requests) {
          assertEquals(request.version, REVISION);
          assertEquals(request.meta[VERSION], REVISION);
          assert(request.meta[CAPABILITIES]);
          assert(request.method !== "initialize" && request.method !== "notifications/initialized");
          if (request.method === "tools/call") assert(request.name);
        }
      });

      await context.step("allowed and absent Origins preserve modern discovery and legacy connections", async () => {
        const config = parseToml(
          await Deno.readTextFile(
            Deno.env.get("WORKSPACE_E2E_CONFIG") ?? new URL("../../config.toml", import.meta.url),
          ),
        );
        const allowedOrigin = new URL((config.auth as { site_url: string }).site_url).origin;
        for (const headers of [{ origin: allowedOrigin }, {}] as Record<string, string>[]) {
          const response = await rpc(mcpTokenA, "server/discover", {}, headers);
          assertEquals(response.status, 200);
          assertEquals(response.body.result.supportedVersions, [REVISION]);
        }
        const legacy = new Client({ name: "workspace-origin-legacy-contract", version: "0.0.0" });
        clients.push(legacy);
        await legacy.connect(
          new StreamableHTTPClientTransport(new URL(MCP_URL), {
            requestInit: { headers: { authorization: `Bearer ${mcpTokenA}`, origin: allowedOrigin } },
          }),
        );
        assertEquals(legacy.getProtocolEra(), "legacy");
        assert((await legacy.listTools()).tools.some((tool) => tool.name === "get_task"));
      });

      await context.step("untrusted Origins cannot discover, read metadata or create a task", async () => {
        const origin = "https://untrusted.example";
        for (const value of [origin, "null", ""]) {
          assertEquals((await rpc(mcpTokenA, "server/discover", {}, { origin: value })).status, 403);
        }
        const deniedTitle = `origin-denied-${crypto.randomUUID()}`;
        const denied = await rpc(mcpTokenA, "tools/call", {
          name: "create_task",
          arguments: {
            workspace_id: workspaceA,
            kind: "once",
            title: deniedTitle,
            request_key: crypto.randomUUID(),
          },
        }, { origin });
        assertEquals(denied.status, 403);
        const listed = await scopedHttp(A, workspaceA, "GET", `/tasks?keyword=${deniedTitle}&limit=100`);
        assertEquals(listed.status, 200);
        assertEquals(listed.body.items, []);
        const metadata = await fetch(`${MCP_URL}/oauth-protected-resource`, { headers: { origin } });
        assertEquals(metadata.status, 403);
        await metadata.body?.cancel();
      });
    } finally {
      for (const client of clients) await client.close();
    }
  },
  { mcp: true },
);
