// Integration test: starts the server over stdio with the SDK client, lists tools, calls each tool with
// known values, runs one negative control per tool, scans every text surface for banned words, then
// repeats a smaller run over Streamable HTTP (--http) to prove that transport works too.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'index.js');
const BANNED = /peptide|\bdos(e|es|ing|age)\b|inject|health|medical|medicine|patient|therap|clinic|treat|drug/i;
const EXPECTED_TOOLS = ['convert_units', 'dilution_c1v1', 'molarity', 'percent_solution', 'reconstitution_concentration', 'serial_dilution'];

let pass = 0, fail = 0;
const allText = [];
function check(label, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
}
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

async function call(client, name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.map((c) => c.text).join('\n') ?? '';
    allText.push(text);
    if (r.isError) return { error: text };
    return { data: JSON.parse(text), text };
  } catch (e) {
    // Schema level rejections may surface as a JSON-RPC error instead of an isError result.
    allText.push(e.message);
    return { error: e.message };
  }
}
// A negative control passes only if the call errors AND carries no numeric result.
function negative(label, r) {
  const ok = Boolean(r.error) && r.data === undefined;
  check(`NEG ${label}`, ok, ok ? r.error.split('\n')[0].slice(0, 110) : `returned ${JSON.stringify(r.data)}`);
}

async function suite(client, tag) {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check(`${tag} lists 6 tools`, JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), names.join(','));
  for (const t of tools) {
    allText.push(t.name, t.title ?? '', t.description, JSON.stringify(t.inputSchema));
    check(`${tag} ${t.name} description ends with the required line`, t.description.endsWith('For laboratory calculations only.'));
  }

  // Positive cases
  let r = await call(client, 'reconstitution_concentration', { powder_amount: 10, powder_unit: 'mg', diluent_ml: 2, wanted_amount: 250, wanted_unit: 'mcg' });
  check(`${tag} recon 10 mg in 2 mL = 5 mg/mL`, r.data && close(r.data.concentration_mg_per_ml, 5) && close(r.data.concentration_mcg_per_ml, 5000), r.data && `${r.data.concentration_mg_per_ml} mg/mL`);
  check(`${tag} recon 250 mcg at 5 mg/mL = 0.05 mL (50 µL)`, r.data && close(r.data.volume_ml, 0.05) && close(r.data.volume_ul, 50), r.data && `${r.data.volume_ml} mL, ${r.data.volume_ul} µL`);

  r = await call(client, 'convert_units', { value: 2.5, from: 'mg', to: 'mcg' });
  check(`${tag} convert 2.5 mg = 2500 mcg`, r.data && close(r.data.result, 2500), r.data && String(r.data.result));
  r = await call(client, 'convert_units', { value: 250, from: 'uL', to: 'mL' });
  check(`${tag} convert 250 uL = 0.25 mL`, r.data && close(r.data.result, 0.25), r.data && String(r.data.result));
  r = await call(client, 'convert_units', { value: 5, from: 'mg/mL', to: 'mcg/mL' });
  check(`${tag} convert 5 mg/mL = 5000 mcg/mL`, r.data && close(r.data.result, 5000), r.data && String(r.data.result));

  r = await call(client, 'molarity', { mw: 58.44, volume: 500, volume_unit: 'mL', molarity: 0.15, molarity_unit: 'M' });
  check(`${tag} molarity 0.15 M, MW 58.44, 500 mL = 4.383 g`, r.data && close(r.data.mass_g, 4.383), r.data && `${r.data.mass_g} g`);
  r = await call(client, 'molarity', { mw: 58.44, volume: 500, volume_unit: 'mL', mass: 4.383, mass_unit: 'g' });
  check(`${tag} molarity reverse 4.383 g = 0.15 M`, r.data && close(r.data.molarity_M, 0.15), r.data && `${r.data.molarity_M} M`);

  r = await call(client, 'dilution_c1v1', { c1: 10, c2: 1, v2: 50 });
  check(`${tag} C1V1 10, blank, 1, 50 gives V1 = 5`, r.data && r.data.solved_for === 'v1' && close(r.data.value, 5), r.data && `${r.data.solved_for} = ${r.data.value}, diluent ${r.data.diluent_to_add}`);

  r = await call(client, 'percent_solution', { percent_wv: 1, final_volume_ml: 100 });
  check(`${tag} 1% w/v in 100 mL = 1 g`, r.data && close(r.data.solute_g, 1), r.data && `${r.data.solute_g} g`);

  r = await call(client, 'serial_dilution', { start_conc: 1000, factor: 10, steps: 5, volume_per_tube_ml: 1 });
  const want = [100, 10, 1, 0.1, 0.01];
  check(`${tag} serial 1000 by 10 x 5 = 100, 10, 1, 0.1, 0.01`, r.data && r.data.concentrations.length === 5 && r.data.concentrations.every((c, i) => close(c, want[i])), r.data && r.data.concentrations.join(', '));

  // Negative controls: one per tool, each must return an error and no number.
  negative(`${tag} recon diluent_ml = 0`, await call(client, 'reconstitution_concentration', { powder_amount: 10, diluent_ml: 0 }));
  negative(`${tag} convert mg to mL (kind mismatch)`, await call(client, 'convert_units', { value: 1, from: 'mg', to: 'mL' }));
  negative(`${tag} C1V1 with two blanks`, await call(client, 'dilution_c1v1', { c1: 10, v2: 50 }));
  negative(`${tag} molarity with both molarity and mass`, await call(client, 'molarity', { mw: 58.44, volume: 500, molarity: 0.15, mass: 4 }));
  negative(`${tag} percent with negative percent`, await call(client, 'percent_solution', { percent_wv: -1, final_volume_ml: 100 }));
  negative(`${tag} serial with factor 1`, await call(client, 'serial_dilution', { start_conc: 1000, factor: 1, steps: 5, volume_per_tube_ml: 1 }));
}

// 1) stdio
const stdio = new Client({ name: 'test-client', version: '1.0.0' });
await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [entry] }));
await suite(stdio, '[stdio]');
await stdio.close();

// 2) Streamable HTTP behind --http
const port = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [entry, '--http', '--port', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('HTTP server did not start')), 8000);
  child.stderr.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
});
try {
  const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json();
  check('[http] /status returns ok', status.ok === true, JSON.stringify(status));
  const httpClient = new Client({ name: 'test-client-http', version: '1.0.0' });
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  await suite(httpClient, '[http]');
  await httpClient.close();
} finally {
  child.kill();
}

// 3) Wording scan over every tool name, description, schema and output seen above.
const hits = allText.join('\n').match(new RegExp(BANNED, 'gi')) ?? [];
check('wording scan: no banned words in names, descriptions, schemas or outputs', hits.length === 0, hits.length ? `hits: ${[...new Set(hits)].join(', ')}` : `${allText.length} strings scanned`);
// Negative control for the scan itself: it must catch a planted banned word.
check('NEG wording scan catches a planted word', BANNED.test('volume per dose'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
