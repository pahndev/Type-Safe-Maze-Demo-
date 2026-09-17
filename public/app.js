import { generateMaze, solveMaze, SIZE, MIN_SIZE, MAX_SIZE } from './maze.js';

const $ = id => document.getElementById(id);
let size = SIZE;
let maze, mazeNumber = 0, run = 0, controller;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const delay = ms => new Promise(resolve => setTimeout(resolve, reducedMotion ? 0 : ms));
let cells = [];
let line;
let records = [], attempts = 0;
const coord = n => `(${Math.floor(n / size) + 1}, ${n % size + 1})`;
const percent = n => `${(n * 100).toFixed(1)}%`;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function metrics(container, values) {
  container.replaceChildren(...values.map(([label, value]) => {
    const node = element('div');
    node.append(element('strong', value), element('span', label));
    return node;
  }));
}
function updateDiagnostics(state) {
  const latencies = records.map(r => r.diagnostics?.latencyMs).filter(Number.isFinite);
  const tokenTotal = key => {
    const values = records.map(r => r.diagnostics?.usage?.[key]);
    return values.length && values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0).toLocaleString() : '—';
  };
  metrics($('diagnostic-stats'), [
    ['Requests attempted', attempts], ['Moves returned', records.length],
    ['Mean API latency', latencies.length ? `${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)} ms` : '—'],
    ['Input tokens · returned moves', tokenTotal('input_tokens')], ['Output tokens · returned moves', tokenTotal('output_tokens')],
    ['Revisited cells · moves', records.filter(r => r.revisited).length]
  ]);
  $('diagnostic-count').textContent = `${records.length} ${records.length === 1 ? 'MOVE' : 'MOVES'}`;
  if (state) $('diagnostic-state').textContent = state;
}
function clearDiagnostics(state) {
  records = []; attempts = 0;
  $('decision-list').replaceChildren();
  updateDiagnostics(state);
}
function jsonDetails(title, value) {
  const details = element('details', undefined, 'payload');
  const pre = element('pre', JSON.stringify(value, null, 2));
  pre.tabIndex = 0;
  details.append(element('summary', title), pre);
  return details;
}
function addDecision(decision, history, roundTripMs) {
  const current = history.at(-1), priorVisits = history.filter(n => n === decision.next).length;
  records.push({ ...decision, revisited: priorVisits > 0 });
  const item = element('li'), details = element('details', undefined, 'move-detail');
  const summary = element('summary');
  summary.append(element('strong', `Move ${records.length} · ${coord(current)} → ${coord(decision.next)}`),
    element('span', `${percent(decision.confidence)} confidence · ${priorVisits ? 'Revisit' : 'New cell'}`, 'move-meta'));
  const body = element('div', undefined, 'move-body'), stats = element('div', undefined, 'move-stats');
  metrics(stats, [['Model', decision.model], ['Selected probability', percent(decision.probabilities[`to_${decision.next}`])],
    ['API latency', Number.isFinite(decision.diagnostics?.latencyMs) ? `${decision.diagnostics.latencyMs} ms` : '—'],
    ['Browser round trip', `${roundTripMs} ms`], ['Discovered before move', `${new Set(history).size} / ${maze.length}`], ['Prior visits to destination', priorVisits]]);
  body.append(stats, element('h3', 'Legal moves · probability distribution'));
  for (const [option, probability] of Object.entries(decision.probabilities).sort((a, b) => b[1] - a[1])) {
    const cell = Number(option.slice(3)), selected = cell === decision.next;
    const row = element('div', undefined, `probability-row${selected ? ' selected' : ''}`);
    const meter = element('meter'); meter.min = 0; meter.max = 1; meter.value = probability;
    meter.setAttribute('aria-label', `Probability of moving to cell ${cell}`);
    row.append(element('span', `Cell ${cell} ${coord(cell)}${selected ? ' · chosen' : ''}`), meter, element('strong', percent(probability)));
    body.append(row);
  }
  body.append(element('p', `History before move: ${history.join(' → ')}`, 'history'));
  if (decision.diagnostics) {
    body.append(jsonDetails('Exact request · state, instructions, and criteria', decision.diagnostics.request),
      jsonDetails('Model answer and token usage · JSON', decision.diagnostics.response));
  }
  details.append(summary, body); item.append(details); $('decision-list').append(item);
  updateDiagnostics(`Move ${records.length} returned. Expand a move to inspect its details. Missing usage is shown as —.`);
}

