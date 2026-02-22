from __future__ import annotations

from .config import _DIFFICULTY_MULTIPLIERS, _SCORE_DURATION_CAP_SEC
from .helpers import normalize_difficulty, sanitize_display_name


def clamp_score(value: object, default: float = 0.0) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        score = default
    return max(0.0, min(100.0, score))


def difficulty_multiplier(value: object) -> float:
    return float(_DIFFICULTY_MULTIPLIERS.get(normalize_difficulty(value), 2.0))


def compute_run_score(duration_sec: object, difficulty: object) -> float:
    try:
        duration = float(duration_sec)
    except (TypeError, ValueError):
        duration = 0.0
    duration = max(0.0, min(_SCORE_DURATION_CAP_SEC, duration))
    return round(duration * difficulty_multiplier(difficulty), 2)


def score_to_grade(score: float) -> str:
    s = clamp_score(score)
    if s >= 95:
        return "A+"
    if s >= 90:
        return "A"
    if s >= 85:
        return "B+"
    if s >= 80:
        return "B"
    if s >= 75:
        return "C+"
    if s >= 70:
        return "C"
    if s >= 65:
        return "D"
    return "F"


def default_user_stats(user_id: str, display_name: str) -> dict:
    return {
        "userId": user_id,
        "displayName": display_name,
        "runs": [],
        "totalRuns": 0,
        "sumAverage": 0.0,
        "bestScore": 0.0,
        "lastRunAt": "",
    }


def summarize_user_stats(user: dict, fallback_user_id: str, fallback_display: str) -> dict:
    runs = user.get("runs", [])
    if not isinstance(runs, list):
        runs = []
    total_runs = int(user.get("totalRuns") or len(runs))
    sum_average = float(user.get("sumAverage") or 0.0)
    average_score = (sum_average / total_runs) if total_runs > 0 else 0.0
    best_score = clamp_score(user.get("bestScore"), 0.0)
    display_name = sanitize_display_name(user.get("displayName") or fallback_display)
    user_id = str(user.get("userId") or fallback_user_id)
    recent = [entry for entry in runs if isinstance(entry, dict)][-5:]
    recent.reverse()
    grade = score_to_grade(average_score) if total_runs > 0 else "N/A"

    longest_duration_sec = 0.0
    for entry in runs:
        if not isinstance(entry, dict):
            continue
        try:
            duration = float(entry.get("durationSec") or 0.0)
        except (TypeError, ValueError):
            duration = 0.0
        longest_duration_sec = max(longest_duration_sec, max(0.0, duration))

    return {
        "userId": user_id,
        "displayName": display_name,
        "runs": total_runs,
        "averageScore": round(average_score, 2),
        "bestScore": round(best_score, 2),
        "longestDurationSec": round(longest_duration_sec, 2),
        "grade": grade,
        "lastRunAt": str(user.get("lastRunAt") or ""),
        "recentRuns": recent,
    }


def build_leaderboard_rows(index: dict, limit: int = 50) -> list[dict]:
    users = index.get("users", {})
    if not isinstance(users, dict):
        return []
    rows: list[dict] = []
    for user_id, raw_user in users.items():
        if not isinstance(raw_user, dict):
            continue
        summary = summarize_user_stats(raw_user, str(user_id), str(user_id))
        if summary["runs"] <= 0:
            continue

        best_run_score = 0.0
        best_run_difficulty = "high"
        best_run_avg = 0.0
        runs = raw_user.get("runs", [])
        if isinstance(runs, list):
            for entry in runs:
                if not isinstance(entry, dict):
                    continue
                run_difficulty = normalize_difficulty(entry.get("difficulty"), "high")
                run_avg = clamp_score(entry.get("averageScore"), 0.0)
                run_score = compute_run_score(entry.get("durationSec"), run_difficulty)
                if (
                    run_score > best_run_score
                    or (run_score == best_run_score and run_avg > best_run_avg)
                ):
                    best_run_score = run_score
                    best_run_difficulty = run_difficulty
                    best_run_avg = run_avg
        rows.append(
            {
                **summary,
                "difficulty": best_run_difficulty,
                "score": round(best_run_score, 2),
            }
        )

    rows.sort(
        key=lambda row: (
            -float(row.get("score") or 0),
            -float(row.get("averageScore") or 0),
            -int(row.get("runs") or 0),
            str(row.get("displayName") or "").lower(),
        )
    )
    for idx, row in enumerate(rows, start=1):
        row["rank"] = idx
    return rows[: max(1, min(limit, 200))]
