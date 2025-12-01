(function (root, factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory();
	} else {
		root.XiangqiEngine = factory();
	}
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const COLS = 8;
	const ROWS = 9;

	function createEmptyBoard() {
		return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
	}

	function inside(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
	function cloneBoard(b) { return b.map((row) => row.map((cell) => (cell ? { ...cell } : null))); }

	function isInsidePalace(rc, side) {
		const inCols = rc.c >= 2 && rc.c <= 4;
		if (side === 'E') return inCols && rc.r >= 0 && rc.r <= 2;
		return inCols && rc.r >= 6 && rc.r <= 8;
	}

	function rookCaptureSquares(stateBoard, from, side) {
		const out = [];
		const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
		for (const [dr, dc] of dirs) {
			let r = from.r + dr, c = from.c + dc;
			while (inside(r, c)) {
				const occ = stateBoard[r][c];
				if (!occ) { r += dr; c += dc; continue; }
				if (occ.side !== side) out.push({ r, c });
				break;
			}
		}
		return out;
	}

	function cannonCaptureSquares(stateBoard, from, side) {
		const out = [];
		const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
		for (const [dr, dc] of dirs) {
			let r = from.r + dr, c = from.c + dc;
			let foundScreen = false;
			while (inside(r, c)) {
				const occ = stateBoard[r][c];
				if (!foundScreen) {
					if (!occ) { r += dr; c += dc; continue; }
					foundScreen = true; r += dr; c += dc; continue;
				}
				if (occ) { if (occ.side !== side) out.push({ r, c }); break; }
				r += dr; c += dc;
			}
		}
		return out;
	}

	function knightCaptureSquares(stateBoard, from, side) {
		const out = [];
		const deltas = [
			{ leg: [1,0], move: [2,1] }, { leg: [1,0], move: [2,-1] },
			{ leg: [-1,0], move: [-2,1] }, { leg: [-1,0], move: [-2,-1] },
			{ leg: [0,1], move: [1,2] }, { leg: [0,1], move: [-1,2] },
			{ leg: [0,-1], move: [1,-2] }, { leg: [0,-1], move: [-1,-2] },
		];
		for (const d of deltas) {
			const legR = from.r + d.leg[0];
			const legC = from.c + d.leg[1];
			if (stateBoard[legR]?.[legC]) continue;
			const tr = from.r + d.move[0];
			const tc = from.c + d.move[1];
			if (!inside(tr, tc)) continue;
			const occ = stateBoard[tr][tc];
			if (occ && occ.side !== side) out.push({ r: tr, c: tc });
		}
		return out;
	}

	function elephantCaptureSquares(stateBoard, from, side) {
		const out = [];
		const diag = [[2,2],[2,-2],[-2,2],[-2,-2]];
		for (const [dr, dc] of diag) {
			const tr = from.r + dr, tc = from.c + dc;
			if (!inside(tr, tc)) continue;
			const eyeR = from.r + dr/2, eyeC = from.c + dc/2;
			if (stateBoard[eyeR][eyeC]) continue;
			const occ = stateBoard[tr][tc];
			if (occ && occ.side !== side) out.push({ r: tr, c: tc });
		}
		return out;
	}

	function advisorCaptureSquares(stateBoard, from, side) {
		const out = [];
		const diag = [[1,1],[1,-1],[-1,1],[-1,-1]];
		for (const [dr, dc] of diag) {
			const tr = from.r + dr, tc = from.c + dc;
			if (!inside(tr, tc)) continue;
			const occ = stateBoard[tr][tc];
			if (occ && occ.side !== side) out.push({ r: tr, c: tc });
		}
		return out;
	}

	function generalCaptureSquares(stateBoard, from, side) {
		const out = [];
		const ortho = [[1,0],[-1,0],[0,1],[0,-1]];
		for (const [dr, dc] of ortho) {
			const tr = from.r + dr, tc = from.c + dc;
			if (!inside(tr, tc)) continue;
			const occ = stateBoard[tr][tc];
			if (occ && occ.side !== side) out.push({ r: tr, c: tc });
		}
		return out;
	}

	function pawnCaptureSquares(stateBoard, from, side) {
		const out = [];
		if (side === 'E') {
			const fwd = { r: from.r + 1, c: from.c };
			if (inside(fwd.r, fwd.c)) { const occ = stateBoard[fwd.r][fwd.c]; if (occ && occ.side !== side) out.push(fwd); }
			for (const dc of [-1, 1]) {
				const tr = from.r, tc = from.c + dc;
				if (!inside(tr, tc)) continue;
				const occ = stateBoard[tr][tc]; if (occ && occ.side !== side) out.push({ r: tr, c: tc });
			}
		} else {
			const fwd = { r: from.r - 1, c: from.c };
			if (inside(fwd.r, fwd.c)) { const occ = stateBoard[fwd.r][fwd.c]; if (occ && occ.side !== side) out.push(fwd); }
			for (const dc of [-1, 1]) {
				const tr = from.r, tc = from.c + dc;
				if (!inside(tr, tc)) continue;
				const occ = stateBoard[tr][tc]; if (occ && occ.side !== side) out.push({ r: tr, c: tc });
			}
		}
		return out;
	}

	function enemyCaptureSquaresForPiece(stateBoard, from, piece) {
		switch (piece.type) {
			case 'rook': return rookCaptureSquares(stateBoard, from, 'E');
			case 'cannon': return cannonCaptureSquares(stateBoard, from, 'E');
			case 'knight': return knightCaptureSquares(stateBoard, from, 'E');
			case 'elephant': return elephantCaptureSquares(stateBoard, from, 'E');
			case 'advisor': return advisorCaptureSquares(stateBoard, from, 'E');
			case 'general': return generalCaptureSquares(stateBoard, from, 'E');
			case 'pawn': return pawnCaptureSquares(stateBoard, from, 'E');
			default: return [];
		}
	}

	function enemyCanCaptureSquare(stateBoard, target) {
		for (let r = 0; r < ROWS; r++) {
			for (let c = 0; c < COLS; c++) {
				const p = stateBoard[r][c];
				if (!p || p.side !== 'E') continue;
				const caps = enemyCaptureSquaresForPiece(stateBoard, { r, c }, p);
				for (const sq of caps) { if (sq.r === target.r && sq.c === target.c) return true; }
			}
		}
		return false;
	}

	function calculateSafeRookCaptures(board, playerRookPos) {
		const moves = [];
		const destKeys = [];
		if (!playerRookPos) return { moves, destKeys };
		const from = { ...playerRookPos };
		const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
		for (const [dr, dc] of dirs) {
			let r = from.r + dr, c = from.c + dc;
			while (inside(r, c)) {
				const occ = board[r][c];
				if (!occ) { r += dr; c += dc; continue; }
				if (occ.side === 'E') {
					const after = cloneBoard(board);
					after[from.r][from.c] = null;
					after[r][c] = { side: 'P', type: 'rook' };
					const rookAt = { r, c };
					const safe = !enemyCanCaptureSquare(after, rookAt);
					if (safe) { moves.push({ from, to: rookAt, captured: occ }); destKeys.push(`${r},${c}`); }
				}
				break;
			}
		}
		return { moves, destKeys };
	}

	function placePiece(board, side, type, r, c) { if (inside(r, c)) board[r][c] = { side, type }; }

	return {
		COLS, ROWS,
		createEmptyBoard,
		placePiece,
		calculateSafeRookCaptures,
		// exposing helpers for more advanced tests if needed
		inside,
		isInsidePalace
	};
});