function render() {
  $('maze').replaceChildren();
  $('maze').style.setProperty('--maze-size', size);
  $('maze').setAttribute('aria-label', `${size} by ${size} maze, start at top left, goal at bottom right`);
  cells = maze.map((exits, cell) => {
    const element = document.createElement('div');
    element.className = 'cell';
    if (!exits.includes(cell - size)) element.style.borderTopWidth = '1px';
    if (!exits.includes(cell + 1) || cell % size === size - 1) element.style.borderRightWidth = '1px';
    if (!exits.includes(cell + size)) element.style.borderBottomWidth = '1px';
    if (!exits.includes(cell - 1) || cell % size === 0) element.style.borderLeftWidth = '1px';
    if (cell === 0 || cell === maze.length - 1) {
      element.classList.add(cell === 0 ? 'start' : 'goal');
      const marker = document.createElement('b'); marker.textContent = cell === 0 ? 'S' : 'G'; element.append(marker);
    }
    $('maze').append(element);
    return element;
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('path-lines'); svg.setAttribute('viewBox', `0 0 ${size * 100} ${size * 100}`); svg.setAttribute('aria-hidden', 'true');
  line = document.createElementNS(svg.namespaceURI, 'polyline');
  for (const [key, value] of Object.entries({ fill: 'none', stroke: '#6a923f', 'stroke-width': '5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })) line.setAttribute(key, value);
  svg.append(line); $('maze').append(svg);
}

function busy(value) {
  $('solve').disabled = value; $('preview').disabled = value; $('stop').hidden = !value;
}
function stop() {
  run++; controller?.abort(); busy(false);
  $('status').textContent = 'Exploration stopped. No further moves will be requested.';
  updateDiagnostics('Stopped. An in-flight request may still finish and incur usage; its result is not included here.');
}
function reset() {
  run++; controller?.abort(); busy(false);
  size = Number($('maze-size').value);
  maze = generateMaze(Math.random, size); mazeNumber++; render();
  $('size-badge').textContent = `${size} × ${size} LAB`;
  $('cell-count').textContent = `${maze.length} cells.`;
  $('cell-range').textContent = `0–${maze.length - 1}`;
  $('maze-number').textContent = `MAZE ${String(mazeNumber).padStart(3, '0')}`;
  $('status').textContent = 'A fresh maze is ready to explore.';
  $('steps').textContent = $('visited').textContent = '—';
  clearDiagnostics('Ready for a new run.');
  $('decision-note').textContent = 'The model sees visited cells and their exits, not the full maze shown here.';
}
function paint(history) {
  cells.forEach(el => el.classList.remove('current'));
  for (const cell of history) cells[cell].classList.add('explored', 'route');
  cells[history.at(-1)].classList.add('current');
  line.setAttribute('points', history.map(cell => `${(cell % size) * 100 + 50},${Math.floor(cell / size) * 100 + 50}`).join(' '));
  $('steps').textContent = history.length - 1;
  $('visited').textContent = new Set(history).size;
}
async function solve(useAI) {
  const token = ++run; busy(true); render();
  clearDiagnostics(useAI ? 'Starting TypeSafe exploration…' : 'BFS comparison · no model requests or token usage.');
  const history = [0]; paint(history);
  $('decision-note').textContent = useAI
    ? 'One live API request per move. Inspect each typed Choice answer and the discovered state sent to Jev. Token totals cover returned moves only.'
    : 'BFS comparison: deterministic shortest path. No API calls.';
  try {
    if (useAI) {
      while (history.at(-1) !== maze.length - 1 && history.length <= 80) {
        if (token !== run) return;
        $('status').textContent = `TypeSafe is choosing move ${history.length} of 80…`;
        controller = new AbortController();
        attempts++;
        updateDiagnostics(`Waiting for move ${history.length} · request ${attempts} in flight…`);
        const started = performance.now();
        const response = await fetch('/api/step', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maze, history }), signal: controller.signal });
        const decision = await response.json();
        if (!response.ok) throw new Error(decision.error || 'Move failed. Please try again.');
        if (token !== run) return;
        const current = history.at(-1);
        if (!maze[current].includes(decision.next)) throw new Error('Illegal move rejected.');
        addDecision(decision, history, Math.round(performance.now() - started));
        history.push(decision.next); paint(history);
        await delay(220);
      }
      if (token !== run) return;
      $('status').textContent = history.at(-1) === maze.length - 1
        ? `Goal reached! TypeSafe took ${history.length - 1} moves. This route is not necessarily shortest.`
        : 'Stopped at 80 moves. TypeSafe has not reached the goal. Try again or compare with BFS.';
      updateDiagnostics($('status').textContent);
    } else {
      const result = solveMaze(maze);
      $('status').textContent = 'BFS comparison: exploring the full maze…';
      for (const [index, cell] of result.visited.entries()) {
        if (token !== run) return;
        cells[cell].classList.add('explored'); $('visited').textContent = index + 1;
        await delay(65);
      }
      for (let i = 1; i <= result.path.length; i++) {
        if (token !== run) return;
        paint(result.path.slice(0, i)); $('visited').textContent = result.visited.length;
        await delay(120);
      }
      if (token !== run) return;
      $('status').textContent = `BFS comparison complete. Shortest path: ${result.path.length - 1} moves. No AI used.`;
      updateDiagnostics($('status').textContent);
      $('decision-list').append(element('li', `BFS path · cell IDs: ${result.path.join(' → ')}. Searched ${result.visited.length} cells using the full maze.`, 'bfs-result'));
    }
  } catch (error) {
    if (token === run) {
      $('status').textContent = error.message;
      updateDiagnostics(`Run failed: ${error.message}`);
      $('decision-list').append(element('li', `Move ${history.length} failed · ${error.message}`, 'diagnostic-error'));
    }
  } finally { if (token === run) busy(false); }
}
for (let n = MIN_SIZE; n <= MAX_SIZE; n++) {
  const option = element('option', `${n} × ${n} · ${n * n} cells`);
  option.value = n; option.selected = n === SIZE; $('maze-size').append(option);
}
$('maze-size').addEventListener('change', reset);
$('new').addEventListener('click', reset);
$('stop').addEventListener('click', stop);
$('solve').addEventListener('click', () => solve(true));
$('preview').addEventListener('click', () => solve(false));
reset();
fetch('/api/status').then(r => r.json()).then(({ configured }) => {
  $('connection').textContent = configured ? '● API key configured · ready to connect' : '○ API key needed · BFS preview available';
}).catch(() => { $('connection').textContent = '○ Local server unavailable'; });
