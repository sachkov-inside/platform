import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, createWriteStream, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
const root = process.cwd();
const artifacts = path.join(root, 'node_modules/.cache/issue-1023');
mkdirSync(artifacts, { recursive: true });
const log = createWriteStream(path.join(artifacts, 'storybook.log'));
const child = spawn(process.execPath, ['--inspect=127.0.0.1:6116', '--expose-gc', 'node_modules/storybook/dist/bin/dispatcher.js', 'dev', '-p', '6106', '--ci', '--no-open'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
child.stdout.pipe(log); child.stderr.pipe(log);
console.log(JSON.stringify({ pid: child.pid, artifacts }));
let socket;
let sequence = 0;
const pending = new Map();
let inspectorUrl;
const started = Date.now();
const samples = [];
let timer;
let captured = false;
async function inspect(method, params = {}) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}
async function sample(label) {
  try {
    const response = await inspect('Runtime.evaluate', { expression: 'process.memoryUsage()', returnByValue: true });
    const value = { seconds: (Date.now() - started) / 1000, label, ...response.result.result.value };
    samples.push(value); writeFileSync(path.join(artifacts, 'memory.json'), JSON.stringify(samples, null, 2));
    console.log(JSON.stringify(value));
    if (value.heapUsed > 1800 * 1024 * 1024 && !captured) {
      captured = true;
      const profile = await inspect('HeapProfiler.stopSampling');
      writeFileSync(path.join(artifacts, 'heap-profile-near-limit.json'), JSON.stringify(profile.result.profile));
      console.log('Saved allocation profile near memory limit');
    }
  } catch (error) { console.log(String(error)); }
}
async function rpc(method, params) {
  const response = await fetch('http://localhost:6106/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }), signal: AbortSignal.timeout(180000) });
  const body = await response.text();
  writeFileSync(path.join(artifacts, method.replace('/', '-') + '.txt'), body);
  const data = body.startsWith('event:') || body.startsWith('data:') ? JSON.parse(body.split('\n').find(line => line.startsWith('data: ')).slice(6)) : JSON.parse(body);
  if (data.error) throw Error(JSON.stringify(data.error));
  return data.result;
}
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Storybook exited before readiness');
    try { const response = await fetch('http://127.0.0.1:6116/json/list'); inspectorUrl = (await response.json())[0].webSocketDebuggerUrl; break; } catch { await delay(500); }
  }
  socket = new WebSocket(inspectorUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('close', () => { for (const entry of pending.values()) entry.reject(Error('Inspector closed: Storybook crashed')); pending.clear(); });
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data); const entry = pending.get(data.id);
    if (entry) { pending.delete(data.id); if (data.error) entry.reject(Error(JSON.stringify(data.error))); else entry.resolve(data); }
  });
  await inspect('HeapProfiler.startSampling', { samplingInterval: 65536 });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Storybook exited before readiness');
    try { const response = await fetch('http://localhost:6106/index.json'); if (response.ok) { const index = await response.json(); console.log(JSON.stringify({ stories: Object.values(index.entries).filter(entry => entry.type === 'story').length })); break; } } catch { /* The server may not have started, or cleanup may already have ended the process. */ }
    await delay(1000);
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'issue-1023-reproduction', version: '1' } });
  console.log(JSON.stringify(await rpc('tools/list', {})).slice(0, 1500));
  await sample('before-test-run');
  timer = setInterval(() => void sample('test-run'), 2000);
  const result = await rpc('tools/call', { name: 'test-run', arguments: {} });
  clearInterval(timer);
  console.log(JSON.stringify({ testResultBytes: JSON.stringify(result).length, isError: result.isError }));
  await sample('after-test-run');
  if (!captured) {
    const profile = await inspect('HeapProfiler.stopSampling');
    writeFileSync(path.join(artifacts, 'heap-profile.json'), JSON.stringify(profile.result.profile));
  }
  await inspect('Runtime.evaluate', { expression: 'global.gc()' });
  await sample('after-gc');
  await delay(3000);
  if (child.exitCode !== null || child.signalCode !== null) throw Error('Storybook exited after test-run');
  const response = await fetch('http://localhost:6106/index.json');
  if (!response.ok) throw Error('Storybook failed health check after test-run');
  console.log('PASS: full MCP run returned and Storybook still serves index');
  socket.close(); socket = undefined;
  process.kill(child.pid, process.env.PROBE_PARENT_SIGNAL || 'SIGTERM');
  await delay(2000);
  const remaining = execFileSync('ps', ['-axo', 'pid,ppid,pgid,rss,command'], { encoding: 'utf8' }).split('\n').filter(line => Number(line.trim().split(/\s+/)[2]) === child.pid);
  writeFileSync(path.join(artifacts, 'children-after-parent-exit.txt'), remaining.join('\n'));
  console.log(JSON.stringify({ remainingChildren: remaining }));
  if (remaining.some(line => line.includes('addon-vitest') || line.includes('esbuild'))) throw Error('Vitest or esbuild outlived Storybook parent');
} finally {
  clearInterval(timer);
  if (socket) socket.close();
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* The server may not have started, or cleanup may already have ended the process. */ }
  await delay(1000);
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The server may not have started, or cleanup may already have ended the process. */ }
  log.end();
  console.log(execFileSync('ps', ['-axo', 'pid,ppid,pgid,rss,command'], { encoding: 'utf8' }).split('\n').filter(line => line.includes(root)).join('\n'));
}
