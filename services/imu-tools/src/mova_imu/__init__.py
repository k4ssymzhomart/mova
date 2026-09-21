"""mova IMU tools: capture, rig diagnostics and offline movement analysis.

Technical, non-clinical. Nothing in this package is a clinical measurement or a
diagnosis. Angles are relative device-orientation proxies derived from the
sensors' own on-chip Euler output, not calibrated joint angles, and the scores
are engineering numbers -- see README.md's "What is real" table.

Layout:
  gateway/    vendored BLE transport, framing, parsing and rig diagnostics
  analysis/   vendored signal profiles, rep segmentation, biomechanics, scoring
  sources/    mova-authored input adapters (Phoenix captures, mova session_frames)
  exercises/  mova-authored exercise-id mapping
"""

__all__ = ["analysis", "exercises", "gateway", "sources"]
