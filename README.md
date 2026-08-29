# justtranscribe-mcp

MCP server for [JustTranscribe](https://justtranscribe.ai) — transcribe public
videos and audio into accurate, timestamped text without leaving your AI
assistant. Paste a YouTube, TikTok or Instagram link in the chat; get the
transcript back, export SRT/TXT/Markdown, or pull the AI breakdown of a
social video. Spanish, English and dozens of languages are auto-detected.

Two ways to connect — both use the same API key and the same account limits:

| | Transport | For |
|---|---|---|
| **Hosted** `https://justtranscribe.ai/api/mcp` | Streamable HTTP | Claude Code, Cursor, any client that supports remote servers with headers |
| **This package** `npx justtranscribe-mcp` | stdio | Claude Desktop and other stdio-only clients |

## Setup

1. Create a free API key at **https://justtranscribe.ai/api-keys** (free
   during the beta, no card).
2. Add the server to your client.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "justtranscribe": {
      "command": "npx",
      "args": ["-y", "justtranscribe-mcp"],
      "env": { "JUSTTRANSCRIBE_API_KEY": "jt_live_..." }
    }
  }
}
```

**Claude Code** (hosted variant — no install):

```bash
claude mcp add --transport http justtranscribe https://justtranscribe.ai/api/mcp \
  --header "Authorization: Bearer jt_live_..."
```

## Tools

- `transcribe_url` — start transcribing a public video/audio link (YouTube,
  TikTok, Instagram, Facebook, Pinterest, Google Drive). Returns an id;
  processing takes minutes.
- `get_transcript` — poll by id; returns the full text once complete
  (optionally timestamped segments and the AI analysis).
- `list_transcripts` — the account's transcripts, newest first.
- `export_transcript` — TXT, SRT, VTT, Markdown or CSV as text.
- `delete_transcript` — permanently remove a transcript and its media.
- `get_account` — identify the key's account and limits.

## Limits

Public links only (no private or login-required videos, no live streams), up
to 150 minutes per recording. The server enforces the same limits as the app
and the [REST API](https://justtranscribe.ai/developers): 120 requests/minute
per key, 3 new transcripts/hour, one processing at a time during the beta.
File upload isn't possible over MCP — use the app or the REST API.

## Environment

- `JUSTTRANSCRIBE_API_KEY` (required) — your `jt_live_…` key.
- `JUSTTRANSCRIBE_API_URL` (optional) — API origin override; defaults to
  `https://justtranscribe.ai`.

MIT © Bramonti Ventures · Docs: https://justtranscribe.ai/mcp
