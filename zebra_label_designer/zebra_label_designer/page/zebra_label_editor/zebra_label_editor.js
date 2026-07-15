frappe.pages["zebra-label-editor"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Zebra Label Designer"),
		single_column: true,
	});

	frappe.require("/assets/zebra_label_designer/css/zebra_label_designer.css", () => {
		frappe.require("/assets/zebra_label_designer/js/zpl_engine.js", () => {
			frappe.require("/assets/zebra_label_designer/js/zebra_label_designer.js", () => {
				wrapper.zebra_label_designer = new window.ZebraLabelDesigner.Editor({
					wrapper,
					page,
				});
				wrapper.zebra_label_designer.handle_route_options();
			});
		});
	});
};

frappe.pages["zebra-label-editor"].on_page_show = function (wrapper) {
	wrapper.zebra_label_designer?.handle_route_options();
};
