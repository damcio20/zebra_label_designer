app_name = "zebra_label_designer"
app_title = "Zebra Label Designer"
app_publisher = "MARAND"
app_description = "Visual Zebra ZPL label designer for ERPNext/Frappe"
app_email = ""
app_license = "MIT"

required_apps = ["erpnext"]

# The app does not require scheduler jobs or external services. Everything that
# touches a user's document is executed through permission-aware whitelisted API
# methods in zebra_label_designer.api.
