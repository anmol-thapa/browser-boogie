from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import drawing_styles
from mediapipe.tasks.python.vision import drawing_utils

DEFAULT_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"
)
MODEL_PATH = Path(__file__).with_name("pose_landmarker.task")
CONNECTIONS = tuple(vision.PoseLandmarksConnections.POSE_LANDMARKS)
ANGLE_WEIGHTS = {
    "lElbow": 1.2,
    "rElbow": 1.2,
    "lShoulder": 1.0,
    "rShoulder": 1.0,
    "lKnee": 0.7,
    "rKnee": 0.7,
}

LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_ANKLE = 27
RIGHT_ANKLE = 28


def ensure_model_file(model_path: Path) -> None:
    if model_path.exists():
        return
    print(f"Downloading model to {model_path} ...")
    urlretrieve(DEFAULT_MODEL_URL, model_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MediaPipe pose recorder + scorer demo.")
    parser.add_argument(
        "--mode",
        choices=("play", "view"),
        default="play",
        help="play: webcam record/score mode, view: black-screen routine playback mode.",
    )
    parser.add_argument(
        "--record-out",
        type=Path,
        default=Path("routine.json"),
        help="Path to save routine JSON when recording is stopped.",
    )
    parser.add_argument(
        "--routine-name",
        default="User Routine",
        help="Routine name stored in exported JSON.",
    )
    parser.add_argument(
        "--reference",
        type=Path,
        default=None,
        help="Optional routine JSON for local scoring + ghost overlay.",
    )
    parser.add_argument(
        "--window-sec",
        type=float,
        default=0.2,
        help="Scoring time window in seconds.",
    )
    parser.add_argument(
        "--countdown-sec",
        type=float,
        default=3.0,
        help="Countdown before scoring starts when using --reference.",
    )
    parser.add_argument(
        "--view-width",
        type=int,
        default=1280,
        help="View mode window width in pixels.",
    )
    parser.add_argument(
        "--view-height",
        type=int,
        default=720,
        help="View mode window height in pixels.",
    )
    return parser.parse_args()


def _angle_degrees(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float | None:
    ba = a - b
    bc = c - b
    denom = float(np.linalg.norm(ba) * np.linalg.norm(bc))
    if denom < 1e-8:
        return None
    cos_theta = float(np.dot(ba, bc) / denom)
    cos_theta = max(-1.0, min(1.0, cos_theta))
    return float(np.degrees(np.arccos(cos_theta)))


def _point_xy(pose_landmarks: list, index: int) -> np.ndarray:
    lm = pose_landmarks[index]
    return np.array([lm.x, lm.y], dtype=np.float64)


def extract_angles(pose_landmarks: list) -> dict[str, float]:
    angles = {
        "lElbow": _angle_degrees(
            _point_xy(pose_landmarks, LEFT_SHOULDER),
            _point_xy(pose_landmarks, LEFT_ELBOW),
            _point_xy(pose_landmarks, LEFT_WRIST),
        ),
        "rElbow": _angle_degrees(
            _point_xy(pose_landmarks, RIGHT_SHOULDER),
            _point_xy(pose_landmarks, RIGHT_ELBOW),
            _point_xy(pose_landmarks, RIGHT_WRIST),
        ),
        "lShoulder": _angle_degrees(
            _point_xy(pose_landmarks, LEFT_ELBOW),
            _point_xy(pose_landmarks, LEFT_SHOULDER),
            _point_xy(pose_landmarks, LEFT_HIP),
        ),
        "rShoulder": _angle_degrees(
            _point_xy(pose_landmarks, RIGHT_ELBOW),
            _point_xy(pose_landmarks, RIGHT_SHOULDER),
            _point_xy(pose_landmarks, RIGHT_HIP),
        ),
        "lKnee": _angle_degrees(
            _point_xy(pose_landmarks, LEFT_HIP),
            _point_xy(pose_landmarks, LEFT_KNEE),
            _point_xy(pose_landmarks, LEFT_ANKLE),
        ),
        "rKnee": _angle_degrees(
            _point_xy(pose_landmarks, RIGHT_HIP),
            _point_xy(pose_landmarks, RIGHT_KNEE),
            _point_xy(pose_landmarks, RIGHT_ANKLE),
        ),
    }
    return {
        angle_name: round(value, 3)
        for angle_name, value in angles.items()
        if value is not None
    }


def landmarks_to_lm2d(pose_landmarks: list) -> list[list[float]]:
    return [[round(lm.x, 6), round(lm.y, 6)] for lm in pose_landmarks]


def build_pose_frame(pose_landmarks: list, t_sec: float) -> dict:
    return {
        "t": round(t_sec, 3),
        "lm2d": landmarks_to_lm2d(pose_landmarks),
        "angles": extract_angles(pose_landmarks),
    }


def score_angles(
    user_angles: dict[str, float], reference_angles: dict[str, float]
) -> tuple[float, str, float | None]:
    weighted_error = 0.0
    total_weight = 0.0
    for joint, weight in ANGLE_WEIGHTS.items():
        if joint not in user_angles or joint not in reference_angles:
            continue
        weighted_error += abs(user_angles[joint] - reference_angles[joint]) * weight
        total_weight += weight

    if total_weight == 0.0:
        return 0.0, "Miss", None

    mean_error = weighted_error / total_weight
    score = max(0.0, min(100.0, 100.0 - (mean_error * 1.25)))
    if score >= 85:
        label = "Perfect"
    elif score >= 70:
        label = "Good"
    elif score >= 50:
        label = "Ok"
    else:
        label = "Miss"
    return score, label, mean_error


def draw_ghost_landmarks(frame_bgr, lm2d: list[list[float]]) -> None:
    if len(lm2d) < 33:
        return
    height, width = frame_bgr.shape[:2]
    for connection in CONNECTIONS:
        start_idx = int(connection.start)
        end_idx = int(connection.end)
        sx, sy = lm2d[start_idx]
        ex, ey = lm2d[end_idx]
        p1 = (int(sx * width), int(sy * height))
        p2 = (int(ex * width), int(ey * height))
        cv2.line(frame_bgr, p1, p2, (70, 170, 255), 2)
    for x_norm, y_norm in lm2d:
        cv2.circle(frame_bgr, (int(x_norm * width), int(y_norm * height)), 3, (70, 170, 255), -1)


@dataclass
class RoutineRecorder:
    frames: list[dict] = field(default_factory=list)
    recording: bool = False
    _start_monotonic: float | None = None

    def start(self) -> None:
        self.frames = []
        self.recording = True
        self._start_monotonic = time.monotonic()

    def stop(self) -> float:
        self.recording = False
        return self.duration_sec

    @property
    def duration_sec(self) -> float:
        if not self.frames:
            return 0.0
        return float(self.frames[-1]["t"])

    def add_frame(self, pose_landmarks: list, now_monotonic: float) -> None:
        if not self.recording or self._start_monotonic is None:
            return
        t_sec = now_monotonic - self._start_monotonic
        self.frames.append(build_pose_frame(pose_landmarks, t_sec))

    def export_json(self, out_path: Path, routine_name: str) -> Path:
        if not self.frames:
            raise ValueError("Cannot export an empty routine.")

        if len(self.frames) >= 2 and self.duration_sec > 0:
            fps = (len(self.frames) - 1) / self.duration_sec
        else:
            fps = 30.0

        payload = {
            "version": 1,
            "name": routine_name,
            "fps": round(float(fps), 2),
            "durationSec": round(self.duration_sec, 3),
            "song": {"title": "Unknown Track", "offsetSec": 0.0},
            "frames": self.frames,
        }

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return out_path


@dataclass
class RoutineReference:
    name: str
    fps: float
    duration_sec: float
    frames: list[dict]

    @classmethod
    def from_json(cls, path: Path) -> "RoutineReference":
        data = json.loads(path.read_text(encoding="utf-8"))
        frames = data.get("frames", [])
        if not isinstance(frames, list) or not frames:
            raise ValueError(f"No frames found in {path}")
        duration_sec = float(
            data.get("durationSec")
            if data.get("durationSec") is not None
            else frames[-1].get("t", 0.0)
        )
        return cls(
            name=str(data.get("name", path.stem)),
            fps=max(float(data.get("fps", 30.0)), 1.0),
            duration_sec=max(duration_sec, 1e-6),
            frames=frames,
        )

    def frame_at(self, t_sec: float, window_sec: float) -> dict | None:
        if not self.frames:
            return None
        t_loop = t_sec % self.duration_sec
        candidates = [
            frame
            for frame in self.frames
            if abs(float(frame.get("t", 0.0)) - t_loop) <= window_sec
        ]
        if not candidates:
            return None
        return min(candidates, key=lambda frame: abs(float(frame.get("t", 0.0)) - t_loop))

    def nearest_frame_at(self, t_sec: float) -> dict | None:
        if not self.frames:
            return None
        t_loop = t_sec % self.duration_sec
        return min(self.frames, key=lambda frame: abs(float(frame.get("t", 0.0)) - t_loop))


@dataclass
class ScoreState:
    score: float = 0.0
    label: str = "Miss"
    combo: int = 0
    mean_error: float | None = None


def draw_pose_landmarks(frame_bgr, pose_landmarks_list) -> None:
    pose_landmark_style = drawing_styles.get_default_pose_landmarks_style()
    pose_connection_style = drawing_utils.DrawingSpec(color=(0, 255, 0), thickness=2)
    for pose_landmarks in pose_landmarks_list:
        drawing_utils.draw_landmarks(
            image=frame_bgr,
            landmark_list=pose_landmarks,
            connections=vision.PoseLandmarksConnections.POSE_LANDMARKS,
            landmark_drawing_spec=pose_landmark_style,
            connection_drawing_spec=pose_connection_style,
        )


def draw_hud(
    frame_bgr,
    recorder: RoutineRecorder,
    score_state: ScoreState,
    reference: RoutineReference | None,
    practice_t: float,
    scoring_active: bool,
    countdown_remaining: float,
) -> None:
    controls = "q: quit  r: start/stop record  e: export"
    cv2.putText(frame_bgr, controls, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (230, 230, 230), 1)

    status = (
        f"REC {len(recorder.frames)} frames ({recorder.duration_sec:.2f}s)"
        if recorder.recording
        else f"IDLE {len(recorder.frames)} frames buffered"
    )
    cv2.putText(frame_bgr, status, (12, 48), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (50, 220, 255), 2)

    if reference is None:
        cv2.putText(
            frame_bgr,
            "Reference: none (run with --reference routine.json for scoring)",
            (12, 72),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (180, 180, 180),
            1,
        )
        return

    if not scoring_active:
        countdown_text = f"Get ready... {countdown_remaining:.1f}"
        cv2.putText(
            frame_bgr,
            countdown_text,
            (12, 78),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (0, 200, 255),
            2,
        )
        cv2.putText(
            frame_bgr,
            f"Reference: {reference.name}",
            (12, 104),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (180, 180, 180),
            1,
        )
        return

    label_color = {
        "Perfect": (80, 255, 80),
        "Good": (80, 220, 255),
        "Ok": (0, 200, 255),
        "Miss": (40, 40, 255),
    }.get(score_state.label, (255, 255, 255))
    cv2.putText(
        frame_bgr,
        f"Score: {score_state.score:5.1f}   {score_state.label}   Combo: {score_state.combo}",
        (12, 72),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        label_color,
        2,
    )
    error_txt = (
        f"Mean angle error: {score_state.mean_error:.2f} deg"
        if score_state.mean_error is not None
        else "Mean angle error: n/a"
    )
    cv2.putText(frame_bgr, error_txt, (12, 96), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (230, 230, 230), 1)
    cv2.putText(
        frame_bgr,
        f"Reference: {reference.name}   t={practice_t % reference.duration_sec:.2f}s",
        (12, 120),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (180, 180, 180),
        1,
    )


def load_reference(reference_path: Path | None, required: bool = False) -> RoutineReference | None:
    if reference_path is None:
        if required:
            print("Missing --reference. Pass a routine JSON file path.")
        return None
    if not reference_path.exists():
        print(
            f"Reference file not found: {reference_path}\n"
            "Record a routine first (press 'r' to start/stop) or pass a valid --reference path."
        )
        return None
    reference = RoutineReference.from_json(reference_path)
    print(
        f"Loaded reference routine '{reference.name}' "
        f"({len(reference.frames)} frames, {reference.duration_sec:.2f}s, {reference.fps:.2f} fps)."
    )
    return reference


def run_view_mode(args: argparse.Namespace) -> None:
    reference = load_reference(args.reference, required=True)
    if reference is None:
        return

    view_width = max(320, int(args.view_width))
    view_height = max(240, int(args.view_height))
    countdown_sec = max(args.countdown_sec, 0.0)
    countdown_start = time.monotonic()
    playback_start = countdown_start if countdown_sec <= 0.0 else None
    frame_delay_ms = max(1, int(round(1000.0 / reference.fps)))

    print("View mode started.")
    print("Controls: q=quit, c=restart countdown/playback.")
    if playback_start is None:
        print(f"Countdown started ({countdown_sec:.1f}s).")

    try:
        while True:
            frame_bgr = np.zeros((view_height, view_width, 3), dtype=np.uint8)
            now_monotonic = time.monotonic()

            if playback_start is None:
                countdown_remaining = max(0.0, countdown_sec - (now_monotonic - countdown_start))
                if countdown_remaining <= 0.0:
                    playback_start = now_monotonic
                    print("Go! Playing reference routine.")
                else:
                    cv2.putText(
                        frame_bgr,
                        f"Starting in {countdown_remaining:.1f}s",
                        (40, 80),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1.0,
                        (0, 200, 255),
                        2,
                    )
                    cv2.putText(
                        frame_bgr,
                        f"Routine: {reference.name}",
                        (40, 120),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (200, 200, 200),
                        1,
                    )

            if playback_start is not None:
                playback_t = now_monotonic - playback_start
                reference_frame = reference.nearest_frame_at(playback_t)
                if reference_frame is not None and "lm2d" in reference_frame:
                    draw_ghost_landmarks(frame_bgr, reference_frame["lm2d"])
                cv2.putText(
                    frame_bgr,
                    f"Routine: {reference.name}",
                    (20, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (200, 200, 200),
                    1,
                )
                cv2.putText(
                    frame_bgr,
                    f"t={playback_t % reference.duration_sec:.2f}s / {reference.duration_sec:.2f}s",
                    (20, 58),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    (0, 200, 255),
                    2,
                )
                cv2.putText(
                    frame_bgr,
                    "q: quit  c: restart",
                    (20, view_height - 20),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (180, 180, 180),
                    1,
                )

            cv2.imshow("Routine View", frame_bgr)
            key = cv2.waitKey(frame_delay_ms) & 0xFF
            if key == ord("q"):
                break
            if key == ord("c"):
                countdown_start = time.monotonic()
                playback_start = countdown_start if countdown_sec <= 0.0 else None
                print("Playback restarted.")
    finally:
        cv2.destroyAllWindows()


def run_play_mode(args: argparse.Namespace) -> None:
    ensure_model_file(MODEL_PATH)

    reference = load_reference(args.reference, required=False)

    recorder = RoutineRecorder()
    score_state = ScoreState()
    countdown_sec = max(args.countdown_sec, 0.0)
    countdown_start = time.monotonic()
    scoring_active = reference is None or countdown_sec <= 0.0
    practice_start = countdown_start if scoring_active else None
    if reference is not None and not scoring_active:
        print(f"Countdown started ({countdown_sec:.1f}s). Hold your start pose.")

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open camera 0.")

    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )

    last_timestamp_ms = 0
    print("Camera started.")
    print("Controls: r=start/stop recording, e=export buffered recording, q=quit.")

    with vision.PoseLandmarker.create_from_options(options) as detector:
        try:
            while True:
                ok, frame_bgr = cap.read()
                if not ok:
                    print("Camera frame read failed.")
                    break

                frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

                timestamp_ms = int(time.monotonic() * 1000)
                if timestamp_ms <= last_timestamp_ms:
                    timestamp_ms = last_timestamp_ms + 1
                last_timestamp_ms = timestamp_ms

                result = detector.detect_for_video(mp_image, timestamp_ms)
                now_monotonic = time.monotonic()
                if reference is not None and not scoring_active:
                    elapsed = now_monotonic - countdown_start
                    if elapsed >= countdown_sec:
                        scoring_active = True
                        practice_start = now_monotonic
                        score_state = ScoreState()
                        print("Go! Scoring started.")

                practice_t = (
                    now_monotonic - practice_start
                    if (practice_start is not None and scoring_active)
                    else 0.0
                )
                countdown_remaining = (
                    max(0.0, countdown_sec - (now_monotonic - countdown_start))
                    if reference is not None and not scoring_active
                    else 0.0
                )
                reference_frame = None

                if result.pose_landmarks:
                    draw_pose_landmarks(frame_bgr, result.pose_landmarks)
                    pose_landmarks = result.pose_landmarks[0]
                    user_angles = extract_angles(pose_landmarks)

                    recorder.add_frame(pose_landmarks, now_monotonic)

                    if reference is not None and scoring_active:
                        reference_frame = reference.frame_at(practice_t, args.window_sec)
                        if reference_frame is None:
                            score_state.score = 0.0
                            score_state.label = "Miss"
                            score_state.combo = 0
                            score_state.mean_error = None
                        else:
                            ref_angles = reference_frame.get("angles", {})
                            score, label, mean_error = score_angles(user_angles, ref_angles)
                            score_state.score = score
                            score_state.label = label
                            score_state.mean_error = mean_error
                            if label in {"Perfect", "Good"}:
                                score_state.combo += 1
                            else:
                                score_state.combo = 0

                if reference_frame is not None and "lm2d" in reference_frame:
                    draw_ghost_landmarks(frame_bgr, reference_frame["lm2d"])

                draw_hud(
                    frame_bgr,
                    recorder,
                    score_state,
                    reference,
                    practice_t,
                    scoring_active,
                    countdown_remaining,
                )

                cv2.imshow("Pose Webcam Test", frame_bgr)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("r"):
                    if recorder.recording:
                        recorder.stop()
                        out = recorder.export_json(args.record_out, args.routine_name)
                        print(
                            f"Recording stopped. Saved {len(recorder.frames)} frames "
                            f"({recorder.duration_sec:.2f}s) to {out}"
                        )
                    else:
                        recorder.start()
                        print("Recording started.")
                elif key == ord("e"):
                    if recorder.recording:
                        print("Stop recording before export (press r).")
                    elif not recorder.frames:
                        print("No buffered frames to export yet.")
                    else:
                        out = recorder.export_json(args.record_out, args.routine_name)
                        print(f"Exported {len(recorder.frames)} frames to {out}")
                elif key == ord("q"):
                    break
        finally:
            if recorder.recording:
                recorder.stop()
                out = recorder.export_json(args.record_out, args.routine_name)
                print(
                    f"Auto-saved active recording on exit: {len(recorder.frames)} frames "
                    f"({recorder.duration_sec:.2f}s) -> {out}"
                )
            cap.release()
            cv2.destroyAllWindows()


def main() -> None:
    args = parse_args()
    if args.mode == "view":
        run_view_mode(args)
    else:
        run_play_mode(args)


if __name__ == "__main__":
    main()
