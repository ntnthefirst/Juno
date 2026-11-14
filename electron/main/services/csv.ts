/**
 * Reads a CSV file into rows of text, for the preview of a spreadsheet and the
 * words it is matched by (decisions 39 and 76).
 *
 * RFC 4180 with the habits of the files people actually have: a field in
 * double quotes may hold the separator, a line break and a doubled quote; the
 * separator is a comma or, as a Belgian Excel writes it, a semicolon, and a
 * tab file reads the same way. Whichever of the three appears most often
 * outside quotes in the first line wins.
 */

export interface CsvLimits {
	maxRows: number;
	maxColumns: number;
}

export interface CsvResult {
	rows: string[][];
	truncatedRows: boolean;
	truncatedColumns: boolean;
	/** Rows read before the limit stopped the count; the whole file when nothing was cut. */
	totalRows: number;
}

export function detectSeparator(text: string): string {
	const counts = new Map<string, number>([
		[",", 0],
		[";", 0],
		["\t", 0],
	]);
	let quoted = false;
	for (const character of text) {
		if (character === '"') quoted = !quoted;
		else if (!quoted && (character === "\n" || character === "\r")) break;
		else if (!quoted && counts.has(character)) counts.set(character, (counts.get(character) ?? 0) + 1);
	}
	let best = ",";
	let bestCount = 0;
	for (const [separator, count] of counts) {
		if (count > bestCount) {
			best = separator;
			bestCount = count;
		}
	}
	return best;
}

export function parseCsv(input: string, limits: CsvLimits = { maxRows: Infinity, maxColumns: Infinity }): CsvResult {
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	const separator = detectSeparator(text);
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	let truncatedColumns = false;
	let total = 0;
	let rowHasContent = false;

	const endField = () => {
		if (row.length < limits.maxColumns) row.push(field);
		else truncatedColumns = true;
		field = "";
	};
	const endRow = () => {
		endField();
		total += 1;
		if (rows.length < limits.maxRows) rows.push(row);
		row = [];
		rowHasContent = false;
	};

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index]!;
		if (quoted) {
			if (character === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				field += character;
			}
			continue;
		}
		if (character === '"' && field.length === 0) {
			quoted = true;
			rowHasContent = true;
		} else if (character === separator) {
			endField();
			rowHasContent = true;
		} else if (character === "\r" || character === "\n") {
			if (character === "\r" && text[index + 1] === "\n") index += 1;
			endRow();
		} else {
			field += character;
			rowHasContent = true;
		}
	}
	if (rowHasContent || field.length > 0 || row.length > 0) endRow();

	return { rows, truncatedRows: total > rows.length, truncatedColumns, totalRows: total };
}
