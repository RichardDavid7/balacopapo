#!/usr/bin/env node
/**
 * Guardião de Paridade para IA — Balacopapo Desktop Nativo
 *
 * Compara automaticamente os 23 PermissionBits oficiais de
 * `packages/shared/src/permissions.ts` com `clients/desktop/src/core/permissions.rs`
 * para alertar imediatamente quando o servidor ganha permissões novas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const tsPath = path.join(root, 'packages', 'shared', 'src', 'permissions.ts');
const rsPath = path.join(root, 'clients', 'desktop', 'src', 'core', 'permissions.rs');

const tsSrc = fs.readFileSync(tsPath, 'utf8');
const rsSrc = fs.readFileSync(rsPath, 'utf8');

const tsBits = new Map();
for (const m of tsSrc.matchAll(/([A-Z_]+):\s*1n\s*<<\s*(\d+)n/g)) {
  tsBits.set(m[1], Number(m[2]));
}

const rsBits = new Map();
for (const m of rsSrc.matchAll(/pub const ([A-Z_]+):\s*u64\s*=\s*1\s*<<\s*(\d+)/g)) {
  rsBits.set(m[1], Number(m[2]));
}

const findings = [];
for (const [name, bit] of tsBits.entries()) {
  if (!rsBits.has(name)) {
    findings.push(`Faltando em clients/desktop/src/core/permissions.rs: ${name} (1 << ${bit})`);
  } else if (rsBits.get(name) !== bit) {
    findings.push(`Bit divergente para ${name}: shared=1<<${bit}, desktop=1<<${rsBits.get(name)}`);
  }
}

for (const [name, bit] of rsBits.entries()) {
  if (!tsBits.has(name)) {
    findings.push(`Extra em clients/desktop/src/core/permissions.rs ausente no shared: ${name} (1 << ${bit})`);
  }
}

if (findings.length > 0) {
  console.error(`[check-desktop-parity] ${findings.length} divergência(s) encontrada(s):`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`[check-desktop-parity] OK — ${tsBits.size} PermissionBits 100% sincronizados (0 findings).`);
