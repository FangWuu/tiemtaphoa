const path = require('path');
const engine = require(path.join('..', 'engine.js'));

function assert(condition, message) { if (!condition) throw new Error(message || 'Assertion failed'); }

function formatMoves(moves) { return moves.map((m) => `${m.from.r},${m.from.c}->${m.to.r},${m.to.c}`).sort(); }

function setupBoard(setupFn) {
	const board = engine.createEmptyBoard();
	let rookPos = null;
	const api = {
		place(side, type, r, c) { engine.placePiece(board, side, type, r, c); },
		setRook(r, c) { rookPos = { r, c }; engine.placePiece(board, 'P', 'rook', r, c); },
		get() { return { board, rookPos }; }
	};
	setupFn(api);
	return api.get();
}

// User scenario: Rook at C7 (file C -> column 2; rank 7 -> row 2 since 9 - 7 = 2),
// Enemy pawns at F7 (col 5, row 2) and G7 (col 6, row 2). Capturing F7 should be unsafe
// because pawn at G7 can capture sideways in no-river rules.
(function testUserScenario() {
	const { board, rookPos } = setupBoard(({ setRook, place }) => {
		setRook(2, 2); // C7
		place('E', 'pawn', 2, 5); // F7
		place('E', 'pawn', 2, 6); // G7
	});
	const { moves } = engine.calculateSafeRookCaptures(board, rookPos);
	const fm = formatMoves(moves);
	assert(!fm.includes('2,2->2,5'), 'C7->F7 must be unsafe due to pawn on G7 capturing sideways');
	console.log('PASS - No-river scenario: C7->F7 correctly unsafe');
})();

console.log('No-river tests finished.');

