// 시험용 @earendil-works/pi-tui (pi 안에서는 pi 가 진짜 것을 넘겨 줌): 확장이 쓰는 Box·Text 만, 줄 나누기 없이
export class Text {
	constructor(text = "", paddingX = 1, paddingY = 1) {
		Object.assign(this, { text, paddingX, paddingY });
	}
	render() {
		return this.text.split("\n");
	}
	invalidate() {}
}
export class Box {
	constructor(paddingX = 1, paddingY = 1, bg) {
		Object.assign(this, { paddingX, paddingY, bg, children: [] });
	}
	addChild(c) {
		this.children.push(c);
	}
	render(width) {
		return this.children.flatMap((c) => c.render(width)).map((l) => (this.bg ? this.bg(l) : l));
	}
	invalidate() {}
}
