const assert = require("node:assert/strict");
const { test } = require("node:test");
const conf = require("../public/conferencia-documental.js");

test("identifica apontamento e caminho provável sem afirmar comprovação", () => {
  const ses = conf.apontamentos("Apresentar extrato bancário referente ao mês de setembro de 2026", "SPAIS.pdf");
  assert.equal(ses.length, 1);
  const docs = [
    { nome: "extrato_bancario_setembro_2026.pdf", caminho: "Entidade/Financeiro/extrato_bancario_setembro_2026.pdf", partes: [] },
    { nome: "contrato.pdf", caminho: "Entidade/Contratos/contrato.pdf", partes: [] }
  ];
  const resultado = conf.cruzar(ses, docs, false)[0];
  assert.match(resultado.situacao, /Possível correspondência/);
  assert.equal(resultado.candidatos[0].caminho, docs[0].caminho);
});
test("ausência de evidência em leitura parcial não produz certeza", () => {
  const a = [{origem:"SGI",texto:"Comprovar recolhimento bancário do FGTS de setembro de 2026"}];
  assert.match(conf.cruzar(a, [], true)[0].situacao, /Não confirmado/);
});
test("resultado exportado neutraliza fórmulas de planilha", () => {
  const a=[{origem:"=SOMA(A1)",texto:"Comprovar depósitos do exercício",situacao:"Não confirmado",candidatos:[]}];
  assert.match(conf.csv(a), /"'=SOMA\(A1\)"/);
});

test("text limits explicitly report evidence excluded from coverage", async () => {
  const result = await conf.ler({ name: "ficticio.txt", size: 200031, text: async () => "a".repeat(200000) + " FGTS evidência no final" });
  assert.equal(result.partes[0].texto.length, 200000);
  assert.match(result.aviso, /parcialmente.*200.000/);
});

test("PDF and Excel limits expose every cut and PDF disables evaluation", async () => {
  const { readFileSync } = require("node:fs");
  const vm = require("node:vm");
  const window = { pdfjsLib: { getDocument: (options) => {
    assert.equal(options.isEvalSupported, false);
    return { promise: Promise.resolve({ numPages: 1, destroy() {}, getPage: async () => ({
      getTextContent: async () => ({ items: [{ str: "x".repeat(20001) + "FGTS" }] }),
    }) }) };
  } }, XLSX: { read: () => ({ SheetNames: ["Teste"], Sheets: { Teste: {} } }),
    utils: { sheet_to_csv: () => "x".repeat(40001) + "FGTS" } } };
  vm.runInNewContext(readFileSync(require.resolve("../public/conferencia-documental.js"), "utf8"), { window, Uint8Array, setTimeout });
  const file = (name) => ({ name, size: 1, arrayBuffer: async () => new ArrayBuffer(1) });
  assert.match((await window.GemodConferencia.ler(file("ficticio.pdf"))).aviso, /Página 1.*cortado/);
  assert.match((await window.GemodConferencia.ler(file("ficticio.xlsx"))).aviso, /Aba Teste.*40.000/);
});

test("streamed folder indexing reads pages beyond 80 and flags image-only pages without paid OCR", async()=>{
  const { readFileSync }=require("node:fs");const vm=require("node:vm");
  const pages=[];let destroyed=false;
  const window={pdfjsLib:{getDocument:()=>({promise:Promise.resolve({numPages:82,destroy(){destroyed=true;},getPage:async number=>({
    getTextContent:async()=>({items:number===5?[]:[{str:number===82?"Evidência FGTS no final":"Texto administrativo ".repeat(150)}]}),cleanup(){},
  })})})}};
  vm.runInNewContext(readFileSync(require.resolve("../public/conferencia-documental.js"),"utf8"),{window,Uint8Array,setTimeout});
  const result=await window.GemodConferencia.ler({name:"longo.pdf",size:100,arrayBuffer:async()=>new ArrayBuffer(1)},undefined,{indiceCompleto:true,onParte:async part=>pages.push(part)});
  assert.equal(pages.length,81);
  assert.equal(result.partes.length,0,"streaming does not retain all document pages");
  assert.match(pages[80].texto,/FGTS/);assert.equal(pages[80].local,"Página 82");
  assert.match(result.aviso,/1 página.*OCR/);
  assert.equal(destroyed,true);
});

test("interrupting folder enumeration does not turn an unfinished listing into a completed index", async()=>{
  const controller=new AbortController();
  const root={name:"Entidade",async *values(){
    yield {kind:"file",name:"primeiro.pdf"};controller.abort();yield {kind:"file",name:"segundo.pdf"};
  }};
  await assert.rejects(conf.indexar(root,controller.signal),{name:"AbortError"});
});
