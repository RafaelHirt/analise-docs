const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const inventario = require("../public/analisar-pasta.js");

function arquivo(name) {
  return { name, kind: "file", getFile() { throw new Error("Não deve abrir arquivos"); } };
}

function pasta(name, itens = [], erro = null) {
  return {
    name, kind: "directory",
    async *values() {
      for (const item of itens) yield item;
      if (erro) throw erro;
    },
  };
}

test("conta toda a árvore, vazias reais e tipos sem abrir os documentos", async () => {
  const raiz = pasta("Documentos", [
    arquivo("relatório.PDF"), arquivo("planilha.XLSX"), arquivo("dados.csv"), arquivo("contrato.docx"),
    pasta("Apenas subpastas", [pasta("Vazia")]),
    pasta("Arquivos", [arquivo("legado.xls"), arquivo("texto.txt"), arquivo(".oculto"), arquivo("termo.DOCM")]),
  ]);
  const resultado = await inventario.analisar(raiz);
  assert.equal(resultado.completo, true);
  assert.deepEqual(resultado.totais, { pastas: 4, vazias: 1, arquivos: 8, pdf: 1, excel: 2, word: 2, outros: 3 });
  for (const contagem of [resultado.totais, ...resultado.pastas]) {
    assert.equal(contagem.arquivos, contagem.pdf + contagem.excel + contagem.word + contagem.outros);
  }
  assert.equal(resultado.pastas.find((p) => p.caminho.endsWith("Apenas subpastas")).vazia, false);
  assert.equal(resultado.pastas.find((p) => p.vazia).caminho, "Documentos/Apenas subpastas/Vazia");
});

test("pasta principal vazia é contada uma vez e como vazia", async () => {
  const resultado = await inventario.analisar(pasta("Vazia"));
  assert.equal(resultado.totais.pastas, 1);
  assert.equal(resultado.totais.vazias, 1);
  assert.equal(resultado.totais.arquivos, 0);
  assert.equal(resultado.totais.word, 0);
  assert.equal(resultado.pastas[0].word, 0);
});

test("reconhece formatos Excel sem confundir CSV, ODS ou nomes sem extensão", () => {
  for (const extensao of ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm", "xla", "xlam", "xlw"]) {
    assert.equal(inventario.tipoArquivo(`teste.${extensao.toUpperCase()}`), "excel");
  }
  for (const nome of ["teste.csv", "teste.ods", "pdf", "xlsx", "teste.pdf.zip", "sem extensão", "arquivo."]) {
    assert.equal(inventario.tipoArquivo(nome), "outros");
  }
});

test("reconhece documentos e modelos Word pela extensão, sem confundir outros formatos", () => {
  for (const extensao of ["doc", "docx", "docm", "dot", "dotx", "dotm"]) {
    assert.equal(inventario.tipoArquivo(`teste.${extensao}`), "word");
    assert.equal(inventario.tipoArquivo(`teste.${extensao.toUpperCase()}`), "word");
  }
  assert.equal(inventario.tipoArquivo("contrato.revisado.DoCx"), "word");
  for (const nome of ["teste.rtf", "teste.odt", "doc", "docx", "teste.docx.zip", "teste.doc."]) {
    assert.equal(inventario.tipoArquivo(nome), "outros");
  }
  assert.equal(inventario.tipoArquivo("teste.docx.pdf"), "pdf");
});

