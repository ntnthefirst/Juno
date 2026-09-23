import type { LayoutBlock } from "@shared/types";
import { PlaceholderText } from "./PlaceholderText";

type BlockViewProps = {
	block: LayoutBlock;
};

/**
 * Renders one block the way it will print: same units as
 * electron/main/services/document-layout.ts (`mm` for size and position,
 * so a box lines up with the compiled PDF exactly), tokens instead of the
 * compiler's literal colours, because this is a component and the compiler
 * is server output. Read-only: editing a block's own text happens in the
 * inspector, not here, so this never renders an input.
 */
export function BlockView({ block }: BlockViewProps) {
	switch (block.kind) {
		case "heading": {
			const size = block.level === 1 ? "18pt" : block.level === 2 ? "14pt" : "12pt";
			return (
				<p
					style={{ textAlign: block.align, fontSize: size, fontWeight: 600, lineHeight: 1.3 }}
					className="text-[var(--ink)]"
				>
					{block.text.length > 0 ? (
						<PlaceholderText text={block.text} />
					) : (
						<span className="text-[var(--ink-faint)]">Empty heading</span>
					)}
				</p>
			);
		}
		case "paragraph":
			return (
				<p
					style={{ textAlign: block.align, fontSize: "10.5pt", lineHeight: 1.5 }}
					className="text-[var(--ink)]"
				>
					{block.html.length > 0 ? (
						<PlaceholderText text={block.html} />
					) : (
						<span className="text-[var(--ink-faint)]">Empty paragraph</span>
					)}
				</p>
			);
		case "list": {
			const Tag = block.ordered ? "ol" : "ul";
			const items = block.items.filter((item) => item.length > 0);
			return (
				<Tag
					style={{ fontSize: "10.5pt", lineHeight: 1.5, paddingLeft: "5mm" }}
					className={`text-[var(--ink)] ${block.ordered ? "list-decimal" : "list-disc"}`}
				>
					{items.length > 0 ? (
						items.map((item, index) => (
							<li key={index}>
								<PlaceholderText text={item} />
							</li>
						))
					) : (
						<li className="text-[var(--ink-faint)]">Empty list</li>
					)}
				</Tag>
			);
		}
		case "image":
			return (
				<div style={{ textAlign: block.align }}>
					{block.src.length > 0 ? (
						<img
							src={block.src}
							alt={block.alt}
							style={{ width: `${block.widthMm}mm` }}
							className="inline-block align-top"
						/>
					) : (
						<div
							style={{ width: `${block.widthMm}mm`, height: `${Math.max(block.widthMm * 0.6, 20)}mm` }}
							className="inline-flex items-center justify-center border border-dashed border-[var(--line-strong)] bg-[var(--sunken)] text-[length:var(--text-micro)] text-[var(--ink-faint)]"
						>
							No image set
						</div>
					)}
				</div>
			);
		case "spacer":
			return <div style={{ height: `${block.heightMm}mm` }} aria-hidden />;
		case "divider":
			return <hr className="border-t border-[var(--line-strong)]" />;
		case "table":
			return (
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt" }}>
					<colgroup>
						{block.columns.map((col, index) => (
							<col key={index} style={{ width: `${col.widthPct}%` }} />
						))}
					</colgroup>
					{block.headerRow ? (
						<thead>
							<tr>
								{block.columns.map((col, index) => (
									<th
										key={index}
										className="border border-[var(--line-strong)] px-1 py-0.5 text-left font-[var(--weight-semibold)]"
									>
										{col.header.length > 0 ? <PlaceholderText text={col.header} /> : " "}
									</th>
								))}
							</tr>
						</thead>
					) : null}
					<tbody>
						{block.rows.map((row, rowIndex) => (
							<tr key={rowIndex}>
								{block.columns.map((_col, colIndex) => (
									<td key={colIndex} className="border border-[var(--line-strong)] px-1 py-0.5 align-top">
										{row[colIndex] ? <PlaceholderText text={row[colIndex]!} /> : " "}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			);
		case "signature":
			return (
				<div style={{ width: `${block.widthMm}mm`, height: "22mm", paddingTop: "2mm" }} className="box-border">
					<div className="h-0 border-t border-[var(--ink)]" />
					<p style={{ fontSize: "9.5pt", marginTop: "2mm" }} className="text-[var(--ink-muted)]">
						{block.label.length > 0 ? (
							<PlaceholderText text={block.label} />
						) : (
							<span className="text-[var(--ink-faint)]">Signature label</span>
						)}
					</p>
				</div>
			);
	}
}
