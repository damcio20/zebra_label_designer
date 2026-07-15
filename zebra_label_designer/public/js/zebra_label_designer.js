(function () {
	"use strict";

	const NS = (window.ZebraLabelDesigner = window.ZebraLabelDesigner || {});
	const SVG_NS = "http://www.w3.org/2000/svg";
	const MM_PX = 4;
	const HISTORY_LIMIT = 100;
	let idCounter = 0;

	function __(text) {
		return typeof window.__ === "function" ? window.__(text) : text;
	}

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function finite(value, fallback) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function round(value, precision) {
		const power = 10 ** (precision || 3);
		return Math.round(value * power) / power;
	}

	function uid(prefix) {
		idCounter += 1;
		return `${prefix || "element"}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
	}

	function safeColor(value, fallback) {
		const color = String(value || "").trim();
		return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent|none)$/i.test(color)
			? color
			: fallback;
	}

	function createElement(tag, className, text) {
		const element = document.createElement(tag);
		if (className) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	}

	function createSvg(tag, attributes) {
		const element = document.createElementNS(SVG_NS, tag);
		Object.entries(attributes || {}).forEach(([key, value]) => {
			if (value !== undefined && value !== null) element.setAttribute(key, String(value));
		});
		return element;
	}

	function defaultDesign() {
		return {
			version: 1,
			label: {
				width_mm: 100,
				height_mm: 50,
				dpi: 203,
				grid_mm: 2,
				snap: true,
				show_grid: true,
				darkness: 15,
				speed: 4,
				copies: 1,
			},
			source_doctype: "",
			sample_data: {},
			elements: [],
		};
	}

	function normalizeDesign(input) {
		const source = input && typeof input === "object" ? clone(input) : defaultDesign();
		const defaults = defaultDesign();
		source.version = Math.max(1, Math.trunc(finite(source.version, 1)));
		source.label = Object.assign({}, defaults.label, source.label || {});
		source.label.width_mm = clamp(finite(source.label.width_mm, 100), 1, 1000);
		source.label.height_mm = clamp(finite(source.label.height_mm, 50), 1, 1000);
		source.label.dpi = [203, 300, 600].includes(Number(source.label.dpi))
			? Number(source.label.dpi)
			: 203;
		source.label.grid_mm = clamp(finite(source.label.grid_mm, 2), 0.1, 100);
		source.label.snap = source.label.snap !== false;
		source.label.show_grid = source.label.show_grid !== false;
		source.label.darkness = clamp(finite(source.label.darkness, 15), 0, 30);
		source.label.speed = clamp(finite(source.label.speed, 4), 1, 14);
		source.label.copies = clamp(Math.trunc(finite(source.label.copies, 1)), 1, 9999);
		source.source_doctype = String(source.source_doctype || "");
		source.sample_data = source.sample_data && typeof source.sample_data === "object" && !Array.isArray(source.sample_data)
			? source.sample_data
			: {};
		source.elements = Array.isArray(source.elements)
			? source.elements.map((item, index) => normalizeElement(item, index))
			: [];
		return source;
	}

	function normalizeElement(item, index) {
		const source = item && typeof item === "object" ? Object.assign({}, item) : {};
		const type = ["text", "rectangle", "ellipse", "line", "image"].includes(source.type)
			? source.type
			: "text";
		const isLine = type === "line";
		let normalizedWidth = Math.max(isLine ? 0 : 0.5, finite(source.width, type === "text" ? 40 : 30));
		let normalizedHeight = Math.max(isLine ? 0 : 0.5, finite(source.height, type === "text" ? 10 : isLine ? 0 : 20));
		if (isLine && normalizedWidth === 0 && normalizedHeight === 0) normalizedWidth = 30;
		const output = Object.assign(source, {
			id: String(source.id || uid(type)),
			type,
			name: String(source.name || `${typeLabel(type)} ${index + 1}`),
			x: finite(source.x, 10),
			y: finite(source.y, 10),
			width: normalizedWidth,
			height: normalizedHeight,
			rotation: [0, 90, 180, 270].includes(Number(source.rotation)) ? Number(source.rotation) : 0,
			visible: source.visible !== false,
			locked: source.locked === true,
		});
		if (type === "text") {
			output.text = String(source.text === undefined ? __("Przykładowy tekst") : source.text);
			output.font_size_mm = clamp(finite(source.font_size_mm, 4), 0.5, 100);
			output.font_family = String(source.font_family || "Arial");
			output.font_weight = String(source.font_weight || "normal");
			output.text_align = ["left", "center", "right"].includes(source.text_align || source.align)
				? source.text_align || source.align
				: "left";
			output.color = safeColor(source.color, "#000000");
		} else if (["rectangle", "ellipse", "line"].includes(type)) {
			output.stroke = safeColor(source.stroke, "#000000");
			output.fill = type === "line" ? "none" : safeColor(source.fill, "transparent");
			output.stroke_width_mm = clamp(finite(source.stroke_width_mm, 0.4), 0.05, 50);
		} else if (type === "image") {
			output.src = String(source.src || "");
			output.threshold = clamp(Math.trunc(finite(source.threshold, 145)), 0, 255);
			output.invert = source.invert === true;
			output.dither = source.dither === true;
			output.fit = ["contain", "cover", "stretch"].includes(source.fit) ? source.fit : "contain";
		}
		return output;
	}

	function typeLabel(type) {
		return {
			text: __("Tekst"),
			rectangle: __("Prostokąt"),
			ellipse: __("Elipsa"),
			line: __("Linia"),
			image: __("Obraz"),
		}[type] || __("Element");
	}

	class Editor {
		constructor(options) {
			this.wrapper = options && options.wrapper;
			this.page = options && options.page;
			this.host = this.wrapper && this.wrapper.querySelector
				? this.wrapper.querySelector(".layout-main-section") || this.wrapper
				: null;
			if (!this.host) throw new Error("Zebra Label Designer requires a wrapper element.");
			this.host.classList.add("zld-host");

			this.design = defaultDesign();
			this.documentName = null;
			this.templateName = __("Nowa etykieta");
			this.selectedId = null;
			this.zoom = 1;
			this.engine = typeof NS.ZplEngine === "function" ? new NS.ZplEngine() : NS.ZplEngine;
			this.activeTab = "element";
			this.raw = "";
			this.interaction = null;
			this.dragLayerId = null;
			this.savedSnapshot = JSON.stringify(this.design);
			this.history = [this.savedSnapshot];
			this.historyIndex = 0;
			this.routeRequest = null;
			this.boundKeydown = this.onKeydown.bind(this);
			this.boundPointerMove = this.onPointerMove.bind(this);
			this.boundPointerUp = this.onPointerUp.bind(this);

			this.build();
			this.bind();
			this.renderAll();
			this.fitZoom();
			window.setTimeout(() => this.handle_route_options(), 0);
		}

		build() {
			this.app = createElement("div", "zld-app");
			this.app.innerHTML = `
				<header class="zld-topbar">
					<div class="zld-topbar__brand">Zebra Label Designer</div>
					<div class="zld-topbar__document">
						<span class="zld-topbar__title" data-role="title"></span>
						<span class="zld-status" data-role="status"></span>
					</div>
					<div class="zld-topbar__actions">
						<button class="zld-btn zld-btn--ghost zld-btn--compact" type="button" data-action="new">＋ <span class="zld-btn__label">${__("Nowa")}</span></button>
						<button class="zld-btn zld-btn--ghost zld-btn--compact" type="button" data-action="open">⌕ <span class="zld-btn__label">${__("Otwórz")}</span></button>
						<span class="zld-topbar__divider"></span>
						<button class="zld-icon-btn" type="button" data-action="undo" title="${__("Cofnij (Ctrl+Z)")}">↶</button>
						<button class="zld-icon-btn" type="button" data-action="redo" title="${__("Ponów (Ctrl+Y)")}">↷</button>
						<button class="zld-btn zld-btn--ghost zld-btn--compact" type="button" data-action="raw">RAW</button>
						<button class="zld-btn zld-btn--primary zld-btn--compact" type="button" data-action="save">${__("Zapisz")}</button>
					</div>
				</header>
				<div class="zld-workspace">
					<aside class="zld-tools" aria-label="${__("Narzędzia")}">
						<div class="zld-tools__section">
							<button class="zld-tool zld-is-active" type="button" data-tool="select" title="${__("Zaznacz (V)")}"><span class="zld-tool__icon">↖</span><span class="zld-tool__label">${__("Wybierz")}</span><span class="zld-tool__shortcut">V</span></button>
							<button class="zld-tool" type="button" data-tool="text" title="${__("Dodaj tekst (T)")}"><span class="zld-tool__icon">T</span><span class="zld-tool__label">${__("Tekst")}</span><span class="zld-tool__shortcut">T</span></button>
							<button class="zld-tool" type="button" data-tool="rectangle" title="${__("Dodaj prostokąt (R)")}"><span class="zld-tool__icon">□</span><span class="zld-tool__label">${__("Prostokąt")}</span><span class="zld-tool__shortcut">R</span></button>
							<button class="zld-tool" type="button" data-tool="ellipse" title="${__("Dodaj elipsę (E)")}"><span class="zld-tool__icon">○</span><span class="zld-tool__label">${__("Elipsa")}</span><span class="zld-tool__shortcut">E</span></button>
							<button class="zld-tool" type="button" data-tool="line" title="${__("Dodaj linię (L)")}"><span class="zld-tool__icon">╱</span><span class="zld-tool__label">${__("Linia")}</span><span class="zld-tool__shortcut">L</span></button>
							<button class="zld-tool" type="button" data-tool="image" title="${__("Dodaj obraz (I)")}"><span class="zld-tool__icon">▧</span><span class="zld-tool__label">${__("Obraz")}</span><span class="zld-tool__shortcut">I</span></button>
						</div>
						<div class="zld-tools__spacer"></div>
						<div class="zld-tools__section">
							<button class="zld-tool" type="button" data-action="duplicate" title="${__("Duplikuj (Ctrl+D)")}"><span class="zld-tool__icon">⧉</span><span class="zld-tool__label">${__("Duplikuj")}</span></button>
							<button class="zld-tool" type="button" data-action="delete" title="${__("Usuń (Delete)")}"><span class="zld-tool__icon">⌫</span><span class="zld-tool__label">${__("Usuń")}</span></button>
						</div>
					</aside>
					<main class="zld-stage-shell" data-role="stage-shell">
						<div class="zld-stage-viewport">
							<div class="zld-stage" data-role="stage" tabindex="0" aria-label="${__("Obszar etykiety")}"></div>
						</div>
						<div class="zld-stage-toolbar">
							<button class="zld-icon-btn" type="button" data-action="zoom-out" title="${__("Pomniejsz")}">−</button>
							<button class="zld-zoom-value" type="button" data-action="zoom-fit" title="${__("Dopasuj")}"></button>
							<button class="zld-icon-btn" type="button" data-action="zoom-in" title="${__("Powiększ")}">＋</button>
							<button class="zld-btn zld-btn--compact zld-btn--ghost" type="button" data-action="toggle-grid">${__("Siatka")}</button>
							<button class="zld-btn zld-btn--compact zld-btn--ghost" type="button" data-action="toggle-snap">${__("Snap")}</button>
						</div>
					</main>
					<aside class="zld-inspector zld-is-open" data-role="inspector" aria-hidden="false">
						<div class="zld-inspector__header">
							<h2 class="zld-inspector__title" data-role="inspector-title"></h2>
							<div class="zld-inspector__actions"><button class="zld-icon-btn" type="button" data-action="delete" title="${__("Usuń")}">⌫</button></div>
						</div>
						<div class="zld-tabs" role="tablist">
							<button class="zld-tab" type="button" data-tab="element">${__("Element")}</button>
							<button class="zld-tab" type="button" data-tab="label">${__("Etykieta")}</button>
							<button class="zld-tab" type="button" data-tab="layers">${__("Warstwy")}</button>
							<button class="zld-tab" type="button" data-tab="data">${__("Dane")}</button>
						</div>
						<div class="zld-inspector__body" data-role="inspector-body"></div>
					</aside>
					<section class="zld-raw-panel zld-is-collapsed" data-role="raw-panel" aria-hidden="true">
						<header class="zld-raw-panel__header">
							<h2 class="zld-raw-panel__title">${__("RAW / ZPL")}</h2>
							<span class="zld-raw-panel__meta" data-role="raw-meta"></span>
							<div class="zld-raw-panel__actions">
								<button class="zld-btn zld-btn--compact" type="button" data-action="copy-raw">${__("Kopiuj")}</button>
								<button class="zld-btn zld-btn--compact" type="button" data-action="download-raw">${__("Pobierz .prn")}</button>
								<button class="zld-icon-btn" type="button" data-action="close-raw" title="${__("Zamknij")}">×</button>
							</div>
						</header>
						<div class="zld-raw-panel__body"><pre class="zld-raw-code" data-role="raw-code"></pre></div>
						<footer class="zld-raw-panel__footer"><span>${__("Podgląd używa przykładowych danych z zakładki Dane.")}</span></footer>
					</section>
				</div>
				<input class="zld-visually-hidden" data-role="image-input" type="file" accept="image/png,image/jpeg,image/webp">
				<div class="zld-dialog-backdrop" data-role="dialog-host" aria-hidden="true"></div>
				<div class="zld-toast-region" data-role="toasts" aria-live="polite"></div>`;

			this.host.replaceChildren(this.app);
			this.stage = this.app.querySelector('[data-role="stage"]');
			this.stageShell = this.app.querySelector('[data-role="stage-shell"]');
			this.inspectorBody = this.app.querySelector('[data-role="inspector-body"]');
			this.imageInput = this.app.querySelector('[data-role="image-input"]');
			this.dialogHost = this.app.querySelector('[data-role="dialog-host"]');
			this.toastRegion = this.app.querySelector('[data-role="toasts"]');
		}

		bind() {
			this.app.addEventListener("click", (event) => this.onClick(event));
			this.stage.addEventListener("pointerdown", (event) => this.onPointerDown(event));
			this.imageInput.addEventListener("change", () => this.readImage());
			document.addEventListener("keydown", this.boundKeydown);
			document.addEventListener("pointermove", this.boundPointerMove);
			document.addEventListener("pointerup", this.boundPointerUp);
			window.addEventListener("resize", () => this.renderStageSize());
		}

		onClick(event) {
			const tool = event.target.closest("[data-tool]");
			if (tool) {
				const type = tool.dataset.tool;
				if (type !== "select") this.addElement(type);
				this.setActiveTool("select");
				return;
			}
			const tab = event.target.closest("[data-tab]");
			if (tab) {
				this.activeTab = tab.dataset.tab;
				this.renderInspector();
				return;
			}
			const actionTarget = event.target.closest("[data-action]");
			if (!actionTarget) return;
			const action = actionTarget.dataset.action;
			const actions = {
				new: () => this.newDesign(),
				open: () => this.showOpenDialog(),
				save: () => this.save(),
				undo: () => this.undo(),
				redo: () => this.redo(),
				duplicate: () => this.duplicateSelected(),
				delete: () => this.deleteSelected(),
				raw: () => this.generateRaw(true),
				"close-raw": () => this.closeRaw(),
				"copy-raw": () => this.copyRaw(),
				"download-raw": () => this.downloadRaw(),
				"zoom-in": () => this.setZoom(this.zoom + 0.1),
				"zoom-out": () => this.setZoom(this.zoom - 0.1),
				"zoom-fit": () => this.fitZoom(),
				"toggle-grid": () => this.updateLabel({ show_grid: !this.design.label.show_grid }),
				"toggle-snap": () => this.updateLabel({ snap: !this.design.label.snap }),
			};
			if (actions[action]) actions[action]();
		}

		setActiveTool(name) {
			this.app.querySelectorAll("[data-tool]").forEach((button) => {
				const active = button.dataset.tool === name;
				button.classList.toggle("zld-is-active", active);
				button.setAttribute("aria-pressed", String(active));
			});
		}

		addElement(type, imageSource) {
			if (type === "image" && !imageSource) {
				this.imageInput.value = "";
				this.imageInput.click();
				return;
			}
			const count = this.design.elements.filter((item) => item.type === type).length + 1;
			const width = type === "text" ? Math.min(45, this.design.label.width_mm * 0.6) : Math.min(30, this.design.label.width_mm * 0.4);
			const height = type === "text" ? 10 : type === "line" ? 0 : Math.min(20, this.design.label.height_mm * 0.4);
			const element = normalizeElement({
				id: uid(type),
				type,
				name: `${typeLabel(type)} ${count}`,
				x: Math.max(0, (this.design.label.width_mm - width) / 2),
				y: Math.max(0, (this.design.label.height_mm - height) / 2),
				width,
				height,
				text: type === "text" ? __("Przykładowy tekst") : undefined,
				src: imageSource || "",
			}, this.design.elements.length);
			this.design.elements.push(element);
			this.selectedId = element.id;
			this.activeTab = "element";
			this.recordHistory();
			this.renderAll();
			this.stage.focus({ preventScroll: true });
		}

		readImage() {
			const file = this.imageInput.files && this.imageInput.files[0];
			if (!file) return;
			if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type)) {
				this.toast(__("Obsługiwane są obrazy PNG, JPEG i WebP."), "danger");
				return;
			}
			if (file.size > 6 * 1024 * 1024) {
				this.toast(__("Obraz jest za duży. Maksymalny rozmiar pliku to 6 MB."), "danger");
				return;
			}
			const reader = new FileReader();
			reader.onload = () => this.addElement("image", String(reader.result || ""));
			reader.onerror = () => this.toast(__("Nie udało się odczytać obrazu."), "danger");
			reader.readAsDataURL(file);
		}

		renderAll() {
			this.renderHeader();
			this.renderCanvas();
			this.renderInspector();
			this.renderRaw();
		}

		renderHeader() {
			const dirty = JSON.stringify(this.design) !== this.savedSnapshot;
			const title = this.templateName || __("Nowa etykieta");
			this.app.querySelector('[data-role="title"]').textContent = title;
			const status = this.app.querySelector('[data-role="status"]');
			status.textContent = dirty ? __("Niezapisane zmiany") : __("Zapisano");
			status.classList.toggle("zld-is-dirty", dirty);
			this.app.querySelector('[data-action="undo"]').disabled = this.historyIndex <= 0;
			this.app.querySelector('[data-action="redo"]').disabled = this.historyIndex >= this.history.length - 1;
			const hasSelection = Boolean(this.selectedElement());
			this.app.querySelectorAll('[data-action="delete"], [data-action="duplicate"]').forEach((button) => {
				button.disabled = !hasSelection;
			});
			if (this.page && typeof this.page.set_title === "function") this.page.set_title(title);
		}

		renderCanvas() {
			this.renderStageSize();
			this.stage.replaceChildren();
			const scale = MM_PX * this.zoom;
			const grid = createElement("div", "zld-grid");
			grid.classList.toggle("zld-is-visible", this.design.label.show_grid);
			grid.style.setProperty("--zld-grid-size", `${this.design.label.grid_mm * scale}px`);
			this.stage.appendChild(grid);

			const svg = createSvg("svg", {
				viewBox: `0 0 ${this.design.label.width_mm} ${this.design.label.height_mm}`,
				width: "100%",
				height: "100%",
				"aria-hidden": "true",
			});
			svg.style.position = "absolute";
			svg.style.inset = "0";
			svg.style.zIndex = "5";
			svg.style.overflow = "hidden";
			this.design.elements.forEach((element) => {
				if (element.visible !== false) svg.appendChild(this.renderSvgElement(element));
			});
			this.stage.appendChild(svg);

			if (!this.design.elements.some((item) => item.visible !== false)) {
				const empty = createElement("div", "zld-stage-empty");
				const icon = createElement("div", "zld-stage-empty__icon", "+");
				const message = createElement("div", "", __("Dodaj tekst, kształt, linię lub obraz."));
				empty.append(icon, message);
				this.stage.appendChild(empty);
			}
			this.renderSelection();
			this.app.querySelector('[data-action="toggle-grid"]').classList.toggle("zld-is-active", this.design.label.show_grid);
			this.app.querySelector('[data-action="toggle-snap"]').classList.toggle("zld-is-active", this.design.label.snap);
			this.app.querySelector('[data-role="stage-shell"] .zld-zoom-value').textContent = `${Math.round(this.zoom * 100)}%`;
		}

		renderStageSize() {
			if (!this.stage) return;
			const scale = MM_PX * this.zoom;
			this.stage.style.width = `${this.design.label.width_mm * scale}px`;
			this.stage.style.height = `${this.design.label.height_mm * scale}px`;
		}

		renderSvgElement(element) {
			const group = createSvg("g", {
				"data-element-id": element.id,
				transform: `translate(${element.x} ${element.y}) rotate(${element.rotation} ${element.width / 2} ${element.height / 2})`,
				tabindex: "-1",
			});
			group.style.cursor = element.locked ? "not-allowed" : "move";
			if (element.type === "text") {
				const hit = createSvg("rect", { width: element.width, height: element.height, fill: "transparent" });
				group.appendChild(hit);
				const align = element.text_align || "left";
				const x = align === "center" ? element.width / 2 : align === "right" ? element.width : 0;
				const text = createSvg("text", {
					x,
					y: 0,
					fill: safeColor(element.color, "#000000"),
					"font-size": element.font_size_mm,
					"font-family": element.font_family || "Arial",
					"font-weight": element.font_weight || "normal",
					"text-anchor": align === "center" ? "middle" : align === "right" ? "end" : "start",
					"dominant-baseline": "hanging",
				});
				const value = this.resolveText(element.text);
				String(value).split(/\r?\n/).forEach((line, index) => {
					const span = createSvg("tspan", { x, dy: index === 0 ? 0 : element.font_size_mm * 1.2 });
					span.textContent = line || " ";
					text.appendChild(span);
				});
				group.appendChild(text);
			} else if (element.type === "rectangle") {
				group.appendChild(createSvg("rect", {
					width: element.width,
					height: element.height,
					fill: safeColor(element.fill, "transparent"),
					stroke: safeColor(element.stroke, "#000000"),
					"stroke-width": element.stroke_width_mm,
					"vector-effect": "non-scaling-stroke",
				}));
			} else if (element.type === "ellipse") {
				group.appendChild(createSvg("ellipse", {
					cx: element.width / 2,
					cy: element.height / 2,
					rx: element.width / 2,
					ry: element.height / 2,
					fill: safeColor(element.fill, "transparent"),
					stroke: safeColor(element.stroke, "#000000"),
					"stroke-width": element.stroke_width_mm,
					"vector-effect": "non-scaling-stroke",
				}));
			} else if (element.type === "line") {
				const hit = createSvg("line", { x1: 0, y1: 0, x2: element.width, y2: element.height, stroke: "transparent", "stroke-width": Math.max(2, element.stroke_width_mm * 4) });
				const line = createSvg("line", {
					x1: 0,
					y1: 0,
					x2: element.width,
					y2: element.height,
					stroke: safeColor(element.stroke, "#000000"),
					"stroke-width": element.stroke_width_mm,
					"vector-effect": "non-scaling-stroke",
				});
				group.append(hit, line);
			} else if (element.type === "image") {
				const image = createSvg("image", {
					width: element.width,
					height: element.height,
					preserveAspectRatio: element.fit === "stretch" ? "none" : element.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet",
				});
				if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(element.src || "")) image.setAttribute("href", element.src);
				group.appendChild(image);
			}
			return group;
		}

		resolveText(value) {
			const rootData = this.design.sample_data || {};
			const context = rootData.doc && typeof rootData.doc === "object" ? rootData.doc : rootData;
			return String(value || "").replace(/{{\s*(?:doc\.)?([A-Za-z_][A-Za-z0-9_.]*)\s*}}/g, (match, path) => {
				let current = context;
				for (const part of path.split(".")) {
					if (!current || typeof current !== "object" || !(part in current)) return match;
					current = current[part];
				}
				return current === null || current === undefined ? "" : String(current);
			});
		}

		renderSelection() {
			const element = this.selectedElement();
			if (!element || element.visible === false) return;
			const scale = MM_PX * this.zoom;
			const selection = createElement("div", "zld-selection");
			selection.style.left = `${element.x * scale}px`;
			selection.style.top = `${element.y * scale}px`;
			selection.style.width = `${Math.max(2, element.width * scale)}px`;
			selection.style.height = `${Math.max(2, element.height * scale)}px`;
			selection.style.transform = `rotate(${element.rotation}deg)`;
			selection.classList.toggle(
				"zld-is-outside",
				element.x < 0 || element.y < 0 || element.x + element.width > this.design.label.width_mm || element.y + element.height > this.design.label.height_mm
			);
			if (!element.locked) {
				["nw", "ne", "se", "sw"].forEach((position) => {
					const handle = createElement("span", `zld-handle zld-handle--${position}`);
					handle.dataset.handle = position;
					handle.setAttribute("role", "button");
					handle.setAttribute("aria-label", `${__("Zmień rozmiar")}: ${position}`);
					selection.appendChild(handle);
				});
			}
			this.stage.appendChild(selection);
		}

		onPointerDown(event) {
			if (event.button !== 0) return;
			const handle = event.target.closest("[data-handle]");
			const elementTarget = event.target.closest("[data-element-id]");
			if (handle) {
				const element = this.selectedElement();
				if (!element || element.locked) return;
				this.beginInteraction("resize", element, event, handle.dataset.handle);
				return;
			}
			if (elementTarget) {
				const id = elementTarget.getAttribute("data-element-id");
				this.selectedId = id;
				this.activeTab = "element";
				const element = this.selectedElement();
				this.renderAll();
				if (element && !element.locked) this.beginInteraction("drag", element, event);
				return;
			}
			this.selectedId = null;
			this.renderAll();
			this.stage.focus({ preventScroll: true });
		}

		beginInteraction(mode, element, event, handle) {
			event.preventDefault();
			const point = this.clientToMm(event.clientX, event.clientY);
			this.interaction = {
				mode,
				handle,
				id: element.id,
				start: point,
				original: clone(element),
				before: JSON.stringify(this.design),
			};
			this.stage.focus({ preventScroll: true });
		}

		onPointerMove(event) {
			if (!this.interaction) return;
			const element = this.design.elements.find((item) => item.id === this.interaction.id);
			if (!element) return;
			const point = this.clientToMm(event.clientX, event.clientY);
			const dx = point.x - this.interaction.start.x;
			const dy = point.y - this.interaction.start.y;
			const original = this.interaction.original;
			if (this.interaction.mode === "drag") {
				element.x = this.snap(clamp(original.x + dx, 0, Math.max(0, this.design.label.width_mm - original.width)));
				element.y = this.snap(clamp(original.y + dy, 0, Math.max(0, this.design.label.height_mm - original.height)));
			} else {
				let left = original.x;
				let top = original.y;
				let right = original.x + original.width;
				let bottom = original.y + original.height;
				if (this.interaction.handle.includes("w")) left += dx;
				if (this.interaction.handle.includes("e")) right += dx;
				if (this.interaction.handle.includes("n")) top += dy;
				if (this.interaction.handle.includes("s")) bottom += dy;
				left = clamp(left, 0, right - 0.5);
				top = clamp(top, 0, bottom - 0.5);
				right = clamp(right, left + 0.5, this.design.label.width_mm);
				bottom = clamp(bottom, top + 0.5, this.design.label.height_mm);
				element.x = this.snap(left);
				element.y = this.snap(top);
				element.width = Math.max(0.5, this.snap(right - left));
				element.height = Math.max(0.5, this.snap(bottom - top));
			}
			this.renderCanvas();
			event.preventDefault();
		}

		onPointerUp() {
			if (!this.interaction) return;
			const changed = this.interaction.before !== JSON.stringify(this.design);
			this.interaction = null;
			if (changed) this.recordHistory();
			this.renderAll();
		}

		clientToMm(clientX, clientY) {
			const rect = this.stage.getBoundingClientRect();
			return {
				x: rect.width ? ((clientX - rect.left) / rect.width) * this.design.label.width_mm : 0,
				y: rect.height ? ((clientY - rect.top) / rect.height) * this.design.label.height_mm : 0,
			};
		}

		snap(value) {
			if (!this.design.label.snap) return round(value);
			const grid = Math.max(0.1, finite(this.design.label.grid_mm, 1));
			return round(Math.round(value / grid) * grid);
		}

		renderInspector() {
			const selected = this.selectedElement();
			if (this.activeTab === "element" && !selected) this.activeTab = "label";
			this.app.querySelectorAll("[data-tab]").forEach((tab) => {
				const active = tab.dataset.tab === this.activeTab;
				tab.classList.toggle("zld-is-active", active);
				tab.setAttribute("aria-selected", String(active));
			});
			this.app.querySelector('[data-tab="element"]').disabled = !selected;
			const title = this.activeTab === "element" && selected
				? selected.name
				: { label: __("Ustawienia etykiety"), layers: __("Warstwy"), data: __("Dane przykładowe") }[this.activeTab];
			this.app.querySelector('[data-role="inspector-title"]').textContent = title || __("Właściwości");
			this.inspectorBody.replaceChildren();
			if (this.activeTab === "element" && selected) this.renderElementInspector(selected);
			else if (this.activeTab === "label") this.renderLabelInspector();
			else if (this.activeTab === "layers") this.renderLayers();
			else this.renderDataInspector();
		}

		section(title) {
			const section = createElement("section", "zld-section");
			const header = createElement("div", "zld-section__header");
			header.appendChild(createElement("h3", "zld-section__title", title));
			section.appendChild(header);
			return section;
		}

		field(label, value, options) {
			const opts = options || {};
			const wrapper = createElement("label", `zld-field${opts.full ? " zld-field--full" : ""}`);
			wrapper.appendChild(createElement("span", "zld-field__label", label));
			let input;
			if (opts.type === "textarea") {
				input = createElement("textarea", "zld-textarea");
				input.rows = opts.rows || 4;
			} else if (opts.type === "select") {
				input = createElement("select", "zld-select");
				(opts.choices || []).forEach((choice) => {
					const option = document.createElement("option");
					option.value = String(choice[0]);
					option.textContent = String(choice[1]);
					input.appendChild(option);
				});
			} else {
				input = createElement("input", "zld-input");
				input.type = opts.type || "text";
				if (opts.step !== undefined) input.step = String(opts.step);
				if (opts.min !== undefined) input.min = String(opts.min);
				if (opts.max !== undefined) input.max = String(opts.max);
			}
			input.value = value === undefined || value === null ? "" : String(value);
			input.addEventListener("change", () => opts.onChange(input.value, input));
			wrapper.appendChild(input);
			if (opts.help) wrapper.appendChild(createElement("span", "zld-field__help", opts.help));
			return wrapper;
		}

		checkbox(label, checked, onChange) {
			const wrapper = createElement("label", "zld-switch");
			const input = createElement("input", "zld-switch__input");
			input.type = "checkbox";
			input.checked = Boolean(checked);
			const track = createElement("span", "zld-switch__track");
			const text = createElement("span", "zld-field__label", label);
			input.addEventListener("change", () => onChange(input.checked));
			wrapper.append(input, track, text);
			return wrapper;
		}

		renderElementInspector(element) {
			const identity = this.section(__("Element"));
			const identityGrid = createElement("div", "zld-property-grid zld-property-grid--single");
			identityGrid.appendChild(this.field(__("Nazwa warstwy"), element.name, {
				onChange: (value) => this.updateSelected({ name: String(value || typeLabel(element.type)) }),
			}));
			identity.appendChild(identityGrid);
			identity.appendChild(this.checkbox(__("Widoczny"), element.visible, (value) => this.updateSelected({ visible: value })));
			identity.appendChild(this.checkbox(__("Zablokowany"), element.locked, (value) => this.updateSelected({ locked: value })));
			this.inspectorBody.appendChild(identity);

			const geometry = this.section(__("Pozycja i rozmiar (mm)"));
			const grid = createElement("div", "zld-property-grid");
			[["X", "x"], ["Y", "y"], [__("Szerokość"), "width"], [__("Wysokość"), "height"]].forEach(([label, key]) => {
				grid.appendChild(this.field(label, round(element[key]), {
					type: "number", step: 0.1, min: key === "width" || key === "height" ? 0.5 : -1000,
					onChange: (value) => this.updateSelected({ [key]: key === "width" || key === "height" ? Math.max(0.5, finite(value, element[key])) : finite(value, element[key]) }),
				}));
			});
			grid.appendChild(this.field(__("Obrót"), element.rotation, {
				type: "select",
				choices: [[0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"]],
				onChange: (value) => this.updateSelected({ rotation: Number(value) }),
			}));
			geometry.appendChild(grid);
			this.inspectorBody.appendChild(geometry);

			if (element.type === "text") this.renderTextProperties(element);
			else if (["rectangle", "ellipse", "line"].includes(element.type)) this.renderShapeProperties(element);
			else if (element.type === "image") this.renderImageProperties(element);
		}

		renderTextProperties(element) {
			const section = this.section(__("Tekst"));
			const grid = createElement("div", "zld-property-grid");
			grid.appendChild(this.field(__("Treść"), element.text, {
				type: "textarea", rows: 4, full: true,
				help: __("Pola danych: {{ doc.item_code }}"),
				onChange: (value) => this.updateSelected({ text: value }),
			}));
			grid.appendChild(this.field(__("Wielkość (mm)"), element.font_size_mm, {
				type: "number", min: 0.5, max: 100, step: 0.1,
				onChange: (value) => this.updateSelected({ font_size_mm: clamp(finite(value, element.font_size_mm), 0.5, 100) }),
			}));
			grid.appendChild(this.field(__("Krój pisma"), element.font_family, {
				onChange: (value) => this.updateSelected({ font_family: String(value || "Arial") }),
			}));
			grid.appendChild(this.field(__("Grubość"), element.font_weight, {
				type: "select", choices: [["normal", __("Normalna")], ["bold", __("Pogrubiona")]],
				onChange: (value) => this.updateSelected({ font_weight: value }),
			}));
			grid.appendChild(this.field(__("Wyrównanie"), element.text_align, {
				type: "select", choices: [["left", __("Do lewej")], ["center", __("Środek")], ["right", __("Do prawej")]],
				onChange: (value) => this.updateSelected({ text_align: value }),
			}));
			grid.appendChild(this.field(__("Kolor"), safeColor(element.color, "#000000"), {
				type: "color", onChange: (value) => this.updateSelected({ color: safeColor(value, "#000000") }),
			}));
			section.appendChild(grid);
			this.inspectorBody.appendChild(section);
		}

		renderShapeProperties(element) {
			const section = this.section(__("Wygląd"));
			const grid = createElement("div", "zld-property-grid");
			grid.appendChild(this.field(__("Kolor linii"), safeColor(element.stroke, "#000000"), {
				type: "color", onChange: (value) => this.updateSelected({ stroke: safeColor(value, "#000000") }),
			}));
			grid.appendChild(this.field(__("Grubość (mm)"), element.stroke_width_mm, {
				type: "number", min: 0.05, max: 50, step: 0.05,
				onChange: (value) => this.updateSelected({ stroke_width_mm: clamp(finite(value, element.stroke_width_mm), 0.05, 50) }),
			}));
			if (element.type !== "line") {
				grid.appendChild(this.field(__("Wypełnienie"), element.fill === "transparent" || element.fill === "none" ? "#ffffff" : safeColor(element.fill, "#ffffff"), {
					type: "color", onChange: (value) => this.updateSelected({ fill: safeColor(value, "#ffffff") }),
				}));
				grid.appendChild(this.checkbox(__("Bez wypełnienia"), element.fill === "transparent" || element.fill === "none", (value) => this.updateSelected({ fill: value ? "transparent" : "#ffffff" })));
			}
			section.appendChild(grid);
			this.inspectorBody.appendChild(section);
		}

		renderImageProperties(element) {
			const section = this.section(__("Konwersja obrazu"));
			const grid = createElement("div", "zld-property-grid");
			grid.appendChild(this.field(__("Próg czerni"), element.threshold, {
				type: "number", min: 0, max: 255, step: 1,
				onChange: (value) => this.updateSelected({ threshold: clamp(Math.trunc(finite(value, element.threshold)), 0, 255) }),
			}));
			grid.appendChild(this.field(__("Dopasowanie"), element.fit, {
				type: "select", choices: [["contain", __("Zmieść")], ["cover", __("Wypełnij")], ["stretch", __("Rozciągnij")]],
				onChange: (value) => this.updateSelected({ fit: value }),
			}));
			grid.appendChild(this.checkbox(__("Odwróć czerń i biel"), element.invert, (value) => this.updateSelected({ invert: value })));
			grid.appendChild(this.checkbox(__("Dithering"), element.dither, (value) => this.updateSelected({ dither: value })));
			section.appendChild(grid);
			this.inspectorBody.appendChild(section);
		}

		renderLabelInspector() {
			const dimensions = this.section(__("Format etykiety"));
			const grid = createElement("div", "zld-property-grid");
			grid.appendChild(this.field(__("Szerokość (mm)"), this.design.label.width_mm, {
				type: "number", min: 1, max: 1000, step: 0.1,
				onChange: (value) => this.updateLabel({ width_mm: clamp(finite(value, this.design.label.width_mm), 1, 1000) }),
			}));
			grid.appendChild(this.field(__("Wysokość (mm)"), this.design.label.height_mm, {
				type: "number", min: 1, max: 1000, step: 0.1,
				onChange: (value) => this.updateLabel({ height_mm: clamp(finite(value, this.design.label.height_mm), 1, 1000) }),
			}));
			grid.appendChild(this.field(__("Rozdzielczość"), this.design.label.dpi, {
				type: "select", choices: [[203, "203 DPI"], [300, "300 DPI"], [600, "600 DPI"]],
				onChange: (value) => this.updateLabel({ dpi: Number(value) }),
			}));
			grid.appendChild(this.field(__("Siatka (mm)"), this.design.label.grid_mm, {
				type: "number", min: 0.1, max: 100, step: 0.1,
				onChange: (value) => this.updateLabel({ grid_mm: clamp(finite(value, this.design.label.grid_mm), 0.1, 100) }),
			}));
			dimensions.appendChild(grid);
			dimensions.appendChild(this.checkbox(__("Pokaż siatkę"), this.design.label.show_grid, (value) => this.updateLabel({ show_grid: value })));
			dimensions.appendChild(this.checkbox(__("Przyciągaj do siatki"), this.design.label.snap, (value) => this.updateLabel({ snap: value })));
			this.inspectorBody.appendChild(dimensions);

			const printer = this.section(__("Drukarka Zebra"));
			const printerGrid = createElement("div", "zld-property-grid");
			printerGrid.appendChild(this.field(__("Zaczernienie"), this.design.label.darkness, {
				type: "number", min: 0, max: 30, step: 1,
				onChange: (value) => this.updateLabel({ darkness: clamp(finite(value, this.design.label.darkness), 0, 30) }),
			}));
			printerGrid.appendChild(this.field(__("Prędkość"), this.design.label.speed, {
				type: "number", min: 1, max: 14, step: 1,
				onChange: (value) => this.updateLabel({ speed: clamp(finite(value, this.design.label.speed), 1, 14) }),
			}));
			printerGrid.appendChild(this.field(__("Liczba kopii"), this.design.label.copies, {
				type: "number", min: 1, max: 9999, step: 1,
				onChange: (value) => this.updateLabel({ copies: clamp(Math.trunc(finite(value, this.design.label.copies)), 1, 9999) }),
			}));
			printer.appendChild(printerGrid);
			this.inspectorBody.appendChild(printer);
		}

		renderLayers() {
			const section = this.section(__("Kolejność warstw"));
			if (!this.design.elements.length) {
				const empty = createElement("div", "zld-empty-state");
				empty.appendChild(createElement("p", "zld-empty-state__message", __("Projekt nie zawiera jeszcze elementów.")));
				section.appendChild(empty);
				this.inspectorBody.appendChild(section);
				return;
			}
			const list = createElement("ol", "zld-layers");
			[...this.design.elements].reverse().forEach((element) => {
				const row = createElement("li", "zld-layer");
				row.dataset.layerId = element.id;
				row.draggable = true;
				row.tabIndex = 0;
				row.setAttribute("aria-selected", String(element.id === this.selectedId));
				row.classList.toggle("zld-is-selected", element.id === this.selectedId);
				const icon = createElement("span", "zld-layer__icon", { text: "T", rectangle: "□", ellipse: "○", line: "╱", image: "▧" }[element.type]);
				const name = createElement("span", "zld-layer__name", element.name);
				const actions = createElement("span", "zld-layer__actions");
				const visibility = createElement("button", "zld-layer__action", element.visible === false ? "○" : "●");
				visibility.type = "button";
				visibility.title = element.visible === false ? __("Pokaż") : __("Ukryj");
				visibility.addEventListener("click", (event) => {
					event.stopPropagation();
					this.mutate(() => { element.visible = element.visible === false; });
				});
				const up = createElement("button", "zld-layer__action", "↑");
				up.type = "button";
				up.title = __("Przesuń wyżej");
				up.addEventListener("click", (event) => { event.stopPropagation(); this.moveLayer(element.id, 1); });
				const down = createElement("button", "zld-layer__action", "↓");
				down.type = "button";
				down.title = __("Przesuń niżej");
				down.addEventListener("click", (event) => { event.stopPropagation(); this.moveLayer(element.id, -1); });
				actions.append(visibility, up, down);
				row.append(icon, name, actions);
				row.addEventListener("click", () => {
					this.selectedId = element.id;
					this.activeTab = "element";
					this.renderAll();
				});
				row.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.click(); }
				});
				row.addEventListener("dragstart", () => { this.dragLayerId = element.id; row.classList.add("zld-is-dragging"); });
				row.addEventListener("dragend", () => { this.dragLayerId = null; row.classList.remove("zld-is-dragging"); });
				row.addEventListener("dragover", (event) => event.preventDefault());
				row.addEventListener("drop", (event) => {
					event.preventDefault();
					if (this.dragLayerId && this.dragLayerId !== element.id) this.reorderLayer(this.dragLayerId, element.id);
				});
				list.appendChild(row);
			});
			section.appendChild(list);
			this.inspectorBody.appendChild(section);
		}

		renderDataInspector() {
			const section = this.section(__("Źródło danych"));
			const grid = createElement("div", "zld-property-grid zld-property-grid--single");
			grid.appendChild(this.field(__("Source DocType"), this.design.source_doctype, {
				help: __("Np. Item, Sales Invoice lub Delivery Note."),
				onChange: (value) => this.mutate(() => { this.design.source_doctype = String(value || "").trim(); }),
			}));
			const jsonValue = JSON.stringify(this.design.sample_data || {}, null, 2);
			grid.appendChild(this.field(__("Przykładowe dane (JSON)"), jsonValue, {
				type: "textarea", rows: 12,
				help: __("Służą tylko do podglądu RAW; zapis zachowuje tokeny {{ doc.field }}."),
				onChange: (value, input) => {
					try {
						const parsed = JSON.parse(value || "{}");
						if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(__("Wymagany jest obiekt JSON."));
						this.mutate(() => { this.design.sample_data = parsed; });
					} catch (error) {
						input.classList.add("zld-is-invalid");
						this.toast(`${__("Niepoprawny JSON")}: ${error.message}`, "danger");
					}
				},
			}));
			section.appendChild(grid);
			this.inspectorBody.appendChild(section);
		}

		updateSelected(patch) {
			const element = this.selectedElement();
			if (!element) return;
			this.mutate(() => Object.assign(element, patch));
		}

		updateLabel(patch) {
			this.mutate(() => Object.assign(this.design.label, patch));
		}

		mutate(callback) {
			callback();
			this.recordHistory();
			this.renderAll();
		}

		recordHistory() {
			const snapshot = JSON.stringify(this.design);
			if (this.history[this.historyIndex] === snapshot) return;
			this.history.splice(this.historyIndex + 1);
			this.history.push(snapshot);
			if (this.history.length > HISTORY_LIMIT) this.history.shift();
			this.historyIndex = this.history.length - 1;
			this.renderHeader();
		}

		undo() {
			if (this.historyIndex <= 0) return;
			this.historyIndex -= 1;
			this.design = normalizeDesign(JSON.parse(this.history[this.historyIndex]));
			if (!this.selectedElement()) this.selectedId = null;
			this.renderAll();
		}

		redo() {
			if (this.historyIndex >= this.history.length - 1) return;
			this.historyIndex += 1;
			this.design = normalizeDesign(JSON.parse(this.history[this.historyIndex]));
			if (!this.selectedElement()) this.selectedId = null;
			this.renderAll();
		}

		selectedElement() {
			return this.design.elements.find((element) => element.id === this.selectedId) || null;
		}

		deleteSelected() {
			const index = this.design.elements.findIndex((element) => element.id === this.selectedId);
			if (index < 0) return;
			this.design.elements.splice(index, 1);
			this.selectedId = null;
			this.recordHistory();
			this.renderAll();
		}

		duplicateSelected() {
			const element = this.selectedElement();
			if (!element) return;
			const copy = clone(element);
			copy.id = uid(element.type);
			copy.name = `${element.name} ${__("kopia")}`;
			copy.x = clamp(element.x + this.design.label.grid_mm, 0, Math.max(0, this.design.label.width_mm - element.width));
			copy.y = clamp(element.y + this.design.label.grid_mm, 0, Math.max(0, this.design.label.height_mm - element.height));
			const index = this.design.elements.indexOf(element);
			this.design.elements.splice(index + 1, 0, copy);
			this.selectedId = copy.id;
			this.recordHistory();
			this.renderAll();
		}

		moveLayer(id, delta) {
			const index = this.design.elements.findIndex((element) => element.id === id);
			const destination = clamp(index + delta, 0, this.design.elements.length - 1);
			if (index < 0 || index === destination) return;
			const [element] = this.design.elements.splice(index, 1);
			this.design.elements.splice(destination, 0, element);
			this.recordHistory();
			this.renderAll();
		}

		reorderLayer(sourceId, targetId) {
			const sourceIndex = this.design.elements.findIndex((element) => element.id === sourceId);
			const targetIndex = this.design.elements.findIndex((element) => element.id === targetId);
			if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
			const [source] = this.design.elements.splice(sourceIndex, 1);
			const adjustedTarget = this.design.elements.findIndex((element) => element.id === targetId);
			this.design.elements.splice(adjustedTarget, 0, source);
			this.recordHistory();
			this.renderAll();
		}

		setZoom(value) {
			this.zoom = clamp(round(value, 2), 0.2, 4);
			this.renderCanvas();
		}

		fitZoom() {
			if (!this.stageShell) return;
			const availableWidth = Math.max(120, this.stageShell.clientWidth - 120);
			const availableHeight = Math.max(100, this.stageShell.clientHeight - 150);
			const zoom = Math.min(
				availableWidth / (this.design.label.width_mm * MM_PX),
				availableHeight / (this.design.label.height_mm * MM_PX),
				2
			);
			this.setZoom(zoom);
		}

		onKeydown(event) {
			if (!this.app.isConnected) return;
			const target = event.target;
			const editing = target && (target.matches("input, textarea, select") || target.isContentEditable);
			if (editing) return;
			const modifier = event.ctrlKey || event.metaKey;
			const key = event.key.toLowerCase();
			if (modifier && key === "z") {
				event.preventDefault();
				event.shiftKey ? this.redo() : this.undo();
			} else if (modifier && key === "y") {
				event.preventDefault(); this.redo();
			} else if (modifier && key === "s") {
				event.preventDefault(); this.save();
			} else if (modifier && key === "o") {
				event.preventDefault(); this.showOpenDialog();
			} else if (modifier && key === "n") {
				event.preventDefault(); this.newDesign();
			} else if (modifier && key === "d") {
				event.preventDefault(); this.duplicateSelected();
			} else if (event.key === "Delete" || event.key === "Backspace") {
				event.preventDefault(); this.deleteSelected();
			} else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && this.selectedElement()) {
				event.preventDefault();
				const amount = event.shiftKey ? this.design.label.grid_mm : 0.1;
				const selected = this.selectedElement();
				const patch = {};
				if (event.key === "ArrowLeft") patch.x = clamp(selected.x - amount, 0, this.design.label.width_mm - selected.width);
				if (event.key === "ArrowRight") patch.x = clamp(selected.x + amount, 0, this.design.label.width_mm - selected.width);
				if (event.key === "ArrowUp") patch.y = clamp(selected.y - amount, 0, this.design.label.height_mm - selected.height);
				if (event.key === "ArrowDown") patch.y = clamp(selected.y + amount, 0, this.design.label.height_mm - selected.height);
				this.updateSelected(patch);
			} else if (!modifier && ["t", "r", "e", "l", "i"].includes(key)) {
				event.preventDefault();
				this.addElement({ t: "text", r: "rectangle", e: "ellipse", l: "line", i: "image" }[key]);
			}
		}

		newDesign() {
			if (JSON.stringify(this.design) !== this.savedSnapshot && !window.confirm(__("Odrzucić niezapisane zmiany?"))) return;
			this.design = defaultDesign();
			this.documentName = null;
			this.templateName = __("Nowa etykieta");
			this.selectedId = null;
			this.raw = "";
			this.savedSnapshot = JSON.stringify(this.design);
			this.history = [this.savedSnapshot];
			this.historyIndex = 0;
			this.activeTab = "label";
			this.renderAll();
			this.fitZoom();
		}

		async showOpenDialog() {
			try {
				const response = await this.call("zebra_label_designer.api.list_templates", {});
				const templates = Array.isArray(response) ? response : [];
				const body = createElement("div");
				const search = createElement("input", "zld-input");
				search.type = "search";
				search.placeholder = __("Szukaj szablonu…");
				const list = createElement("div", "zld-layers");
				const paint = () => {
					const phrase = search.value.trim().toLocaleLowerCase();
					list.replaceChildren();
					templates.filter((item) => `${item.template_name || ""} ${item.name || ""}`.toLocaleLowerCase().includes(phrase)).forEach((item) => {
						const button = createElement("button", "zld-layer");
						button.type = "button";
						const icon = createElement("span", "zld-layer__icon", "▣");
						const details = createElement("span", "zld-layer__name");
						details.textContent = `${item.template_name || item.name} — ${item.label_width_mm} × ${item.label_height_mm} mm / ${item.printer_dpi} DPI`;
						button.append(icon, details);
						button.addEventListener("click", () => this.loadTemplate(item.name));
						list.appendChild(button);
					});
					if (!list.childElementCount) list.appendChild(createElement("div", "zld-empty-state", __("Brak szablonów.")));
				};
				search.addEventListener("input", paint);
				body.append(search, list);
				paint();
				this.openDialog(__("Otwórz szablon"), body);
				search.focus();
			} catch (error) {
				this.handleError(error, __("Nie udało się pobrać szablonów."));
			}
		}

		async loadTemplate(name) {
			if (!name) return;
			if (JSON.stringify(this.design) !== this.savedSnapshot && !window.confirm(__("Odrzucić niezapisane zmiany?"))) return;
			try {
				const result = await this.call("zebra_label_designer.api.get_template", { name });
				const parsed = typeof result.design_json === "string" ? JSON.parse(result.design_json) : result.design_json;
				this.design = normalizeDesign(parsed);
				if (!this.design.source_doctype && result.source_doctype) this.design.source_doctype = result.source_doctype;
				this.documentName = result.name;
				this.templateName = result.template_name || result.name;
				this.raw = result.generated_zpl || "";
				this.selectedId = null;
				this.savedSnapshot = JSON.stringify(this.design);
				this.history = [this.savedSnapshot];
				this.historyIndex = 0;
				this.activeTab = "label";
				this.closeDialog();
				this.renderAll();
				this.fitZoom();
				this.toast(__("Szablon został otwarty."), "success");
			} catch (error) {
				this.handleError(error, __("Nie udało się otworzyć szablonu."));
			}
		}

		async save() {
			if (!this.documentName && (!this.templateName || this.templateName === __("Nowa etykieta"))) {
				this.showSaveDialog();
				return;
			}
			await this.performSave(this.templateName);
		}

		showSaveDialog() {
			const body = createElement("div", "zld-property-grid zld-property-grid--single");
			const nameField = this.field(__("Nazwa szablonu"), this.templateName === __("Nowa etykieta") ? "" : this.templateName, {
				onChange: () => {},
			});
			const sourceField = this.field(__("Source DocType"), this.design.source_doctype, { onChange: () => {} });
			body.append(nameField, sourceField);
			const nameInput = nameField.querySelector("input");
			const sourceInput = sourceField.querySelector("input");
			this.openDialog(__("Zapisz szablon"), body, [
				{ label: __("Anuluj"), action: () => this.closeDialog() },
				{ label: __("Zapisz"), primary: true, action: () => {
					const name = nameInput.value.trim();
					if (!name) { nameInput.focus(); this.toast(__("Podaj nazwę szablonu."), "warning"); return; }
					this.design.source_doctype = sourceInput.value.trim();
					this.performSave(name);
				} },
			]);
			nameInput.focus();
		}

		async performSave(templateName) {
			try {
				const generated = await this.compile({});
				const result = await this.call("zebra_label_designer.api.save_template", {
					template_name: templateName,
					design_json: JSON.stringify(this.design),
					generated_zpl: generated,
					document_name: this.documentName,
					source_doctype: this.design.source_doctype || "",
				});
				this.documentName = result.name;
				this.templateName = result.template_name || templateName;
				this.raw = generated;
				this.savedSnapshot = JSON.stringify(this.design);
				this.closeDialog();
				this.renderAll();
				this.toast(__("Szablon został zapisany."), "success");
			} catch (error) {
				this.handleError(error, __("Nie udało się zapisać szablonu."));
			}
		}

		async compile(data) {
			if (!this.engine || typeof this.engine.generate !== "function") {
				throw new Error(__("Silnik ZPL nie został załadowany."));
			}
			return this.engine.generate(this.design, { data: data || {}, preserveUnknown: true });
		}

		async generateRaw(openPanel) {
			try {
				this.raw = await this.compile(this.design.sample_data || {});
				if (openPanel) {
					const panel = this.app.querySelector('[data-role="raw-panel"]');
					panel.classList.remove("zld-is-collapsed");
					panel.setAttribute("aria-hidden", "false");
				}
				this.renderRaw();
			} catch (error) {
				this.handleError(error, __("Nie udało się wygenerować RAW/ZPL."));
			}
		}

		renderRaw() {
			this.app.querySelector('[data-role="raw-code"]').textContent = this.raw || __("Kliknij RAW, aby wygenerować kod ZPL.");
			let bytes = String(this.raw || "").length;
			if (typeof TextEncoder !== "undefined") bytes = new TextEncoder().encode(this.raw || "").length;
			this.app.querySelector('[data-role="raw-meta"]').textContent = this.raw ? `${bytes.toLocaleString()} B` : "";
		}

		closeRaw() {
			const panel = this.app.querySelector('[data-role="raw-panel"]');
			panel.classList.add("zld-is-collapsed");
			panel.setAttribute("aria-hidden", "true");
		}

		async copyRaw() {
			if (!this.raw) await this.generateRaw(false);
			if (!this.raw) return;
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(this.raw);
				else {
					const textarea = createElement("textarea");
					textarea.value = this.raw;
					textarea.style.position = "fixed";
					textarea.style.opacity = "0";
					document.body.appendChild(textarea);
					textarea.select();
					document.execCommand("copy");
					textarea.remove();
				}
				this.toast(__("Kod RAW skopiowano."), "success");
			} catch (error) {
				this.handleError(error, __("Nie udało się skopiować kodu."));
			}
		}

		async downloadRaw() {
			if (!this.raw) await this.generateRaw(false);
			if (!this.raw) return;
			const blob = new Blob([this.raw], { type: "application/octet-stream;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${String(this.templateName || "label").replace(/[^a-z0-9_-]+/gi, "_")}.prn`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
		}

		openDialog(title, body, actions) {
			this.dialogHost.replaceChildren();
			const dialog = createElement("section", "zld-dialog");
			dialog.setAttribute("role", "dialog");
			dialog.setAttribute("aria-modal", "true");
			const header = createElement("header", "zld-dialog__header");
			header.appendChild(createElement("h2", "zld-dialog__title", title));
			const close = createElement("button", "zld-dialog__close", "×");
			close.type = "button";
			close.setAttribute("aria-label", __("Zamknij"));
			close.addEventListener("click", () => this.closeDialog());
			header.appendChild(close);
			const content = createElement("div", "zld-dialog__body");
			content.appendChild(body);
			dialog.append(header, content);
			if (actions && actions.length) {
				const footer = createElement("footer", "zld-dialog__footer");
				actions.forEach((definition) => {
					const button = createElement("button", `zld-btn${definition.primary ? " zld-btn--primary" : ""}`, definition.label);
					button.type = "button";
					button.addEventListener("click", definition.action);
					footer.appendChild(button);
				});
				dialog.appendChild(footer);
			}
			this.dialogHost.appendChild(dialog);
			this.dialogHost.classList.add("zld-is-open");
			this.dialogHost.setAttribute("aria-hidden", "false");
			this.dialogHost.addEventListener("pointerdown", (event) => {
				if (event.target === this.dialogHost) this.closeDialog();
			}, { once: true });
		}

		closeDialog() {
			this.dialogHost.classList.remove("zld-is-open");
			this.dialogHost.setAttribute("aria-hidden", "true");
			this.dialogHost.replaceChildren();
		}

		toast(message, type) {
			const toast = createElement("div", `zld-toast zld-toast--${type || "info"}`);
			const icon = createElement("span", "zld-toast__icon", type === "danger" ? "!" : type === "warning" ? "!" : "✓");
			const content = createElement("div", "zld-toast__content");
			content.appendChild(createElement("p", "zld-toast__message", message));
			const close = createElement("button", "zld-toast__close", "×");
			close.type = "button";
			close.addEventListener("click", () => toast.remove());
			toast.append(icon, content, close);
			this.toastRegion.appendChild(toast);
			window.setTimeout(() => toast.remove(), 4500);
		}

		handleError(error, fallback) {
			const message = error && (error.message || error.exc || error._server_messages);
			this.toast(message ? `${fallback} ${String(message)}` : fallback, "danger");
		}

		call(method, args) {
			if (!window.frappe || typeof window.frappe.call !== "function") return Promise.reject(new Error(__("Frappe API jest niedostępne.")));
			return new Promise((resolve, reject) => {
				window.frappe.call({
					method,
					args,
					callback: (response) => {
						if (response && response.exc) reject(new Error(response.exc));
						else resolve(response ? response.message : null);
					},
					error: (error) => reject(error instanceof Error ? error : new Error(String(error && error.message ? error.message : error))),
				});
			});
		}

		handle_route_options() {
			const options = window.frappe && window.frappe.route_options;
			if (!options) return;
			const name = options.template || options.zebra_template || options.zebra_label_template || options.name || options.document_name;
			if (!name || name === this.routeRequest) return;
			this.routeRequest = name;
			window.frappe.route_options = null;
			this.loadTemplate(name);
		}

		destroy() {
			document.removeEventListener("keydown", this.boundKeydown);
			document.removeEventListener("pointermove", this.boundPointerMove);
			document.removeEventListener("pointerup", this.boundPointerUp);
			this.app.remove();
			this.host.classList.remove("zld-host");
		}
	}

	NS.Editor = Editor;
})();