test("Word aparece nos totais TXT e nas contagens diretas TXT e CSV, sem duplicar Outros", async () => {
  const resultado = await inventario.analisar(pasta("Principal", [
    arquivo("a.docx"), arquivo("b.pdf"), arquivo("c.xlsx"), arquivo("d.txt"),
    pasta("Subpasta", [arquivo("legado.DOC"), arquivo("texto.rtf")]), pasta("Vazia"),
  ]));
  const texto = inventario.relatorioTexto(resultado);
  assert.match(texto, /\r\nWord: 2\r\nOutros arquivos: 2\r\n/);
  assert.match(texto, /Word: \.doc, \.docx, \.docm, \.dot, \.dotx, \.dotm\./);
  assert.match(texto, /Principal \| Lida \| Subpastas: 2 \| Arquivos: 4 \| PDF: 1 \| Excel: 1 \| Word: 1 \| Outros: 1/);
  assert.match(texto, /Principal\/Subpasta \| Lida \| Subpastas: 0 \| Arquivos: 2 \| PDF: 0 \| Excel: 0 \| Word: 1 \| Outros: 1/);
  const linhas = inventario.relatorioCSV(resultado).split("\r\n");
  assert.match(linhas[0], /"PDF";"Excel";"Word";"Outros"/);
  assert.match(linhas.find((l) => l.startsWith('"Principal";')), /^"Principal";"Lida";"2";"4";"1";"1";"1";"1";/);
  assert.match(linhas.find((l) => l.startsWith('"Principal/Subpasta";')), /^"Principal\/Subpasta";"Lida";"0";"2";"0";"0";"1";"1";/);
  assert.match(linhas.find((l) => l.startsWith('"Principal/Vazia";')), /^"Principal\/Vazia";"Vazia na leitura";"0";"0";"0";"0";"0";"0";/);
});

test("falha de acesso gera relatório parcial, continua nas demais e não conta pasta como vazia", async () => {
  const resultado = await inventario.analisar(pasta("Principal", [
    pasta("Com acesso", [arquivo("a.pdf")]),
    pasta("Bloqueada", [], { name: "NotAllowedError" }),
    pasta("Com falha após listar", [arquivo("b.xls")], { name: "NotFoundError" }),
  ]));
  assert.equal(resultado.completo, false);
  assert.equal(resultado.erros.length, 2);
  assert.equal(resultado.totais.vazias, 0);
  assert.equal(resultado.totais.arquivos, 2);
  assert.equal(resultado.pastas.find((p) => p.caminho.endsWith("Bloqueada")).vazia, null);
  assert.match(inventario.relatorioTexto(resultado), /FALHAS DE LEITURA/);
  assert.match(inventario.relatorioCSV(resultado), /PARCIAL/);
});

test("cancelamento interrompe a travessia e identifica contagens parciais", async () => {
  const controle = new AbortController();
  const resultado = await inventario.analisar(pasta("Principal", [pasta("Ainda não lida", [arquivo("a.pdf")])]), {
    signal: controle.signal,
    onProgress: () => controle.abort(),
  });
  assert.equal(resultado.interrompido, true);
  assert.equal(resultado.completo, false);
  assert.equal(resultado.totais.pastas, 1);
  assert.equal(resultado.totais.arquivos, 0);
  assert.match(inventario.relatorioTexto(resultado), /PARCIAL/);
  assert.match(inventario.relatorioTexto(resultado), /Análise interrompida/);
});

test("cancelamento antes do início não solicita nenhuma listagem", async () => {
  const controle = new AbortController();
  controle.abort();
  const resultado = await inventario.analisar({ name: "Principal", values() { throw new Error("Não deve listar"); } }, { signal: controle.signal });
  assert.equal(resultado.totais.pastas, 0);
  assert.equal(resultado.completo, false);
});

test("árvore profunda e muitos arquivos não usam recursão nem retêm nomes de arquivos", async () => {
  let raiz = pasta("Última", Array.from({ length: 1000 }, (_, i) => arquivo(`${i}.pdf`)));
  for (let i = 0; i < 2000; i++) raiz = pasta(`Nível ${i}`, [raiz]);
  const resultado = await inventario.analisar(raiz);
  assert.equal(resultado.completo, true);
  assert.equal(resultado.totais.pastas, 2001);
  assert.equal(resultado.totais.pdf, 1000);
  assert.equal(resultado.totais.vazias, 0);
  assert.equal(JSON.stringify(resultado).includes("999.pdf"), false);
});

