import json

import frappe
from frappe.tests.utils import FrappeTestCase

from zebra_label_designer.zebra_label_designer.doctype.zebra_label_template.zebra_label_template import (
    parse_and_validate_design,
)


class TestZebraLabelTemplate(FrappeTestCase):
    def test_minimal_design_is_normalized(self):
        design = parse_and_validate_design(
            json.dumps(
                {
                    "version": 1,
                    "label": {"width_mm": 100, "height_mm": 50, "dpi": 203},
                    "elements": [],
                    "sample_data": {},
                }
            )
        )

        self.assertEqual(design["label"]["dpi"], 203)
        self.assertEqual(design["label"]["width_mm"], 100.0)

    def test_rejects_unknown_element_type(self):
        with self.assertRaises(frappe.ValidationError):
            parse_and_validate_design(
                {
                    "label": {"width_mm": 100, "height_mm": 50, "dpi": 203},
                    "elements": [
                        {
                            "id": "bad",
                            "type": "script",
                            "x": 0,
                            "y": 0,
                            "width": 10,
                            "height": 10,
                        }
                    ],
                }
            )

    def test_rejects_unsupported_dpi(self):
        with self.assertRaises(frappe.ValidationError):
            parse_and_validate_design(
                {
                    "label": {"width_mm": 100, "height_mm": 50, "dpi": 200},
                    "elements": [],
                }
            )
