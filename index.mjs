#!/usr/bin/env node
// justtranscribe-mcp — MCP stdio server for JustTranscribe (justtranscribe.ai).
//
// Zero runtime dependencies: newline-delimited JSON-RPC on stdin/stdout (the
// MCP stdio transport), tools implemented as calls to the public REST API v1.
// Auth: JUSTTRANSCRIBE_API_KEY env (a `jt_live_…` key from
// https://justtranscribe.ai/api-keys). The hosted Streamable HTTP variant of
// this server lives at https://justtranscribe.ai/api/mcp — same tools, same
// limits; this package exists for stdio-only clients (Claude Desktop etc.).

import { createInterface } from "node:readline";

const API_URL = (process.env.JUSTTRANSCRIBE_API_URL || "https://justtranscribe.ai").replace(/\/+$/, "");
const API_KEY = process.env.JUSTTRANSCRIBE_API_KEY || "";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "justtranscribe", title: "JustTranscribe", version: "0.1.3" };
const INSTRUCTIONS =
  "Transcribe audio and video into timestamped text. transcribe_url starts a job from a public link and returns an id; " +
  'processing takes minutes, so poll get_transcript with that id until status is "complete". ' +
  "API keys: https://justtranscribe.ai/api-keys — docs: https://justtranscribe.ai/mcp";

// --- REST helpers -----------------------------------------------------------

async function api(path, init = {}) {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${API_KEY}`, ...(init.headers || {}) },
  });
  return res;
}

async function apiJson(path, init) {
  const res = await api(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return { error: `HTTP ${res.status}: ${body?.error ?? "Unexpected error."}` };
  }
  return { json: await res.json() };
}

const pretty = (v) => JSON.stringify(v, null, 2);
const errorResult = (text) => ({ content: [{ type: "text", text }], isError: true });
const textResult = (text) => ({ content: [{ type: "text", text }], isError: false });

const PROCESSING = new Set(["queued", "pending", "fetching", "transcribing", "analyzing"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampWait = (v) => Math.min(Math.max(typeof v === "number" && Number.isFinite(v) ? v : 25, 0), 55) * 1000;

/**
 * Poll server-side until the transcript finishes or waitMs elapses.
 * Assistants do not sit and poll (ChatGPT ended its turn after 8s on
 * 2026-08-29), so a bounded wait turns "poll me later" into "await me".
 */
async function awaitTranscript(id, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const r = await apiJson(`/transcripts/${encodeURIComponent(id)}`);
    if (r.error) return r;
    if (!PROCESSING.has(r.json.status) || Date.now() >= deadline) return r;
    await sleep(2500);
  }
}

function processingHint(status, error) {
  if (status === "complete") return "";
  if (status === "failed") return `\n\nThis transcript FAILED: ${error ?? "unknown error"}.`;
  if (status === "queued")
    return "\n\nQueued behind the daily capacity window — call get_transcript again to resume it automatically once the window reopens.";
  return (
    "\n\nSTILL PROCESSING. Do not end your turn and do not ask the user to wait: " +
    "call get_transcript again with this id right now — that call waits for the " +
    "result and returns it as soon as it is ready. Long recordings may need a few such calls."
  );
}

// --- tools ------------------------------------------------------------------

const TOOLS = [
  {
    name: "transcribe_url",
    title: "Transcribe a video or audio URL",
    description:
      'Transcribe a public video/audio URL (YouTube, TikTok, Instagram, Facebook, Pinterest, Google Drive). Waits up to ~25s so short videos come back in one call; if still processing, call get_transcript with the returned id (that call waits too) until status is "complete". Limits: public links only (no private/login-required videos, no live streams), up to 150 minutes.',
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public video or audio URL to transcribe." },
        webhook_url: { type: "string", description: "Optional HTTPS URL to POST the result to on completion." },
        wait_seconds: { type: "integer", description: "How long to wait for the result before returning (0-55, default 25)." },
      },
      required: ["url"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (args) => {
      if (typeof args.url !== "string" || !args.url) return errorResult("`url` is required.");
      const r = await apiJson("/transcripts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: args.url, webhookUrl: args.webhook_url }),
      });
      if (r.error) return errorResult(r.error);
      if (r.json.queued) {
        return textResult(
          pretty(r.json) +
            "\n\nQueued behind the daily capacity window; it starts automatically when the window reopens. Call get_transcript with this id.",
        );
      }
      const w = await awaitTranscript(r.json.id, clampWait(args.wait_seconds));
      if (w.error) return errorResult(w.error);
      const f = w.json;
      return textResult(
        pretty({ id: f.id, status: f.status, title: f.title, language: f.language, durationSec: f.durationSec, text: f.text }) +
          processingHint(f.status, f.error),
      );
    },
  },
  {
    name: "get_transcript",
    title: "Get a transcript",
    description:
      "Fetch a transcript by id, waiting up to ~25s if it is still processing: status, metadata, and the plain text once complete. Set include_segments for timestamped segments, include_analysis for the AI analysis when one exists.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Transcript id from transcribe_url or list_transcripts." },
        include_segments: { type: "boolean", description: "Include timestamped segments. Default false." },
        include_analysis: { type: "boolean", description: "Include the AI analysis and pace metrics. Default false." },
        wait_seconds: { type: "integer", description: "If still processing, wait up to this many seconds (0-55, default 25)." },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      if (typeof args.id !== "string" || !args.id) return errorResult("`id` is required.");
      const r = await awaitTranscript(args.id, clampWait(args.wait_seconds));
      if (r.error) return errorResult(r.error);
      const f = r.json;
      const out = {
        id: f.id,
        status: f.status,
        title: f.title,
        platform: f.platform,
        url: f.url,
        language: f.language,
        durationSec: f.durationSec,
        createdAt: f.createdAt,
        completedAt: f.completedAt,
        text: f.text,
      };
      if (args.include_segments) out.segments = f.transcript?.segments ?? null;
      if (args.include_analysis) {
        out.analysis = f.analysis;
        out.metrics = f.metrics;
      }
      return textResult(pretty(out) + processingHint(f.status, f.error));
    },
  },
  {
    name: "list_transcripts",
    title: "List transcripts",
    description:
      'List this account\'s transcripts, newest first. Use sort="completedAt" for finished transcripts ordered by completion.',
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max results (default 10)." },
        status: {
          type: "string",
          enum: ["queued", "pending", "fetching", "transcribing", "analyzing", "complete", "failed"],
        },
        sort: { type: "string", enum: ["createdAt", "completedAt"] },
      },
    },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      const q = new URLSearchParams({ limit: String(args.limit ?? 10) });
      if (args.status) q.set("status", String(args.status));
      if (args.sort === "completedAt") q.set("sort", "completedAt");
      const r = await apiJson(`/transcripts?${q}`);
      return r.error ? errorResult(r.error) : textResult(pretty(r.json));
    },
  },
  {
    name: "export_transcript",
    title: "Export a transcript",
    description:
      "Export a completed transcript as text: txt (paragraphs), srt/vtt (subtitles), md (Markdown), csv (one row per segment). PDF/DOCX are binary — use the REST API or the web app for those.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        format: { type: "string", enum: ["txt", "srt", "vtt", "md", "csv"] },
        timestamps: { type: "boolean", description: "Include timestamps in txt/md (default true)." },
        speakers: { type: "boolean", description: "Include cached speaker labels (default false)." },
      },
      required: ["id", "format"],
    },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      const formats = ["txt", "srt", "vtt", "md", "csv"];
      if (!formats.includes(args.format)) return errorResult(`format must be one of: ${formats.join(", ")}.`);
      const q = new URLSearchParams();
      if (args.timestamps === false) q.set("ts", "0");
      if (args.speakers) q.set("sp", "1");
      const res = await api(
        `/transcripts/${encodeURIComponent(String(args.id))}/export/${args.format}${q.size ? `?${q}` : ""}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        return errorResult(`HTTP ${res.status}: ${body?.error ?? "Unexpected error."}`);
      }
      return textResult(await res.text());
    },
  },
  {
    name: "delete_transcript",
    title: "Delete a transcript",
    description: "Permanently delete a transcript and its stored media. This cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    run: async (args) => {
      const r = await apiJson(`/transcripts/${encodeURIComponent(String(args.id))}`, { method: "DELETE" });
      return r.error ? errorResult(r.error) : textResult(pretty(r.json));
    },
  },
  {
    name: "get_account",
    title: "Account info",
    description: "Identify the account behind the API key, with the current beta limits.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => {
      const r = await apiJson("/me");
      return r.error ? errorResult(r.error) : textResult(pretty(r.json));
    },
  },
];

