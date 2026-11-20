"""Use the same dimensions for Blender and the offline Demo."""

import json
from pathlib import Path


definition = (Path(__file__).resolve().parents[2] / "aquarium-layout.js").read_text(encoding="utf-8")
TANK = json.loads(definition[definition.index("{"):definition.rindex("}") + 1])
