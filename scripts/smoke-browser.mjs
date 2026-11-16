import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { startLocal } from "./dev-local.mjs";
import { pdfTexto } from "./test-fixtures.mjs";

const directory = await mkdtemp(join(tmpdir(), "analise-browser-"));
const artifacts = new URL("../artifacts/", import.meta.url).pathname;
await mkdir(artifacts, { recursive: true });
let runtime, browser;
try {
  runtime = await startLocal({ port: 0, directory });
  const base = `http://127.0.0.1:${runtime.port}`;
  browser = await chromium.launch({ executablePath: process.env.ANALISE_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [], violations = []; let calls = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.text().includes("violates the following Content Security Policy")) violations.push(message.text()); });
  page.on("dialog", dialog => dialog.accept());
  page.setDefaultTimeout(15000);
  await page.route("https://**/*", route => route.abort());
  await page.route("**/api/analise-ia/**", async route => {
    if (route.request().url().endsWith("/status")) { await route.fulfill({ json: { disponivel: true, modelo: "provedor-simulado", motivo: "" } }); return; }
    if (route.request().url().endsWith("/diagnostico")) { await route.fulfill({ json: { mensagem: "Modelo fictício localizado, sem documentos." } }); return; }
    calls++;
    const body = route.request().postDataJSON(); assert.equal(body.autorizado, true);
    if (body.paginas) {
      await route.fulfill({ json: { itens: [{ id: "p1", origem: body.nome, local: "Página 1", descricao: "Comprovar FGTS",
        providencia: "Apresentar comprovante do recolhimento de FGTS de setembro de 2026", referencia: "09/2026", trecho: "Apresentar comprovante",
        fonteVerificada: true, paginaConfirmada: true, contextoSES: body.paginas[0].texto, contextoMetodo: "trecho_validado",
        termosBusca: ["FGTS"], consultasAlternativas: ["Quitação do fundo de garantia"] }] } });
    } else {
      await route.fulfill({ json: { itens: body.itens.map(item => ({ id: item.id, situacao: "nao_verificavel", justificativa: "Justificativa fictícia de uma avaliação inconclusiva",
        candidatoIds: [item.candidatos[0].id], evidencias: [{ candidatoId: item.candidatos[0].id, trecho: item.candidatos[0].trecho.slice(0, 80) }], pendencias: ["Revisar o contexto da prova"] })) } });
    }
  });
  const samples = [pdfTexto("Guia FGTS. Competencia 08/2026. Recolhimento a efetuar."), pdfTexto("Fundo de Garantia do Tempo de Servico. Competencia 09/2026. Recolhimento efetuado. Autenticacao bancaria 777888999.")].map(value => [...Buffer.from(value)]);
  const installFolder = bytes => {
    const files = bytes.map((data, i) => new File([new Uint8Array(data)], "documento-" + i + ".pdf", { type: "application/pdf", lastModified: 1 }));
    const handles = files.map(file => ({ kind: "file", name: file.name, getFile: async () => file }));
    const folder = { kind: "directory", name: "Financeiro", async *values() { yield* handles; }, getFileHandle: async name => handles.find(h => h.name === name) };
    const denied = { kind: "directory", name: "Restrita", async *values() { throw new DOMException("Sem permissão", "NotAllowedError"); } };
    window.showDirectoryPicker = async () => ({ kind: "directory", name: "Entidade", async *values() { yield folder; yield denied; }, getDirectoryHandle: async () => folder });
  };
  await page.addInitScript(installFolder, samples);
  await page.goto(base);
  await page.locator("#auth-name").waitFor({ state: "visible" });
  await page.locator("#auth-name").fill("Equipe de teste"); await page.locator("#auth-email").fill("admin@example.test"); await page.locator("#auth-password").fill("senha-apenas-teste");
  await page.locator("#auth-submit").click(); await page.locator("#app").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#metric-analyses").textContent === "0");
  assert.equal(await page.locator("#recent-analyses .empty-state").count(), 1);
  await page.screenshot({ path: join(artifacts, "dashboard-vazio.png"), fullPage: true });
  await page.locator("#view-overview [data-new-analysis]").first().click();
  await page.locator("#pasta-selecionar").click(); await page.locator("#pasta-resultado").waitFor({ state: "visible" });
  assert.match(await page.locator("#pasta-diagnostico").textContent(), /NotAllowedError/);
  assert.equal(calls, 0, "inventory has no paid request");
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Comprovantes").addRow(["Documento FGTS", "Competência 09/2026", 123]);
  const excel = [...new Uint8Array(await workbook.xlsx.writeBuffer())];
  const readExcel = await page.evaluate(async bytes => {
    const file = new File([new Uint8Array(bytes)], "exemplo.xlsx");
    return window.GemodConferencia.ler(file, undefined, { indiceCompleto: true });
  }, excel);
  assert.match(readExcel.partes[0].texto, /Documento FGTS/); assert.match(readExcel.partes[0].texto, /09\/2026/);
  const sesFiles = ["OFICIO No 87129/2025/SES", "RELATORIO No 1 / 2025 SES/CAC-09363"].map((title, i) => ({ name: "SES-" + (i + 1) + ".pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfTexto(title + "\nApresentar comprovante do recolhimento FGTS de setembro de 2026.")) }));
  await page.locator("#ia-ses").setInputFiles(sesFiles); await page.locator("#ia-interpretar").click();
  await page.waitForFunction(() => /2 consulta/.test(document.querySelector("#ia-interpretar").textContent));
  assert.equal(calls, 0, "real PDF text and worker prepare the SES sources locally");
  assert.equal(await page.locator(".gemod-ses-reading").count(), 2);
  await page.locator("#ia-consentimento").check(); await page.locator("#ia-interpretar").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-ia-desc]").length === 2);
  assert.equal(calls, 2);
  await page.locator('[data-ia-desc="0"]').fill("Comprovar FGTS — pedido revisado");
  await page.getByRole("button", { name: "Conferir próximo documento →", exact: true }).click();
  await page.getByRole("button", { name: "Documento anterior", exact: true }).click();
  assert.match(await page.locator('[data-ia-desc="0"]').inputValue(), /pedido revisado/);
  await page.locator("#ia-buscar").click(); await page.locator("#ia-resultado").waitFor({ state: "visible" });
  assert.equal(calls, 2, "real PDF indexing never uploads the entity corpus to AI");
  await page.locator(".gemod-candidates > summary").first().click();
  assert.equal(await page.locator(".gemod-location-name").first().textContent(), "documento-1.pdf", "the paid period ranks ahead of a different-period unpaid guide");
  assert.match(await page.locator("#ia-cobertura").textContent(), /parcial/i);
  await page.locator("#ia-selecionar-todos").click(); await page.locator("#ia-avaliar").click();
  await page.waitForFunction(() => document.querySelectorAll(".gemod-ai-assessment").length === 2);
  assert.equal(calls, 3); assert.match(await page.locator("#ia-tabela").textContent(), /Justificativa fictícia/);
  await page.locator("#save-shortcut").click(); await page.locator("[data-nome-analise]").fill("Conferência SES · FGTS"); await page.locator("[data-salvar-analise]").click();
  await page.waitForFunction(() => /^Salvo em/.test(document.querySelector("[data-analise-status]").textContent));
  await page.locator('[data-nav="overview"]').first().click();
  await page.waitForFunction(() => document.querySelector("#metric-analyses").textContent === "1");
  assert.equal(await page.locator("#metric-requests").textContent(), "2");
  await page.screenshot({ path: join(artifacts, "dashboard.png"), fullPage: true });
  await page.locator('[data-nav="saved"]').first().click();
  await page.locator("#saved-search").fill("inexistente"); assert.match(await page.locator("#saved-analyses").textContent(), /Nenhuma análise corresponde/);
  await page.locator("#saved-search").fill("FGTS"); await page.locator("#saved-analyses [data-open-analysis]").click();
  await page.locator("#view-analysis").waitFor({ state: "visible" });
  assert.equal(calls, 3, "reopening does not regenerate an assessment");
  await page.reload(); await page.locator("#view-analysis").waitFor({ state: "visible" });
  await page.locator('[data-nav="saved"]').first().click(); await page.locator("#saved-analyses [data-open-analysis]").click(); await page.locator("#ia-resultado").waitFor({ state: "visible" });
  assert.match(await page.locator("#ia-tabela").textContent(), /Justificativa fictícia/); assert.equal(calls, 3);
  // Expiring the server session must hide private work, then restore it only after login.
  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  await page.locator('[data-nav="overview"]').first().click();
  await page.locator("#auth-screen").waitFor({ state: "visible" });
  assert.equal(await page.locator("#app").isVisible(), false);
  await page.locator("#auth-email").fill("admin@example.test"); await page.locator("#auth-password").fill("senha-apenas-teste");
  await page.locator("#auth-submit").click(); await page.locator("#app").waitFor({ state: "visible" });
  await page.locator('[data-nav="analysis"]').first().click();
  assert.match(await page.locator("#ia-tabela").textContent(), /Justificativa fictícia/);
  assert.equal(calls, 3, "reauthentication preserves work without regenerating it");
  const htmlDownload = page.waitForEvent("download"); await page.locator("#ia-html").click();
  const htmlPath = join(directory, "relatorio.html"); await (await htmlDownload).saveAs(htmlPath);
  const html = await readFile(htmlPath, "utf8"); assert.ok(html.includes("Entidade/Financeiro/documento-1.pdf"));
  const csvDownload = page.waitForEvent("download"); await page.locator("#ia-csv").click();
  const csvPath = join(directory, "quadro.csv"); await (await csvDownload).saveAs(csvPath);
  await page.locator(".gemod-candidates > summary").first().click();
  await page.locator("[data-gerar-imagem]").first().click();
  await page.waitForFunction(() => /pronta/.test(document.querySelector(".gemod-share-status")?.textContent || ""));
  const png = page.waitForEvent("download"); await page.locator(".gemod-share-page button").first().click();
  const pngPath = join(directory, "trecho.png"); await (await png).saveAs(pngPath);
  assert.deepEqual((await readFile(pngPath)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await page.locator(".gemod-share-dialog [data-fechar]").click();
  await page.screenshot({ path: join(artifacts, "analise.png"), fullPage: false });
  const offline = await browser.newPage(); await offline.route(/^https?:/, route => route.abort());
  await offline.setContent(html); assert.equal(await offline.locator(".request").count(), 2);
  assert.ok((await offline.pdf({ format: "A4" })).length > 1000);
  const converter = await browser.newPage(); await converter.goto(base + "/relatorio-conferencia.html");
  await converter.locator("#relatorio-csv").setInputFiles(csvPath);
  await converter.waitForFunction(() => !document.querySelector("#relatorio-salvar").disabled);
  assert.equal(await converter.frameLocator("#relatorio-previa").locator(".request").count(), 2);
  assert.equal(calls, 3, "HTML, CSV, PNG and printable PDF need no AI generation");
  await page.locator('[data-nav="overview"]').first().click(); await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, "dashboard-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator("#menu-toggle").click(); await page.locator('#sidebar [data-nav="analysis"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  console.log("Browser smoke passed: setup/login, dashboard, local PDF/XLSX readers, contextual search, consent, mock AI, private save/reopen, HTML/CSV/PNG/PDF, CSP and mobile navigation. No external AI calls.");
} finally {
  await browser?.close(); await runtime?.close(); await rm(directory, { recursive: true, force: true });
}
