"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ZplEngine = require("../zebra_label_designer/public/js/zpl_engine.js");

function design(elements, label) {
	return {
		version: 1,
		label: Object.assign({ width_mm: 50, height_mm: 30, dpi: 203 }, label || {}),
		elements: elements || [],
	};
}

function imageData(width, height, pixel) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const rgba = pixel(x, y);
			data.set(rgba, (y * width + x) * 4);
		}
	}
	return { width, height, data };
}

test("exports the constructor to CommonJS and the browser namespace", () => {
	assert.equal(typeof ZplEngine, "function");
	assert.equal(ZplEngine.ZplEngine, ZplEngine);
	assert.equal(globalThis.ZebraLabelDesigner.ZplEngine, ZplEngine);
});

test("uses Zebra's canonical dots-per-millimetre profiles", () => {
	assert.equal(ZplEngine.mmToDots(50, 203), 400);
	assert.equal(ZplEngine.mmToDots(50, 300), 600);
	assert.equal(ZplEngine.mmToDots(50, 600), 1200);
	assert.equal(new ZplEngine({ dpi: 300 }).mmToDots(2), 24);
	assert.equal(ZplEngine.mmToDots(25.4, 203), 203);
});

test("generates a complete RAW ZPL envelope and physical label dimensions", async () => {
	const zpl = await new ZplEngine().generate(design());
	assert.equal(zpl, "^XA\n^CI28\n^PW400\n^LL240\n^LH0,0\n^XZ");
	assert.ok(zpl.startsWith("^XA"));
	assert.ok(zpl.endsWith("^XZ"));
});

test("generates optional printer settings without persisting unsafe values", async () => {
	const zpl = await new ZplEngine().generate(
		design([], { darkness: 90, speed: 99, copies: 3, home_x_mm: 1, home_y_mm: 2 })
	);
	assert.match(zpl, /\^LH8,16/);
	assert.match(zpl, /\^MD30/);
	assert.match(zpl, /\^PR14/);
	assert.match(zpl, /\^PQ3/);
});

test("preserves unresolved ERPNext placeholders literally", async () => {
	const zpl = await new ZplEngine().generate(
		design([
			{
				id: "text-1",
				type: "text",
				x: 5,
				y: 4,
				width: 40,
				height: 6,
				rotation: 0,
				text: "Indeks: {{ doc.item_code }}",
				font_size_mm: 3,
				text_align: "left",
			},
		]),
		{ data: {}, preserveUnknown: true }
	);
	assert.match(zpl, /\^FO40,32\^A0N,24,24\^FB320,2,0,L,0\^FH_\^FDIndeks: {{ doc\.item_code }}\^FS/);
	assert.ok(!zpl.includes("item_5Fcode"));
});

test("resolves nested data and safely escapes ZPL control bytes and UTF-8", async () => {
	const zpl = await new ZplEngine().generate(
		design([
			{
				id: "text-1",
				type: "text",
				x: 0,
				y: 0,
				width: 40,
				height: 10,
				rotation: 0,
				text: "{{ doc.value }}",
				font_size_mm: 3,
			},
		]),
		{ data: { doc: { value: "A^XZ~_Ł\nB\\&" } }, preserveUnknown: true }
	);
	assert.match(zpl, /\^FDA_5EXZ_7E_5F_C5_81\\&B\\\\&\^FS/);
	assert.equal((zpl.match(/\^XZ/g) || []).length, 1, "field data cannot inject a second ^XZ command");
});

test("removes unknown placeholders only when preserveUnknown is false", async () => {
	const element = {
		id: "text-1",
		type: "text",
		x: 0,
		y: 0,
		width: 30,
		height: 5,
		rotation: 0,
		text: "A{{ doc.missing }}B",
		font_size_mm: 3,
	};
	const preserved = await new ZplEngine().generate(design([element]), { preserveUnknown: true });
	const removed = await new ZplEngine().generate(design([element]), { preserveUnknown: false });
	assert.ok(preserved.includes("A{{ doc.missing }}B"));
	assert.ok(removed.includes("^FDAB^FS"));
});

