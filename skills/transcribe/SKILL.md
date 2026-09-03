---
description: Transcribe a public video or audio link into timestamped text, then summarize, translate, quote or export subtitles. Use when the user pastes a YouTube, TikTok, Instagram, Facebook, Pinterest or Google Drive link and wants what was said, or asks for a transcript, subtitles or a summary of a recording.
---

# Transcribe a video or audio link

Use the `justtranscribe` MCP tools. If they are not available, the server
has no API key: tell the user to create a free one at
https://justtranscribe.ai/api-keys (no card), export it, and restart
Claude Code:

```
export JUSTTRANSCRIBE_API_KEY=jt_live_...
```

Users who would rather sign in than paste a key can use the hosted server
instead — `claude mcp add --transport http justtranscribe
https://justtranscribe.ai/api/mcp` — which runs an OAuth sign-in.

## How to do it

1. Call `transcribe_url` with the link. It waits for the result and returns
   the transcript in the same call for short videos; if it comes back still
   processing, call `get_transcript` with the returned id **immediately**
   rather than ending your turn — that call waits too.
2. Present the transcript. Keep the words exactly as returned: it is a
   machine transcript and the user may be quoting it. Never silently
   "fix" wording.
3. Offer the obvious next steps only when they help: a summary, key
   moments, a translation, or subtitles via `export_transcript`
   (`srt`/`vtt` for subtitles, `txt`/`md` for prose, `csv` per segment).

## Facts to be honest about

- Public links only. Private, unlisted-with-login videos and live streams
  cannot be fetched — say so and suggest uploading the file at
  justtranscribe.ai instead. File upload is not available over MCP.
- Up to 150 minutes per recording. Free-beta limits: 3 new transcripts per
  hour, one processing at a time.
- The language is detected automatically (Spanish, English, Portuguese and
  dozens more). Transcripts of clear audio are close to final; noisy or
  overlapping speech needs a read-through — treat it as a working draft.
- `delete_transcript` is permanent. Only call it when the user asks.
- A video with no audio track cannot be transcribed; the tool says so.

## Useful patterns

- "What did they say about X?" → transcribe, then quote the line with its
  timestamp so the user can verify it against the audio.
- "Subtitle this" → transcribe, then `export_transcript` with `srt`.
- "Summarize this video" → transcribe, then summarize from the text; never
  summarize a video you have not transcribed.
