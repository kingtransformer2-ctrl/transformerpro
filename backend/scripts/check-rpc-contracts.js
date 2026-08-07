import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');
const projectRoot = resolve(backendRoot, '..');

const hooksDir = join(projectRoot, 'frontend', 'src', 'hooks');
const serverTs = join(backendRoot, 'src', 'server.ts');

function findCalledRpcFunctions() {
  const rpcRe = /\.rpc\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
  const found = new Set();
  if (!existsSync(hooksDir)) {
    console.error(`Hooks directory not found: ${hooksDir}`);
    process.exit(2);
  }
  for (const f of readdirSync(hooksDir)) {
    if (!f.endsWith('.ts')) continue;
    const content = readFileSync(join(hooksDir, f), 'utf8');
    let m;
    while ((m = rpcRe.exec(content)) !== null) {
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

function findImplementedRpcCases() {
  const caseRe = /case\s+['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*:/g;
  if (!existsSync(serverTs)) {
    console.error(`server.ts not found: ${serverTs}`);
    process.exit(2);
  }
  const content = readFileSync(serverTs, 'utf8');
  const found = new Set();
  let m;
  while ((m = caseRe.exec(content)) !== null) {
    found.add(m[1]);
  }
  return [...found].sort();
}

const called = findCalledRpcFunctions();
const implemented = findImplementedRpcCases();
const implementedSet = new Set(implemented);

const missing = called.filter((n) => !implementedSet.has(n));

if (missing.length === 0) {
  console.log('RPC contract check: OK. All called RPCs have matching server.ts switch cases.');
  process.exit(0);
} else {
  console.error('RPC contract check: FAIL. The following RPCs are called from frontend hooks but have no matching case in server.ts switch:');
  for (const name of missing) {
    console.error(`  - ${name}`);
  }
  process.exit(1);
}
