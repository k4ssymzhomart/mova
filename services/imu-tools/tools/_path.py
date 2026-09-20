"""Make `tools/` importable so the sibling imports below resolve.

Several tools import each other by bare name (`from rep_labels import ...`).
That works for free when a script is *run* from this directory, because Python
puts the script's own directory on `sys.path`. It does not work when the same
module is *imported* -- which is what the dev-tools server does. Importing this
module first makes both cases behave the same.

`mova_imu` itself is never reached this way: it comes from the installed
package (`pip install -e services/imu-tools`).
"""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
CAPTURE_DIR = ROOT / "captures"

if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