test("supports text alignment, cardinal rotation, and simulated bold", async () => {
	const zpl = await new ZplEngine().generate(
		design([
			{
				id: "text-1",
				type: "text",
				x: 10,
				y: 10,
				width: 20,
				height: 10,
				rotation: 90,
				text: "ABC",
				font_size_mm: 3,
				text_align: "center",
				font_weight: "bold",
			},
		])
	);
	assert.match(zpl, /\^FO120,40\^A0R,24,24\^FB160,3,0,C,0/);
	assert.equal((zpl.match(/\^FDABC\^FS/g) || []).length, 2);
});

test("compiles rectangles, fill, clipping, and orthogonal rotation", async () => {
	const engine = new ZplEngine();
	const plain = await engine.generate(
		design([{ id: "r", type: "rectangle", x: 1, y: 2, width: 10, height: 5, rotation: 0, stroke_width_mm: 0.25, fill: "none" }])
	);
	assert.match(plain, /\^FO8,16\^GB80,40,2,B,0\^FS/);

	const rotated = await engine.generate(
		design([{ id: "r", type: "rectangle", x: 10, y: 10, width: 20, height: 10, rotation: 90, stroke_width_mm: 0.25, fill: "black" }])
	);
	assert.match(rotated, /\^FO120,40\^GB80,160,80,B,0\^FS/);
});

test("compiles circles and ellipses with native ZPL", async () => {
	const zpl = await new ZplEngine().generate(
		design([
			{ id: "c", type: "ellipse", x: 1, y: 1, width: 8, height: 8, rotation: 0, stroke_width_mm: 0.5, fill: "none" },
			{ id: "e", type: "ellipse", x: 12, y: 1, width: 10, height: 5, rotation: 0, stroke_width_mm: 0.5, fill: "none" },
		])
	);
	assert.match(zpl, /\^FO8,8\^GC64,4,B\^FS/);
	assert.match(zpl, /\^FO96,8\^GE80,40,4,B\^FS/);
});

test("compiles horizontal, vertical, and diagonal lines", async () => {
	const zpl = await new ZplEngine().generate(
		design([
			{ id: "h", type: "line", x: 1, y: 2, width: 10, height: 0, rotation: 0, stroke_width_mm: 0.25 },
			{ id: "v", type: "line", x: 2, y: 4, width: 0, height: 8, rotation: 0, stroke_width_mm: 0.25 },
			{ id: "d", type: "line", x: 4, y: 4, width: 10, height: 5, rotation: 0, stroke_width_mm: 0.25 },
		])
	);
	assert.match(zpl, /\^FO8,16\^GB81,2,2,B,0\^FS/);
	assert.match(zpl, /\^FO16,32\^GB2,65,2,B,0\^FS/);
	assert.match(zpl, /\^FO32,32\^GD81,41,2,B,L\^FS/);
});

test("packs monochrome pixels MSB-first and pads the last byte with white", () => {
	const bitmap = {
		width: 10,
		height: 2,
		data: new Uint8Array(20).fill(1),
	};
	const packed = ZplEngine._internal.packMonochrome(bitmap);
	assert.equal(packed.bytesPerRow, 2);
	assert.deepEqual(Array.from(packed.bytes), [0xff, 0xc0, 0xff, 0xc0]);
});

