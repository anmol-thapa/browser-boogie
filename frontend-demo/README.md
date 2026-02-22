# Frontend Demo (Record / Export / Load / Compare)

This is a no-build browser demo for your JustDance MVP flow:
- Webcam pose tracking with MediaPipe in browser
- Record routine frames (`t`, `lm2d`, `angles`)
- Add music file and use it during recording/comparison
- Export package (`routine.json` + audio + optional webcam video)
- Load routine JSON
- Create routine from uploaded dance video (uses video audio for compare)
- Compare live pose vs routine with countdown, score, label, combo

## Run

From `JustDance/`:

```bash
python -m http.server 8000
```

Open:
- `http://localhost:8000/frontend-demo/`

## Usage Flow

1. Click `Start Camera`.
2. Click `Start Recording`, move, then `Stop Recording`.
3. Optional: choose `Music File`.
4. Click `Export Package`.
   - Output is a zip with `routine.json`, music file (if selected), and optional webcam video.
   - Webcam video can be `Raw webcam` or `Side-by-side (camera + stage)`.
   - If zip library is unavailable, files download separately.
5. Load a routine with `Load Routine JSON Or Package ZIP` or click `Use Last Recording`.
   - ZIP validation checks required files (`routine.json` and linked audio/video by `song.fileName`).
   - If files are missing, app shows a clear package error.
6. Optional video workflow:
   - Select a dance video in `Create Routine From Video`
   - Choose `Video Routine Compare View` (`Overlay` or `Side-by-side`)
   - Preview it
   - Click `Analyze Video To Routine`
   - If pose is detected, click `Use Video Routine`
   - If not, app shows `No person found...`
7. Set `Countdown` + `Match Window`.
8. Click `Start Compare`.

## Notes

- Default model path is `../pose_landmarker.task`.
- `Black background` shows ghost/live skeleton without webcam image behind it.
- Countdown applies to both recording and compare, shown centered in large white text.
- Scoring uses angle similarity (elbows/shoulders/knees) so it is less sensitive to absolute body position.
- When routine comes from uploaded video, compare playback uses the video's own audio/time clock.
