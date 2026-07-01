export const RECORDINGS_BUCKET = "recordings";
export const MAX_RECORDINGS_PER_USER = 10;
export const SIGNED_URL_TTL_SEC = 60 * 60;
export const MAX_RECORDING_DURATION_SEC = 120;
export const WEBCAM_VIDEO_BITRATE = 1_000_000;
export const WEBCAM_AUDIO_BITRATE = 64_000;
export const MAX_AUDIO_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_SEC = 120;

export const STORAGE_KEY_PREFIX = "justdance_frontend_test_sessions_v2";

export const MODEL_PATH = "/pose_landmarker.task";

export const SHARE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LS_HIDE_RECORD_LIMIT_WARN = "bb_hide_record_limit_warn";

export const DEFAULT_DIFFICULTY = "medium";

export const MODE_OPTIONS = [
  { id: "record", label: "Recording Session", hint: "Create a routine from webcam recording." },
  { id: "load-routine", label: "Play Session", hint: "Load a routine package and start practicing." },
  { id: "create-video", label: "Create From Video", hint: "Generate a routine from an uploaded dance video." },
];

export const WEBCAM_LAYOUT_OPTIONS = [
  { id: "raw", label: "Raw Webcam" },
  { id: "side-by-side", label: "Side-By-Side" },
];

export const DIFFICULTY_OPTIONS = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];

export const PLAY_VIEW_OPTIONS = [
  { id: "overlay", label: "Overlay", description: "Your live skeleton is overlaid on top of the reference pose so you can mirror it in real time." },
  { id: "skeleton-on-side", label: "Skeleton on Side", description: "Reference skeleton plays in a panel next to your live feed. No reference video required." },
  { id: "side-by-side", label: "Side by Side", description: "Your webcam feed plays next to the reference recording. Requires a webcam video to have been saved with the routine." },
  { id: "none", label: "None", description: "No skeleton or reference hints are shown. Pure memorization. You are graded on your movement alone." },
];

export const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19], [12, 14],
  [14, 16], [16, 18], [16, 20], [16, 22], [18, 20], [11, 23], [12, 24], [23, 24],
  [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32],
  [27, 31], [28, 32],
];

export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_ELBOW = 13;
export const RIGHT_ELBOW = 14;
export const LEFT_WRIST = 15;
export const RIGHT_WRIST = 16;
export const LEFT_HIP = 23;
export const RIGHT_HIP = 24;
export const LEFT_KNEE = 25;
export const RIGHT_KNEE = 26;
export const LEFT_ANKLE = 27;
export const RIGHT_ANKLE = 28;

export const SCORE_POINT_IDS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export const PERSIST_FILE_KEYS = [
  "recordAudioFile",
  "loadZipFile",
  "createVideoFile",
  "playAudioFile",
  "loadAudioFile",
  "recordedWebcamFile",
  "loadWebcamVideoFile",
];

export const PERSIST_JSON_KEYS = ["generatedRoutine", "loadedRoutine"];
export const PERSIST_VALUE_KEYS = ["hideQuickSetup", "recordedWebcamLayout"];

export const XP_PER_PLAY = 10;
export const DIFFICULTY_XP_MULT = { easy: 1, medium: 1.15, hard: 1.25 };
export const LEVELS = [
  { id: "beginner", label: "Beginner", xpRequired: 0 },
  { id: "dancer", label: "Dancer", xpRequired: 100 },
  { id: "legend", label: "Dancing Legend", xpRequired: 1000 },
];
export const ACHIEVEMENTS = [
  { id: "first_move", label: "First Move", description: "Complete your first dance." },
  { id: "getting_used_to_it", label: "Getting Used To It", description: "Complete 10 dances." },
  { id: "duet", label: "Duet", description: "Complete a shared friend dance." },
];