test("relatório de texto traz totais, vazias, regras e detalhes por pasta", async () => {
  const resultado = await inventario.analisar(pasta("Principal", [pasta("Vazia"), arquivo("a.pdf")]));
  const texto = inventario.relatorioTexto(resultado);
  assert.match(texto, /Resultado: LEITURA CONCLUÍDA/);
  assert.match(texto, /inclui a principal\): 2/);
  assert.match(texto, /Pastas vazias na leitura: 1/);
  assert.match(texto, /PDFs: 1/);
  assert.match(texto, /PASTAS VAZIAS\r\nPrincipal\/Vazia/);
  assert.match(texto, /contagens diretas/);
  assert.match(texto, /Revise antes de compartilhar/);
});

test("CSV é UTF-8, escapa aspas e neutraliza fórmulas em nomes de pastas", async () => {
  const resultado = await inventario.analisar(pasta('=HYPERLINK("exemplo");', [pasta("Vazia")]));
  const csv = inventario.relatorioCSV(resultado);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /"'=HYPERLINK\(""exemplo""\);"/);
  assert.match(csv, /"'=HYPERLINK\(""exemplo""\);\/Vazia"/);
  assert.match(csv, /"LEITURA CONCLUÍDA — itens listados pelo navegador"/);
});

test("relatórios limitam a cobertura ao navegador, inclusive em leituras parciais", async () => {
  for (const raiz of [pasta("Listada"), pasta("Com falha", [], { name: "NotAllowedError" })]) {
    const resultado = await inventario.analisar(raiz);
    for (const relatorio of [inventario.relatorioTexto(resultado), inventario.relatorioCSV(resultado)]) {
      assert.match(relatorio, /apenas os itens que o navegador permite listar/);
      assert.match(relatorio, /pode omitir itens sem avisar/);
      assert.match(relatorio, /cobertura total da pasta não foi verificada/);
      assert.doesNotMatch(relatorio, /COMPLETO/);
    }
  }
});

function tela(t, raiz, suportado = true, comApp = false) {
  const html = readFileSync(require.resolve("../public/index.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://gemod.example/", runScripts: "outside-only" });
  t.after(() => { dom.window.GemodPastas.sair(); dom.window.close(); });
  const { window } = dom;
  window.scrollTo = () => {}; // Layout is exercised separately in Chromium.
  Object.defineProperty(window, "isSecureContext", { value: true });
  let opcoes;
  if (suportado) window.showDirectoryPicker = async (opts) => { opcoes = opts; return raiz; };
  window.fetch = () => { throw new Error("Não deve enviar dados à API"); };
  window.eval(readFileSync(require.resolve("../public/analisar-pasta.js"), "utf8"));
  window.GemodPastas.render(window.document.querySelector("#analysis-workspace"));
  if (comApp) window.navegar = () => window.GemodPastas.sair();
  return { window, $: (sel) => window.document.querySelector(sel), opcoes: () => opcoes };
}

