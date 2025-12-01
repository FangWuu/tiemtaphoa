const path = require('path');
const engine = require(path.join('..', 'engine.js'));

function assert(condition, message) {
	if (!condition) throw new Error(message || 'Assertion failed');
}

function formatMoves(moves) {
	return moves.map((m) => `${m.from.r},${m.from.c}->${m.to.r},${m.to.c}`).sort();
}

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

function runTest(name, fn) {
	try {
		fn();
		console.log(`PASS - ${name}`);
	} catch (err) {
		console.error(`FAIL - ${name}: ${err.message}`);
		process.exitCode = 1;
	}
}

// 1) Safe adjacent capture (no enemy recapture)
runTest('Safe: Rook captures adjacent enemy Pawn with no recapture', () => {
	const { board, rookPos } = setupBoard(({ place, setRook }) => {
		setRook(8, 0); // bottom-left corner
		place('E', 'pawn', 8, 1); // right of rook
	});
	const { moves } = engine.calculateSafeRookCaptures(board, rookPos);
	assert(formatMoves(moves).includes('8,0->8,1'), 'Expected capture 8,0->8,1');
});

// 2) Unsafe due to enemy Cannon with a screen
runTest('Unsafe: Rook capture exposes to enemy Cannon through one screen', () => {
	const { board, rookPos } = setupBoard(({ place, setRook }) => {
		setRook(8, 0);
		place('E', 'pawn', 8, 1); // capture target
		place('P', 'pawn', 8, 2); // screen for cannon
		place('E', 'cannon', 8, 3);
	});
	const { moves } = engine.calculateSafeRookCaptures(board, rookPos);
	assert(!formatMoves(moves).includes('8,0->8,1'), 'Capture should be unsafe due to cannon');
});

// 3) Unsafe due to enemy Knight with open leg
runTest('Unsafe: Enemy Knight with open leg can capture after rook capture', () => {
	const { board, rookPos } = setupBoard(({ place, setRook }) => {
		setRook(5, 4);
		place('E', 'rook', 5, 6); // target to capture
		place('E', 'knight', 3, 5); // knight can go to (4,7) if leg (4,5) is free
		// ensure leg square is free and after capture the rook sits at (5,6)
		// Knight moves: from (3,5) with leg (4,5) to (5,6)
	});
	const { moves } = engine.calculateSafeRookCaptures(board, rookPos);
	assert(!formatMoves(moves).includes('5,4->5,6'), 'Capture should be unsafe due to knight');
});

// 4) Safe because Knight leg is blocked by a piece
runTest('Safe: Knight leg blocked prevents recapture', () => {
	const { board, rookPos } = setupBoard(({ place, setRook }) => {
		setRook(5, 4);
		place('E', 'rook', 5, 6); // target
		place('E', 'knight', 3, 5); // same knight as before
		place('P', 'pawn', 4, 5); // block the knight leg
	});
	const { moves } = engine.calculateSafeRookCaptures(board, rookPos);
	assert(formatMoves(moves).includes('5,4->5,6'), 'Capture should be safe with blocked leg');
});

// 5) Elephant cannot cross river, so cannot recapture
runTest('Safe: Elephant cannot cross river to recapture', () => {
	const { board, rookPos } = setupBoard(({ place, setRook }) => {
		setRook(6, 2);
		place('E', 'pawn', 6, 3); // capture target
		place('E', 'elephant', 2, 1); // top side, cannot cross river
	});
	const { moves } = engine.calculateSafeRookCaptures(board, rookPos);
	assert(formatMoves(moves).includes('6,2->6,3'), 'Capture should be safe; elephant cannot cross');
});

// 6) Advisor and General threats inside palace
runTest('Unsafe: Enemy General adjacent in enemy palace can recapture', () => {
    const { board, rookPos } = setupBoard(({ place, setRook }) => {
        setRook(1, 3); // near top palace
        place('E', 'rook', 0, 3); // target to capture into enemy palace
        place('E', 'general', 0, 4); // adjacent inside enemy palace
    });
    const { moves } = engine.calculateSafeRookCaptures(board, rookPos);
    assert(!formatMoves(moves).includes('1,3->0,3'), 'Capture should be unsafe due to General');
});

// 7) Pawn sideways after crossing river can recapture
runTest('Unsafe: Enemy Pawn crossed river can capture sideways', () => {
	const { board, rookPos } = setupBoard(({ place, setRook }) => {
		setRook(5, 4);
		place('E', 'rook', 5, 5); // target
		place('E', 'pawn', 5, 6); // enemy pawn on row 5 has crossed river
	});
	const { moves } = engine.calculateSafeRookCaptures(board, rookPos);
	assert(!formatMoves(moves).includes('5,4->5,5'), 'Capture should be unsafe due to pawn sideways');
});

console.log('Tests finished.');

