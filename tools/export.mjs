/**
 * Gera os formatos de distribuição a partir de dist/matriz_tgca_municipios.html.
 *
 * O HTML desenha tudo por JavaScript, então quem só pré-visualiza o arquivo
 * (Gmail, Drive, SharePoint, Slack) vê uma página em branco. PDF, PNG e CSV
 * existem para esses casos.
 *
 *   python3 tools/build_standalone.py && node tools/export.mjs
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const HTML = join(DIST, 'matriz_tgca_municipios.html');

/* --------- o mesmo ajuste que a página faz, para gerar o CSV --------- */
const bruto = readFileSync(HTML, 'utf8');
const i = bruto.indexOf('type="application/json">') + 24;
const ROWS = JSON.parse(bruto.slice(i, bruto.indexOf('</script>', i))).rows
  .map(r => ({ mun: r[0], uf: r[1], pop: r[2], tgca: r[3], pib: r[4], pibpc: r[5] }));

function ajuste(peso) {
  let sw = 0, mx = 0, my = 0;
  ROWS.forEach(d => { sw += peso(d); });
  ROWS.forEach(d => { const w = peso(d); mx += w * Math.log10(d.pop) / sw; my += w * d.tgca / sw; });
  let sxx = 0, sxy = 0;
  ROWS.forEach(d => { const w = peso(d), dx = Math.log10(d.pop) - mx; sxx += w * dx * dx; sxy += w * dx * (d.tgca - my); });
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}
const ordenados = ROWS.map(d => d.pib).sort((x, y) => x - y);
const TETO = ordenados[Math.floor(0.95 * (ordenados.length - 1))];
const F = { capped: ajuste(d => Math.min(d.pib, TETO)), full: ajuste(d => d.pib) };
const linha = (f, d) => f.a + f.b * Math.log10(d.pop);
const prio = (f, d) => (d.tgca > linha(f, d) ? 'Prioritário' : 'Não prioritário');

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });
await ctx.route('http*://**', r => r.abort());   // confirma que nada depende de rede
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));
await p.goto('file://' + HTML, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(900);
await p.click('#rangechips button:text-is("Toda a base")');
await p.waitForTimeout(600);

/* --------- PNG do gráfico em cada ponderação --------- */
for (const [rotulo, arquivo] of [['Limitada', 'limitada'], ['Integral', 'integral']]) {
  await p.click(`#wchips button:text-is("${rotulo}")`);
  await p.waitForTimeout(500);
  await p.locator('#view-chart').screenshot({ path: join(DIST, `grafico-${arquivo}.png`) });
}

/* --------- confere o CSV contra o que a página renderiza --------- */
await p.click('#v-tab');
await p.waitForTimeout(400);
let divergencias = 0, conferidos = 0;
for (const [rotulo, chave] of [['Limitada', 'capped'], ['Integral', 'full']]) {
  await p.click(`#wchips button:text-is("${rotulo}")`);
  await p.waitForTimeout(500);
  const daPagina = await p.$$eval('#tbody tr', trs => trs.map(tr => {
    const td = tr.querySelectorAll('td');
    return [td[0].textContent.trim(), td[1].textContent.trim(), td[7].textContent.trim()];
  }));
  const meu = new Map(ROWS.map(d => [d.mun + '|' + d.uf, prio(F[chave], d)]));
  for (const [mun, uf, rot] of daPagina) { conferidos++; if (meu.get(mun + '|' + uf) !== rot) divergencias++; }
}
console.log(`verificação: ${conferidos} rótulos conferidos contra a página, ${divergencias} divergências`);
if (divergencias) { console.error('abortado: o CSV não bate com a página'); process.exit(1); }

/* --------- PDF --------- */
await p.click('#v-chart');
await p.click('#wchips button:text-is("Limitada")');
await p.waitForTimeout(500);
await p.emulateMedia({ media: 'print' });
await p.pdf({
  path: join(DIST, 'matriz_tgca_municipios.pdf'), format: 'A4', landscape: true,
  printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
});
await navegador.close();

/* --------- CSV: ; como separador e vírgula decimal, que é o que o Excel pt-BR abre --------- */
const colunas = [
  ['mun', 'Município'], ['uf', 'UF'], ['pop', 'População (Censo 2022)'], ['tgca', 'TGCA (% a.a.)'],
  ['pib', 'PIB total (R$ mil)'], ['pibpc', 'PIB per capita (R$)'], ['q', 'Quadrante'],
  ['lin_lim', 'Linha — ponderação limitada (%)'], ['gap_lim', 'Distância da linha limitada (p.p.)'], ['pri_lim', 'Prioridade — limitada'],
  ['lin_int', 'Linha — ponderação integral (%)'], ['gap_int', 'Distância da linha integral (p.p.)'], ['pri_int', 'Prioridade — integral'],
];
const quadrante = d => {
  const g = d.pop >= 60000, h = d.tgca >= 0.36;
  return g && h ? 'Grandes · crescendo' : (!g && h ? 'Pequenas · crescendo' : (!g ? 'Pequenas · estagnadas' : 'Grandes · estagnadas'));
};
const r4 = v => Math.round(v * 1e4) / 1e4;
const esc = v => { const t = String(v); return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const num = v => (typeof v === 'number' ? String(v).replace('.', ',') : v);
const linhas = [colunas.map(c => esc(c[1])).join(';')];
for (const d of ROWS) {
  const o = {
    ...d, q: quadrante(d),
    lin_lim: r4(linha(F.capped, d)), gap_lim: r4(d.tgca - linha(F.capped, d)), pri_lim: prio(F.capped, d),
    lin_int: r4(linha(F.full, d)), gap_int: r4(d.tgca - linha(F.full, d)), pri_int: prio(F.full, d),
  };
  linhas.push(colunas.map(c => esc(num(o[c[0]]))).join(';'));
}
writeFileSync(join(DIST, 'matriz_tgca_municipios.csv'), '﻿' + linhas.join('\r\n') + '\r\n', 'utf8');

console.log(`erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'}`);
console.log(`gerados em dist/: PDF, CSV (${ROWS.length} linhas) e 2 PNGs`);
