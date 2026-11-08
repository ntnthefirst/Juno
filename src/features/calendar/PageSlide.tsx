import { Component, createRef, type ReactNode } from "react";
import { prefersReducedMotion } from "../../lib/motion";

type PageSlideProps = {
	/** Which page is showing: a new value slides the old page out and this one in. */
	pageKey: string;
	/** Months go up and down, weeks go sideways. */
	axis: "x" | "y";
	/** 1 brings the next page in from the right or the bottom, -1 from the left or the top. */
	direction: -1 | 1;
	/** Classes for the frame, which also takes the keyed page's place in its parent's layout. */
	className?: string;
	/** One element, keyed by the caller on the same value as `pageKey`. */
	children: ReactNode;
};

type Snapshot = { ghost: HTMLElement; width: number; height: number } | null;

/** Read once: the motion tokens are fixed for the life of the window. */
function motionToken(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value || fallback;
}

/**
 * Pages the calendar the way a scroll would: the page that was showing slides
 * out while the next one slides in right behind it, edge to edge, the whole
 * distance, with no fade. Both are on screen for the whole move, so the eye
 * follows the dates instead of watching one set vanish and another appear.
 *
 * The page going out is a copy of its last frame, taken in
 * `getSnapshotBeforeUpdate`, the one moment React offers when the old page is
 * still in the document and the new one is about to replace it. That is why
 * this is a class: no hook runs at that point. The copy is inert and gone the
 * moment the move ends; the live page underneath is the real one throughout,
 * so a click during the move lands on the new dates.
 */
export class PageSlide extends Component<PageSlideProps> {
	private frame = createRef<HTMLDivElement>();
	private running: { ghost: HTMLElement; animations: Animation[] } | null = null;

	getSnapshotBeforeUpdate(previous: PageSlideProps): Snapshot {
		if (previous.pageKey === this.props.pageKey || prefersReducedMotion()) return null;
		// A step taken mid-move starts from where the pages are meant to rest.
		this.settle();
		const page = this.frame.current?.firstElementChild;
		if (!(page instanceof HTMLElement)) return null;
		const ghost = page.cloneNode(true) as HTMLElement;
		return { ghost, width: page.offsetWidth, height: page.offsetHeight };
	}

	componentDidUpdate(_previous: PageSlideProps, _state: unknown, snapshot: Snapshot) {
		const frame = this.frame.current;
		const page = frame?.firstElementChild;
		if (!snapshot || !frame || !(page instanceof HTMLElement)) return;

		const { ghost, width, height } = snapshot;
		ghost.setAttribute("aria-hidden", "true");
		ghost.inert = true;
		Object.assign(ghost.style, {
			position: "absolute",
			top: `${page.offsetTop}px`,
			left: `${page.offsetLeft}px`,
			width: `${width}px`,
			height: `${height}px`,
			pointerEvents: "none",
			animation: "none",
		});
		frame.appendChild(ghost);

		const sign = this.props.direction;
		const move = (percent: number) =>
			this.props.axis === "x" ? `translateX(${percent}%)` : `translateY(${percent}%)`;
		const timing: KeyframeAnimationOptions = {
			duration: Number.parseFloat(motionToken("--duration-slow", "360ms")) || 360,
			easing: motionToken("--ease-smooth", "cubic-bezier(0.16, 1, 0.3, 1)"),
		};
		const animations = [
			page.animate([{ transform: move(100 * sign) }, { transform: move(0) }], timing),
			ghost.animate([{ transform: move(0) }, { transform: move(-100 * sign) }], timing),
		];
		this.running = { ghost, animations };
		void Promise.all(animations.map((animation) => animation.finished))
			.then(() => {
				if (this.running?.ghost === ghost) this.settle();
			})
			.catch(() => undefined);
	}

	componentWillUnmount() {
		this.settle();
	}

	/** Ends a move at once: the copy goes and the live page is where it belongs. */
	private settle() {
		if (!this.running) return;
		for (const animation of this.running.animations) animation.cancel();
		this.running.ghost.remove();
		this.running = null;
	}

	render() {
		return (
			<div ref={this.frame} className={`relative overflow-hidden ${this.props.className ?? ""}`}>
				{this.props.children}
			</div>
		);
	}
}
