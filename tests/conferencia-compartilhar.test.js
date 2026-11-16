const assert = require("node:assert/strict");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const relatorio = require("../public/relatorio-conferencia.js");
const compartilhar = require("../public/conferencia-compartilhar.js");

function dados() {
  return { cobertura: { verificacaoParcial: true }, resultados: [{ origem: "Ofício SES.pdf", local: "Página 4", descricao: "Ausência de nota fiscal e pagamento.",
    providencia: "Apresentar a nota fiscal 782 e o comprovante de pagamento.", referencia: "12/2024", situacao: "localizada_sem_analise", candidatos: [
      { caminho: "Entidade/Financeiro/Dezembro/NF 782.pdf", local: "Página 12", trecho: "Nota fiscal 782 referente a dezembro de 2024.", motivos: ["Número e competência"], alertas: ["Conferir o vínculo com o pagamento"] },
      { caminho: "Entidade/Pagamentos/Comprovante.pdf", local: "Página 3", trecho: "Pagamento efetuado referente à nota fiscal 782." },
    ], evidencias: [{ candidatoId: "c0", trecho: "Nota fiscal 782" }, { candidatoId: "c1", trecho: "Pagamento efetuado" }] }] };
}

test("caminho decorado mantém a ordem das pastas, destaca o PDF e preserva o texto exato para cópia", () => {
  for (const caminho of ['Entidade/Contas/12-2024/NF "782"; comprovante.pdf', 'C:\\Documentos\\Prestação de contas\\Nota.pdf']) {
    const p = relatorio.partesCaminho(caminho);
    const dom = new JSDOM(relatorio.caminhoHTML(caminho, "Página 12", true));
    const doc = dom.window.document;
    assert.deepEqual([...doc.querySelectorAll(".gemod-folder-chip > span")].map(el => el.textContent), p.pastas);
    assert.equal(doc.querySelector(".gemod-location-name").textContent, p.arquivo);
    assert.equal(doc.querySelector(".location").textContent, "Página 12");
    assert.equal(doc.querySelector("[data-copiar-caminho]").dataset.copiarCaminho, caminho);
    assert.equal(doc.querySelector(".path").textContent, caminho);
    dom.window.close();
  }
});

test("nomes e caminhos maliciosos permanecem texto na apresentação das pastas", () => {
  const caminho = 'Pasta<img src=x onerror=alert(1)>/Arquivo " data-teste="injetado.pdf';
  const dom = new JSDOM(relatorio.caminhoHTML(caminho, "Página 1", true));
  assert.equal(dom.window.document.querySelectorAll("img,script,[data-teste]").length, 0);
  assert.equal(dom.window.document.querySelector("[data-copiar-caminho]").dataset.copiarCaminho, caminho);
  assert.equal(dom.window.document.querySelector(".path").textContent, caminho);
  assert.equal(new JSDOM(relatorio.caminhoHTML(caminho)).window.document.querySelectorAll("button").length, 0, "standalone report has no inert action buttons");
  dom.window.close();
});

test("imagem de um arquivo preserva o pedido e usa somente os candidatos e citações escolhidos", () => {
  const fonte = dados(), antes = JSON.stringify(fonte);
  const blocos = compartilhar.blocosPedido(fonte, 0, 1);
  const texto = blocos.map(b => b.texto).join("\n");
  assert.match(texto, /Apresentar a nota fiscal 782/);
  assert.match(texto, /Pagamento efetuado/);
  assert.match(texto, /Página 3/);
  assert.match(texto, /Entidade\/Pagamentos\/Comprovante.pdf/);
  assert.match(texto, /Arquivo 2 de 2 candidatos/);
  assert.match(texto, /A avaliação registrada refere-se ao pedido/);
  assert.doesNotMatch(texto, /Entidade\/Financeiro|Número e competência|Página 12/);
  assert.equal(JSON.stringify(fonte), antes, "image export does not alter the search results");
  assert.throws(() => compartilhar.blocosPedido(fonte, 5), /pedido válido/);
  assert.throws(() => compartilhar.blocosPedido(fonte, 0, 9), /arquivo válido/);
});

test("paginação mantém todos os textos e limita as dimensões para pedidos longos", () => {
  const fonte = dados();
  fonte.resultados[0].candidatos[0].trecho = "Citação literal com informações para conferência. ".repeat(300) + "FIM_DA_EVIDENCIA";
  fonte.resultados[0].candidatos[0].caminho = "Entidade/" + "arquivo".repeat(60) + ".pdf";
  const ctx = { font: "", measureText: text => ({ width: [...text].length * 12 }) };
  const paginas = compartilhar.planejarPaginas(ctx, compartilhar.blocosPedido(fonte, 0));
  assert.ok(paginas.length > 1);
  assert.ok(paginas.every(p => p.altura <= compartilhar.ALTURA_MAXIMA));
  assert.ok(paginas.flatMap(p => p.linhas).some(l => l.texto.includes("FIM_DA_EVIDENCIA")));
  assert.ok(paginas.flatMap(p => p.linhas).every(l => ctx.measureText(l.texto).width <= compartilhar.LARGURA - 148));
  const nome = "Árvore".repeat(100);
  assert.equal(compartilhar.quebrarTexto(ctx, nome, 700).join(""), nome, "long names wrap without ellipsis or lost characters");
  fonte.resultados[0].providencia = "x".repeat(160001);
  assert.throws(() => compartilhar.blocosPedido(fonte, 0), /extenso demais/);
});
