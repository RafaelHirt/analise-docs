const {test}=require("node:test");
const assert=require("node:assert/strict");
const D=require("../public/leitura-diagnostico.js");
const Inventario=require("../public/analisar-pasta.js");
const Documentos=require("../public/conferencia-documental.js");

test("directory diagnostics retain the browser code and message instead of guessing a cause from file count",async()=>{
  const pasta={name:"Bloqueada",kind:"directory",async *values(){throw Object.assign(new Error("Read permission denied by browser"),{name:"NotAllowedError"});}};
  const raiz={name:"Entidade",async *values(){yield pasta;}};
  const inv=await Inventario.analisar(raiz),indice=await Documentos.indexar(raiz);
  const e=inv.erros[0];assert.equal(e.caminho,"Entidade/Bloqueada");assert.equal(e.codigo,"NotAllowedError");assert.equal(e.mensagem,"Read permission denied by browser");
  assert.match(e.orientacao,/permita a leitura/);assert.equal(inv.totais.vazias,0);
  assert.deepEqual(indice.falhasPastas,[e]);assert.deepEqual(indice.erros,[e.caminho]);
  assert.match(Inventario.relatorioTexto(inv),/NotAllowedError.*\r\nMensagem original: Read permission/s);
  assert.match(Inventario.relatorioCSV(inv),/"Código do erro"/);
});

test("unknown errors explicitly remain inconclusive and PDF failures are distinguished from enumeration",()=>{
  const desconhecido=D.diagnosticar(new TypeError("Provider returned an unexpected entry"),"Entidade/Rede");
  assert.equal(desconhecido.codigo,"TypeError");assert.match(desconhecido.motivo,/não forneceu uma causa específica/);
  assert.match(desconhecido.orientacao,/Não é possível concluir/);
  const pdf=D.diagnosticar({name:"InvalidPDFException",message:"Invalid PDF structure"},"Entidade/Rede/A.pdf","ler conteúdo do arquivo");
  assert.equal(pdf.etapa,"ler conteúdo do arquivo");assert.match(pdf.motivo,/estrutura do PDF/);
  assert.equal(pdf.mensagem,"Invalid PDF structure");
});
