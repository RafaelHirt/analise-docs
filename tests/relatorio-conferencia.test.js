const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { JSDOM } = require("jsdom");
const relatorio = require("../public/relatorio-conferencia.js");

function resultados() {
  return [{ origem: "Ofício SES.pdf", local: "Página 4", descricao: "Ausência da nota fiscal e do pagamento de dezembro de 2024.",
    providencia: 'Apresentar a nota fiscal 782; demonstrar o pagamento de R$ 5.000,00 e esclarecer a descrição "Serviços prestados".',
    referencia: "NF 782 · 12/2024", situacao: "localizada_sem_analise", justificativa: "Candidatos aguardam revisão.", pendencias: [], candidatos: [
      { nome: 'NF "782"; comprovante.pdf', caminho: 'Entidade/Financeiro/Dezembro de 2024/NF "782"; comprovante.pdf', local: "Página 12",
        trecho: "Nota fiscal 782. Valor R$ 5.000,00.\nPagamento efetuado em 20/12/2024.", motivos: ["Referência: NF 782", "Competência: 12/2024"], alertas: ["Conferir o vínculo entre os documentos"] },
      { nome: "Extrato.pdf", caminho: "Entidade/Financeiro/Extratos/Extrato.pdf", local: "Página 23", trecho: "Débito de R$ 5.000,00 referente à NF 782.", motivos: [], alertas: [] },
    ] }, { origem: "RAFIC.pdf", local: "Local citado pela IA não validado", descricao: "Ausência de justificativa para saldo negativo.",
    providencia: "Apresentar justificativa e plano de ação.", referencia: "12/2024", situacao: "nao_verificavel", justificativa: "Sem candidatos confiáveis.", pendencias: [], candidatos: [] }];
}
function csvAtual(rows, cobertura, falhas) {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  try {
    dom.window.eval(readFileSync(require.resolve("../public/conferencia-ia.js"), "utf8"));
    return dom.window.GemodAnaliseIA.csv(rows, cobertura, falhas);
  } finally { dom.window.close(); }
}

test("converte o CSV real do GEMOD em pedidos com caminhos, páginas, trechos e cobertura preservados", () => {
  const rows = resultados();
  const cobertura = { listados: 6523, comTexto: 4747, semTexto: 641, naoSuportados: 25, erros: 1110, pastasFalhas: 17, parciais: 828, verificacaoParcial: true };
  const falhas = [{ caminho: "Entidade/Sem texto.pdf", motivo: "Exige OCR" }];
  const dados = relatorio.importarCSV(csvAtual(rows, cobertura, falhas), "gemod-analise-tecnica.csv");
  assert.equal(dados.resultados.length, 2);
  assert.equal(dados.resultados[0].candidatos.length, 2);
  assert.equal(dados.resultados[1].candidatos.length, 0);
  assert.equal(dados.resultados[0].providencia, rows[0].providencia);
  assert.deepEqual(dados.resultados[0].candidatos.map(c => [c.caminho, c.local, c.trecho]), rows[0].candidatos.map(c => [c.caminho, c.local, c.trecho.replace(/\n/g, " ")]));
  assert.equal(dados.cobertura.erros, 1110);
  assert.equal(dados.cobertura.parciais, 828);
  assert.equal(dados.cobertura.verificacaoParcial, true);
  assert.deepEqual(dados.falhas, falhas);
  const doc = new JSDOM(relatorio.gerarHTML(dados)).window.document;
  assert.equal(doc.querySelectorAll(".request").length, 2);
  assert.equal(doc.querySelectorAll(".candidate").length, 2);
  assert.equal(doc.querySelector(".path").textContent, rows[0].candidatos[0].caminho);
  assert.equal(doc.querySelector(".location").textContent, "Página 12");
  assert.match(doc.body.textContent, /Cobertura da leitura · parcial/);
  assert.match(doc.body.textContent, /1\.110/);
  assert.match(doc.body.textContent, /Nenhum candidato encontrado.*Isso não prova/);
});

