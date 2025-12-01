(function () {
	'use strict';

	const COLS = 8;
	const ROWS = 9;
	const FILE_LETTERS = 'ABCDEFGH'.split('');

	const boardEl = document.getElementById('board');
	const fileLabelsEl = document.getElementById('fileLabels');
	const rankLabelsEl = document.getElementById('rankLabels');
	const moveListEl = document.getElementById('moveList');
	const resetBtn = document.getElementById('resetBtn');
	const paletteEl = document.getElementById('palette');
	const deleteBtn = document.getElementById('deleteBtn');
	const aiBtn = document.getElementById('aiBtn');

	let board = createEmptyBoard();
	let selectedFrom = null; // for move tool: {r,c}
	let playerRookPos = null; // {r,c}
	let currentPalettePiece = null; // 'pawn' | 'advisor' | ... when placing enemy piece
	let deleteArmed = false; // one-time delete toggle
	let blastArmed = false; // armed after capturing enemy general; triggers on rook's next move
	let geminiHighlightActive = false; // track when Gemini has made a suggestion

	function createEmptyBoard() {
		return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
	}

	function algebraicFrom(rc) {
		if (!rc) return '';
		const file = FILE_LETTERS[rc.c];
		const rank = ROWS - rc.r; // 9..1
		return `${file}${rank}`;
	}

	function renderLabels() {
		fileLabelsEl.innerHTML = '';
		rankLabelsEl.innerHTML = '';
		for (let c = 0; c < COLS; c++) {
			const d = document.createElement('div');
			d.textContent = FILE_LETTERS[c];
			fileLabelsEl.appendChild(d);
		}
		for (let r = 0; r < ROWS; r++) {
			const d = document.createElement('div');
			d.textContent = String(ROWS - r);
			rankLabelsEl.appendChild(d);
		}
	}

	function createBoardGrid() {
		boardEl.innerHTML = '';
		for (let r = 0; r < ROWS; r++) {
			for (let c = 0; c < COLS; c++) {
				const cell = document.createElement('button');
				cell.type = 'button';
				cell.className = 'cell';
				cell.dataset.r = String(r);
				cell.dataset.c = String(c);
				cell.setAttribute('role', 'gridcell');
				cell.addEventListener('click', onCellClick);
				cell.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelMoveSelection(); });
				boardEl.appendChild(cell);
			}
		}
	}

	function pieceGlyph(piece) {
		if (!piece) return '';
		const side = piece.side === 'P' ? 'player' : 'enemy';
		const classes = ['piece', side];
		let text = '';
		switch (piece.type) {
			case 'rook':
				classes.push('rook');
				text = '車';
				break;
			case 'cannon':
				text = '炮';
				break;
			case 'knight':
				text = '馬';
				break;
			case 'elephant':
				text = '象';
				break;
			case 'advisor':
				text = '士';
				break;
			case 'general':
				text = '將';
				break;
			case 'pawn':
				text = '卒';
				break;
		}
		const wrap = document.createElement('div');
		wrap.className = classes.join(' ');
		wrap.textContent = text;
		return wrap;
	}

	function renderBoard(highlights = new Set(), selected = null) {
		const cells = boardEl.querySelectorAll('.cell');
		cells.forEach((cell) => {
			cell.innerHTML = '';
			cell.classList.remove('highlight-safe', 'highlight-unsafe', 'highlight-selected', 'highlight-rook', 'highlight-best');
			const r = Number(cell.dataset.r);
			const c = Number(cell.dataset.c);
			const piece = board[r][c];
			if (piece) {
				cell.appendChild(pieceGlyph(piece));
			}
			const key = keyOf({ r, c });
			if (highlights.has(key)) {
				const mode = highlights.get(key);
				if (mode === 'unsafe') cell.classList.add('highlight-unsafe');
				else if (mode === 'best') {
					cell.classList.add('highlight-best');
					// Add "Best" indicator
					const bestIndicator = document.createElement('div');
					bestIndicator.className = 'best-indicator';
					bestIndicator.textContent = 'Best';
					cell.appendChild(bestIndicator);
				}
				else cell.classList.add('highlight-safe');
			}
			if (selected && selected.r === r && selected.c === c) {
				cell.classList.add('highlight-selected');
			}
			if (playerRookPos && playerRookPos.r === r && playerRookPos.c === c) {
				cell.classList.add('highlight-rook');
			}
		});
	}

	// Map-backed highlight set with status
	function createHighlightMap() {
		const map = new Map();
		map.addSafe = (rc) => map.set(keyOf(rc), 'safe');
		map.addUnsafe = (rc) => map.set(keyOf(rc), 'unsafe');
		map.addBestMove = (rc) => map.set(keyOf(rc), 'best');
		map.has = (k) => Map.prototype.has.call(map, k);
		map.get = (k) => Map.prototype.get.call(map, k);
		map.clear = () => Map.prototype.clear.call(map);
		return map;
	}

	function setPaletteHandlers() {
		if (!paletteEl) return;
		paletteEl.addEventListener('click', (e) => {
			const btn = e.target.closest('.token');
			if (!btn) return;
			const type = btn.dataset.piece;
			if (currentPalettePiece === type) {
				currentPalettePiece = null;
				updatePaletteActive();
				return;
			}
			currentPalettePiece = type;
			updatePaletteActive();
			// cancel any move selection when switching to placement
				cancelMoveSelection();
			});
		}

	function updatePaletteActive() {
		if (!paletteEl) return;
		const buttons = paletteEl.querySelectorAll('.token');
		buttons.forEach((b) => {
			if (b.dataset.piece === currentPalettePiece) b.classList.add('active');
			else b.classList.remove('active');
		});
	}

	function onCellClick(e) {
		const cell = e.currentTarget;
		const r = Number(cell.dataset.r);
		const c = Number(cell.dataset.c);
		// If delete armed, delete piece if any and consume
		if (deleteArmed) {
			if (board[r][c]) {
				if (playerRookPos && playerRookPos.r === r && playerRookPos.c === c) playerRookPos = null;
				board[r][c] = null;
				// Clear Gemini highlight when board changes
				geminiHighlightActive = false;
				runAutoSafety();
			}
			deleteArmed = false;
			updateDeleteButton();
			return;
		}
		// If a palette piece is selected, place enemy piece only on empty square
		if (currentPalettePiece && !board[r][c]) {
			placeEnemyPieceOnCell({ r, c }, currentPalettePiece);
			// one-time placement: clear selection after successful place
			currentPalettePiece = null;
			updatePaletteActive();
			// Clear Gemini highlight when board changes
			geminiHighlightActive = false;
			runAutoSafety();
			return;
		}
		// Otherwise, handle click-to-move
			moveToolClick({ r, c });
		runAutoSafety();
	}

	function placeEnemyPieceOnCell(rc, type) {
		// Place only if empty
		if (board[rc.r][rc.c]) return;
		board[rc.r][rc.c] = { side: 'E', type };
		renderBoard();
	}

	function cancelMoveSelection() {
		selectedFrom = null;
		runAutoSafety();
	}

	function moveToolClick(rc) {
		if (!selectedFrom) {
			const piece = board[rc.r][rc.c];
			if (!piece) return;
			selectedFrom = rc;
			return;
		}
		const from = selectedFrom;
		const moving = board[from.r][from.c];
		const targetBefore = board[rc.r][rc.c];
		const wasBlastArmed = blastArmed; // capture earlier arms next move
		// If clicking the same square, cancel selection
		if (from.r === rc.r && from.c === rc.c) {
			selectedFrom = null;
			// Clear Gemini highlight when selection is cancelled
			geminiHighlightActive = false;
			return;
		}
		// Basic validity check: for rook, must move in straight line
		if (moving && moving.type === 'rook') {
			const isStraight = (from.r === rc.r) || (from.c === rc.c);
			if (!isStraight) {
				// invalid move -> deselect without moving
				selectedFrom = null;
				return;
			}
		}
		board[from.r][from.c] = null;
		const hadPlayerRook = playerRookPos && playerRookPos.r === from.r && playerRookPos.c === from.c;
		const destHadPlayerRook = playerRookPos && playerRookPos.r === rc.r && playerRookPos.c === rc.c;
		board[rc.r][rc.c] = moving;
		if (hadPlayerRook) playerRookPos = { r: rc.r, c: rc.c };
		else if (destHadPlayerRook && !(moving.side === 'P' && moving.type === 'rook')) playerRookPos = null;
		// If player's rook moves and a blast was armed from a prior capture, trigger blast now at landing square
		if (moving && moving.side === 'P' && moving.type === 'rook' && wasBlastArmed) {
			performBlastAt({ r: rc.r, c: rc.c });
			blastArmed = false;
		}
		// If player's rook captured enemy general on this move, arm the blast for its next move
		if (moving && moving.side === 'P' && moving.type === 'rook' && targetBefore && targetBefore.side === 'E' && targetBefore.type === 'general') {
			blastArmed = true;
		}
		selectedFrom = null;
		// Clear Gemini highlight when a move is made
		geminiHighlightActive = false;
	}

	function performBlastAt(center) {
		// Remove all pieces in same row and column, except preserve the player's rook at center if present
		for (let cc = 0; cc < COLS; cc++) {
			if (cc === center.c) continue;
			const p = board[center.r][cc];
			if (p) board[center.r][cc] = null;
		}
		for (let rr = 0; rr < ROWS; rr++) {
			if (rr === center.r) continue;
			const p = board[rr][center.c];
			if (p) board[rr][center.c] = null;
		}
		// Ensure rook marker remains if rook still at center
		const centerPiece = board[center.r][center.c];
		if (!centerPiece || !(centerPiece.side === 'P' && centerPiece.type === 'rook')) {
			if (playerRookPos && playerRookPos.r === center.r && playerRookPos.c === center.c) playerRookPos = null;
		}
		runAutoSafety();
	}

	function findNextBestMove() {
		if (!playerRookPos) return null;
		
		const validMoves = getValidRookMoves(playerRookPos);
		const strategicMoves = [];
		
		for (const move of validMoves) {
			// Check for immediate captures
			const immediateCapture = analyzeImmediateCapture(move);
			if (immediateCapture.isStrategic) {
				strategicMoves.push({
					...move,
					...immediateCapture
				});
			}
			
			// Check for tactical setups
			const tacticalSetup = analyzeTacticalSetup(move);
			if (tacticalSetup.isStrategic) {
				strategicMoves.push({
					...move,
					...tacticalSetup
				});
			}
		}
		
		if (strategicMoves.length === 0) return null;
		
		// Sort by strategic value: immediate captures first, then by score
		strategicMoves.sort((a, b) => {
			if (a.type === 'immediate' && b.type !== 'immediate') return -1;
			if (a.type !== 'immediate' && b.type === 'immediate') return 1;
			// For tactical moves, use score (higher is better)
			const scoreA = a.score || (a.target ? getPieceValue(a.target.type) : 0);
			const scoreB = b.score || (b.target ? getPieceValue(b.target.type) : 0);
			return scoreB - scoreA; // Higher scores first
		});
		return strategicMoves[0];
	}

	function getValidRookMoves(from) {
		const moves = [];
		const dirs = [[1,0], [-1,0], [0,1], [0,-1]];
		
		for (const [dr, dc] of dirs) {
			let r = from.r + dr, c = from.c + dc;
			while (inside(r, c)) {
				const target = board[r][c];
				if (!target) {
					// Empty square - valid move
					moves.push({ from, to: { r, c } });
				} else {
					// Occupied square - can't move further in this direction
					break;
				}
				r += dr; c += dc;
			}
		}
		
		return moves;
	}

	function analyzeImmediateCapture(move) {
		// Check if the move directly captures an enemy piece
		const target = board[move.to.r][move.to.c];
		if (!target || target.side !== 'E') return { isStrategic: false };
		
		// Simulate the capture
		const afterCapture = cloneBoard(board);
		afterCapture[move.from.r][move.from.c] = null;
		afterCapture[move.to.r][move.to.c] = { side: 'P', type: 'rook' };
		
		// Safety check
		const isSafe = !enemyCanCaptureSquare(afterCapture, move.to);
		if (!isSafe) return { isStrategic: false };
		
		return {
			isStrategic: true,
			type: 'immediate',
			target: target,
			reason: `Ăn ${prettyPieceName(target)} ngay lập tức`,
			distanceToTarget: 0
		};
	}

	function analyzeTacticalSetup(move) {
		// Simulate the move
		const afterMove = cloneBoard(board);
		afterMove[move.from.r][move.from.c] = null;
		afterMove[move.to.r][move.to.c] = { side: 'P', type: 'rook' };
		
		// Safety check for the move itself
		const isMoveSafe = !enemyCanCaptureSquare(afterMove, move.to);
		if (!isMoveSafe) return { isStrategic: false };
		
		let bestAnalysis = { isStrategic: false };
		
		// Check for Cannon tactic (two cannons on same line)
		const cannonTactic = analyzeCannonTactic(afterMove, move.to);
		if (cannonTactic.isStrategic) {
			bestAnalysis = cannonTactic;
		}
		
		// Check for other piece tactics
		const otherTactics = analyzeOtherPieceTactics(afterMove, move.to);
		if (otherTactics.isStrategic) {
			// If the tactic suggests a specific target position, use that instead of the original move
			if (otherTactics.targetPosition) {
				// Override the move target with the suggested position
				move.to = otherTactics.targetPosition;
				
				// IMPORTANT: Re-check safety for the new target position
				const afterNewMove = cloneBoard(board);
				afterNewMove[move.from.r][move.from.c] = null;
				afterNewMove[move.to.r][move.to.c] = { side: 'P', type: 'rook' };
				const isNewMoveSafe = !enemyCanCaptureSquare(afterNewMove, move.to);
				if (!isNewMoveSafe) return { isStrategic: false };
			}
			
			if (!bestAnalysis.isStrategic || otherTactics.score > bestAnalysis.score) {
				bestAnalysis = otherTactics;
			}
		}
		
		return bestAnalysis;
	}

	function analyzeCannonTactic(boardState, rookPos) {
		// Check horizontal line for two cannons
		const horizontalCannons = findPiecesInLine(boardState, rookPos.r, 'horizontal', 'cannon');
		if (horizontalCannons.length >= 2) {
			// Check if rook is positioned between two cannons
			const sortedCannons = horizontalCannons.sort((a, b) => a.c - b.c);
			const rookCol = rookPos.c;
			
			// Find if rook is between two cannons
			for (let i = 0; i < sortedCannons.length - 1; i++) {
				const cannon1 = sortedCannons[i];
				const cannon2 = sortedCannons[i + 1];
				
				if (cannon1.c < rookCol && rookCol < cannon2.c) {
					// Rook is between two cannons - simulate one cannon moving away
					const afterCannon1Leaves = cloneBoard(boardState);
					afterCannon1Leaves[cannon1.r][cannon1.c] = null;
					
					// Check if rook can capture the remaining cannon
					const canCaptureCannon2 = canRookCaptureTarget(afterCannon1Leaves, rookPos, cannon2);
					if (canCaptureCannon2) {
						// Safety check after capturing cannon2
						const afterCapture = cloneBoard(afterCannon1Leaves);
						afterCapture[rookPos.r][rookPos.c] = null;
						afterCapture[cannon2.r][cannon2.c] = { side: 'P', type: 'rook' };
						
						const isSafe = !enemyCanCaptureSquare(afterCapture, cannon2);
						if (isSafe) {
							return {
								isStrategic: true,
								type: 'tactical',
								reason: `Chiến thuật Pháo: đặt giữa 2 Pháo địch`,
								distanceToTarget: Math.abs(rookPos.c - cannon2.c)
							};
						}
					}
				}
			}
		}
		
		// Check vertical line for two cannons
		const verticalCannons = findPiecesInLine(boardState, rookPos.c, 'vertical', 'cannon');
		if (verticalCannons.length >= 2) {
			const sortedCannons = verticalCannons.sort((a, b) => a.r - b.r);
			const rookRow = rookPos.r;
			
			for (let i = 0; i < sortedCannons.length - 1; i++) {
				const cannon1 = sortedCannons[i];
				const cannon2 = sortedCannons[i + 1];
				
				if (cannon1.r < rookRow && rookRow < cannon2.r) {
					const afterCannon1Leaves = cloneBoard(boardState);
					afterCannon1Leaves[cannon1.r][cannon1.c] = null;
					
					const canCaptureCannon2 = canRookCaptureTarget(afterCannon1Leaves, rookPos, cannon2);
					if (canCaptureCannon2) {
						const afterCapture = cloneBoard(afterCannon1Leaves);
						afterCapture[rookPos.r][rookPos.c] = null;
						afterCapture[cannon2.r][cannon2.c] = { side: 'P', type: 'rook' };
						
						const isSafe = !enemyCanCaptureSquare(afterCapture, cannon2);
						if (isSafe) {
							return {
								isStrategic: true,
								type: 'tactical',
								reason: `Chiến thuật Pháo: đặt giữa 2 Pháo địch`,
								distanceToTarget: Math.abs(rookPos.r - cannon2.r)
							};
						}
					}
				}
			}
		}
		
		return { isStrategic: false };
	}

	function analyzeOtherPieceTactics(boardState, rookPos) {
		// Check for any piece that can be captured after one enemy move
		const allEnemyPieces = findAllEnemyPieces(boardState);
		let bestTactic = { isStrategic: false };
		
		// First, check if the rook's new position threatens any pieces directly
		const threatenedPieces = [];
		for (const piece of allEnemyPieces) {
			if (canRookCaptureTarget(boardState, rookPos, piece)) {
				threatenedPieces.push(piece);
			}
		}
		
		// If we threaten multiple pieces, analyze the tactical situation more carefully
		if (threatenedPieces.length >= 2) {
			// Check if the threatened pieces are on the same line (row or column)
			const threatenedOnSameLine = analyzeThreatenedPiecesOnSameLine(boardState, rookPos, threatenedPieces);
			if (threatenedOnSameLine.isStrategic) {
				return threatenedOnSameLine;
			}
			
			// If not on same line, find the best individual capture
			let bestTarget = null;
			let bestScore = -1;
			
			for (const target of threatenedPieces) {
				// Simulate capturing this target
				const afterCapture = cloneBoard(boardState);
				afterCapture[rookPos.r][rookPos.c] = null;
				afterCapture[target.r][target.c] = { side: 'P', type: 'rook' };
				
				const isSafe = !enemyCanCaptureSquare(afterCapture, target);
				if (isSafe) {
					const distance = Math.abs(rookPos.r - target.r) + Math.abs(rookPos.c - target.c);
					const score = getPieceValue(target.type) - distance; // Higher value pieces preferred
					if (score > bestScore) {
						bestScore = score;
						bestTarget = target;
					}
				}
			}
			
			if (bestTarget) {
				return {
					isStrategic: true,
					type: 'tactical',
					reason: `Đe dọa nhiều quân: có thể ăn ${prettyPieceName(bestTarget)}`,
					distanceToTarget: Math.abs(rookPos.r - bestTarget.r) + Math.abs(rookPos.c - bestTarget.c),
					score: bestScore
				};
			}
		}
		
		// NEW: Check for proactive positioning opportunities
		// Look for positions where moving the rook would create tactical advantages
		const proactiveTactic = analyzeProactivePositioning(boardState, rookPos);
		if (proactiveTactic.isStrategic) {
			return proactiveTactic;
		}
		
		// Check for tactical opportunities where moving one piece creates capture opportunity
		for (const piece of allEnemyPieces) {
			// Simulate this piece moving away
			const afterPieceLeaves = cloneBoard(boardState);
			afterPieceLeaves[piece.r][piece.c] = null;
			
			// Check if rook can capture any other piece after this piece leaves
			for (const otherPiece of allEnemyPieces) {
				if (otherPiece.r === piece.r && otherPiece.c === piece.c) continue; // Same piece
				
				const canCapture = canRookCaptureTarget(afterPieceLeaves, rookPos, otherPiece);
				if (canCapture) {
					// Safety check after capturing
					const afterCapture = cloneBoard(afterPieceLeaves);
					afterCapture[rookPos.r][rookPos.c] = null;
					afterCapture[otherPiece.r][otherPiece.c] = { side: 'P', type: 'rook' };
					
					const isSafe = !enemyCanCaptureSquare(afterCapture, otherPiece);
					if (isSafe) {
						const distance = Math.abs(rookPos.r - otherPiece.r) + Math.abs(rookPos.c - otherPiece.c);
						const score = getPieceValue(otherPiece.type) - distance;
						if (!bestTactic.isStrategic || score > bestTactic.score) {
							bestTactic = {
								isStrategic: true,
								type: 'tactical',
								reason: `Cơ hội ăn ${prettyPieceName(otherPiece)} sau khi ${prettyPieceName(piece)} di chuyển`,
								distanceToTarget: distance,
								score: score
							};
						}
					}
				}
			}
		}
		
		return bestTactic;
	}

	function analyzeThreatenedPiecesOnSameLine(boardState, rookPos, threatenedPieces) {
		// Check if threatened pieces are on the same row or column as the rook
		const sameRowPieces = threatenedPieces.filter(p => p.r === rookPos.r);
		const sameColPieces = threatenedPieces.filter(p => p.c === rookPos.c);
		
		// Analyze same row threats
		if (sameRowPieces.length >= 2) {
			const sortedPieces = sameRowPieces.sort((a, b) => a.c - b.c);
			const rookCol = rookPos.c;
			
			// Check if rook is positioned between two pieces
			for (let i = 0; i < sortedPieces.length - 1; i++) {
				const piece1 = sortedPieces[i];
				const piece2 = sortedPieces[i + 1];
				
				if (piece1.c < rookCol && rookCol < piece2.c) {
					// Rook is between two pieces - this is a strong tactical position
					// The enemy must move one piece, allowing us to capture the other
					const bestTarget = getPieceValue(piece1.type) > getPieceValue(piece2.type) ? piece1 : piece2;
					
					// Simulate capturing the better piece
					const afterCapture = cloneBoard(boardState);
					afterCapture[rookPos.r][rookPos.c] = null;
					afterCapture[bestTarget.r][bestTarget.c] = { side: 'P', type: 'rook' };
					
					const isSafe = !enemyCanCaptureSquare(afterCapture, bestTarget);
					if (isSafe) {
						return {
							isStrategic: true,
							type: 'tactical',
							reason: `Đe dọa 2 quân cùng hàng: ${prettyPieceName(piece1)} và ${prettyPieceName(piece2)}`,
							distanceToTarget: Math.abs(rookPos.c - bestTarget.c),
							score: getPieceValue(bestTarget.type)
						};
					}
				}
			}
		}
		
		// Analyze same column threats
		if (sameColPieces.length >= 2) {
			const sortedPieces = sameColPieces.sort((a, b) => a.r - b.r);
			const rookRow = rookPos.r;
			
			// Check if rook is positioned between two pieces
			for (let i = 0; i < sortedPieces.length - 1; i++) {
				const piece1 = sortedPieces[i];
				const piece2 = sortedPieces[i + 1];
				
				if (piece1.r < rookRow && rookRow < piece2.r) {
					// Rook is between two pieces - this is a strong tactical position
					const bestTarget = getPieceValue(piece1.type) > getPieceValue(piece2.type) ? piece1 : piece2;
					
					// Simulate capturing the better piece
					const afterCapture = cloneBoard(boardState);
					afterCapture[rookPos.r][rookPos.c] = null;
					afterCapture[bestTarget.r][bestTarget.c] = { side: 'P', type: 'rook' };
					
					const isSafe = !enemyCanCaptureSquare(afterCapture, bestTarget);
					if (isSafe) {
						return {
							isStrategic: true,
							type: 'tactical',
							reason: `Đe dọa 2 quân cùng cột: ${prettyPieceName(piece1)} và ${prettyPieceName(piece2)}`,
							distanceToTarget: Math.abs(rookPos.r - bestTarget.r),
							score: getPieceValue(bestTarget.type)
						};
					}
				}
			}
		}
		
		return { isStrategic: false };
	}

	function analyzeProactivePositioning(boardState, rookPos) {
		// Look for positions where moving the rook would create tactical advantages
		const allEnemyPieces = findAllEnemyPieces(boardState);
		let bestTactic = { isStrategic: false };
		
		// Check for potential same-row positioning
		for (let targetRow = 0; targetRow < ROWS; targetRow++) {
			const piecesOnRow = allEnemyPieces.filter(p => p.r === targetRow);
			if (piecesOnRow.length >= 2) {
				// Sort pieces by column to find optimal position between them
				const sortedPieces = piecesOnRow.sort((a, b) => a.c - b.c);
				
				// Find the optimal position between the two pieces
				for (let i = 0; i < sortedPieces.length - 1; i++) {
					const piece1 = sortedPieces[i];
					const piece2 = sortedPieces[i + 1];
					
					// Calculate the middle position between the two pieces
					const middleCol = Math.floor((piece1.c + piece2.c) / 2);
					const potentialPos = { r: targetRow, c: middleCol };
					
					// Check if this position is empty and rook can reach it
					if (!boardState[targetRow][middleCol] && canRookReachPosition(boardState, rookPos, potentialPos)) {
						// Check how many pieces this position threatens
						let threatenedCount = 0;
						let threatenedPieces = [];
						
						for (const piece of piecesOnRow) {
							if (canRookCaptureTarget(boardState, potentialPos, piece)) {
								threatenedCount++;
								threatenedPieces.push(piece);
							}
						}
						
						// If this position threatens multiple pieces, it's a strong tactical position
						if (threatenedCount >= 2) {
							// Find the best target (highest value piece)
							let bestTarget = threatenedPieces[0];
							for (const piece of threatenedPieces) {
								if (getPieceValue(piece.type) > getPieceValue(bestTarget.type)) {
									bestTarget = piece;
								}
							}
							
							// Simulate the move and capture
							const afterMove = cloneBoard(boardState);
							afterMove[rookPos.r][rookPos.c] = null;
							afterMove[potentialPos.r][potentialPos.c] = { side: 'P', type: 'rook' };
							
							// IMPORTANT: Check if the move itself is safe
							const isMoveSafe = !enemyCanCaptureSquare(afterMove, potentialPos);
							if (!isMoveSafe) continue; // Skip this position if unsafe
							
							const afterCapture = cloneBoard(afterMove);
							afterCapture[potentialPos.r][potentialPos.c] = null;
							afterCapture[bestTarget.r][bestTarget.c] = { side: 'P', type: 'rook' };
							
							const isSafe = !enemyCanCaptureSquare(afterCapture, bestTarget);
							if (isSafe) {
								// Calculate distance from rook's current position to the tactical position
								const distanceFromRook = Math.abs(rookPos.r - potentialPos.r) + Math.abs(rookPos.c - potentialPos.c);
								const score = getPieceValue(bestTarget.type) + (threatenedCount - 1) * 0.5 - distanceFromRook * 0.5; // Strongly penalize longer distances
								if (!bestTactic.isStrategic || score > bestTactic.score) {
									bestTactic = {
										isStrategic: true,
										type: 'tactical',
										reason: `Di chuyển để đe dọa ${threatenedCount} quân cùng hàng: ${threatenedPieces.map(p => prettyPieceName(p)).join(', ')}`,
										distanceToTarget: Math.abs(potentialPos.c - bestTarget.c),
										score: score,
										targetPosition: potentialPos
									};
								}
							}
						}
					}
				}
			}
		}
		
		// Check for potential same-column positioning
		for (let targetCol = 0; targetCol < COLS; targetCol++) {
			const piecesOnCol = allEnemyPieces.filter(p => p.c === targetCol);
			if (piecesOnCol.length >= 2) {
				// Sort pieces by row to find optimal position between them
				const sortedPieces = piecesOnCol.sort((a, b) => a.r - b.r);
				
				// Find the optimal position between the two pieces
				for (let i = 0; i < sortedPieces.length - 1; i++) {
					const piece1 = sortedPieces[i];
					const piece2 = sortedPieces[i + 1];
					
					// Calculate the middle position between the two pieces
					const middleRow = Math.floor((piece1.r + piece2.r) / 2);
					const potentialPos = { r: middleRow, c: targetCol };
					
					// Check if this position is empty and rook can reach it
					if (!boardState[middleRow][targetCol] && canRookReachPosition(boardState, rookPos, potentialPos)) {
						// Check how many pieces this position threatens
						let threatenedCount = 0;
						let threatenedPieces = [];
						
						for (const piece of piecesOnCol) {
							if (canRookCaptureTarget(boardState, potentialPos, piece)) {
								threatenedCount++;
								threatenedPieces.push(piece);
							}
						}
						
						// If this position threatens multiple pieces, it's a strong tactical position
						if (threatenedCount >= 2) {
							// Find the best target (highest value piece)
							let bestTarget = threatenedPieces[0];
							for (const piece of threatenedPieces) {
								if (getPieceValue(piece.type) > getPieceValue(bestTarget.type)) {
									bestTarget = piece;
								}
							}
							
							// Simulate the move and capture
							const afterMove = cloneBoard(boardState);
							afterMove[rookPos.r][rookPos.c] = null;
							afterMove[potentialPos.r][potentialPos.c] = { side: 'P', type: 'rook' };
							
							// IMPORTANT: Check if the move itself is safe
							const isMoveSafe = !enemyCanCaptureSquare(afterMove, potentialPos);
							if (!isMoveSafe) continue; // Skip this position if unsafe
							
							const afterCapture = cloneBoard(afterMove);
							afterCapture[potentialPos.r][potentialPos.c] = null;
							afterCapture[bestTarget.r][bestTarget.c] = { side: 'P', type: 'rook' };
							
							const isSafe = !enemyCanCaptureSquare(afterCapture, bestTarget);
							if (isSafe) {
								// Calculate distance from rook's current position to the tactical position
								const distanceFromRook = Math.abs(rookPos.r - potentialPos.r) + Math.abs(rookPos.c - potentialPos.c);
								const score = getPieceValue(bestTarget.type) + (threatenedCount - 1) * 0.5 - distanceFromRook * 0.5; // Strongly penalize longer distances
								if (!bestTactic.isStrategic || score > bestTactic.score) {
									bestTactic = {
										isStrategic: true,
										type: 'tactical',
										reason: `Di chuyển để đe dọa ${threatenedCount} quân cùng cột: ${threatenedPieces.map(p => prettyPieceName(p)).join(', ')}`,
										distanceToTarget: Math.abs(potentialPos.r - bestTarget.r),
										score: score,
										targetPosition: potentialPos
									};
								}
							}
						}
					}
				}
			}
		}
		
		return bestTactic;
	}

	function canRookReachPosition(boardState, from, to) {
		// Check if rook can reach the target position in one move
		const dirs = [[1,0], [-1,0], [0,1], [0,-1]];
		
		for (const [dr, dc] of dirs) {
			let r = from.r + dr, c = from.c + dc;
			while (inside(r, c)) {
				if (r === to.r && c === to.c) {
					return true; // Can reach target
				}
				const piece = boardState[r][c];
				if (piece) break; // Blocked
				r += dr; c += dc;
			}
		}
		
		return false;
	}

	function getPieceValue(pieceType) {
		// Assign values to pieces for prioritization
		const values = {
			general: 1000,  // Highest priority
			rook: 9,
			cannon: 4.5,
			knight: 4,
			elephant: 2,
			advisor: 2,
			pawn: 1
		};
		return values[pieceType] || 1;
	}

	function findPiecesInLine(boardState, lineIndex, direction, pieceType) {
		const pieces = [];
		
		if (direction === 'horizontal') {
			for (let c = 0; c < COLS; c++) {
				const piece = boardState[lineIndex][c];
				if (piece && piece.side === 'E' && piece.type === pieceType) {
					pieces.push({ r: lineIndex, c });
				}
			}
		} else { // vertical
			for (let r = 0; r < ROWS; r++) {
				const piece = boardState[r][lineIndex];
				if (piece && piece.side === 'E' && piece.type === pieceType) {
					pieces.push({ r, c: lineIndex });
				}
			}
		}
		
		return pieces;
	}

	function findAllEnemyPieces(boardState) {
		const pieces = [];
		for (let r = 0; r < ROWS; r++) {
			for (let c = 0; c < COLS; c++) {
				const piece = boardState[r][c];
				if (piece && piece.side === 'E') {
					pieces.push({ r, c, type: piece.type });
				}
			}
		}
		return pieces;
	}

	// Legacy function kept for compatibility - now handled by analyzeOtherPieceTactics
	function analyzePawnCaptureOpportunity(boardState, rookPos, pawns, direction) {
		return { isStrategic: false };
	}

	function canRookCaptureTarget(boardState, rookPos, target) {
		// Check if rook can reach target in one move
		const dirs = [[1,0], [-1,0], [0,1], [0,-1]];
		
		for (const [dr, dc] of dirs) {
			let r = rookPos.r + dr, c = rookPos.c + dc;
			while (inside(r, c)) {
				if (r === target.r && c === target.c) {
					return true; // Can reach target
				}
				const piece = boardState[r][c];
				if (piece) break; // Blocked
				r += dr; c += dc;
			}
		}
		
		return false;
	}

	function initialSetup() {
		board = createEmptyBoard();
		selectedFrom = null;
		// Player's Rook at D3 -> c=3, r=6
		const playerR = 6, playerC = 3;
		board[playerR][playerC] = { side: 'P', type: 'rook' };
		playerRookPos = { r: playerR, c: playerC };
		// Enemy Pawns at D7, F7, H7 -> r=2, c=3/5/7
		const enemyR = 2;
		for (const enemyC of [3, 5, 7]) {
			board[enemyR][enemyC] = { side: 'E', type: 'pawn' };
		}
	}