// --- stdio JSON-RPC loop ----------------------------------------------------

const reply = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const result = (id, r) => reply({ jsonrpc: "2.0", id, result: r });
const rpcError = (id, code, message) => reply({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  if (typeof msg?.method !== "string") return;
  const hasId = typeof msg.id === "string" || typeof msg.id === "number";
  if (!hasId) return; // notification
  const p = msg.params && typeof msg.params === "object" ? msg.params : {};

  switch (msg.method) {
    case "initialize": {
      if (!API_KEY) {
        // Surface the misconfiguration where the user will see it instead of
        // failing every later tool call mysteriously.
        process.stderr.write("justtranscribe-mcp: JUSTTRANSCRIBE_API_KEY is not set — get one at https://justtranscribe.ai/api-keys\n");
      }
      return result(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations,
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === p.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${p.name ?? "(missing name)"}.`);
      if (!API_KEY)
        return result(msg.id, errorResult("JUSTTRANSCRIBE_API_KEY is not set. Create a key at https://justtranscribe.ai/api-keys and add it to this server's env."));
      try {
        return result(msg.id, await tool.run(p.arguments && typeof p.arguments === "object" ? p.arguments : {}));
      } catch (err) {
        return result(msg.id, errorResult(`Tool failed: ${err?.message ?? String(err)}`));
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}.`);
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
// Stdin closing means the client is going away — but a tools/call may still
// be awaiting the API. Drain in-flight work before exiting, or the last
// response is silently dropped.
const pending = new Set();
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return rpcError(null, -32700, "Line is not valid JSON.");
  }
  const p = handle(msg).catch((err) => process.stderr.write(`justtranscribe-mcp: ${err?.stack ?? err}\n`));
  pending.add(p);
  p.finally(() => pending.delete(p));
});
rl.on("close", () => {
  Promise.allSettled([...pending]).then(() => process.exit(0));
});