test("relatório escapa conteúdo não confiável e não carrega scripts, arquivos externos ou links para os PDFs", () => {
  const rows = resultados(), malicioso = '</pre><script>alert("privado")</script><img src="https://example.invalid/private" onerror="alert(1)">';
  rows[0].descricao = malicioso;
  rows[0].providencia = malicioso;
  rows[0].candidatos[0].nome = malicioso;
  rows[0].candidatos[0].caminho = malicioso;
  rows[0].candidatos[0].trecho = malicioso;
  rows[0].candidatos[0].alertas = [malicioso];
  const html = relatorio.gerarHTML({ resultados: rows, pasta: malicioso, arquivoOrigem: malicioso, falhas: [{ caminho: malicioso, motivo: malicioso }] });
  const dom = new JSDOM(html), doc = dom.window.document;
  assert.equal(doc.querySelector(".path").textContent, malicioso);
  assert.equal(doc.querySelectorAll("script,img,iframe,link,form").length, 0);
  assert.ok([...doc.querySelectorAll("a")].every(a => /^#(?:pedido-\d+|cobertura)$/.test(a.getAttribute("href"))));
  assert.match(doc.querySelector('[http-equiv="Content-Security-Policy"]').content, /default-src 'none'/);
  assert.doesNotMatch(html, /onerror="alert/);
  dom.window.close();
});

test("leitura CSV aceita aspas, separadores e quebras de linha dentro dos campos", () => {
  const tabelas = [
    ['\uFEFF"Nome";"Trecho"\r\n"Pasta; A";"Valor ""citado""\nsegunda linha"', [["Nome", "Trecho"], ["Pasta; A", 'Valor "citado"\nsegunda linha']]],
    ['sep=,\r\n"Nome","Trecho"\r\n"A,B","Texto"', [["Nome", "Trecho"], ["A,B", "Texto"]]],
    ['Nome\tTrecho\nPasta\tTexto', [["Nome", "Trecho"], ["Pasta", "Texto"]]],
  ];
  for (const [texto, esperado] of tabelas) assert.deepEqual(relatorio.tabelaCSV(texto), esperado);
  assert.throws(() => relatorio.tabelaCSV('"campo sem fim'), /sem fechamento de aspas/);
  assert.throws(() => relatorio.importarCSV("Pasta;Quantidade\nPrincipal;7000"), /não é o quadro de evidências/);
  assert.throws(() => relatorio.importarCSV(csvAtual(resultados()) + '\r\n"linha cortada"'), /linha.*incompleta/);
});

test("relatório preserva avaliação existente e citações sem promover candidatos a atendimento confirmado", () => {
  const rows = resultados();
  rows[0].situacao = "evidencia_compativel";
  rows[0].evidencias = [{ candidatoId: "c1", trecho: "Débito de R$ 5.000,00 referente à NF 782." }];
  const doc = new JSDOM(relatorio.gerarHTML({ resultados: rows })).window.document;
  assert.match(doc.querySelector(".badge").textContent, /Possível evidência compatível/);
  assert.match(doc.body.textContent, /Extratos\/Extrato.pdf · Página 23: Débito/);
  assert.doesNotMatch(doc.body.textContent, /atendimento confirmado|Como usar este relatório|Observação da conferência/);
  assert.match(doc.body.textContent, /Contagens não informadas/);
  assert.throws(() => relatorio.gerarHTML({ resultados: [] }), /Pesquise a pasta/);
});

test("an inconclusive paid assessment keeps its justification in HTML and CSV without marking local misses as AI results",()=>{
  const rows=resultados();Object.assign(rows[0],{situacao:"nao_verificavel",avaliacaoConcluida:true,avaliacaoModelo:"modelo-ficticio",justificativa:"Os trechos não vinculam os documentos à despesa exigida.",pendencias:["Apresentar o vínculo com a nota de débito"]});
  for(const dados of [{resultados:rows},relatorio.importarCSV(csvAtual(rows))]){
    const doc=new JSDOM(relatorio.gerarHTML(dados)).window.document,primeiro=doc.querySelector(".request");
    assert.match(primeiro.textContent,/Não verificável com os dados disponíveis/);
    assert.match(primeiro.textContent,/Os trechos não vinculam os documentos à despesa exigida/);
    assert.doesNotMatch(doc.querySelectorAll(".request")[1].textContent,/Sem candidatos confiáveis/);
  }
  const reaberto=relatorio.importarCSV(csvAtual(rows)).resultados[0];assert.equal(reaberto.avaliacaoConcluida,true);assert.equal(reaberto.avaliacaoModelo,"modelo-ficticio");
});

test("older source JSON without item numbering or assessment columns remains readable",()=>{
  const tabela=relatorio.tabelaCSV(csvAtual(resultados())).map((linha,i)=>{
    if(i&&linha[22]){const fonte=JSON.parse(linha[22]);delete fonte.item;delete fonte.extracao;linha[22]=JSON.stringify(fonte);}
    return linha.slice(0,23);
  });
  const csv=tabela.map(l=>l.map(v=>'"'+v.replace(/"/g,'""')+'"').join(";")).join("\r\n");
  const importado=relatorio.importarCSV(csv);assert.equal(importado.resultados.length,2);assert.equal(importado.resultados[0].avaliacaoConcluida,false);
  assert.equal(importado.resultados[0].item,"");assert.equal(importado.resultados[0].candidatos.length,2);
});

test("contagens de falhas mantêm parcialidade mesmo se uma linha CSV disser NÃO", () => {
  const csv = csvAtual(resultados(), { listados: 10, comTexto: 9, erros: 1, verificacaoParcial: false });
  assert.equal(relatorio.importarCSV(csv).cobertura.verificacaoParcial, true);
});

test("CSV regravado com colunas vazias na cobertura não vira apontamento adicional", () => {
  const tabela = relatorio.tabelaCSV(csvAtual(resultados(), { listados: 10, erros: 1, verificacaoParcial: true }, [{ caminho: "Pasta/Arquivo.pdf", motivo: "Falha de leitura" }]));
  const largura = tabela[0].length;
  const preenchido = tabela.map(linha => [...linha, ...Array(largura - linha.length).fill("")].map(valor => '"' + valor.replace(/"/g, '""') + '"').join(";")).join("\r\n");
  const dados = relatorio.importarCSV(preenchido);
  assert.equal(dados.resultados.length, 2);
  assert.equal(dados.cobertura.listados, 10);
  assert.equal(dados.falhas.length, 1);
});

test("relatório agrupa pedidos por documento SES e mostra a fonte original antes dos caminhos", () => {
  const rows = resultados();
  Object.assign(rows[0], { documentoSES:"OFÍCIO Nº 87129/2025/SES", documentoId:"ses1", fonteVerificada:true, paginaConfirmada:true,
    trecho:"Apresentar a nota fiscal 782.", contextoSES:"Pedido da área: Apresentar a nota fiscal 782. Referência dezembro de 2024.", contextoMetodo:"trecho_validado" });
  Object.assign(rows[1], { documentoSES:"RELATÓRIO Nº 1 / 2025 SES/CAC-09363", documentoId:"ses2", contextoSES:"Justificar o saldo negativo da unidade.", contextoMetodo:"pagina_selecionada", paginaConfirmada:true, local:"Página 30" });
  const dados = relatorio.importarCSV(csvAtual(rows));
  const doc = new JSDOM(relatorio.gerarHTML(dados)).window.document;
  assert.deepEqual([...doc.querySelectorAll(".ses-document-head h1")].map(e=>e.textContent), [rows[0].documentoSES, rows[1].documentoSES]);
  assert.equal(doc.querySelector(".quote-ses mark").textContent, rows[0].trecho);
  assert.match(doc.querySelectorAll(".quote-ses")[1].textContent,/Justificar o saldo negativo/);
  assert.equal(doc.querySelector(".request").querySelectorAll(".ses-source,.candidate")[0].className,"ses-source");
  for(const removido of ["Como usar este relatório","Pedidos da SES e caminhos dos documentos","CSV de origem","Relatório criado","Busca com cobertura parcial","Trecho localizado · IA não executada","Observação da conferência"])
    assert.ok(!doc.body.textContent.includes(removido), removido);
});

test("novos CSVs preservam citações com quebras e sinais; CSV antigo não inventa contexto", () => {
  const rows = resultados();
  Object.assign(rows[0], { documentoSES:"OFÍCIO Nº 87129/2025/SES", documentoId:"ses1", trecho:"- Apresentar a documentação\nna competência correta.",
    contextoSES:"Antes do pedido.\n- Apresentar a documentação\nna competência correta.\nDepois do pedido.", fonteVerificada:true, paginaConfirmada:true, contextoMetodo:"trecho_validado" });
  const csv = csvAtual(rows), fonte = relatorio.importarCSV(csv).resultados[0];
  assert.equal(fonte.trecho, rows[0].trecho); assert.equal(fonte.contextoSES, rows[0].contextoSES);
  assert.equal(fonte.fonteVerificada,true);
  const antigo = relatorio.tabelaCSV(csv).map(row=>row.slice(0,14).map(s=>'"'+s.replace(/"/g,'""')+'"').join(";")).join("\r\n");
  const recuperado = relatorio.importarCSV(antigo).resultados[0];
  assert.equal(recuperado.contextoSES,""); assert.equal(recuperado.fonteVerificada,false);
  assert.match(relatorio.fonteHTML(recuperado),/não consta neste resultado/);
});
