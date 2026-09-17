import { mazeSize } from './public/maze.js';

export function buildRequest(maze, history) {
  const current = history.at(-1), size = mazeSize(maze), goal = maze.length - 1;
  return {
    model: 'jev-latest',
    state: {
      description: `${size}×${size} maze; row-major IDs 0–${goal}. Only exits of visited cells are revealed. All passages are bidirectional. Other walls are unknown.`,
      current, goal, history,
      discovered: [...new Set(history)].map(cell => ({ cell, row: Math.floor(cell / size) + 1, column: cell % size + 1,
        visits: history.filter(n => n === cell).length, exits: maze[cell] }))
    },
    questions: { move: {
      type: 'choice',
      instructions: `Choose the next legal move from the current cell toward goal ${goal}. Explore unknown passages when useful. Use history and visit counts to avoid repeating loops. Backtrack when needed. You only know the discovered portion of the maze.`,
      criteria: Object.fromEntries(maze[current].map(next => [`to_${next}`,
        `Move to cell ${next}, row ${Math.floor(next / size) + 1}, column ${next % size + 1}. Visited ${history.filter(n => n === next).length} times.`]))
    } }
  };
}

export async function getDecision(maze, history, apiKey, fetcher = fetch) {
  const request = buildRequest(maze, history);
  const started = performance.now();
  const response = await fetcher('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403 ? 'TypeSafe rejected the API key. Check .env and restart.'
      : response.status === 429 ? 'TypeSafe rate limit reached. Please try again later.'
      : `TypeSafe request failed (HTTP ${response.status}). Please try again.`);
  }
  const data = await response.json(), answer = data.answers?.move;
  const options = Object.keys(request.questions.move.criteria);
  const unit = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  if (answer?.type !== 'choice' || !options.includes(answer.choice) || !unit(answer.confidence) ||
      !answer.probabilities || options.some(key => !unit(answer.probabilities[key])) ||
      Math.abs(options.reduce((sum, key) => sum + answer.probabilities[key], 0) - 1) > 0.02) {
    throw new Error('TypeSafe returned an incomplete or illegal move. Please try again.');
  }
  return { next: Number(answer.choice.slice(3)), confidence: answer.confidence,
    probabilities: answer.probabilities, model: data.model || request.model,
    diagnostics: {
      request,
      response: { model: data.model || request.model, answers: { move: answer }, usage: data.usage ?? null },
      latencyMs: Math.round(performance.now() - started),
      usage: data.usage ?? null
    } };
}
