# PrepMate integrated features

- Interview evaluation posts each answer to `/api/interview`, with five dimensions: clarity, structure, relevance, impact, and ownership.
- Optional Claude review runs server-side when `ANTHROPIC_API_KEY` is configured in Vercel; rule-based scoring is the fallback.
- Adaptive follow-up questions target the weakest score dimension.
- Interview answers/drafts, settings, grooming checks, resume analysis, session history, and practice plan persist in browser localStorage.
- Progress summary and CSV export use actual sessions saved in this browser.
- Resume analysis accepts pasted text or `.txt`; PDF/DOCX extraction is not included.
- Grooming checks can inspect a camera frame and test microphone input when browser permissions and devices are available. Eye-line remains a manual confirmation.
- Theme uses the supplied Warm Study / Forest palette with Fraunces display typography and Inter UI typography.

## Limitations

- Session data is browser-local and does not sync to Supabase or trainer accounts.
- Heuristic scoring is not a trained evaluator. Model review requires the server-side API key.
- Supabase sign-in and passkeys depend on valid project URL/key and domain settings.
- Camera/microphone checks require HTTPS or localhost and user permission.
