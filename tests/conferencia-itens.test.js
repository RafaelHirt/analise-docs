const {test}=require("node:test");
const assert=require("node:assert/strict");
const Itens=require("../public/conferencia-itens.js");
const IA=require("../netlify/lib/analise-ia.js");
const paginas=[{local:"Página 1",texto:"OFÍCIO Nº 1/2025/SES\n1 Trata-se da prestação de contas.\n2 A entidade não saneou os apontamentos, conforme assinalado abaixo:\n2.1 Item 110011 ND 0011/2024 - LIMPEZA E ESTERILIZAÇÃO: faltam notas fiscais. O valor já comprovado é de R$ 18.000,00."},
  {local:"Página 2",texto:"Impressão do processo · 2/4\nO total da nota de débito é R$ 49.000,00. Apresentar as notas fiscais faltantes ou ressarcir a diferença e apresentar nova tabela.\n2.2 Item 220022 (12/24) - FORNECEDOR B: a nota de débito é R$ 51.000,00 e as notas somam R$ 39.000,00. Apresentar as notas fiscais faltantes ou ressarcir a diferença e apresentar nova tabela.\n2.3 Item 330033 (12/24) - FORNECEDOR C: apresentou apenas nota de débito de R$ 55.000,00. Apresentar todas as notas fiscais ou ressarcir o valor integral.\n3 Fundamentos da decisão.\n5 Notifica-se a entidade a sanear definitivamente em 03 dias consecutivos; não será aceita nota de débito como comprovação."}];

test("a numbered introduction never replaces its detailed requirements, including a demand crossing pages",()=>{
  const itens=Itens.detectar(paginas);
  assert.deepEqual(itens.map(i=>i.numero),["2.1","2.2","2.3"]);
  assert.equal(itens[0].local,"Página 1 a Página 2");
  assert.match(Itens.original(itens[0],"SES.pdf").providencia,/nova tabela/);
  assert.doesNotMatch(Itens.original(itens[0],"SES.pdf").descricao,/FORNECEDOR B/);
  assert.equal(itens[2].local,"Página 2");assert.doesNotMatch(Itens.original(itens[2],"SES.pdf").contextoSES,/Fundamentos/);
});

test("a generic AI summary leaves three original, individually traceable requests without another provider call",()=>{
  const entrada=IA.validarEntrada("extrair",{nome:"SES.pdf",autorizado:true,paginas});
  assert.deepEqual(entrada.itensNumerados.map(i=>i.item),["2.1","2.2","2.3"]);
  const out=IA.sanitizarSaida("extrair",{itens:[{descricao:"A entidade não saneou os apontamentos",providencia:"Apresentar notas fiscais faltantes",trecho:"A entidade não saneou os apontamentos, conforme assinalado abaixo:",local:"Página 1"}]},entrada);
  assert.deepEqual(out.itens.slice(0,3).map(i=>i.item),["2.1","2.2","2.3"]);
  assert.ok(out.itens.slice(0,3).every(i=>i.extracao==="texto_original"&&i.fonteVerificada&&i.selecionado));
  assert.match(out.itens[0].referencia,/110011/);assert.match(out.itens[1].referencia,/220022/);assert.match(out.itens[2].referencia,/330033/);
  assert.equal(out.itens[3].selecionado,false);assert.equal(out.itens[3].extracao,"sem_item");
  assert.ok(out.itens[0].contextoSES.includes("Apresentar as notas fiscais faltantes"));
});

test("literal citations associate the right item and repeated generic phrases cannot assign the wrong supplier",()=>{
  const entrada=IA.validarEntrada("extrair",{nome:"SES.pdf",autorizado:true,paginas});
  const out=IA.sanitizarSaida("extrair",{itens:[{item:"2.2",descricao:"Documentos do fornecedor B",providencia:"Complementar notas ou restituir e corrigir tabela",referencia:"220022",
    trecho:"Apresentar as notas fiscais faltantes ou ressarcir a diferença e apresentar nova tabela.",local:"Página 2"}]},entrada);
  assert.equal(out.itens[0].extracao,"texto_original");assert.equal(out.itens[1].extracao,"ia");
  assert.equal(out.itens[1].item,"2.2");assert.match(out.itens[1].contextoSES,/FORNECEDOR B/);
  assert.deepEqual(Itens.individualizar(out.itens,paginas,"SES.pdf").itens,out.itens,"whole-document continuity validation is idempotent");
  const semNumero=IA.sanitizarSaida("extrair",{itens:[{descricao:"Resumo genérico",providencia:"Apresentar notas",trecho:"Apresentar as notas fiscais faltantes ou ressarcir a diferença e apresentar nova tabela.",local:"Página 2"}]},entrada);
  assert.ok(semNumero.itens.slice(0,3).every(i=>i.extracao==="texto_original"));
});

test("nested headings, money and unnumbered prose do not create invented demands",()=>{
  assert.deepEqual(Itens.detectar([{local:"Página 1",texto:"Valor R$ 31.076,98. Apresentar notas fiscais."}]),[]);
  const nested=Itens.detectar([{local:"Página 1",texto:"4.2 Apresentar os itens abaixo:\n4.2.1 Apresentar o relatório mensal.\n4.2.2 Justificar divergências na folha.\n5 Conclusão."}]);
  assert.deepEqual(nested.map(i=>i.numero),["4.2.1","4.2.2"]);
  assert.deepEqual(Itens.detectar([{local:"Página 1",texto:"2.1 Sem pedido concreto.\n2.2 Apenas histórico e contextualização."}]),[]);
});
