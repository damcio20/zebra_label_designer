(function (root, factory) {
	"use strict";

	const ZplEngine = factory();
	root.ZebraLabelDesigner = root.ZebraLabelDesigner || {};
	root.ZebraLabelDesigner.ZplEngine = ZplEngine;

	if (typeof module === "object" && module.exports) {
		module.exports = ZplEngine;
		module.exports.ZplEngine = ZplEngine;
	}
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	"use strict";

	const DPI_TO_DPMM = Object.freeze({ 152: 6, 153: 6, 203: 8, 300: 12, 600: 24 });
	const SUPPORTED_DPI = new Set([203, 300, 600]);
	const ROTATION_TO_ZPL = Object.freeze({ 0: "N", 90: "R", 180: "I", 270: "B" });
	const ELEMENT_TYPES = new Set(["text", "rectangle", "ellipse", "line", "image"]);
	const PLACEHOLDER_RE = /{{\s*(?:doc\.)?([A-Za-z_][A-Za-z0-9_.]*)\s*}}/g;
	const MAX_ZPL_COMMAND_VALUE = 32000;
	const MAX_GFA_BYTES = 99999;
	const MAX_RASTER_PIXELS = 24 * 1024 * 1024;
	const MAX_RAW_BYTES = 24 * 1024 * 1024;
	const HEX = Array.from({ length: 256 }, function (_, value) {
		return value.toString(16).toUpperCase().padStart(2, "0");
	});

	function finiteNumber(value, fallback) {
		const number = Number(value);
		return Number.isFinite(number) ? number : fallback;
	}

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function normalizeRotation(value) {
		const rotation = finiteNumber(value, 0);
		const normalized = ((rotation % 360) + 360) % 360;
		return Object.prototype.hasOwnProperty.call(ROTATION_TO_ZPL, normalized) ? normalized : null;
	}

	function dotsPerMillimetre(dpi) {
		const numericDpi = finiteNumber(dpi, NaN);
		if (!(numericDpi > 0)) {
			throw new RangeError("DPI must be a positive number.");
		}
		return DPI_TO_DPMM[numericDpi] || numericDpi / 25.4;
	}

	function mmToDots(mm, dpi) {
		const numericMm = finiteNumber(mm, NaN);
		if (!Number.isFinite(numericMm)) {
			throw new TypeError("Millimetres must be a finite number.");
		}
		return Math.round(numericMm * dotsPerMillimetre(dpi == null ? 203 : dpi));
	}

	function utf8Bytes(value) {
		const result = [];
		const text = String(value);
		for (let index = 0; index < text.length; index += 1) {
			let point = text.charCodeAt(index);
			if (point >= 0xd800 && point <= 0xdbff) {
				const low = text.charCodeAt(index + 1);
				if (low >= 0xdc00 && low <= 0xdfff) {
					point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00);
					index += 1;
				} else {
					point = 0xfffd;
				}
			} else if (point >= 0xdc00 && point <= 0xdfff) {
				point = 0xfffd;
			}

			if (point <= 0x7f) {
				result.push(point);
			} else if (point <= 0x7ff) {
				result.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
			} else if (point <= 0xffff) {
				result.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
			} else {
				result.push(
					0xf0 | (point >> 18),
					0x80 | ((point >> 12) & 0x3f),
					0x80 | ((point >> 6) & 0x3f),
					0x80 | (point & 0x3f)
				);
			}
		}
		return result;
	}

	function encodeTextChunk(value) {
		const normalized = String(value).replace(/\r\n?/g, "\n");
		let output = "";
		let partStart = 0;
		for (let index = 0; index <= normalized.length; index += 1) {
			if (index !== normalized.length && normalized[index] !== "\n") {
				continue;
			}
			const bytes = utf8Bytes(normalized.slice(partStart, index));
			for (const byte of bytes) {
				if (byte === 92) {
					output += "\\\\";
				} else if (byte < 32 || byte > 126 || byte === 94 || byte === 95 || byte === 126) {
					output += "_" + HEX[byte];
				} else {
					output += String.fromCharCode(byte);
				}
			}
			if (index !== normalized.length) {
				output += "\\&";
			}
			partStart = index + 1;
		}
		return output;
	}

	function escapeFieldData(value, preservePlaceholders) {
		const text = String(value == null ? "" : value);
		if (!preservePlaceholders) {
			return encodeTextChunk(text);
		}

		let output = "";
		let cursor = 0;
		PLACEHOLDER_RE.lastIndex = 0;
		let match;
		while ((match = PLACEHOLDER_RE.exec(text))) {
			output += encodeTextChunk(text.slice(cursor, match.index));
			// Keep unresolved template tokens intact so ERPNext can replace them later.
			output += match[0];
			cursor = match.index + match[0].length;
		}
		output += encodeTextChunk(text.slice(cursor));
		return output;
	}

	function ownPathValue(object, path) {
		let current = object;
		for (const part of path.split(".")) {
			if (part === "__proto__" || part === "prototype" || part === "constructor") {
				return { found: false, value: undefined };
			}
			if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part)) {
				return { found: false, value: undefined };
			}
			current = current[part];
		}
		return { found: true, value: current };
	}

	function printableValue(value) {
		if (value == null) {
			return "";
		}
		if (typeof value === "object") {
			try {
				return JSON.stringify(value);
			} catch (error) {
				return String(value);
			}
		}
		return String(value);
	}

	function interpolate(value, data, preserveUnknown) {
		const source = String(value == null ? "" : value);
		const supplied = data && typeof data === "object" ? data : {};
		const documentData = supplied.doc && typeof supplied.doc === "object" ? supplied.doc : supplied;
		PLACEHOLDER_RE.lastIndex = 0;
		return source.replace(PLACEHOLDER_RE, function (whole, path) {
			let result = ownPathValue(documentData, path);
			if (!result.found && documentData !== supplied) {
				result = ownPathValue(supplied, path);
			}
			return result.found ? printableValue(result.value) : preserveUnknown ? whole : "";
		});
	}

	function frameFor(element) {
		let x = finiteNumber(element.x, 0);
		let y = finiteNumber(element.y, 0);
		let width = finiteNumber(element.width, 0);
		let height = finiteNumber(element.height, 0);
		if (width < 0) {
			x += width;
			width = -width;
		}
		if (height < 0) {
			y += height;
			height = -height;
		}
		return { x: x, y: y, width: width, height: height };
	}

	function rotatedFrame(frame, rotation) {
		if (rotation !== 90 && rotation !== 270) {
			return frame;
		}
		const centreX = frame.x + frame.width / 2;
		const centreY = frame.y + frame.height / 2;
		return {
			x: centreX - frame.height / 2,
			y: centreY - frame.width / 2,
			width: frame.height,
			height: frame.width,
		};
	}

	function boundsToDots(frame, dpmm) {
		const x0 = Math.round(frame.x * dpmm);
		const y0 = Math.round(frame.y * dpmm);
		const x1 = Math.round((frame.x + frame.width) * dpmm);
		const y1 = Math.round((frame.y + frame.height) * dpmm);
		return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
	}

	function rotatePoint(point, centre, rotation) {
		const dx = point.x - centre.x;
		const dy = point.y - centre.y;
		switch (rotation) {
			case 90:
				return { x: centre.x - dy, y: centre.y + dx };
			case 180:
				return { x: centre.x - dx, y: centre.y - dy };
			case 270:
				return { x: centre.x + dy, y: centre.y - dx };
			default:
				return point;
		}
	}

	function colourCode(value) {
		const colour = String(value == null ? "black" : value).trim().toLowerCase();
		return colour === "white" || colour === "w" || colour === "#fff" || colour === "#ffffff" ? "W" : "B";
	}

	function fillKind(value) {
		if (value === true) {
			return "B";
		}
		if (!value) {
			return null;
		}
		const fill = String(value).trim().toLowerCase();
		if (["none", "transparent", "false", "0"].includes(fill)) {
			return null;
		}
		return colourCode(fill);
	}

	function textAlignment(element) {
		const value = String(element.text_align || element.align || "left").toLowerCase();
		return { left: "L", start: "L", center: "C", centre: "C", right: "R", end: "R", justify: "J", justified: "J" }[value] || "L";
	}

	function isBold(value) {
		if (typeof value === "number") {
			return value >= 600;
		}
		return ["bold", "bolder", "600", "700", "800", "900"].includes(String(value || "").toLowerCase());
	}

	function makeDiagnostic(level, message, elementId, code) {
		const diagnostic = { level: level, message: message };
		if (elementId != null) {
			diagnostic.elementId = String(elementId);
		}
		if (code) {
			diagnostic.code = code;
		}
		return diagnostic;
	}

	function validateDesign(design) {
		const diagnostics = [];
		if (!design || typeof design !== "object" || Array.isArray(design)) {
			return [makeDiagnostic("error", "Design must be an object.", null, "INVALID_DESIGN")];
		}
		const label = design.label;
		if (!label || typeof label !== "object") {
			return [makeDiagnostic("error", "Design must contain label settings.", null, "MISSING_LABEL")];
		}
		const width = finiteNumber(label.width_mm, NaN);
		const height = finiteNumber(label.height_mm, NaN);
		const dpi = finiteNumber(label.dpi, NaN);
		if (!(width > 0)) {
			diagnostics.push(makeDiagnostic("error", "Label width_mm must be greater than zero.", null, "INVALID_LABEL_WIDTH"));
		}
		if (!(height > 0)) {
			diagnostics.push(makeDiagnostic("error", "Label height_mm must be greater than zero.", null, "INVALID_LABEL_HEIGHT"));
		}
		if (!SUPPORTED_DPI.has(dpi)) {
			diagnostics.push(makeDiagnostic("error", "Printer DPI must be 203, 300 or 600.", null, "INVALID_DPI"));
		}
		if (width > 0 && dpi > 0 && mmToDots(width, dpi) > MAX_ZPL_COMMAND_VALUE) {
			diagnostics.push(makeDiagnostic("error", "Label width exceeds the ZPL coordinate limit.", null, "LABEL_TOO_WIDE"));
		}
		if (height > 0 && dpi > 0 && mmToDots(height, dpi) > MAX_ZPL_COMMAND_VALUE) {
			diagnostics.push(makeDiagnostic("error", "Label height exceeds the ZPL coordinate limit.", null, "LABEL_TOO_HIGH"));
		}
		if (!Array.isArray(design.elements)) {
			diagnostics.push(makeDiagnostic("error", "Design elements must be an array.", null, "INVALID_ELEMENTS"));
			return diagnostics;
		}

		const ids = new Set();
		design.elements.forEach(function (element, index) {
			if (!element || typeof element !== "object") {
				diagnostics.push(makeDiagnostic("error", "Element " + (index + 1) + " must be an object.", null, "INVALID_ELEMENT"));
				return;
			}
			const id = element.id == null ? "element-" + (index + 1) : String(element.id);
			if (ids.has(id)) {
				diagnostics.push(makeDiagnostic("error", "Element identifiers must be unique.", id, "DUPLICATE_ID"));
			}
			ids.add(id);
			if (!ELEMENT_TYPES.has(element.type)) {
				diagnostics.push(makeDiagnostic("warning", "Unsupported element type will be skipped: " + String(element.type), id, "UNSUPPORTED_TYPE"));
				return;
			}
			for (const property of ["x", "y", "width", "height"]) {
				if (!Number.isFinite(Number(element[property]))) {
					diagnostics.push(makeDiagnostic("error", property + " must be a finite number.", id, "INVALID_GEOMETRY"));
				}
			}
			if (element.type !== "line" && (!(Number(element.width) > 0) || !(Number(element.height) > 0))) {
				diagnostics.push(makeDiagnostic("error", "Element width and height must be greater than zero.", id, "INVALID_SIZE"));
			}
			if (normalizeRotation(element.rotation || 0) == null) {
				diagnostics.push(makeDiagnostic("error", "Rotation must be 0, 90, 180 or 270 degrees.", id, "INVALID_ROTATION"));
			}
			if (element.type === "text") {
				const size = finiteNumber(element.font_size_mm, NaN);
				if (!(size > 0)) {
					diagnostics.push(makeDiagnostic("error", "Text font_size_mm must be greater than zero.", id, "INVALID_FONT_SIZE"));
				} else if (dpi > 0 && mmToDots(size, dpi) < 10) {
					diagnostics.push(makeDiagnostic("warning", "Printer font height is below 10 dots and will be raised to 10 dots.", id, "FONT_TOO_SMALL"));
				}
				if (element.font_family && !["0", "zebra 0", "default"].includes(String(element.font_family).toLowerCase())) {
					diagnostics.push(makeDiagnostic("warning", "Native ZPL output uses Zebra font 0; exact browser font appearance requires raster text.", id, "FONT_SUBSTITUTED"));
				}
			}
			if (["rectangle", "ellipse", "line"].includes(element.type) && !(finiteNumber(element.stroke_width_mm, 0.4) > 0)) {
				diagnostics.push(makeDiagnostic("error", "stroke_width_mm must be greater than zero.", id, "INVALID_STROKE"));
			}
			if (element.type === "image") {
				const hasPixels = element.imageData && typeof element.imageData === "object";
				if (!hasPixels && !(typeof element.src === "string" && element.src.length)) {
					diagnostics.push(makeDiagnostic("error", "Image requires src or imageData.", id, "MISSING_IMAGE"));
				}
				const threshold = finiteNumber(element.threshold, 145);
				if (threshold < 0 || threshold > 255) {
					diagnostics.push(makeDiagnostic("warning", "Image threshold will be limited to 0–255.", id, "THRESHOLD_CLAMPED"));
				}
			}
			if (width > 0 && height > 0) {
				const frame = rotatedFrame(frameFor(element), normalizeRotation(element.rotation || 0) || 0);
				if (frame.x < 0 || frame.y < 0 || frame.x + frame.width > width || frame.y + frame.height > height) {
					diagnostics.push(makeDiagnostic("warning", "Element extends outside the label and may be clipped.", id, "ELEMENT_CLIPPED"));
				}
			}
		});

		return diagnostics;
	}

	function normalizeImageData(value) {
		if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width <= 0 || value.height <= 0) {
			throw new TypeError("Decoded image must contain positive integer width and height.");
		}
		const data = value.data;
		if (!data || data.length !== value.width * value.height * 4) {
			throw new TypeError("Decoded image RGBA data has an invalid length.");
		}
		return { width: value.width, height: value.height, data: data };
	}

	function browserDecodeImage(src) {
		if (typeof Image === "undefined" || typeof document === "undefined") {
			return Promise.reject(new Error("No browser image decoder is available; supply imageDecoder or imageData."));
		}
		return new Promise(function (resolve, reject) {
			const image = new Image();
			image.onload = function () {
				try {
					const canvas = document.createElement("canvas");
					canvas.width = image.naturalWidth || image.width;
					canvas.height = image.naturalHeight || image.height;
					const context = canvas.getContext("2d", { willReadFrequently: true });
					context.drawImage(image, 0, 0);
					resolve(context.getImageData(0, 0, canvas.width, canvas.height));
				} catch (error) {
					reject(error);
				}
			};
			image.onerror = function () {
				reject(new Error("Image could not be decoded."));
			};
			image.src = src;
		});
	}

	function parsePosition(value) {
		if (Array.isArray(value) && value.length >= 2) {
			return [clamp(finiteNumber(value[0], 0.5), 0, 1), clamp(finiteNumber(value[1], 0.5), 0, 1)];
		}
		return [0.5, 0.5];
	}

	function sampleRgba(source, x, y) {
		const clampedX = clamp(x, 0, source.width - 1);
		const clampedY = clamp(y, 0, source.height - 1);
		const x0 = Math.floor(clampedX);
		const y0 = Math.floor(clampedY);
		const x1 = Math.min(source.width - 1, x0 + 1);
		const y1 = Math.min(source.height - 1, y0 + 1);
		const fx = clampedX - x0;
		const fy = clampedY - y0;
		const result = [0, 0, 0, 0];
		for (let channel = 0; channel < 4; channel += 1) {
			const a = source.data[(y0 * source.width + x0) * 4 + channel];
			const b = source.data[(y0 * source.width + x1) * 4 + channel];
			const c = source.data[(y1 * source.width + x0) * 4 + channel];
			const d = source.data[(y1 * source.width + x1) * 4 + channel];
			result[channel] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
		}
		return result;
	}

	function resizeImage(sourceValue, targetWidth, targetHeight, fit, objectPosition) {
		const source = normalizeImageData(sourceValue);
		if (targetWidth * targetHeight > MAX_RASTER_PIXELS) {
			throw new RangeError("Raster element is too large.");
		}
		const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
		const mode = ["contain", "cover", "stretch"].includes(fit) ? fit : "stretch";
		const position = parsePosition(objectPosition);
		let scaleX = targetWidth / source.width;
		let scaleY = targetHeight / source.height;
		let drawWidth = targetWidth;
		let drawHeight = targetHeight;
		let offsetX = 0;
		let offsetY = 0;
		if (mode !== "stretch") {
			const scale = mode === "contain" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
			scaleX = scale;
			scaleY = scale;
			drawWidth = source.width * scale;
			drawHeight = source.height * scale;
			offsetX = (targetWidth - drawWidth) * position[0];
			offsetY = (targetHeight - drawHeight) * position[1];
		}

		for (let y = 0; y < targetHeight; y += 1) {
			for (let x = 0; x < targetWidth; x += 1) {
				const outputIndex = (y * targetWidth + x) * 4;
				if (mode === "contain" && (x + 0.5 < offsetX || x + 0.5 >= offsetX + drawWidth || y + 0.5 < offsetY || y + 0.5 >= offsetY + drawHeight)) {
					output[outputIndex] = 255;
					output[outputIndex + 1] = 255;
					output[outputIndex + 2] = 255;
					output[outputIndex + 3] = 0;
					continue;
				}
				const sourceX = (x + 0.5 - offsetX) / scaleX - 0.5;
				const sourceY = (y + 0.5 - offsetY) / scaleY - 0.5;
				const rgba = sampleRgba(source, sourceX, sourceY);
				for (let channel = 0; channel < 4; channel += 1) {
					output[outputIndex + channel] = Math.round(rgba[channel]);
				}
			}
		}
		return { width: targetWidth, height: targetHeight, data: output };
	}

	function rgbaToMonochrome(imageValue, options) {
		const image = normalizeImageData(imageValue);
		const settings = options || {};
		const threshold = clamp(Math.round(finiteNumber(settings.threshold, 145)), 0, 255);
		const invert = Boolean(settings.invert);
		const dither = settings.dither === true || ["floyd", "floyd-steinberg", "floyd_steinberg"].includes(String(settings.dither || "").toLowerCase());
		const greys = new Float64Array(image.width * image.height);
		for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
			const offset = pixel * 4;
			const alpha = image.data[offset + 3] / 255;
			let luminance = 0.2126 * image.data[offset] + 0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2];
			if (invert) {
				luminance = 255 - luminance;
			}
			greys[pixel] = luminance * alpha + 255 * (1 - alpha);
		}

		const pixels = new Uint8Array(image.width * image.height);
		for (let y = 0; y < image.height; y += 1) {
			const reverse = dither && y % 2 === 1;
			for (let step = 0; step < image.width; step += 1) {
				const x = reverse ? image.width - 1 - step : step;
				const index = y * image.width + x;
				const black = greys[index] < threshold;
				pixels[index] = black ? 1 : 0;
				if (!dither) {
					continue;
				}
				const error = greys[index] - (black ? 0 : 255);
				const direction = reverse ? -1 : 1;
				if (x + direction >= 0 && x + direction < image.width) {
					greys[index + direction] += (error * 7) / 16;
				}
				if (y + 1 < image.height) {
					if (x - direction >= 0 && x - direction < image.width) {
						greys[index + image.width - direction] += (error * 3) / 16;
					}
					greys[index + image.width] += (error * 5) / 16;
					if (x + direction >= 0 && x + direction < image.width) {
						greys[index + image.width + direction] += error / 16;
					}
				}
			}
		}
		return { width: image.width, height: image.height, data: pixels };
	}

	function rotateMonochrome(bitmap, rotation) {
		if (rotation === 0) {
			return bitmap;
		}
		const width = rotation === 90 || rotation === 270 ? bitmap.height : bitmap.width;
		const height = rotation === 90 || rotation === 270 ? bitmap.width : bitmap.height;
		const data = new Uint8Array(width * height);
		for (let y = 0; y < bitmap.height; y += 1) {
			for (let x = 0; x < bitmap.width; x += 1) {
				let outputX;
				let outputY;
				if (rotation === 90) {
					outputX = bitmap.height - 1 - y;
					outputY = x;
				} else if (rotation === 180) {
					outputX = bitmap.width - 1 - x;
					outputY = bitmap.height - 1 - y;
				} else {
					outputX = y;
					outputY = bitmap.width - 1 - x;
				}
				data[outputY * width + outputX] = bitmap.data[y * bitmap.width + x];
			}
		}
		return { width: width, height: height, data: data };
	}

	function cropBitmap(bitmap, left, top, right, bottom) {
		const width = right - left;
		const height = bottom - top;
		const data = new Uint8Array(width * height);
		for (let y = 0; y < height; y += 1) {
			data.set(bitmap.data.subarray((y + top) * bitmap.width + left, (y + top) * bitmap.width + right), y * width);
		}
		return { width: width, height: height, data: data };
	}

	function clipBitmap(bitmap, originX, originY, labelWidth, labelHeight) {
		const left = Math.max(0, -originX);
		const top = Math.max(0, -originY);
		const right = Math.min(bitmap.width, labelWidth - originX);
		const bottom = Math.min(bitmap.height, labelHeight - originY);
		if (right <= left || bottom <= top) {
			return null;
		}
		return {
			bitmap: left === 0 && top === 0 && right === bitmap.width && bottom === bitmap.height ? bitmap : cropBitmap(bitmap, left, top, right, bottom),
			x: originX + left,
			y: originY + top,
		};
	}

	function trimWhite(bitmap, originX, originY) {
		let left = bitmap.width;
		let top = bitmap.height;
		let right = -1;
		let bottom = -1;
		for (let y = 0; y < bitmap.height; y += 1) {
			for (let x = 0; x < bitmap.width; x += 1) {
				if (!bitmap.data[y * bitmap.width + x]) {
					continue;
				}
				left = Math.min(left, x);
				top = Math.min(top, y);
				right = Math.max(right, x);
				bottom = Math.max(bottom, y);
			}
		}
		if (right < left) {
			return null;
		}
		return {
			bitmap: left === 0 && top === 0 && right === bitmap.width - 1 && bottom === bitmap.height - 1 ? bitmap : cropBitmap(bitmap, left, top, right + 1, bottom + 1),
			x: originX + left,
			y: originY + top,
		};
	}

	function packMonochrome(bitmap) {
		const bytesPerRow = Math.ceil(bitmap.width / 8);
		const bytes = new Uint8Array(bytesPerRow * bitmap.height);
		for (let y = 0; y < bitmap.height; y += 1) {
			for (let x = 0; x < bitmap.width; x += 1) {
				if (bitmap.data[y * bitmap.width + x]) {
					bytes[y * bytesPerRow + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
				}
			}
		}
		return { width: bitmap.width, height: bitmap.height, bytesPerRow: bytesPerRow, bytes: bytes };
	}

	function bytesToHex(bytes) {
		const parts = new Array(bytes.length);
		for (let index = 0; index < bytes.length; index += 1) {
			parts[index] = HEX[bytes[index]];
		}
		return parts.join("");
	}

	function emitGfa(bitmap, originX, originY, maximumBytes) {
		const packed = packMonochrome(bitmap);
		const limit = Math.min(MAX_GFA_BYTES, Math.max(1, Math.floor(finiteNumber(maximumBytes, MAX_GFA_BYTES))));
		if (packed.bytesPerRow > limit) {
			throw new RangeError("A graphic row exceeds the ^GFA byte limit.");
		}
		const rowsPerBand = Math.max(1, Math.floor(limit / packed.bytesPerRow));
		const commands = [];
		for (let row = 0; row < packed.height; row += rowsPerBand) {
			const rows = Math.min(rowsPerBand, packed.height - row);
			const totalBytes = rows * packed.bytesPerRow;
			const start = row * packed.bytesPerRow;
			const bytes = packed.bytes.subarray(start, start + totalBytes);
			commands.push(
				"^FO" + originX + "," + (originY + row) + "^GFA," + totalBytes + "," + totalBytes + "," + packed.bytesPerRow + "," + bytesToHex(bytes) + "^FS"
			);
		}
		return commands;
	}

	function ellipseBitmap(width, height, thickness, filled) {
		if (width * height > MAX_RASTER_PIXELS) {
			throw new RangeError("Raster element is too large.");
		}
		const data = new Uint8Array(width * height);
		const radiusX = width / 2;
		const radiusY = height / 2;
		const innerX = radiusX - thickness;
		const innerY = radiusY - thickness;
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const dx = (x + 0.5 - radiusX) / radiusX;
				const dy = (y + 0.5 - radiusY) / radiusY;
				const outer = dx * dx + dy * dy <= 1;
				let inner = false;
				if (innerX > 0 && innerY > 0) {
					const innerDx = (x + 0.5 - radiusX) / innerX;
					const innerDy = (y + 0.5 - radiusY) / innerY;
					inner = innerDx * innerDx + innerDy * innerDy < 1;
				}
				data[y * width + x] = outer && (filled || !inner) ? 1 : 0;
			}
		}
		return { width: width, height: height, data: data };
	}

	function rawByteLength(value) {
		const text = String(value);
		let length = 0;
		for (let index = 0; index < text.length; index += 1) {
			const code = text.charCodeAt(index);
			if (code <= 0x7f) {
				length += 1;
			} else if (code <= 0x7ff) {
				length += 2;
			} else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
				length += 4;
				index += 1;
			} else {
				length += 3;
			}
		}
		return length;
	}

	class ZplEngine {
		constructor(options) {
			this.options = Object.assign(
				{
					dpi: 203,
					imageDecoder: null,
					maxGraphicBytes: MAX_GFA_BYTES,
					maxRawBytes: MAX_RAW_BYTES,
				},
				options || {}
			);
		}

		static mmToDots(mm, dpi) {
			return mmToDots(mm, dpi == null ? 203 : dpi);
		}

		mmToDots(mm, dpi) {
			return mmToDots(mm, dpi == null ? this.options.dpi : dpi);
		}

		validate(design) {
			return validateDesign(design);
		}

		async generate(design, options) {
			const settings = Object.assign({ data: {}, preserveUnknown: true }, options || {});
			const diagnostics = this.validate(design);
			const errors = diagnostics.filter(function (item) {
				return item.level === "error";
			});
			if (errors.length) {
				const error = new Error(errors.map(function (item) { return item.message; }).join(" "));
				error.name = "ZplValidationError";
				error.diagnostics = diagnostics;
				throw error;
			}

			const label = design.label;
			const dpi = Number(label.dpi);
			const dpmm = dotsPerMillimetre(dpi);
			const labelWidth = mmToDots(label.width_mm, dpi);
			const labelHeight = mmToDots(label.height_mm, dpi);
			const commands = ["^XA", "^CI28", "^PW" + labelWidth, "^LL" + labelHeight];
			const homeX = clamp(mmToDots(finiteNumber(label.home_x_mm, 0), dpi), 0, MAX_ZPL_COMMAND_VALUE);
			const homeY = clamp(mmToDots(finiteNumber(label.home_y_mm, 0), dpi), 0, MAX_ZPL_COMMAND_VALUE);
			commands.push("^LH" + homeX + "," + homeY);
			if (label.darkness != null && Number.isFinite(Number(label.darkness))) {
				commands.push("^MD" + clamp(Math.round(Number(label.darkness)), -30, 30));
			}
			if (label.speed != null && Number.isFinite(Number(label.speed))) {
				commands.push("^PR" + clamp(Math.round(Number(label.speed)), 1, 14));
			}

			const indexedElements = design.elements.map(function (element, index) {
				return { element: element, index: index };
			});
			indexedElements.sort(function (a, b) {
				const aOrder = finiteNumber(a.element.z_index != null ? a.element.z_index : a.element.zIndex, a.index);
				const bOrder = finiteNumber(b.element.z_index != null ? b.element.z_index : b.element.zIndex, b.index);
				return aOrder === bOrder ? a.index - b.index : aOrder - bOrder;
			});

			for (const item of indexedElements) {
				const element = item.element;
				if (element.visible === false || !ELEMENT_TYPES.has(element.type)) {
					continue;
				}
				let elementCommands;
				if (element.type === "text") {
					elementCommands = this._compileText(element, dpmm, settings);
				} else if (element.type === "rectangle") {
					elementCommands = this._compileRectangle(element, dpmm, labelWidth, labelHeight);
				} else if (element.type === "ellipse") {
					elementCommands = this._compileEllipse(element, dpmm, labelWidth, labelHeight);
				} else if (element.type === "line") {
					elementCommands = this._compileLine(element, dpmm);
				} else {
					elementCommands = await this._compileImage(element, dpmm, labelWidth, labelHeight, settings);
				}
				commands.push.apply(commands, elementCommands);
			}

			const copies = clamp(Math.round(finiteNumber(label.copies, 1)), 1, 99999999);
			if (copies !== 1) {
				commands.push("^PQ" + copies);
			}
			commands.push("^XZ");
			const zpl = commands.join("\n");
			if (rawByteLength(zpl) > finiteNumber(this.options.maxRawBytes, MAX_RAW_BYTES)) {
				throw new RangeError("Generated ZPL exceeds the configured RAW size limit.");
			}
			return zpl;
		}

		_compileText(element, dpmm, settings) {
			const rotation = normalizeRotation(element.rotation || 0) || 0;
			const frame = frameFor(element);
			const bounds = boundsToDots(rotatedFrame(frame, rotation), dpmm);
			const x = clamp(bounds.x, 0, MAX_ZPL_COMMAND_VALUE);
			const y = clamp(bounds.y, 0, MAX_ZPL_COMMAND_VALUE);
			const localWidth = clamp(Math.max(1, Math.round(frame.width * dpmm)), 1, MAX_ZPL_COMMAND_VALUE);
			const localHeight = Math.max(1, Math.round(frame.height * dpmm));
			const fontHeight = clamp(Math.max(10, Math.round(finiteNumber(element.font_size_mm, 4) * dpmm)), 10, MAX_ZPL_COMMAND_VALUE);
			const fontWidthMm = finiteNumber(element.font_width_mm, NaN);
			const fontWidth = Number.isFinite(fontWidthMm) && fontWidthMm > 0 ? clamp(Math.round(fontWidthMm * dpmm), 1, MAX_ZPL_COMMAND_VALUE) : fontHeight;
			const spacing = clamp(Math.round(finiteNumber(element.line_spacing_mm, 0) * dpmm), -9999, 9999);
			const maxLines = clamp(
				Math.round(finiteNumber(element.max_lines, Math.max(1, Math.floor(localHeight / Math.max(1, fontHeight + spacing))))),
				1,
				9999
			);
			const resolved = interpolate(element.text, settings.data, settings.preserveUnknown !== false);
			const field = escapeFieldData(resolved, settings.preserveUnknown !== false);
			const prefix = "^FO" + x + "," + y + "^A0" + ROTATION_TO_ZPL[rotation] + "," + fontHeight + "," + fontWidth + "^FB" + localWidth + "," + maxLines + "," + spacing + "," + textAlignment(element) + ",0^FH_^FD" + field + "^FS";
			if (!isBold(element.font_weight)) {
				return [prefix];
			}
			const offset = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[rotation];
			const boldX = clamp(x + offset[0], 0, MAX_ZPL_COMMAND_VALUE);
			const boldY = clamp(y + offset[1], 0, MAX_ZPL_COMMAND_VALUE);
			const duplicate = "^FO" + boldX + "," + boldY + "^A0" + ROTATION_TO_ZPL[rotation] + "," + fontHeight + "," + fontWidth + "^FB" + localWidth + "," + maxLines + "," + spacing + "," + textAlignment(element) + ",0^FH_^FD" + field + "^FS";
			return [prefix, duplicate];
		}

		_compileRectangle(element, dpmm, labelWidth, labelHeight) {
			const rotation = normalizeRotation(element.rotation || 0) || 0;
			const bounds = boundsToDots(rotatedFrame(frameFor(element), rotation), dpmm);
			const x0 = clamp(bounds.x, 0, labelWidth);
			const y0 = clamp(bounds.y, 0, labelHeight);
			const x1 = clamp(bounds.x + bounds.width, 0, labelWidth);
			const y1 = clamp(bounds.y + bounds.height, 0, labelHeight);
			if (x1 <= x0 || y1 <= y0) {
				return [];
			}
			const width = x1 - x0;
			const height = y1 - y0;
			const fill = fillKind(element.fill);
			const colour = fill || colourCode(element.stroke || element.color);
			let thickness = Math.max(1, Math.round(finiteNumber(element.stroke_width_mm, 0.4) * dpmm));
			if (fill) {
				thickness = Math.min(width, height);
			}
			thickness = clamp(thickness, 1, Math.min(width, height));
			let roundness = finiteNumber(element.roundness, NaN);
			if (!Number.isFinite(roundness)) {
				const radius = Math.max(0, finiteNumber(element.corner_radius_mm, 0) * dpmm);
				roundness = Math.min(width, height) ? (16 * radius) / Math.min(width, height) : 0;
			}
			roundness = clamp(Math.round(roundness), 0, 8);
			return ["^FO" + x0 + "," + y0 + "^GB" + width + "," + height + "," + thickness + "," + colour + "," + roundness + "^FS"];
		}

		_compileEllipse(element, dpmm, labelWidth, labelHeight) {
			const rotation = normalizeRotation(element.rotation || 0) || 0;
			const bounds = boundsToDots(rotatedFrame(frameFor(element), rotation), dpmm);
			const fill = fillKind(element.fill);
			const colour = fill || colourCode(element.stroke || element.color);
			let thickness = Math.max(1, Math.round(finiteNumber(element.stroke_width_mm, 0.4) * dpmm));
			const filled = Boolean(fill);
			if (filled) {
				thickness = Math.ceil(Math.min(bounds.width, bounds.height) / 2);
			}
			const nativeSafe = bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= labelWidth && bounds.y + bounds.height <= labelHeight && bounds.width >= 3 && bounds.height >= 3 && bounds.width <= 4095 && bounds.height <= 4095 && thickness >= 2;
			if (nativeSafe) {
				if (bounds.width === bounds.height) {
					return ["^FO" + bounds.x + "," + bounds.y + "^GC" + bounds.width + "," + clamp(thickness, 1, 4095) + "," + colour + "^FS"];
				}
				return ["^FO" + bounds.x + "," + bounds.y + "^GE" + bounds.width + "," + bounds.height + "," + clamp(thickness, 1, 4095) + "," + colour + "^FS"];
			}
			if (colour === "W") {
				return [];
			}
			let bitmap = ellipseBitmap(bounds.width, bounds.height, thickness, filled);
			let clipped = clipBitmap(bitmap, bounds.x, bounds.y, labelWidth, labelHeight);
			if (!clipped) {
				return [];
			}
			clipped = trimWhite(clipped.bitmap, clipped.x, clipped.y);
			return clipped ? emitGfa(clipped.bitmap, clipped.x, clipped.y, this.options.maxGraphicBytes) : [];
		}

		_compileLine(element, dpmm) {
			const frame = {
				x: finiteNumber(element.x, 0),
				y: finiteNumber(element.y, 0),
				width: finiteNumber(element.width, 0),
				height: finiteNumber(element.height, 0),
			};
			const rotation = normalizeRotation(element.rotation || 0) || 0;
			const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
			const first = rotatePoint({ x: frame.x, y: frame.y }, centre, rotation);
			const second = rotatePoint({ x: frame.x + frame.width, y: frame.y + frame.height }, centre, rotation);
			const x1 = clamp(Math.round(first.x * dpmm), 0, MAX_ZPL_COMMAND_VALUE);
			const y1 = clamp(Math.round(first.y * dpmm), 0, MAX_ZPL_COMMAND_VALUE);
			const x2 = clamp(Math.round(second.x * dpmm), 0, MAX_ZPL_COMMAND_VALUE);
			const y2 = clamp(Math.round(second.y * dpmm), 0, MAX_ZPL_COMMAND_VALUE);
			const thickness = clamp(Math.max(1, Math.round(finiteNumber(element.stroke_width_mm, 0.4) * dpmm)), 1, MAX_ZPL_COMMAND_VALUE);
			const colour = colourCode(element.stroke || element.color);
			if (y1 === y2) {
				const width = clamp(Math.max(thickness, Math.abs(x2 - x1) + 1), 1, MAX_ZPL_COMMAND_VALUE);
				return ["^FO" + Math.min(x1, x2) + "," + y1 + "^GB" + width + "," + thickness + "," + thickness + "," + colour + ",0^FS"];
			}
			if (x1 === x2) {
				const height = clamp(Math.max(thickness, Math.abs(y2 - y1) + 1), 1, MAX_ZPL_COMMAND_VALUE);
				return ["^FO" + x1 + "," + Math.min(y1, y2) + "^GB" + thickness + "," + height + "," + thickness + "," + colour + ",0^FS"];
			}
			const left = x1 <= x2 ? { x: x1, y: y1 } : { x: x2, y: y2 };
			const right = x1 <= x2 ? { x: x2, y: y2 } : { x: x1, y: y1 };
			const width = clamp(Math.max(3, right.x - left.x + 1), 3, MAX_ZPL_COMMAND_VALUE);
			const height = clamp(Math.max(3, Math.abs(right.y - left.y) + 1), 3, MAX_ZPL_COMMAND_VALUE);
			const direction = left.y < right.y ? "L" : "R";
			return ["^FO" + left.x + "," + Math.min(left.y, right.y) + "^GD" + width + "," + height + "," + clamp(thickness, 1, Math.min(width, height)) + "," + colour + "," + direction + "^FS"];
		}

		async _compileImage(element, dpmm, labelWidth, labelHeight, settings) {
			const source = element.imageData
				? normalizeImageData(element.imageData)
				: normalizeImageData(await (settings.imageDecoder || this.options.imageDecoder || browserDecodeImage)(element.src, element));
			const frame = frameFor(element);
			const localWidth = Math.max(1, Math.round(frame.width * dpmm));
			const localHeight = Math.max(1, Math.round(frame.height * dpmm));
			const scaled = resizeImage(source, localWidth, localHeight, element.fit || "stretch", element.object_position);
			let bitmap = rgbaToMonochrome(scaled, {
				threshold: element.threshold,
				invert: element.invert,
				dither: element.dither,
			});
			const rotation = normalizeRotation(element.rotation || 0) || 0;
			bitmap = rotateMonochrome(bitmap, rotation);
			const centreX = (frame.x + frame.width / 2) * dpmm;
			const centreY = (frame.y + frame.height / 2) * dpmm;
			const originX = Math.round(centreX - bitmap.width / 2);
			const originY = Math.round(centreY - bitmap.height / 2);
			let clipped = clipBitmap(bitmap, originX, originY, labelWidth, labelHeight);
			if (!clipped) {
				return [];
			}
			clipped = trimWhite(clipped.bitmap, clipped.x, clipped.y);
			return clipped ? emitGfa(clipped.bitmap, clipped.x, clipped.y, this.options.maxGraphicBytes) : [];
		}
	}

	ZplEngine.DPI_TO_DPMM = DPI_TO_DPMM;
	ZplEngine.escapeFieldData = escapeFieldData;
	ZplEngine._internal = Object.freeze({
		dotsPerMillimetre: dotsPerMillimetre,
		interpolate: interpolate,
		rgbaToMonochrome: rgbaToMonochrome,
		rotateMonochrome: rotateMonochrome,
		packMonochrome: packMonochrome,
		emitGfa: emitGfa,
		resizeImage: resizeImage,
		validateDesign: validateDesign,
	});

	return ZplEngine;
});