test("converts an RGBA image into deterministic uncompressed ^GFA", async () => {
	const pixels = imageData(8, 1, (x) => (x % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
	const zpl = await new ZplEngine().generate(
		design([
			{ id: "img", type: "image", x: 0, y: 0, width: 1, height: 0.125, rotation: 0, imageData: pixels, threshold: 128 },
		])
	);
	assert.match(zpl, /\^FO0,0\^GFA,1,1,1,AA\^FS/);
});

test("treats transparent image pixels as white even when inversion is enabled", async () => {
	const transparentBlack = imageData(4, 4, () => [0, 0, 0, 0]);
	const zpl = await new ZplEngine().generate(
		design([
			{ id: "img", type: "image", x: 0, y: 0, width: 1, height: 1, rotation: 0, imageData: transparentBlack, threshold: 128, invert: true },
		])
	);
	assert.ok(!zpl.includes("^GFA"));
});

test("rotates monochrome raster data exactly by 90 degrees", () => {
	const source = { width: 2, height: 3, data: Uint8Array.from([1, 0, 0, 1, 1, 1]) };
	const rotated = ZplEngine._internal.rotateMonochrome(source, 90);
	assert.equal(rotated.width, 3);
	assert.equal(rotated.height, 2);
	assert.deepEqual(Array.from(rotated.data), [1, 0, 1, 1, 1, 0]);
});

test("splits graphics so each ^GFA field stays below 99,999 bytes", () => {
	const bitmap = { width: 8, height: 100001, data: new Uint8Array(100001).fill(1) };
	const commands = ZplEngine._internal.emitGfa(bitmap, 5, 7, 99999);
	assert.equal(commands.length, 2);
	assert.match(commands[0], /^\^FO5,7\^GFA,99999,99999,1,/);
	assert.match(commands[1], /^\^FO5,100006\^GFA,2,2,1,/);
});

test("accepts an injected asynchronous image decoder", async () => {
	let decodedSource;
	const engine = new ZplEngine({
		imageDecoder: async (src) => {
			decodedSource = src;
			return imageData(1, 1, () => [0, 0, 0, 255]);
		},
	});
	const zpl = await engine.generate(
		design([{ id: "img", type: "image", x: 0, y: 0, width: 1, height: 1, rotation: 0, src: "data:image/png;base64,AA==" }])
	);
	assert.equal(decodedSource, "data:image/png;base64,AA==");
	assert.ok(zpl.includes("^GFA"));
});

test("validate returns structured errors and non-blocking warnings", () => {
	const engine = new ZplEngine();
	const diagnostics = engine.validate({
		label: { width_mm: 50, height_mm: 30, dpi: 200 },
		elements: [
			{ id: "a", type: "text", x: -1, y: 0, width: 10, height: 5, rotation: 45, font_size_mm: 0.1, text: "x", font_family: "Arial" },
			{ id: "unknown", type: "barcode", x: 0, y: 0, width: 10, height: 5, rotation: 0 },
		],
	});
	assert.ok(diagnostics.some((item) => item.level === "error" && item.code === "INVALID_DPI"));
	assert.ok(diagnostics.some((item) => item.level === "error" && item.elementId === "a" && item.code === "INVALID_ROTATION"));
	assert.ok(diagnostics.some((item) => item.level === "warning" && item.elementId === "unknown" && item.code === "UNSUPPORTED_TYPE"));
	assert.ok(diagnostics.every((item) => typeof item.message === "string"));
});

test("generate rejects invalid designs with diagnostics and skips invisible elements", async () => {
	const engine = new ZplEngine();
	await assert.rejects(
		() => engine.generate(design([{ id: "bad", type: "text", x: 0, y: 0, width: 0, height: 2, rotation: 0, font_size_mm: 3, text: "bad" }])),
		(error) => error.name === "ZplValidationError" && Array.isArray(error.diagnostics)
	);
	const zpl = await engine.generate(
		design([{ id: "hidden", type: "text", x: 0, y: 0, width: 10, height: 5, rotation: 0, font_size_mm: 3, text: "SECRET", visible: false }])
	);
	assert.ok(!zpl.includes("SECRET"));
});

test("enforces the configured maximum RAW payload size", async () => {
	const engine = new ZplEngine({ maxRawBytes: 20 });
	await assert.rejects(() => engine.generate(design()), /RAW size limit/);
});
