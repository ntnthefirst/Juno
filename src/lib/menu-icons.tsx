import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MENU_ICONS, type MenuIcon, type MenuIconSet } from "@shared/menu";
import { Icon, type IconName } from "../components/Icon";

/** Every glyph a native menu can show is one of the app's own, so the two sets cannot drift apart. */
const GLYPHS: readonly IconName[] = MENU_ICONS;

const SHOWN = 16;
const SCALE = 2;

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("A menu picture could not be drawn."));
		image.src = url;
	});
}

/** Draws every glyph once, in one colour, as small PNGs the platform menu can show. */
async function draw(color: string): Promise<MenuIconSet> {
	const host = document.createElement("div");
	const root = createRoot(host);
	flushSync(() => {
		root.render(
			<>
				{GLYPHS.map((name) => (
					<span key={name} data-glyph={name}>
						<Icon name={name} size={SHOWN} />
					</span>
				))}
			</>,
		);
	});

	const set: MenuIconSet = {};
	const serializer = new XMLSerializer();
	for (const holder of Array.from(host.querySelectorAll<HTMLElement>("[data-glyph]"))) {
		const svg = holder.querySelector("svg");
		const name = holder.dataset["glyph"] as MenuIcon | undefined;
		if (!svg || !name) continue;
		const markup = serializer.serializeToString(svg).replaceAll("currentColor", color);
		const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
		const canvas = document.createElement("canvas");
		canvas.width = SHOWN * SCALE;
		canvas.height = SHOWN * SCALE;
		canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
		set[name] = canvas.toDataURL("image/png");
	}
	root.unmount();
	return set;
}

/**
 * Keeps the native menus' pictures in step with the theme. The platform menu
 * takes a bitmap, so the pictures are drawn here in the ink colour of whatever
 * the page is showing and handed to the main process, again each time the
 * theme changes. Returns what stops it.
 */
export function installMenuIcons(): () => void {
	let current = 0;

	async function send() {
		const ticket = ++current;
		const color = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
		if (color === "") return;
		try {
			const set = await draw(color);
			if (ticket === current) await window.juno.menu.setIcons(set);
		} catch {
			// Without pictures a menu is still a menu.
		}
	}

	void send();
	const observer = new MutationObserver(() => void send());
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
	const query = window.matchMedia("(prefers-color-scheme: dark)");
	const onScheme = () => void send();
	query.addEventListener("change", onScheme);
	return () => {
		observer.disconnect();
		query.removeEventListener("change", onScheme);
	};
}
