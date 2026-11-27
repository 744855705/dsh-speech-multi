# dsh-speech-multi

Four local speech-to-text models behind one plugin, each decoded in the window it handles best.
Audio never leaves the machine, and a model is downloaded only when you prepare that model.

## Models

Priority is the measured order, best first. The first one is the default selection.

| Priority | Provider id | Model | Window | Shortest | Hard cap |
|---|---|---|---|---|---|
| 1 | `multi-xasr` | X-ASR zh-en (int8, punctuation) | 34 s | 20 s | 38 s |
| 2 | `multi-funasr` | Fun-ASR-Nano (int8, 1024 context) | 20 s | 6 s | 30 s |
| 3 | `multi-qwen3` | Qwen3-ASR 0.6B (int8) | 40 s | 8 s | 100 s |
| 4 | `multi-firered` | FireRedASR2-AED (int8) | 40 s | 8 s | 55 s |

Each model is a separate provider, so an unused model is never downloaded, and each one runs in
its own worker process with its own preparation state and idle reclaimer.

**Window** is the recording length that measured best, not the largest the model survives.
**Hard cap** is the length past which output becomes unusable; for X-ASR it terminates the
process, so the plan is rejected before decoding.

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `enabledModels` | all four | Models to register, in registration order |
| `dataRoot` | `~/.dsh/speech-to-text/multi` | Verified models and the archive cache |
| `releaseBaseUrl` | placeholder | Release serving the archives listed in `runtime/assets.json` |
| `lockFile` | `~/.dsh/speech-multi-lock.json` | Selection lock, read-only for the plugin |
| `deviceTier` | `auto` | `light` / `standard` / `large`, or derived from total memory |
| `threads` | `8` | CPU threads per worker |
| `maxRecordingSeconds` | tier default | Overrides the tier ceiling |
| `idleTimeoutMs` | `7200000` | Two hours before an idle worker is reclaimed |

`releaseBaseUrl` must be set to your own release before any download can succeed; the shipped
value is a placeholder and startup rejects it.

## Selection lock

`~/.dsh/speech-multi-lock.json`, read once at activation. A missing or malformed file leaves the
plugin unlocked rather than failing to start.

```json
{
  "schema": 2,
  "mode": "hard",
  "modelId": "multi-xasr",
  "allow": ["multi-xasr", "multi-funasr", "multi-qwen3", "multi-firered"]
}
```

- `soft` reasserts `modelId` at startup and whenever the speech catalog changes.
- `hard` also rejects selections outside `allow` and forces `resolve` to `modelId`.
- Omitting `allow` permits every model this plugin registers.

## Device tiers

| Tier | Memory | Models | Recording ceiling |
|---|---|---|---|
| `light` | under 8 GiB | X-ASR, Fun-ASR-Nano | 60 s |
| `standard` | under 16 GiB | + FireRedASR2-AED | 120 s |
| `large` | 16 GiB and above | + Qwen3-ASR 0.6B | 300 s |

A model the tier cannot run is skipped with a warning; recordings past the ceiling are rejected
before decoding instead of exhausting memory.

## Transcript inspection

A decode that produces no text, a leaked control token (`<sil>`, `<unk>`, `language`), far fewer
characters than the recording warrants, or a repeated passage is rejected and reported instead of
returned. There is no automatic retry: a result that fails inspection is a recording to redo, not
a model to switch.

## Known gaps in this build

- External punctuation is not wired yet, so `multi-firered` returns unpunctuated text. The other
  three emit punctuation themselves.
- Speech/silence detection is energy-based; a Silero model is not shipped, so a very noisy room
  can shift the block boundaries.
- Nothing has been exercised end to end: no model is installed into a profile from this build yet.

## License

Apache-2.0. Redistributed model weights and their upstream licenses are listed in
`THIRD_PARTY_NOTICES.md`.
