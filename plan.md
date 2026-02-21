PROJECT: JustDance-CV (Music + Computer Vision Pose Matching Game)
TIME CONSTRAINT: < 12 hours (Hackathon MVP, reliability > complexity)

CORE CONCEPT:
A "Just Dance"-style web app where:
- Music plays
- User pose is tracked in real-time using MediaPipe (frontend)
- Pose is compared to a reference routine
- System gives live score + feedback + combo
- Users can record and share choreography via JSON files

CRITICAL ARCHITECTURE (NON-NEGOTIABLE):
--------------------------------------
FRONTEND (React + MediaPipe):
- Webcam capture
- Real-time pose estimation (MediaPipe Pose)
- Landmark extraction (33 keypoints)
- Angle feature extraction
- Ghost skeleton rendering
- Audio playback + master clock (audio.currentTime)
- Sending pose features to backend for scoring

BACKEND (FastAPI / Python):
- Routine caching/loading
- Pose similarity scoring (ML/logic layer)
- Time-window matching
- Session scoring aggregation
- Future: Supabase ID-based sharing (NOT MVP)

IMPORTANT:
DO NOT run MediaPipe in backend.
Pose estimation MUST stay in frontend for:
- Low latency
- No video streaming overhead
- Real-time UX stability

--------------------------------------
MODES (PRODUCT FEATURES)
--------------------------------------

MODE 1: PRE-RECORDED JUST DANCE LEVELS
- Play predefined routine + music
- Reference pose sequence extracted beforehand
- User matches poses in real-time
- Backend computes score vs reference frames

MODE 2: RECORD + PRACTICE + SHARE (CORE MVP)
- User records choreography while music plays
- System stores pose sequence as routine.json
- JSON can be downloaded and uploaded by others
- Enables choreography learning + fun sharing

--------------------------------------
MUST-SHIP FEATURES (LOCKED MVP)
--------------------------------------
- MediaPipe Pose working in browser
- Audio playback with single master clock
- Record routine → download JSON
- Upload routine JSON → load routine
- Real-time scoring + combo + feedback labels
- GHOST OVERLAY (MANDATORY): reference skeleton synced to time
- 1 demo routine (10–15 seconds)
- Stable demo flow (no crashes)

CUT FEATURES (DO NOT BUILD IN 12 HOURS):
- Accounts/authentication
- Full database integration
- Beat detection ML
- Custom song upload alignment
- Multi-song library
- Complex deep learning models

--------------------------------------
DATA FLOW (END-TO-END)
--------------------------------------

1. Webcam Frame (Frontend)
   ↓
2. MediaPipe Pose (Frontend, Pretrained BlazePose)
   Output: 33 landmarks (x, y, visibility)
   ↓
3. Feature Extraction (Frontend)
   - Convert landmarks → joint angles (robust features)
   - Example: elbow, shoulder, knee angles
   ↓
4. Audio Clock Sync (Frontend)
   t = audio.currentTime
   ↓
5. Scoring Request (Frontend → Backend)
   POST /score
   {
     routine_id OR routine_json,
     t,
     user_angles
   }
   ↓
6. Backend Scoring Engine (FastAPI)
   - Finds best reference frame within ±0.2s window
   - Computes similarity score
   - Returns score + label
   ↓
7. Frontend UI Update
   - Score meter
   - Perfect/Good/Miss
   - Combo counter
   - Ghost overlay rendering

--------------------------------------
ROUTINE JSON SCHEMA (CORE DATASET)
--------------------------------------
Stores BOTH:
- lm2d (for ghost skeleton overlay)
- angles (for backend scoring)

{
  "version": 1,
  "name": "Routine Name",
  "fps": 30,
  "durationSec": 15.0,
  "song": {
    "title": "Track 1",
    "offsetSec": 0.0
  },
  "frames": [
    {
      "t": 0.000,
      "lm2d": [[0.5,0.1],[0.49,0.12], "... 33 landmarks ..."],
      "angles": {
        "lElbow": 145.2,
        "rElbow": 152.8,
        "lShoulder": 35.1,
        "rShoulder": 40.6,
        "lKnee": 170.0,
        "rKnee": 168.4
      }
    }
  ]
}

NOTE:
lm2d coordinates are normalized [0,1] from MediaPipe.
This allows resolution-independent ghost rendering.

--------------------------------------
SCORING LOGIC (BACKEND ML-LIKE CORE)
--------------------------------------
Feature: Joint Angle Similarity

Steps:
1. Receive user_angles + time t
2. Find reference frames in [t - 0.2s, t + 0.2s]
3. Compute weighted mean angle error
   - elbows weight = 1.2
   - shoulders weight = 1.0
   - knees weight = 0.7
4. Map error → score (0–100)
5. Convert to label:
   >= 85 → Perfect
   >= 70 → Good
   >= 50 → Ok
   < 50 → Miss
6. Combo increments on Perfect/Good

This is considered applied ML + CV feature modeling.

--------------------------------------
GHOST OVERLAY (MANDATORY VISUAL SYSTEM)
--------------------------------------
At runtime:
- t = audio.currentTime
- Select reference frame at time t
- Draw ghost skeleton (semi-transparent)
- Draw live user skeleton on top
- Uses lm2d from routine JSON

This is the primary UX differentiator.

--------------------------------------
REPO STRUCTURE (MONOREPO)
--------------------------------------
just-dance-cv/
  frontend/  (React + MediaPipe CV layer)
    src/
      pose/        (MediaPipe + angle extraction)
      routine/     (record, upload, align logic)
      ui/          (canvas, HUD, pages)
      audio/       (player + master clock)
      scoring_client/ (API calls to backend)
  backend/  (FastAPI scoring engine)
    app/
      main.py
      scoring.py
      models.py
      storage.py
      
--------------------------------------
DEFINITION OF DONE (HACKATHON DEMO)
--------------------------------------
- MediaPipe pose tracking stable at ~30 FPS
- Can record choreography and export JSON
- Can upload JSON and practice routine
- Ghost skeleton perfectly synced with audio clock
- Live scoring + combo system functional
- Demo routine works without internet/backend failure