// removed manual calc button; auto-calc runs on all interactions

	resetBtn.addEventListener('click', () => {
		initialSetup();
		// Clear Gemini highlight when board is reset
		geminiHighlightActive = false;
		runAutoSafety();
	});

	deleteBtn.addEventListener('click', () => {
		deleteArmed = !deleteArmed;
		// Deselect palette when arming delete
		if (deleteArmed) { currentPalettePiece = null; updatePaletteActive(); }
		updateDeleteButton();
	});

	aiBtn.addEventListener('click', async () => {
		// Check if API key is set
		const apiKey = localStorage.getItem('gemini_api_key');
		if (!apiKey) {
			const key = prompt('Please enter your Google Gemini API key:');
			if (key) {
				localStorage.setItem('gemini_api_key', key);
				initGeminiAI(key);
			} else {
				alert('API key is required for AI analysis');
				return;
			}
		} else if (!geminiAI) {
			initGeminiAI(apiKey);
		}

		// Show loading state
		aiBtn.textContent = '🤖 Đang phân tích...';
		aiBtn.disabled = true;

		try {
			const suggestion = await getAISuggestion(board, playerRookPos);
			if (suggestion.error) {
				alert('AI Analysis Error: ' + suggestion.error);
			} else {
				// Display AI suggestion
				displayAISuggestion(suggestion);
				// Highlight Gemini's suggested move
				highlightGeminiMove(suggestion.move);
			}
		} catch (error) {
			alert('Failed to get AI suggestion: ' + error.message);
		} finally {
			// Reset button state
			aiBtn.textContent = '🤖 AI Phân Tích';
			aiBtn.disabled = false;
		}
	});

	// Remove the findMoveBtn event listener - strategic analysis is now always active

	function updateDeleteButton() {
		if (!deleteBtn) return;
		if (deleteArmed) {
			deleteBtn.classList.add('danger');
			deleteBtn.textContent = 'Đang Xóa (bấm 1 ô)';
		} else {
			deleteBtn.classList.remove('danger');
			deleteBtn.textContent = 'Xóa 1 Quân';
		}
	}

	function computeRookLineHighlights() {
		const map = createHighlightMap();
		if (!playerRookPos) return map;
		// Highlight all cells in the rook's row and column
		const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ];
		const from = playerRookPos;
		// Include the rook square itself using current board
		{
			const unsafe = enemyCanCaptureSquare(board, from);
			if (unsafe) map.addUnsafe(from); else map.addSafe(from);
		}
		for (const [dr, dc] of dirs) {
			let r = from.r + dr, c = from.c + dc;
			while (inside(r, c)) {
				const rc = { r, c };
				const after = cloneBoard(board);
				// Move rook to the hypothetical square rc
				after[from.r][from.c] = null;
				after[rc.r][rc.c] = { side: 'P', type: 'rook' };
				const unsafe = enemyCanCaptureSquare(after, rc);
				if (unsafe) map.addUnsafe(rc); else map.addSafe(rc);
				r += dr; c += dc;
			}
		}
		return map;
	}

	function runAutoSafety() {
		const { moves, destKeys } = calculateSafeRookCaptures();
		const map = computeRookLineHighlights();
		
		// If Gemini highlight is active, don't override it with automatic analysis
		if (geminiHighlightActive) {
			renderBoard(map, selectedFrom);
			renderMoveList(moves, null, null);
			return;
		}
		
		// Always run strategic analysis and highlight best moves
		const bestMove = findNextBestMove();
		
		// Validate that the best move is actually safe (not in red/unsafe area)
		let validBestMove = bestMove;
		if (bestMove) {
			const bestMoveKey = keyOf(bestMove.to);
			const highlightStatus = map.get(bestMoveKey);
			
			// Additional safety check: simulate the move and check if rook would be captured
			const afterMove = cloneBoard(board);
			afterMove[bestMove.from.r][bestMove.from.c] = null;
			afterMove[bestMove.to.r][bestMove.to.c] = { side: 'P', type: 'rook' };
			const isMoveSafe = !enemyCanCaptureSquare(afterMove, bestMove.to);
			
			if (highlightStatus === 'unsafe' || !isMoveSafe) {
				// Best move is unsafe - reject it
				validBestMove = null;
			} else {
				// Add best move highlights to the map
				map.addBestMove(bestMove.to);
			}
		}
		
		// If there are immediate safe captures, highlight the best one instead of tactical moves
		if (moves.length > 0) {
			// Find the highest value immediate capture
			let bestCapture = moves[0];
			for (const move of moves) {
				const currentValue = getPieceValue(move.captured.type);
				const bestValue = getPieceValue(bestCapture.captured.type);
				if (currentValue > bestValue) {
					bestCapture = move;
				}
			}
			
			// Clear any existing best move highlights and highlight the best capture instead
			map.clear();
			// Re-add safe/unsafe highlights
			const highlightMap = computeRookLineHighlights();
			for (const [key, value] of highlightMap.entries()) {
				if (value === 'safe' || value === 'unsafe') {
					map.set(key, value);
				}
			}
			// Add the best capture as the highlighted move
			map.addBestMove(bestCapture.to);
		}
		
		renderBoard(map, selectedFrom);
		renderMoveList(moves, validBestMove, null);
	}

	function keyOf(rc) { return `${rc.r},${rc.c}`; }
	function inside(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

	function cloneBoard(b) {
		return b.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
	}

	function calculateSafeRookCaptures() {
		const moves = [];
		const destKeys = [];
		if (!playerRookPos) {
			renderMoveList([]);
			return { moves, destKeys };
		}
		const from = { ...playerRookPos };
		const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ];
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
					if (safe) {
						moves.push({ from, to: rookAt, captured: occ });
						destKeys.push(keyOf(rookAt));
					}
				}
				break; // blocked after first piece
			}
		}
		return { moves, destKeys };
	}

	// ===================== Safety check via explicit enemy move generation =====================
	function enemyCanCaptureSquare(stateBoard, target) {
		for (let r = 0; r < ROWS; r++) {
			for (let c = 0; c < COLS; c++) {
				const p = stateBoard[r][c];
				if (!p || p.side !== 'E') continue;
				const caps = enemyCaptureSquaresForPiece(stateBoard, { r, c }, p);
				for (const sq of caps) {
					if (sq.r === target.r && sq.c === target.c) return true;
				}
			}
		}
		return false;
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

	function rookCaptureSquares(stateBoard, from, side) {
		const out = [];
		const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ];
		for (const [dr, dc] of dirs) {
			let r = from.r + dr, c = from.c + dc;
			while (inside(r, c)) {
				const occ = stateBoard[r][c];
				if (!occ) { r += dr; c += dc; continue; }
				if (occ.side !== side) { out.push({ r, c }); }
				break;
			}
		}
		return out;
	}

	function cannonCaptureSquares(stateBoard, from, side) {
		const out = [];
		const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ];
		for (const [dr, dc] of dirs) {
			let r = from.r + dr, c = from.c + dc;
			let foundScreen = false;
			while (inside(r, c)) {
				const occ = stateBoard[r][c];
				if (!foundScreen) {
					if (!occ) { r += dr; c += dc; continue; }
					foundScreen = true;
					r += dr; c += dc;
					continue;
				}
				// After screen: first piece encountered can be captured if opposite side
				if (occ) {
					if (occ.side !== side) out.push({ r, c });
					break;
				}
				r += dr; c += dc;
			}
		}
		return out;
	}

	function knightCaptureSquares(stateBoard, from, side) {
		const out = [];
		const deltas = [
			{ leg: [1,0], move: [2,1] },
			{ leg: [1,0], move: [2,-1] },
			{ leg: [-1,0], move: [-2,1] },
			{ leg: [-1,0], move: [-2,-1] },
			{ leg: [0,1], move: [1,2] },
			{ leg: [0,1], move: [-1,2] },
			{ leg: [0,-1], move: [1,-2] },
			{ leg: [0,-1], move: [-1,-2] },
		];
		for (const d of deltas) {
			const legR = from.r + d.leg[0];
			const legC = from.c + d.leg[1];
			if (stateBoard[legR]?.[legC]) continue; // leg blocked
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
		const diag = [ [2,2], [2,-2], [-2,2], [-2,-2] ];
		for (const [dr, dc] of diag) {
			const tr = from.r + dr;
			const tc = from.c + dc;
			if (!inside(tr, tc)) continue;
			const eyeR = from.r + dr / 2;
			const eyeC = from.c + dc / 2;
			if (stateBoard[eyeR][eyeC]) continue; // eye blocked
			const occ = stateBoard[tr][tc];
			if (occ && occ.side !== side) out.push({ r: tr, c: tc });
		}
		return out;
	}

	function advisorCaptureSquares(stateBoard, from, side) {
		const out = [];
		const diag = [ [1,1], [1,-1], [-1,1], [-1,-1] ];
		for (const [dr, dc] of diag) {
			const tr = from.r + dr;
			const tc = from.c + dc;
			if (!inside(tr, tc)) continue;
			const occ = stateBoard[tr][tc];
			if (occ && occ.side !== side) out.push({ r: tr, c: tc });
		}
		return out;
	}

	function generalCaptureSquares(stateBoard, from, side) {
		const out = [];
		const ortho = [ [1,0], [-1,0], [0,1], [0,-1] ];
		for (const [dr, dc] of ortho) {
			const tr = from.r + dr;
			const tc = from.c + dc;
			if (!inside(tr, tc)) continue;
			const occ = stateBoard[tr][tc];
			if (occ && occ.side !== side) out.push({ r: tr, c: tc });
		}
		return out;
	}

	function pawnCaptureSquares(stateBoard, from, side) {
		const out = [];
		if (side === 'E') {
			// Enemy pawns can move UP (forward) and DOWN (backward) - r decreases/increases
			const fwd = { r: from.r - 1, c: from.c };
			if (inside(fwd.r, fwd.c)) {
				const occ = stateBoard[fwd.r][fwd.c];
				if (occ && occ.side !== side) out.push(fwd);
			}
			const bwd = { r: from.r + 1, c: from.c };
			if (inside(bwd.r, bwd.c)) {
				const occ = stateBoard[bwd.r][bwd.c];
				if (occ && occ.side !== side) out.push(bwd);
			}
			for (const dc of [-1, 1]) {
				const tr = from.r;
				const tc = from.c + dc;
				if (!inside(tr, tc)) continue;
				const occ = stateBoard[tr][tc];
				if (occ && occ.side !== side) out.push({ r: tr, c: tc });
			}
		} else {
			// Player pawns can move DOWN (forward) and UP (backward) - r increases/decreases
			const fwd = { r: from.r + 1, c: from.c };
			if (inside(fwd.r, fwd.c)) {
				const occ = stateBoard[fwd.r][fwd.c];
				if (occ && occ.side !== side) out.push(fwd);
			}
			const bwd = { r: from.r - 1, c: from.c };
			if (inside(bwd.r, bwd.c)) {
				const occ = stateBoard[bwd.r][bwd.c];
				if (occ && occ.side !== side) out.push(bwd);
			}
			for (const dc of [-1, 1]) {
				const tr = from.r;
				const tc = from.c + dc;
				if (!inside(tr, tc)) continue;
				const occ = stateBoard[tr][tc];
				if (occ && occ.side !== side) out.push({ r: tr, c: tc });
			}
		}
		return out;
	}

	function isInsidePalace(rc, side) {
		// Adapted 3x3 palace centered horizontally on 8 columns: columns 2..4
		const inCols = rc.c >= 2 && rc.c <= 4;
		if (side === 'E') {
			return inCols && rc.r >= 0 && rc.r <= 2;
		} else {
			return inCols && rc.r >= 6 && rc.r <= 8;
		}
	}

	function renderMoveList(moves, suggestion = null, message = null) {
		moveListEl.innerHTML = '';
		
		// Show strategic suggestion first if available
		if (suggestion) {
			const li = document.createElement('li');
			li.className = 'suggestion';
			li.textContent = `💡 Gợi ý chiến lược: Xe ${algebraicFrom(suggestion.from)} -> ${algebraicFrom(suggestion.to)} (${suggestion.reason})`;
			moveListEl.appendChild(li);
		}
		
		if (message) {
			const li = document.createElement('li');
			li.className = 'empty-hint';
			li.textContent = message;
			moveListEl.appendChild(li);
			return;
		}
		
		// Show all safe captures
		if (!moves.length) {
			const li = document.createElement('li');
			li.className = 'empty-hint';
			li.textContent = 'Không có nước ăn an toàn hoặc chưa đặt Xe của Người chơi.';
			moveListEl.appendChild(li);
			return;
		}
		
		// Add a header for safe captures
		const headerLi = document.createElement('li');
		headerLi.className = 'section-header';
		headerLi.textContent = 'Các nước ăn an toàn:';
		headerLi.style.fontWeight = '600';
		headerLi.style.color = '#16a34a';
		headerLi.style.marginTop = '8px';
		headerLi.style.marginBottom = '4px';
		moveListEl.appendChild(headerLi);
		
		for (const m of moves) {
			const li = document.createElement('li');
			const capturedName = prettyPieceName(m.captured);
			li.textContent = `Xe ${algebraicFrom(m.from)} -> ${algebraicFrom(m.to)} (ăn ${capturedName})`;
			moveListEl.appendChild(li);
		}
	}

	function prettyPieceName(p) {
		if (!p) return '';
		return {
			rook: 'Xe',
			cannon: 'Pháo',
			knight: 'Mã',
			elephant: 'Tượng',
			advisor: 'Sĩ',
			general: 'Tướng',
			pawn: 'Tốt',
		}[p.type] || p.type;
	}

	function displayAISuggestion(suggestion) {
		// Create a modal or update the move list to show AI suggestion
		const aiSuggestionHtml = `
			<div class="ai-suggestion">
				<h4>🤖 AI Phân Tích</h4>
				${suggestion.move ? `<p><strong>Nước đi:</strong> ${suggestion.move}</p>` : ''}
				${suggestion.reason ? `<p><strong>Lý do:</strong> ${suggestion.reason}</p>` : ''}
				${suggestion.tactics ? `<p><strong>Chiến thuật:</strong> ${suggestion.tactics}</p>` : ''}
			</div>
		`;
		
		// Add to move list
		const aiElement = document.createElement('div');
		aiElement.innerHTML = aiSuggestionHtml;
		aiElement.className = 'ai-analysis';
		moveListEl.appendChild(aiElement);
		
		// Scroll to show the AI suggestion
		aiElement.scrollIntoView({ behavior: 'smooth' });
	}

	function parseAlgebraicNotation(moveNotation) {
		if (!moveNotation) return null;
		
		// Handle different formats:
		// "D3->D7" or "D3-D7" or "D3D7" or "Rxd1" or "D1"
		
		// Remove any spaces and convert to uppercase
		const cleanMove = moveNotation.replace(/\s+/g, '').toUpperCase();
		
		// Extract the destination square (last 2 characters)
		let destSquare = '';
		
		if (cleanMove.includes('->') || cleanMove.includes('-')) {
			// Format: "D3->D7" or "D3-D7"
			const parts = cleanMove.split(/[->-]/);
			if (parts.length >= 2) {
				destSquare = parts[1];
			}
		} else if (cleanMove.includes('X')) {
			// Format: "RXD1" or "RXD1"
			const parts = cleanMove.split('X');
			if (parts.length >= 2) {
				destSquare = parts[1];
			}
		} else if (cleanMove.length >= 2) {
			// Format: "D3D7" or just "D7"
			destSquare = cleanMove.slice(-2);
		}
		
		// Validate the destination square format (letter + number)
		if (destSquare.length === 2) {
			const file = destSquare[0];
			const rank = destSquare[1];
			
			// Convert to board coordinates
			const fileIndex = 'ABCDEFGH'.indexOf(file);
			const rankIndex = '987654321'.indexOf(rank);
			
			if (fileIndex !== -1 && rankIndex !== -1) {
				return { r: rankIndex, c: fileIndex };
			}
		}
		
		return null;
	}

	function highlightGeminiMove(moveNotation) {
		const destPos = parseAlgebraicNotation(moveNotation);
		if (!destPos) {
			console.log('Could not parse Gemini move notation:', moveNotation);
			return;
		}
		
		// Set flag to indicate Gemini highlight is active
		geminiHighlightActive = true;
		
		// Create a new highlight map with safe/unsafe highlights plus Gemini move
		const map = computeRookLineHighlights();
		
		// Add the Gemini suggested move as the best move
		map.addBestMove(destPos);
		
		// Re-render the board with the new highlight
		renderBoard(map, selectedFrom);
	}

	// Initial boot
	createBoardGrid();
	renderLabels();
	setPaletteHandlers();
	initialSetup();
	runAutoSafety();
	updateDeleteButton();
})();

