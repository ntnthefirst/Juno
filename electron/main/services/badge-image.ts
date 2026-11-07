/**
 * The picture on the taskbar button: a filled circle with the number of agent
 * requests waiting, as PNG bytes.
 *
 * Drawn by hand because the main process has no canvas, and a font would be a
 * dependency for ten digits. Pure, so a test can read the pixels back.
 */
import { deflateSync } from "node:zlib";

/** Windows scales an overlay to 16px on the button; 32 keeps it sharp at higher DPI. */
export const BADGE_SIZE = 32;

/** The accent of the light theme (`--accent` in brand/tokens.css). The main process cannot read CSS. */
const FILL = [0x4a, 0x3f, 0xa0] as const;
const INK = [0xff, 0xff, 0xff] as const;

/** 3 by 5 glyphs, one string of rows each. */
const GLYPHS: Record<string, string[]> = {
	"0": ["###", "#.#", "#.#", "#.#", "###"],
	"1": [".#.", "##.", ".#.", ".#.", "###"],
	"2": ["###", "..#", "###", "#..", "###"],
	"3": ["###", "..#", "###", "..#", "###"],
	"4": ["#.#", "#.#", "###", "..#", "..#"],
	"5": ["###", "#..", "###", "..#", "###"],
	"6": ["###", "#..", "###", "#.#", "###"],
	"7": ["###", "..#", ".#.", ".#.", ".#."],
	"8": ["###", "#.#", "###", "#.#", "###"],
	"9": ["###", "#.#", "###", "..#", "###"],
	"+": ["...", ".#.", "###", ".#.", "..."],
};

/** What the badge says: the number, or 9+ once it stops fitting. */
export function badgeLabel(count: number): string {
	return count > 9 ? "9+" : String(Math.max(0, Math.trunc(count)));
}

export function badgePixels(count: number): Uint8Array {
	const pixels = new Uint8Array(BADGE_SIZE * BADGE_SIZE * 4);
	const centre = (BADGE_SIZE - 1) / 2;
	const radius = BADGE_SIZE / 2 - 0.5;
	for (let y = 0; y < BADGE_SIZE; y++) {
		for (let x = 0; x < BADGE_SIZE; x++) {
			if (Math.hypot(x - centre, y - centre) > radius) continue;
			const at = (y * BADGE_SIZE + x) * 4;
			pixels[at] = FILL[0];
			pixels[at + 1] = FILL[1];
			pixels[at + 2] = FILL[2];
			pixels[at + 3] = 255;
		}
	}

	const label = badgeLabel(count);
	const scale = label.length === 1 ? 4 : 3;
	const width = (label.length * 3 + (label.length - 1)) * scale;
	const height = 5 * scale;
	const left = Math.round((BADGE_SIZE - width) / 2);
	const top = Math.round((BADGE_SIZE - height) / 2);
	[...label].forEach((char, index) => {
		const rows = GLYPHS[char]!;
		const offset = left + index * 4 * scale;
		rows.forEach((row, rowIndex) => {
			[...row].forEach((cell, column) => {
				if (cell !== "#") return;
				for (let dy = 0; dy < scale; dy++) {
					for (let dx = 0; dx < scale; dx++) {
						const at = ((top + rowIndex * scale + dy) * BADGE_SIZE + offset + column * scale + dx) * 4;
						pixels[at] = INK[0];
						pixels[at + 1] = INK[1];
						pixels[at + 2] = INK[2];
						pixels[at + 3] = 255;
					}
				}
			});
		});
	});
	return pixels;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const out = Buffer.alloc(body.length + 8);
	out.writeUInt32BE(data.length, 0);
	body.copy(out, 4);
	out.writeUInt32BE(crc32(body), body.length + 4);
	return out;
}

export function badgePng(count: number): Buffer {
	const pixels = badgePixels(count);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(BADGE_SIZE, 0);
	header.writeUInt32BE(BADGE_SIZE, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA
	const stride = BADGE_SIZE * 4;
	const raw = Buffer.alloc((stride + 1) * BADGE_SIZE);
	for (let y = 0; y < BADGE_SIZE; y++) {
		raw[y * (stride + 1)] = 0; // no filter
		Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
