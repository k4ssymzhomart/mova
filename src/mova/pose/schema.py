"""Canonical pose representation + skeleton definitions.

Pose datasets (KIMORE, UI-PRMD, and the mocap side of DIP/AMASS) are stored as
long-format per-frame, per-joint Parquet so the pose feature pipeline reads them uniformly,
mirroring how the IMU adapters share the canonical IMU schema.
"""

from __future__ import annotations

# Long-format canonical pose record (Hive-partitioned by dataset/subject_id/session_id).
POSE_COLUMNS: list[str] = [
    "t",            # per-session seconds
    "joint",        # canonical joint name
    "x", "y", "z",  # meters (or dataset-native units, documented per card)
    "confidence",   # nullable tracking confidence
    "subject_id",
    "session_id",
    "dataset",
    "exercise",     # nullable movement/exercise id
    "group",        # nullable cohort (e.g. CG_healthy / GPP)
    "quality_score",  # nullable clinician quality score
    "correct",      # nullable 1/0 correct-vs-incorrect
]
POSE_PARTITION: list[str] = ["dataset", "subject_id", "session_id"]

# Kinect v2 (KIMORE) 25-joint order.
KINECT25: list[str] = [
    "spine_base", "spine_mid", "neck", "head",
    "l_shoulder", "l_elbow", "l_wrist", "l_hand",
    "r_shoulder", "r_elbow", "r_wrist", "r_hand",
    "l_hip", "l_knee", "l_ankle", "l_foot",
    "r_hip", "r_knee", "r_ankle", "r_foot",
    "spine_shoulder", "l_hand_tip", "l_thumb", "r_hand_tip", "r_thumb",
]

# UI-PRMD 22-joint order (Vicon/Kinect reduced set).
UIPRMD22: list[str] = [
    "waist", "spine", "chest", "neck", "head",
    "l_shoulder", "l_elbow", "l_wrist",
    "r_shoulder", "r_elbow", "r_wrist",
    "l_hip", "l_knee", "l_ankle", "l_foot",
    "r_hip", "r_knee", "r_ankle", "r_foot",
    "spine_base", "l_toe", "r_toe",
]

# Clinical angle definitions: name -> (proximal, vertex, distal) joint names.
# The angle is measured at the vertex between the two adjacent segments.
ANGLE_TRIPLETS: dict[str, tuple[str, str, str]] = {
    "l_elbow": ("l_shoulder", "l_elbow", "l_wrist"),
    "r_elbow": ("r_shoulder", "r_elbow", "r_wrist"),
    "l_knee": ("l_hip", "l_knee", "l_ankle"),
    "r_knee": ("r_hip", "r_knee", "r_ankle"),
    "l_shoulder": ("l_elbow", "l_shoulder", "l_hip"),
    "r_shoulder": ("r_elbow", "r_shoulder", "r_hip"),
}

# Left/right joint pairs for symmetry.
SYMMETRY_PAIRS: list[tuple[str, str]] = [
    ("l_elbow", "r_elbow"),
    ("l_knee", "r_knee"),
    ("l_shoulder", "r_shoulder"),
    ("l_wrist", "r_wrist"),
    ("l_ankle", "r_ankle"),
]
