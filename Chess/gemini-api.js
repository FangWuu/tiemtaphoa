// Google Gemini API Integration for Xiangqi
class GeminiXiangqiAI {
	constructor(apiKey) {
		this.apiKey = apiKey;
		this.baseUrl = 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent';
	}

	async analyzePosition(boardState, playerRookPos, enemyPieces) {
		try {
			const prompt = this.createAnalysisPrompt(boardState, playerRookPos, enemyPieces);
			const response = await this.callGeminiAPI(prompt);
			return this.parseResponse(response);
		} catch (error) {
			console.error('Gemini API Error:', error);
			return null;
		}
	}

	createAnalysisPrompt(boardState, playerRookPos, enemyPieces) {
		const boardText = this.boardToString(boardState);
		const rookPos = this.positionToAlgebraic(playerRookPos);
		
		return `You are a Xiangqi (Chinese Chess) expert for a custom variant (not international chess). Analyze this position and suggest the best move for the player's Rook.

Rules:
- The board has 8 columns × 9 rows.
- The player controls a single Rook that can move any number of squares horizontally or vertically.
- This is not standard Xiangqi — enemy pieces (Pawn, Advisor, Knight, Elephant, General, Cannon, Rook) are placed randomly anywhere on the board, not in the usual starting layout.
- Enemy Pawns can move exactly 1 square orthogonally (up, down, left, or right). They are NOT restricted by forward movement rules and can move in all four orthogonal directions.
- Enemy Advisors move 1 square diagonally.
- Enemy Knights move by first moving one square orthogonally, then one square diagonally outward ("1 then 1" pattern). If the adjacent orthogonal square (the "leg") is occupied, the Knight is blocked and cannot move in that direction.
- Enemy Elephants move exactly two squares diagonally and cannot jump over intervening pieces.
- Enemy General moves 1 square horizontally or vertically.
- Enemy Cannons move any number of squares horizontally or vertically, but must jump over exactly one piece when capturing.
- Enemy Rooks move any number of squares horizontally or vertically without jumping.
- After the player moves, it’s the computer’s turn. If the computer detects that one of its pieces is threatened by the player's Rook, it will move that piece away if possible. Therefore, calculate moves that can still result in a capture even if the first target escapes. For example, if two enemy pieces are in the same rank or file, the computer may move the threatened one away, but the other will remain and can still be captured.
- Also consider whether capturing will put the player's Rook in danger of being captured in return.
- During play, the computer gradually spawns additional enemy pieces at random squares.

Your tasks:
- Compute moves that let the player’s Rook capture enemy pieces while remaining safe from capture.
- Identify positions that lure the opponent to create follow-up capture opportunities.
- Exploit situations where a rank or file contains ≥ 2 enemy pieces, ensuring at least one capture after the computer moves.
- Prioritize safe and effective capture opportunities.

Board Position:
${boardText}

Player's Rook is at: ${rookPos}

Enemy pieces: ${enemyPieces.map(p => `${p.type} at ${this.positionToAlgebraic(p)}`).join(', ')}

Respond in this exact format:
MOVE: [algebraic notation]
REASON: [explanation]
TACTICS: [tactical notes]`;
	}

	boardToString(boardState) {
		const files = 'ABCDEFGH';
		const ranks = '987654321';
		let boardText = '  A B C D E F G H\n';
		
		for (let r = 0; r < 9; r++) {
			boardText += `${ranks[r]} `;
			for (let c = 0; c < 8; c++) {
				const piece = boardState[r][c];
				if (!piece) {
					boardText += '. ';
				} else if (piece.side === 'P') {
					boardText += this.getPieceSymbol(piece.type).toUpperCase() + ' ';
				} else {
					boardText += this.getPieceSymbol(piece.type).toLowerCase() + ' ';
				}
			}
			boardText += '\n';
		}
		return boardText;
	}

	getPieceSymbol(type) {
		const symbols = {
			rook: 'R',
			cannon: 'C', 
			knight: 'N',
			elephant: 'E',
			advisor: 'A',
			general: 'G',
			pawn: 'P'
		};
		return symbols[type] || '?';
	}

	positionToAlgebraic(pos) {
		if (!pos) return 'none';
		const files = 'ABCDEFGH';
		const ranks = '987654321';
		return `${files[pos.c]}${ranks[pos.r]}`;
	}

	async callGeminiAPI(prompt) {
		try {
			console.log('Calling Gemini API with prompt:', prompt.substring(0, 3000) + '...');
			
			const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					contents: [{
						parts: [{
							text: prompt
						}]
					}]
				})
			});

			console.log('Response status:', response.status);
			
			if (!response.ok) {
				const errorText = await response.text();
				console.error('API Error Response:', errorText);
				throw new Error(`API call failed: ${response.status} - ${errorText}`);
			}

			const data = await response.json();
			console.log('API Response data:', data);
			
			if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
				throw new Error('Invalid response format from Gemini API');
			}
			
			return data.candidates[0].content.parts[0].text;
		} catch (error) {
			console.error('Detailed API Error:', error);
			throw error;
		}
	}

	parseResponse(response) {
		try {
			const lines = response.split('\n');
			let move = '';
			let reason = '';
			let tactics = '';

			for (const line of lines) {
				if (line.startsWith('MOVE:')) {
					move = line.replace('MOVE:', '').trim();
				} else if (line.startsWith('REASON:')) {
					reason = line.replace('REASON:', '').trim();
				} else if (line.startsWith('TACTICS:')) {
					tactics = line.replace('TACTICS:', '').trim();
				}
			}

			return {
				move: move,
				reason: reason,
				tactics: tactics,
				fullResponse: response
			};
		} catch (error) {
			console.error('Error parsing Gemini response:', error);
			return {
				move: '',
				reason: 'AI analysis failed',
				tactics: '',
				fullResponse: response
			};
		}
	}
}

// Global instance
let geminiAI = null;

// Initialize Gemini AI
function initGeminiAI(apiKey) {
	geminiAI = new GeminiXiangqiAI(apiKey);
	console.log('Gemini AI initialized');
}

// Get AI suggestion
async function getAISuggestion(boardState, playerRookPosition) {
	if (!geminiAI) {
		return { error: 'Gemini AI not initialized. Please add your API key.' };
	}

	try {
		// Get current board state - find enemy pieces manually
		const enemyPieces = [];
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 8; c++) {
				const piece = boardState[r][c];
				if (piece && piece.side === 'E') {
					enemyPieces.push({ r, c, type: piece.type });
				}
			}
		}
		
		const analysis = await geminiAI.analyzePosition(boardState, playerRookPosition, enemyPieces);
		return analysis;
	} catch (error) {
		console.error('Error getting AI suggestion:', error);
		return { error: 'Failed to get AI suggestion' };
	}
} 