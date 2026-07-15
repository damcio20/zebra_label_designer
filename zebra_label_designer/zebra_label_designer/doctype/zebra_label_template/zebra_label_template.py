import json
import math
import re

import frappe
from frappe import _
from frappe.model.document import Document


ALLOWED_ELEMENT_TYPES = {"text", "rectangle", "ellipse", "line", "image"}
ALLOWED_DPI = {203, 300, 600}
MAX_DESIGN_BYTES = 16 * 1024 * 1024
MAX_ZPL_BYTES = 24 * 1024 * 1024
MAX_ELEMENTS = 1000
DATA_URL_RE = re.compile(r"^data:image/(?:png|jpeg|jpg|webp);base64,", re.IGNORECASE)


class ZebraLabelTemplate(Document):
    def validate(self):
        if not self.design_json:
            self.design_json = json.dumps(
                {
                    "version": 1,
                    "label": {
                        "width_mm": float(self.label_width_mm or 100),
                        "height_mm": float(self.label_height_mm or 50),
                        "dpi": int(self.printer_dpi or 203),
                        "darkness": 15,
                        "speed": 4,
                        "copies": 1,
                    },
                    "elements": [],
                    "sample_data": {},
                },
                ensure_ascii=False,
            )
        design = parse_and_validate_design(self.design_json)
        label = design["label"]

        self.label_width_mm = label["width_mm"]
        self.label_height_mm = label["height_mm"]
        self.printer_dpi = str(label["dpi"])
        self.design_version = int(design.get("version", 1))
        self.design_json = json.dumps(design, ensure_ascii=False, separators=(",", ":"))

        if self.generated_zpl:
            validate_zpl(self.generated_zpl)


def parse_and_validate_design(value):
    if not value:
        frappe.throw(_("Design JSON is required."))

    raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_DESIGN_BYTES:
        frappe.throw(_("Design is too large (maximum 16 MB)."))

    try:
        design = json.loads(raw) if isinstance(value, str) else value
    except (TypeError, ValueError) as exc:
        frappe.throw(_("Design JSON is invalid: {0}").format(str(exc)))

    if not isinstance(design, dict):
        frappe.throw(_("Design must be a JSON object."))

    label = design.get("label")
    if not isinstance(label, dict):
        frappe.throw(_("Design must contain label settings."))

    width = _number(label.get("width_mm"), "width_mm", 1, 1000)
    height = _number(label.get("height_mm"), "height_mm", 1, 1000)
    try:
        dpi = int(label.get("dpi", 203))
    except (TypeError, ValueError):
        dpi = 0
    if dpi not in ALLOWED_DPI:
        frappe.throw(_("Printer DPI must be 203, 300 or 600."))

    elements = design.get("elements", [])
    if not isinstance(elements, list) or len(elements) > MAX_ELEMENTS:
        frappe.throw(_("Design can contain at most {0} elements.").format(MAX_ELEMENTS))

    validated_elements = []
    seen_ids = set()
    for index, element in enumerate(elements):
        if not isinstance(element, dict):
            frappe.throw(_("Element {0} is invalid.").format(index + 1))
        element_type = element.get("type")
        if element_type not in ALLOWED_ELEMENT_TYPES:
            frappe.throw(_("Unsupported element type: {0}").format(element_type))
        element_id = str(element.get("id") or "element-{0}".format(index + 1))[:140]
        if element_id in seen_ids:
            frappe.throw(_("Element identifiers must be unique."))
        seen_ids.add(element_id)

        clean = dict(element)
        clean["id"] = element_id
        for key in ("x", "y"):
            clean[key] = _number(clean.get(key), key, -1000, 2000)
        for key in ("width", "height"):
            clean[key] = _number(clean.get(key), key, 0, 2000)

        rotation = int(_number(clean.get("rotation", 0), "rotation", -360, 360)) % 360
        if rotation not in (0, 90, 180, 270):
            frappe.throw(_("Rotation must be 0, 90, 180 or 270 degrees."))
        clean["rotation"] = rotation

        if element_type == "text":
            clean["text"] = str(clean.get("text", ""))[:10000]
            clean["font_size_mm"] = _number(
                clean.get("font_size_mm", 4), "font_size_mm", 0.5, 100
            )
        elif element_type in {"rectangle", "ellipse", "line"}:
            clean["stroke_width_mm"] = _number(
                clean.get("stroke_width_mm", 0.4), "stroke_width_mm", 0.05, 50
            )
        elif element_type == "image":
            source = str(clean.get("src", ""))
            if not DATA_URL_RE.match(source):
                frappe.throw(_("Images must be embedded PNG, JPEG or WebP Data URLs."))
            if len(source.encode("utf-8")) > 8 * 1024 * 1024:
                frappe.throw(_("A single embedded image cannot exceed 8 MB."))
            clean["threshold"] = int(_number(clean.get("threshold", 145), "threshold", 0, 255))

        validated_elements.append(clean)

    try:
        version = int(design.get("version", 1) or 1)
    except (TypeError, ValueError):
        frappe.throw(_("Design version must be a whole number."))
    if version < 1 or version > 1000:
        frappe.throw(_("Design version must be between 1 and 1000."))
    design["version"] = version
    design["label"] = dict(label, width_mm=width, height_mm=height, dpi=dpi)
    design["elements"] = validated_elements

    sample_data = design.get("sample_data", {})
    if not isinstance(sample_data, dict):
        frappe.throw(_("Sample data must be a JSON object."))

    return design


def validate_zpl(value):
    if not isinstance(value, str):
        frappe.throw(_("Generated ZPL must be text."))
    if len(value.encode("utf-8")) > MAX_ZPL_BYTES:
        frappe.throw(_("Generated ZPL is too large (maximum 24 MB)."))
    stripped = value.strip()
    if not stripped.startswith("^XA") or not stripped.endswith("^XZ"):
        frappe.throw(_("Generated ZPL must start with ^XA and end with ^XZ."))


def _number(value, fieldname, minimum, maximum):
    try:
        number = float(value)
    except (TypeError, ValueError):
        frappe.throw(_("{0} must be a number.").format(fieldname))
    if not math.isfinite(number) or number < minimum or number > maximum:
        frappe.throw(
            _("{0} must be between {1} and {2}.").format(fieldname, minimum, maximum)
        )
    return round(number, 3)
