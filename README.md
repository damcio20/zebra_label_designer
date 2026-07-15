# Zebra Label Designer for ERPNext

A lightweight Zebra label editor running as a page inside ERPNext/Frappe Desk. It allows you to define the physical label size, arrange text, rectangles, ellipses, lines, and images, and then generate a raw ZPL print stream (`.prn`).

## Features

- SVG canvas using millimetres for coordinates and dimensions,
- 203, 300, and 600 DPI printer profiles,
- text, rectangles, ellipses, lines, and PNG/JPEG images,
- drag-and-drop positioning, resizing, 90° rotation, layer ordering, and duplication,
- grid, snapping, zoom, undo, and redo,
- image conversion to monochrome `^GFA`,
- text templates such as `{{ doc.item_code }}` and JSON preview data,
- project storage in the `Zebra Label Template` DocType,
- ZPL copying and `.prn` file downloads.

## Installation

The simplest method is to install the application inside your `frappe-bench` directory.

### Installation from GitHub

```bash
cd ~/frappe-bench

bench get-app https://github.com/damcio20/zebra_label_designer.git

bench --site your-site.local install-app zebra_label_designer

bench build --app zebra_label_designer

bench --site your-site.local migrate

bench restart

bench --site your-site.local clear-cache
```

Replace `your-site.local` with the actual name of your Frappe site.

### Installation from a local directory

```bash
cd ~/frappe-bench

bench get-app file:///full/path/to/zebra_label_designer

bench --site your-site.local install-app zebra_label_designer

bench build --app zebra_label_designer

bench --site your-site.local migrate

bench restart

bench --site your-site.local clear-cache
```

### Manual installation from a ZIP archive

```bash
cd ~/frappe-bench

unzip /full/path/to/zebra_label_designer-0.1.0.zip -d apps/

./env/bin/pip install -e apps/zebra_label_designer

grep -qxF zebra_label_designer sites/apps.txt || echo zebra_label_designer >> sites/apps.txt

bench --site your-site.local install-app zebra_label_designer

bench build --app zebra_label_designer

bench --site your-site.local migrate

bench restart

bench --site your-site.local clear-cache
```

### Docker installation

When Bench runs inside Docker, execute the installation commands inside the backend container.

Example:

```bash
docker compose exec backend bench --site your-site.local install-app zebra_label_designer

docker compose exec backend bench build --app zebra_label_designer

docker compose exec backend bench --site your-site.local migrate

docker compose exec backend bench --site your-site.local clear-cache
```

For a persistent Docker installation, the application should be included in a custom Frappe/ERPNext image. Installing it only inside a running container may cause the application to disappear when the container is recreated.

## Opening the Designer

After installation, open **Zebra Label Designer** from the Frappe Desk search or navigate directly to:

```text
/app/zebra-label-editor
```

## Installation Test

Run:

```bash
bench --site your-site.local execute zebra_label_designer.api.list_templates
```

For Docker:

```bash
docker compose exec backend bench --site your-site.local execute zebra_label_designer.api.list_templates
```

## Permissions

The `System Manager` role has full access.

Users with the `Stock User` role can:

- create label templates,
- read label templates,
- edit label templates,
- export and print templates.

Users with the `Stock Manager` role can also delete label templates.

## ERPNext Data Binding

Text elements can use fields from an ERPNext document.

Example:

```text
Item code: {{ doc.item_code }}
Batch: {{ doc.batch_no }}
```

The editor uses JSON preview data while designing the label.

From server-side code, ZPL can be generated using data from an actual ERPNext document:

```python
frappe.call(
    "zebra_label_designer.api.render_template",
    template="Product Label 100x50",
    document_name="ITEM-0001",
)
```

The `source_doctype` stored in the template defines the document type.

The rendering method respects the current user's read permissions for the selected document.

## Printing Notes

- The application generates ZPL but does not establish a direct network connection to the printer.
- Polish and other Unicode characters are sent as UTF-8 using `^CI28`.
- Unicode compatibility depends on the printer font and firmware.
- Always test the generated output on the target Zebra printer before production use.
- Image processing runs in the browser.
- Saved projects store imported images as Data URLs.
- Generated `.prn` files can be sent to a Zebra printer using operating-system tools, print servers, Zebra utilities, or custom integrations.

## Supported Elements

The editor currently supports:

- text,
- rectangles,
- ellipses,
- lines,
- PNG images,
- JPEG images.

Elements can be:

- moved,
- resized,
- rotated in 90-degree steps,
- duplicated,
- reordered between layers,
- hidden,
- locked,
- removed.

## Label Configuration

Each label template can define:

- width in millimetres,
- height in millimetres,
- printer DPI,
- grid size,
- snapping,
- print darkness,
- print speed,
- number of copies,
- source DocType,
- preview data,
- label elements.

Supported DPI profiles:

- 203 DPI,
- 300 DPI,
- 600 DPI.

## RAW and ZPL Export

The designer generates Zebra Programming Language output enclosed between:

```text
^XA
...
^XZ
```

The generated output can be:

- copied to the clipboard,
- downloaded as a `.prn` file,
- stored in a `Zebra Label Template`,
- generated from server-side ERPNext data.

## Tests

Run JavaScript tests:

```bash
node --test tests/zpl_engine.test.js
```

Run Python compilation checks:

```bash
python -m compileall zebra_label_designer
```

## Project Structure

```text
zebra_label_designer/
├── examples/
│   └── product_label.json
├── tests/
│   └── zpl_engine.test.js
├── zebra_label_designer/
│   ├── api.py
│   ├── hooks.py
│   ├── public/
│   │   ├── css/
│   │   │   └── zebra_label_designer.css
│   │   └── js/
│   │       ├── zebra_label_designer.js
│   │       └── zpl_engine.js
│   ├── translations/
│   │   └── pl.csv
│   └── zebra_label_designer/
│       ├── doctype/
│       │   └── zebra_label_template/
│       ├── page/
│       │   └── zebra_label_editor/
│       └── workspace/
│           └── zebra_label_designer/
├── MANIFEST.in
├── pyproject.toml
├── README.md
└── license.txt
```

## Compatibility

The application is built using the Frappe Framework.

It has been tested with:

```text
Frappe 16.17.0
ERPNext 16.16.0
```

The core editor is based on Frappe and does not inherently require ERPNext business modules. However, the current permission configuration includes ERPNext roles such as `Stock User` and `Stock Manager`.

Additional testing on a plain Frappe installation is recommended before using it without ERPNext.

## License

MIT
