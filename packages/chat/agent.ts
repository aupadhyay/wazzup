import type Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";

const TOOL_NAME = "query_database";

const tools: Anthropic.Tool[] = [
  {
    name: TOOL_NAME,
    description:
      "Execute a read-only SQL query against the thoughts database. Only SELECT and WITH (CTE) queries are allowed. Returns results as a JSON array of objects.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string",
          description: "The SQL SELECT query to execute",
        },
      },
      required: ["sql"],
    },
  },
];

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "REPLACE",
];

function validateQuery(sql: string): string | null {
  // Strip SQL comments
  const stripped = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  const firstKeyword = stripped.split(/\s+/)[0]?.toUpperCase();
  if (firstKeyword !== "SELECT" && firstKeyword !== "WITH") {
    return `Query must start with SELECT or WITH. Got: ${firstKeyword}`;
  }

  const upper = stripped.toUpperCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Match keyword as a whole word
    const regex = new RegExp(`\\b${keyword}\\b`);
    if (regex.test(upper)) {
      return `Forbidden keyword: ${keyword}`;
    }
  }

  return null;
}

function executeQuery(db: Database.Database, sql: string): string {
  const error = validateQuery(sql);
  if (error) {
    return JSON.stringify({ error });
  }

  try {
    const stmt = db.prepare(sql);

    // Extra safety: better-sqlite3 marks read-only statements
    if (!stmt.reader) {
      return JSON.stringify({
        error: "Statement is not read-only. Only SELECT queries are allowed.",
      });
    }

    const rows = stmt.all();

    if (rows.length > 100) {
      return JSON.stringify({
        rows: rows.slice(0, 100),
        truncated: true,
        total: rows.length,
        note: "Results truncated to 100 rows. Use LIMIT to narrow your query.",
      });
    }

    return JSON.stringify(rows);
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

export async function chat(
  client: Anthropic,
  db: Database.Database,
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
): Promise<void> {
  while (true) {
    // Collect content blocks from the stream
    const contentBlocks: Anthropic.ContentBlock[] = [];
    let stopReason: string | null = null;

    // Track tool use input JSON assembly
    const toolInputBuffers: Map<number, string> = new Map();

    const stream = client.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "text") {
          contentBlocks[event.index] = event.content_block;
        } else if (event.content_block.type === "tool_use") {
          contentBlocks[event.index] = event.content_block;
          toolInputBuffers.set(event.index, "");
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          process.stdout.write(event.delta.text);
          const block = contentBlocks[event.index];
          if (block && block.type === "text") {
            block.text += event.delta.text;
          }
        } else if (event.delta.type === "input_json_delta") {
          const buf = toolInputBuffers.get(event.index) ?? "";
          toolInputBuffers.set(event.index, buf + event.delta.partial_json);
        }
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason;
      }
    }

    // Finalize tool_use blocks with parsed input
    for (const [index, jsonStr] of toolInputBuffers) {
      const block = contentBlocks[index];
      if (block && block.type === "tool_use") {
        block.input = jsonStr ? JSON.parse(jsonStr) : {};
      }
    }

    // Filter out undefined entries
    const finalContent = contentBlocks.filter(Boolean);

    // Add assistant message to conversation
    messages.push({ role: "assistant", content: finalContent });

    if (stopReason === "tool_use") {
      // Execute all tool calls and push results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of finalContent) {
        if (block.type === "tool_use") {
          const input = block.input as { sql: string };
          process.stdout.write(`\n\x1b[2m> ${input.sql}\x1b[0m\n`);
          const result = executeQuery(db, input.sql);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
      // Loop to get Claude's response to the tool results
    } else {
      // end_turn or max_tokens — done
      process.stdout.write("\n");
      return;
    }
  }
}
