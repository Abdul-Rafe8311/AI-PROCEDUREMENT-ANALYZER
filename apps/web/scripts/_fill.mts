import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { extractText } = await import('../src/lib/extraction-server');
const { seedTenderSheet } = await import('../src/lib/tender-sheet/seed');
const { extractTenderAnswersForSupplier, answersFromExtraction, commercialAnswersFromQuotation } = await import('../src/lib/tender-sheet/extract');
const { mergeAiAnswers } = await import('../src/lib/tender-sheet/types');
const { tenderWorkbookBuffer } = await import('../src/lib/tender-sheet/excel');

const CACHE = '/tmp/pr87/filled.json';
const d = JSON.parse(readFileSync('/tmp/pr87/all.json', 'utf8'));
const files = readdirSync('pdf/').filter((f) => f.endsWith('.pdf')).sort();
const byFile: Record<string, any> = d.files;
const sheet = seedTenderSheet('pr-12602087', d.pr, Object.values(byFile).flatMap((v: any) => v.quotations ?? []));

const cache: Record<string, any> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
for (const f of files) {
  const q = (byFile[f]?.quotations ?? [])[0];
  if (!q) continue;
  sheet.answers = mergeAiAnswers(sheet.answers, commercialAnswersFromQuotation(sheet.template, q));
  if (!cache[f]) {
    const { text } = await extractText(readFileSync('pdf/' + f), f, 'application/pdf');
    console.error(`asking Claude for ${q.supplierName} (${text.length} chars of stored text)…`);
    cache[f] = await extractTenderAnswersForSupplier(sheet.template, q, text);
    writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  }
  if (cache[f]) sheet.answers = mergeAiAnswers(sheet.answers, answersFromExtraction(sheet.template, q.id, cache[f]));
}
const filled = Object.keys(sheet.answers).length;
console.log(`\nanswers filled: ${filled}`);
const bySrc: Record<string, number> = {};
for (const a of Object.values(sheet.answers) as any[]) bySrc[a.source] = (bySrc[a.source] ?? 0) + 1;
console.log('by source:', bySrc);
writeFileSync('/tmp/pr87/tender-filled.xlsx', await tenderWorkbookBuffer(sheet));
writeFileSync('/tmp/pr87/sheet.json', JSON.stringify(sheet, null, 2));
console.log('wrote /tmp/pr87/tender-filled.xlsx');
