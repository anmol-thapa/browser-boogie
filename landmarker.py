"""Minimal MediaPipe Pose Landmarker webcam test.

Run:
python landmarker.py
"""

from __future__ import annotations

import time
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import drawing_styles
from mediapipe.tasks.python.vision import drawing_utils

DEFAULT_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"
)
MODEL_PATH = Path(__file__).with_name("pose_landmarker.task")


def ensure_model_file(model_path: Path) -> None:
    if model_path.exists():
        return
    print(f"Downloading model to {model_path} ...")
    urlretrieve(DEFAULT_MODEL_URL, model_path)


def print_pose_landmarks(pose_landmarks: list, frame_width: int, frame_height: int) -> None:
    print("Pose 0:")
    for idx, landmark in enumerate(pose_landmarks):
        x_px = int(landmark.x * frame_width)
        y_px = int(landmark.y * frame_height)
        print(
            f"  {idx:02d}: x={landmark.x:.4f}, y={landmark.y:.4f} "
            f"(px: {x_px}, {y_px})"
        )


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


def main() -> None:
    ensure_model_file(MODEL_PATH)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open camera 0.")

    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )

    last_timestamp_ms = 0
    print("Camera started. Press 'q' in the video window to quit.")

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

                if result.pose_landmarks:
                    frame_height, frame_width = frame_bgr.shape[:2]
                    print("-" * 40)
                    print_pose_landmarks(result.pose_landmarks[0], frame_width, frame_height)
                    draw_pose_landmarks(frame_bgr, result.pose_landmarks)

                cv2.imshow("Pose Webcam Test", frame_bgr)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
        finally:
            cap.release()
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()