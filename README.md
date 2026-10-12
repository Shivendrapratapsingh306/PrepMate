# PrepMate — Integrated Warm Study Edition

This package updates the existing single-file PrepMate application, preserving its navigation, Supabase hooks, and Vercel API routes while applying the supplied Warm Study / Forest palette and the feature layer.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npx vercel dev` from this folder to serve the `/api` functions locally, or use `npx serve .` for UI-only preview.
3. Configure server-side `ANTHROPIC_API_KEY` in Vercel if you want optional model-assisted interview review. Never put API keys in frontend files.

## Integrated features

- Five-dimension interview scoring, STAR coverage heuristics, adaptive follow-ups, and autosaved drafts.
- Session history, practice plan, and CSV export.
- Resume text / TXT analysis through `/api/resume`. PDF/DOCX text extraction is not included yet; paste the text instead.
- Grooming checklist with browser camera / microphone checks where supported. Eye-line remains a manual confirmation.
- Settings persistence in browser localStorage.
- Warm Study theme from `WARM_STUDY_TOKENS.md`.

## Data and limitations

Session and settings history are stored locally in the current browser, not synced across devices. Rule-based scores are heuristics; optional model review requires a server-side API key. Supabase authentication still requires your project's valid configuration and appropriate Row Level Security policies.
