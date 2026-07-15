frappe.ui.form.on("Zebra Label Template", {
	refresh(frm) {
		if (frm.is_new()) {
			return;
		}

		frm.add_custom_button(__("Open designer"), () => {
			frappe.route_options = { zebra_template: frm.doc.name };
			frappe.set_route("zebra-label-designer");
		});

		if (frm.doc.generated_zpl) {
			frm.add_custom_button(
				__("Copy ZPL"),
				async () => {
					if (navigator.clipboard && navigator.clipboard.writeText) {
						await navigator.clipboard.writeText(frm.doc.generated_zpl);
					} else {
						const textarea = document.createElement("textarea");
						textarea.value = frm.doc.generated_zpl;
						textarea.style.position = "fixed";
						textarea.style.opacity = "0";
						document.body.appendChild(textarea);
						textarea.select();
						document.execCommand("copy");
						textarea.remove();
					}
					frappe.show_alert({ message: __("ZPL copied"), indicator: "green" });
				},
				__("Export")
			);
		}
	},
});
