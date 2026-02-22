# Selection Presets

Place preset folders here. Each folder becomes one card in the Browse tab.

## Minimum required files per preset folder

- `routine.json`
- One audio or video source file (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.aac`, `.flac`, `.mp4`, `.mov`, `.webm`, etc.)

## Optional files

- `manifest.json` for title/description/category/tags and explicit file names
- Webcam reference video (for side-by-side mode)
- Package zip file
- Thumbnail / preview media

## Example

```text
selection/
  yoga_flow_01/
    manifest.json
    routine.json
    yoga_flow.mp4
    webcam_reference.mp4
```

## Example manifest.json

```json
{
  "title": "Morning Yoga Flow",
  "description": "Beginner-friendly follow-along yoga routine.",
  "category": "Yoga",
  "tags": ["yoga", "mobility", "beginner"],
  "durationSec": 420,
  "routineFile": "routine.json",
  "videoFile": "yoga_flow.mp4",
  "webcamFile": "webcam_reference.mp4",
  "webcamLayout": "side-by-side"
}
```
