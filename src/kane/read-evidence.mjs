// Pulls what a coding agent needs out of a Kane evidence pack for one failed
// flow: the flow as written, the step that failed and Kane's reason, the page
// address, Kane's own triage, console errors, failed network requests, and the
// screenshot of the failing step.
//
// Packs are read as zips. YAML inside them is read with a few line patterns
// rather than a YAML parser: the fields used here are flat, and the raw text is
// handed on for anything else.

import { readFile } from 'node:fs/promises';
import { listZip, readZipEntry } from './zip.mjs';

const stemOf = (flow) => flow.replace(/^.*\//, '').replace(/_test\.md$/, '');

/** Steps from a result.yaml: [{id, ordinal, status, kind}] */
export function readSteps(resultYaml) {
  const steps = [];
  let current = null;
  let inSteps = false;
  for (const line of resultYaml.split('\n')) {
    if (/^steps:\s*$/.test(line)) {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;
    if (/^\S/.test(line)) break; // next top-level key
    const start = /^\s*-\s+id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (start) {
      current = { id: start[1] };
      steps.push(current);
      continue;
    }
    const field = /^\s+(ordinal|status|kind):\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (field && current) current[field[1]] = field[1] === 'ordinal' ? Number(field[2]) : field[2];
  }
  return steps;
}

const topLevel = (yaml, key) => new RegExp(`^${key}:\\s*['"]?([^'"\\n]+?)['"]?\\s*$`, 'm').exec(yaml)?.[1];

/** Console lines worth showing an agent: errors and uncaught exceptions. */
export function consoleErrors(ndjson, limit = 12) {
  const out = new Map();
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const level = String(entry.level ?? entry.type ?? entry.severity ?? '').toLowerCase();
    const text = entry.text ?? entry.message ?? entry.description ?? entry.args?.join?.(' ');
    if (!text) continue;
    if (/error|exception|assert|fatal/.test(level) || /\b(Uncaught|TypeError|RangeError|ReferenceError|SyntaxError|is not a function|is not defined)\b/.test(text)) {
      const message = String(text).trim().slice(0, 400);
      const where = entry.url ? ` (${String(entry.url).replace(/^https?:\/\/[^/]+/, '')}${entry.line ? `:${entry.line}` : ''})` : '';
      // The browser reports one error several times; keep the copy that says where.
      if (!out.has(message) || where) out.set(message, `${message}${where}`);
    }
  }
  return [...out.values()].slice(0, limit);
}

/** Requests that failed, from a HAR file. */
export function failedRequests(harText, limit = 8) {
  let har;
  try {
    har = JSON.parse(harText);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of har?.log?.entries ?? []) {
    const status = entry.response?.status;
    if (status >= 400 || status === 0) out.push(`${entry.request?.method ?? 'GET'} ${entry.request?.url} -> ${status === 0 ? 'no response' : status}`);
  }
  return [...new Set(out)].slice(0, limit);
}

/**
 * The screenshot that shows how a flow ended in a pack: the last step of its
 * final attempt. For a failed flow that is the state Kane gave up on (the
 * step holding Kane's failure record is often the click before it, taken while
 * the page still looked fine).
 * @returns {{bytes: Buffer, failed: boolean} | null}
 */
export function flowScreenshot(zip, entries, stem) {
  const prefix = `tests/${stem}-`;
  const shots = entries.filter((e) => e.name.startsWith(prefix) && /\/steps\/\d+-[^/]+\/screenshot\.(jpg|png)$/.test(e.name));
  if (shots.length === 0) return null;
  const failed = entries.some((e) => e.name.startsWith(prefix) && /\/steps\/\d+-[^/]+\/failure\.yaml$/.test(e.name));
  const ordinal = (e) => Number(/\/steps\/(\d+)-/.exec(e.name)[1]);
  // A pack can hold more than one attempt of a flow; the top-level one is the final attempt.
  const depth = (e) => e.name.split('/').length;
  const shallowest = Math.min(...shots.map(depth));
  const last = shots.filter((e) => depth(e) === shallowest).sort((a, b) => ordinal(b) - ordinal(a))[0];
  return { bytes: readZipEntry(zip, last), failed };
}

/**
 * @param {string} packPath a sealed .evidence file
 * @param {{flow: string}} flow the failed flow, as in the suite result
 * @returns {Promise<null | {flow: string, definition?: string, failedStep?: string, pageUrl?: string,
 *   triage?: string, console: string[], network: string[], screenshot?: {name: string, bytes: Buffer}}>}
 */
export async function readFailure(packPath, flow) {
  const zip = await readFile(packPath);
  const entries = listZip(zip);
  const text = (name) => {
    const entry = entries.find((e) => e.name === name);
    return entry ? readZipEntry(zip, entry).toString('utf8') : null;
  };

  // tests/<stem>-<hash>/…; with several attempts in a pack, take the one that failed.
  const prefix = `tests/${stemOf(flow.flow)}-`;
  const folders = [...new Set(entries.filter((e) => e.name.startsWith(prefix)).map((e) => e.name.split('/').slice(0, 2).join('/')))];
  if (folders.length === 0) return null;
  const folder = folders.find((f) => topLevel(text(`${f}/result.yaml`) ?? '', 'status') === 'failed') ?? folders[0];

  const result = text(`${folder}/result.yaml`) ?? '';
  const steps = readSteps(result);
  const out = { flow: flow.flow, console: [], network: [] };

  const definition = text(`${folder}/test.md`);
  if (definition) out.definition = definition.replace(/^---[\s\S]*?---\s*/, '');

  // Kane writes a failure.yaml only into the step where it judged the flow to
  // have failed. That is not always the last step marked failed in result.yaml
  // (Kane may keep waiting or retrying after it), so the record decides.
  const record = entries.find((e) => e.name.startsWith(`${folder}/steps/`) && e.name.endsWith('/failure.yaml'));
  const marked = steps.find((step) => step.status && step.status !== 'passed' && step.status !== 'skipped');
  const stepFolder = record ? record.name.slice(0, -'/failure.yaml'.length) : marked ? `${folder}/steps/${marked.ordinal}-${marked.id}` : null;

  if (stepFolder) {
    let step = null;
    try {
      step = JSON.parse(text(`${stepFolder}/step.json`) ?? 'null');
    } catch {
      step = null;
    }
    const triage = record ? readZipEntry(zip, record).toString('utf8') : null;
    const title = triage ? /^title:\s*(.+)$/m.exec(triage)?.[1] : null;
    const ordinal = stepFolder.split('/').pop().split('-')[0];
    out.failedStep = [`step ${ordinal}`, title ?? step?.summary].filter(Boolean).join(': ');
    out.pageUrl = (triage ? /^\s+url:\s*(\S+)\s*$/m.exec(triage)?.[1] : null) ?? step?.url;
    if (!out.pageUrl) delete out.pageUrl;
    if (triage) out.triage = triage;
  }
  // Where the walk ended, which for a failed flow is what the person would see.
  const shot = flowScreenshot(zip, entries, stemOf(flow.flow));
  if (shot) out.screenshot = { name: 'screenshot.jpg', bytes: shot.bytes };

  for (const entry of entries) {
    if (!entry.name.startsWith(`${folder}/logs/`)) continue;
    if (entry.name.endsWith('-console.ndjson')) out.console.push(...consoleErrors(readZipEntry(zip, entry).toString('utf8')));
    if (entry.name.endsWith('-network.har')) out.network.push(...failedRequests(readZipEntry(zip, entry).toString('utf8')));
  }
  out.console = [...new Set(out.console)].slice(0, 12);
  out.network = [...new Set(out.network)].slice(0, 8);
  return out;
}