async function esperar(condicao) {
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    if (condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("A análise não terminou no prazo do teste");
}

test("tela pede somente leitura, apresenta resultado, filtra vazias e não faz upload", async (t) => {
  const { window, $, opcoes } = tela(t, pasta("Principal", [arquivo("a.pdf"), pasta("Vazia")]));
  $("#pasta-selecionar").click();
  await esperar(() => !$("#pasta-resultado").hidden);
  assert.equal(opcoes().mode, "read");
  assert.match($("#pasta-status").textContent, /concluída/);
  assert.equal($("#pasta-linhas").children.length, 2);
  $("#pasta-vazias").checked = true;
  $("#pasta-vazias").dispatchEvent(new window.Event("input"));
  assert.equal($("#pasta-linhas").children.length, 1);
  assert.match($("#pasta-linhas").textContent, /Principal\/Vazia/);
});

test("tela explica a cobertura antes da seleção e não promete análise completa", async (t) => {
  const { $ } = tela(t, pasta("Principal"));
  const limites = $("details.gemod-manual-mode");
  assert.ok(limites.querySelector("summary").textContent.includes("limitações"));
  limites.open = true;
  assert.equal(limites.open, true);
  assert.match(limites.textContent, /pode omitir itens sem avisar/);
  $("#pasta-selecionar").click();
  await esperar(() => !$("#pasta-resultado").hidden);
  assert.match($("#pasta-resumo").textContent, /itens listados pelo navegador/);
  assert.doesNotMatch($("#pasta-resumo").textContent, /análise completa/);
  assert.match($("#pasta-totais").textContent, /Vazias na leitura/);
});

test("tela mostra Word separado de Outros no cartão e na tabela, inclusive sem resultados no filtro", async (t) => {
  const { window, $ } = tela(t, pasta("Principal", [arquivo("a.docx"), arquivo("b.DOC"), arquivo("outro.txt"), pasta("Vazia")]));
  $("#pasta-selecionar").click();
  await esperar(() => !$("#pasta-resultado").hidden);
  const cards = [...$("#pasta-totais").children];
  assert.equal(cards.find((c) => c.querySelector(".metric-rotulo").textContent === "Documentos Word").querySelector(".metric-valor").textContent, "2");
  assert.equal(cards.find((c) => c.querySelector(".metric-rotulo").textContent === "Outros arquivos").querySelector(".metric-valor").textContent, "1");
  const tabela = $("#pasta-linhas").closest("table");
  assert.deepEqual([...tabela.querySelectorAll("th")].map((th) => th.textContent), ["Pasta", "Situação", "Subpastas", "Arquivos", "PDF", "Excel", "Word", "Outros"]);
  assert.deepEqual([...$("#pasta-linhas tr").cells].map((td) => td.textContent), ["Principal", "Lida", "1", "3", "0", "0", "2", "1"]);
  $("#pasta-busca").value = "inexistente";
  $("#pasta-busca").dispatchEvent(new window.Event("input"));
  assert.equal($("#pasta-linhas td").colSpan, 8);
});

test("ações da análise não herdam a barra fixa que encobria os avisos", (t) => {
  const { window, $ } = tela(t, null);
  const estilo = window.document.createElement("style");
  estilo.textContent = readFileSync(require.resolve("../public/conferencia.css"), "utf8") + readFileSync(require.resolve("../public/styles.css"), "utf8");
  window.document.head.append(estilo);
  const acoes = $(".inventario-local .form-acoes");
  const css = window.getComputedStyle(acoes);
  assert.equal(css.position, "static");
  assert.equal(css.marginBottom, "1rem");
  assert.equal(css.paddingBottom, "0px");
});

test("nomes de pastas não são interpretados como HTML", async (t) => {
  const { $ } = tela(t, pasta('<img src=x onerror="alert(1)">'));
  $("#pasta-selecionar").click();
  await esperar(() => !$("#pasta-resultado").hidden);
  assert.equal($("#pasta-linhas img"), null);
  assert.match($("#pasta-linhas").textContent, /<img/);
});

test("navegador sem seletor de diretórios informa limitação em vez de omitir vazias", (t) => {
  const { $ } = tela(t, null, false);
  assert.equal($("#pasta-selecionar").disabled, true);
  assert.match($("#analysis-workspace").textContent, /Chrome ou Edge/);
  assert.match($("#analysis-workspace").textContent, /seletor necessário para contar pastas vazias/);
});

test("cancelar o seletor não exibe falha nem resultado inventado", async (t) => {
  const { window, $ } = tela(t, null);
  window.showDirectoryPicker = async () => { throw new window.DOMException("Cancelado", "AbortError"); };
  $("#pasta-selecionar").click();
  await esperar(() => !$("#pasta-selecionar").disabled);
  assert.match($("#pasta-status").textContent, /Seleção cancelada/);
  assert.equal($("#pasta-resultado").hidden, true);
});

test("navegar para fora durante o seletor impede leitura posterior e limpa a tela", async (t) => {
  const { window, $ } = tela(t, null, true, true);
  let selecionar;
  window.showDirectoryPicker = () => new Promise((resolve) => { selecionar = resolve; });
  $("#pasta-selecionar").click();
  window.navegar("manual");
  selecionar({ name: "Privada", values() { throw new Error("Não deve ler após sair da tela"); } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal($("#pasta-status"), null);
  assert.equal($("#analysis-workspace").textContent.includes("Privada"), false);
});

test("tabela de muitas pastas é paginada, com busca sem perder itens do relatório", async (t) => {
  const { window, $ } = tela(t, pasta("Principal", Array.from({ length: 210 }, (_, i) => pasta(`Pasta ${i}`))));
  $("#pasta-selecionar").click();
  await esperar(() => !$("#pasta-resultado").hidden);
  assert.equal($("#pasta-linhas").children.length, 100);
  assert.match($("#pasta-pagina").textContent, /Página 1 de 3/);
  $("#pasta-proxima").click();
  $("#pasta-proxima").click();
  assert.equal($("#pasta-linhas").children.length, 11);
  $("#pasta-busca").value = "Pasta 209";
  $("#pasta-busca").dispatchEvent(new window.Event("input"));
  assert.equal($("#pasta-linhas").children.length, 1);
  assert.match($("#pasta-pagina").textContent, /Página 1 de 1/);
});

test("downloads contêm todas as pastas, independentemente do filtro da tela", async (t) => {
  const { window, $ } = tela(t, pasta("Principal", [pasta("Vazia"), pasta("Com arquivo", [arquivo("a.pdf"), arquivo("contrato.docx")])]));
  const blobs = [];
  const downloads = [];
  window.Blob = Blob;
  window.URL.createObjectURL = (blob) => { blobs.push(blob); return `blob:relatorio-${blobs.length}`; };
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  $("#pasta-selecionar").click();
  await esperar(() => !$("#pasta-resultado").hidden);
  $("#pasta-vazias").checked = true;
  $("#pasta-vazias").dispatchEvent(new window.Event("input"));
  assert.equal($("#pasta-linhas").children.length, 1);
  $("#pasta-texto").click();
  $("#pasta-csv").click();
  assert.equal(blobs.length, 2);
  assert.match(await blobs[0].text(), /Principal\/Com arquivo/);
  assert.match(await blobs[1].text(), /Principal\/Com arquivo/);
  assert.match(await blobs[0].text(), /\r\nWord: 1\r\n/);
  assert.match(await blobs[1].text(), /"PDF";"Excel";"Word";"Outros"/);
  assert.match(await blobs[1].text(), /"Principal\/Com arquivo";"Lida";"0";"2";"1";"0";"1";"0";/);
  assert.match(downloads[0], /^gemod-inventario-.*\.txt$/);
  assert.match(downloads[1], /^gemod-inventario-.*\.csv$/);
  assert.equal(window.localStorage.length, 0);
});

test("botão interromper mantém relatório parcial e nunca declara pasta incompleta vazia", async (t) => {
  let liberar;
  const aguardar = new Promise((resolve) => { liberar = resolve; });
  const raiz = {
    name: "Principal",
    async *values() {
      yield arquivo("a.pdf");
      await aguardar;
      yield arquivo("b.pdf");
    },
  };
  const { $ } = tela(t, raiz);
  $("#pasta-selecionar").click();
  await esperar(() => !$("#pasta-parar").hidden);
  $("#pasta-parar").click();
  liberar();
  await esperar(() => !$("#pasta-resultado").hidden);
  assert.match($("#pasta-resumo").textContent, /RELATÓRIO PARCIAL/);
  assert.match($("#pasta-linhas").textContent, /Leitura incompleta/);
  assert.equal($("#pasta-selecionar").disabled, false);
});
