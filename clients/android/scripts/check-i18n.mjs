import fs from 'node:fs';
import path from 'node:path';

const resDir = path.resolve('app/src/main/res');
const locales = ['values', 'values-pt-rBR', 'values-de', 'values-ru', 'values-zh-rCN'];
const keyRegex = /<string\s+name="([^"]+)"[^>]*>/g;

function extractKeys(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const keys = new Set();
  for (const match of xml.matchAll(keyRegex)) {
    keys.add(match[1]);
  }
  return keys;
}

const baseKeys = extractKeys(path.join(resDir, 'values', 'strings.xml'));
let findings = 0;

for (const locale of locales.slice(1)) {
  const filePath = path.join(resDir, locale, 'strings.xml');
  if (!fs.existsSync(filePath)) {
    console.error(`[MISSING FILE] ${filePath}`);
    findings++;
    continue;
  }
  const keys = extractKeys(filePath);
  for (const k of baseKeys) {
    if (!keys.has(k)) {
      console.error(`[MISSING KEY] ${locale}: ${k}`);
      findings++;
    }
  }
  for (const k of keys) {
    if (!baseKeys.has(k)) {
      console.error(`[EXTRA KEY] ${locale}: ${k}`);
      findings++;
    }
  }
}

if (findings === 0) {
  console.log(`check-i18n: OK (${baseKeys.size} keys across ${locales.length} locales, 0 findings)`);
  process.exit(0);
} else {
  console.error(`check-i18n: ${findings} finding(s)`);
  process.exit(1);
}
