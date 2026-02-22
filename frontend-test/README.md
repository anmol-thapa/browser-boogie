# Frontend Test (React)

A no-build React test page for planning your product flow.

## Includes
- Dashboard tab
- My Library tab with previous sessions
- Add Session modal config flow
  - mode: recording / load routine / create from video
  - recording mode:
    - required audio input
    - optional webcam output capture (raw or side-by-side)
  - load mode:
    - required zip file
    - package requirement note: `routine.json` + audio file (webcam optional)
    - zip file is validated before session creation
  - create-from-video mode:
    - required video input only
  - no notes field
- Studio is a separate page view (not a dashboard tab)
  - recording sessions: countdown + start/stop recording flow
  - non-recording sessions: input summary + mode-specific note

## Run
From `JustDance/`:

```bash
python app.py
```

Open:
- `http://localhost:8000/frontend-test/`

Notes:
- Sessions persist in `localStorage`.
- File bundles now persist to `data/<folderId>/` via `/api/storage/*`.
- If a folder is deleted manually, opening that session shows a missing-data warning.
