import json
import re

import frappe
from frappe import _

from zebra_label_designer.zebra_label_designer.doctype.zebra_label_template.zebra_label_template import (
    parse_and_validate_design,
    validate_zpl,
)


PLACEHOLDER_RE = re.compile(r"{{\s*(?:doc\.)?([A-Za-z_][A-Za-z0-9_.]*)\s*}}")


@frappe.whitelist()
def list_templates(search=None):
    filters = {"is_active": 1}
    or_filters = None
    if search:
        or_filters = {
            "name": ["like", "%{0}%".format(search)],
            "template_name": ["like", "%{0}%".format(search)],
        }

    return frappe.get_list(
        "Zebra Label Template",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name",
            "template_name",
            "label_width_mm",
            "label_height_mm",
            "printer_dpi",
            "source_doctype",
            "modified",
        ],
        order_by="modified desc",
        limit_page_length=200,
    )


@frappe.whitelist()
def get_template(name):
    doc = frappe.get_doc("Zebra Label Template", name)
    doc.check_permission("read")
    return _serialize_template(doc)


@frappe.whitelist()
def save_template(
    template_name,
    design_json,
    generated_zpl,
    document_name=None,
    source_doctype=None,
):
    template_name = (template_name or "").strip()
    if not template_name:
        frappe.throw(_("Template name is required."))
    if len(template_name) > 140:
        frappe.throw(_("Template name cannot exceed 140 characters."))

    design = parse_and_validate_design(design_json)
    validate_zpl(generated_zpl)

    if document_name:
        doc = frappe.get_doc("Zebra Label Template", document_name)
        doc.check_permission("write")
        # Renaming is deliberately handled by the standard document form so a
        # designer save cannot unexpectedly change links to an existing record.
        template_name = doc.template_name
    else:
        if frappe.db.exists("Zebra Label Template", template_name):
            frappe.throw(
                _("A template with this name already exists. Open it before saving.")
            )
        doc = frappe.new_doc("Zebra Label Template")
        doc.template_name = template_name

    doc.design_json = json.dumps(design, ensure_ascii=False, separators=(",", ":"))
    doc.generated_zpl = generated_zpl
    doc.source_doctype = (source_doctype or design.get("source_doctype") or "").strip() or None
    doc.is_active = 1

    if doc.is_new():
        doc.insert()
    else:
        doc.save()

    return _serialize_template(doc)


@frappe.whitelist()
def render_template(template, document_name=None, data=None):
    """Return permission-aware ZPL with ``{{ doc.field }}`` values resolved.

    ``data`` is useful for integrations that already have a payload. When a
    document name is provided, the template's Source DocType is loaded and its
    normal Frappe read permissions are checked before field values are used.
    """

    template_doc = frappe.get_doc("Zebra Label Template", template)
    template_doc.check_permission("read")

    context = {}
    if data:
        try:
            context = json.loads(data) if isinstance(data, str) else data
        except (TypeError, ValueError) as exc:
            frappe.throw(_("Render data is invalid JSON: {0}").format(str(exc)))
        if not isinstance(context, dict):
            frappe.throw(_("Render data must be a JSON object."))
    elif document_name:
        if not template_doc.source_doctype:
            frappe.throw(_("Set Source DocType on the label template first."))
        source_doc = frappe.get_doc(template_doc.source_doctype, document_name)
        source_doc.check_permission("read")
        context = source_doc.as_dict(convert_dates_to_str=True)

    if "doc" in context and isinstance(context["doc"], dict):
        context = context["doc"]

    raw = template_doc.generated_zpl or ""
    validate_zpl(raw)

    def replace(match):
        value = _resolve_path(context, match.group(1))
        return _escape_zpl_field("" if value is None else str(value))

    return PLACEHOLDER_RE.sub(replace, raw)


def _serialize_template(doc):
    return {
        "name": doc.name,
        "template_name": doc.template_name,
        "source_doctype": doc.source_doctype,
        "label_width_mm": doc.label_width_mm,
        "label_height_mm": doc.label_height_mm,
        "printer_dpi": int(doc.printer_dpi or 203),
        "design_json": doc.design_json,
        "generated_zpl": doc.generated_zpl,
        "modified": doc.modified,
    }


def _resolve_path(data, path):
    current = data
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, (list, tuple)) and part.isdigit():
            index = int(part)
            current = current[index] if index < len(current) else None
        else:
            return None
        if current is None:
            return None
    return current


def _escape_zpl_field(value):
    # Fields produced by the JS generator use ^FH with '_' as the escape marker.
    # Encode control bytes, command delimiters and all non-ASCII UTF-8 bytes.
    result = []
    for byte in value.encode("utf-8"):
        if byte == 92:
            # ^FB uses backslash sequences (for example \& for a new line).
            # Doubling a user-provided slash prevents it from becoming layout
            # control data after placeholder substitution.
            result.append("\\\\")
        elif byte < 32 or byte > 126 or byte in (94, 95, 126):
            result.append("_{0:02X}".format(byte))
        else:
            result.append(chr(byte))
    return "".join(result)
