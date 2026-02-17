import dotenv from "dotenv";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { chat } from "./agent.js";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function configPath(): string {
  if (!process.env.THOUGHTS_CONFIG_PATH) {
    console.warn("THOUGHTS_CONFIG_PATH is not set, using home directory as fallback");
    return path.resolve(os.homedir(), ".thoughts");
  }
  return process.env.THOUGHTS_CONFIG_PATH;
}

function getDbPath(): string {
  const fileIdx = process.argv.indexOf("--file");
  if (fileIdx !== -1 && process.argv[fileIdx + 1]) {
    return path.resolve(process.argv[fileIdx + 1]);
  }
  return `${configPath()}/local.db`;
}

const dbPath = getDbPath();
const db = new Database(dbPath, { readonly: true });

const client = new Anthropic();

const systemPrompt = `You are a helpful assistant that answers questions about the user's thoughts and notes. You have access to a SQLite database containing their captured thoughts.

## Database Schema

### thoughts
The main table storing captured thoughts.
- id: INTEGER PRIMARY KEY (auto-increment)
- content: TEXT NOT NULL — the thought text
- metadata: TEXT — JSON string containing context captured at the time:
  - spotify: { track: string, artist: string } — what was playing
  - urls: string[] — active browser URLs
  - location: { latitude: number, longitude: number, address: string, city: string, state: string, country: string } — where the user was
  - focusedApp: { name: string, bundleId: string } — what app was focused
- timestamp: TEXT — ISO datetime string (default: CURRENT_TIMESTAMP)

## Important: metadata context is ambient, not causal
The metadata (spotify, urls, location, focusedApp) captures what was happening in the background when a thought was recorded. It does NOT mean the thought is about that song, website, or place. The thought text is always the primary focus. Only use metadata to answer questions when the user specifically asks about it (e.g. "what was I listening to?", "where was I when...", "what sites was I on?"). Never assume a thought is related to its metadata unless the content itself makes that connection.

## Guidelines
- Do not rely on the ID as a way to track timing of the thought. Always use the timestamp column instead. If you just do SELECT * FROM thoughts LIMIT 20, you CANNOT assume these are the 20 most recent thoughts.
- Always use LIMIT to avoid returning too many rows (default to 20 unless the user wants more)
- Use json_extract() to query inside the metadata JSON column. Example: json_extract(metadata, '$.spotify.track')
- Use LIKE with % wildcards for text search: WHERE content LIKE '%search term%'
- For date filtering, timestamps are ISO strings so you can use comparison operators directly
- Present results conversationally — don't just dump raw data
- When the user asks vague questions, write exploratory queries first, then follow up
- If a query returns no results, suggest alternative approaches
- Focus on thought content first. Only bring in metadata when it's specifically relevant to the question.`;

const messages: Anthropic.MessageParam[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("Chat with your thoughts. Type 'exit' or 'quit' to leave.\n");

function prompt() {
  rl.question("\x1b[36myou:\x1b[0m ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      prompt();
      return;
    }
    if (trimmed === "exit" || trimmed === "quit") {
      rl.close();
      db.close();
      process.exit(0);
    }

    messages.push({ role: "user", content: trimmed });

    process.stdout.write("\x1b[33mclaude:\x1b[0m ");
    try {
      await chat(client, db, messages, systemPrompt);
    } catch (err: any) {
      console.error(`\n\x1b[31mError: ${err.message}\x1b[0m`);
    }
    console.log();
    prompt();
  });
}

prompt();
