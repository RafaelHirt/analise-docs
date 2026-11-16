const assert = require("node:assert/strict");
const { test } = require("node:test");
const Fontes = require("../public/conferencia-fontes.js");
const IA = require("../netlify/lib/analise-ia.js");

test("identifica os documentos pelo cabeçalho e usa o nome do arquivo quando não houver número",()=>{
  assert.equal(Fontes.identificarDocumento("Ofício.pdf",[{texto:"Secretaria da Saúde\nOFÍCIO Nº 87129/2025/SES\nAssunto: prestação de contas"}]),"OFÍCIO Nº 87129/2025/SES");
  assert.equal(Fontes.identificarDocumento("RAFIC.pdf",[{texto:"RELATÓRIO Nº 1 / 2025 SES/CAC-09363\nAnálise técnica"}]),"RELATÓRIO Nº 1 / 2025 SES/CAC-09363");
  assert.equal(Fontes.identificarDocumento("Nome original.pdf",[{texto:"Documento sem identificação oficial"}]),"Nome original.pdf");
});
test("citação localiza a página real, preserva o texto original e inclui o contexto",()=>{
  const paginas=[{local:"Página 1",texto:"Capa do documento"},{local:"Página 4",texto:"📄 Contexto anterior.\nAPRESENTAR   a documentação comprobatória de dezembro.\nContexto posterior."}];
  const fonte=Fontes.verificarFonte(paginas,"apresentar a documentacao comprobatoria de dezembro.","Página 99");
  assert.equal(fonte.fonteVerificada,true);assert.equal(fonte.local,"Página 4");
  assert.equal(fonte.trecho,"APRESENTAR   a documentação comprobatória de dezembro.");
  assert.match(fonte.contextoSES,/Contexto anterior/);assert.match(fonte.contextoSES,/Contexto posterior/);
});
test("citação inexistente ou ambígua não recebe página nem contexto inventados",()=>{
  const paginas=[{local:"Página 1",texto:"Apresentar os documentos comprobatórios."},{local:"Página 2",texto:"Apresentar os documentos comprobatórios."}];
  for(const [trecho,local] of [["Apresentar os documentos comprobatórios.","Página 99"],["Restituir R$ 999.999,00.","Página 1"]]){
    const fonte=Fontes.verificarFonte(paginas,trecho,local);
    assert.equal(fonte.fonteVerificada,false);assert.equal(fonte.trecho,"");assert.equal(fonte.contextoSES,"");
  }
  assert.equal(Fontes.verificarFonte(paginas,"Apresentar os documentos comprobatórios.","Página 2").local,"Página 2");
});
test("sanitização devolve somente citações verificadas com sua página e seu contexto",()=>{
  const entrada=IA.validarEntrada("extrair",{autorizado:true,nome:"SES.pdf",paginas:[{local:"Página 3 (trecho 1)",texto:"Área técnica. Apresentar notas fiscais do mês de dezembro. Competência 12/2024."}]});
  const resposta=IA.sanitizarSaida("extrair",{itens:[{descricao:"Notas ausentes",providencia:"Apresentar notas fiscais",local:"Página 3",trecho:"Apresentar notas fiscais do mês de dezembro."}]},entrada).itens[0];
  assert.equal(resposta.local,"Página 3 (trecho 1)");assert.equal(resposta.fonteVerificada,true);assert.equal(resposta.paginaConfirmada,true);
  assert.match(resposta.contextoSES,/Competência 12\/2024/);
});
test("página escolhida para CSV antigo fornece contexto sem afirmar citação automática",()=>{
  const pagina={local:"Página 30",texto:"RELATÓRIO Nº 1 / 2025 SES/CAC-09363\nJustificar o saldo negativo."};
  const documento={id:"fonte1",nome:"RAFIC.pdf",titulo:"RELATÓRIO Nº 1 / 2025 SES/CAC-09363",paginas:[pagina]};
  const row={descricao:"Saldo negativo",trecho:"",candidatos:[{caminho:"Entidade/Justificativa.pdf"}]};
  const atualizado=Fontes.aplicarPagina(row,documento,pagina);
  assert.equal(atualizado.contextoSES,pagina.texto);assert.equal(atualizado.fonteVerificada,false);assert.equal(atualizado.paginaConfirmada,true);
  assert.equal(atualizado.contextoMetodo,"pagina_selecionada");assert.equal(atualizado.candidatos,row.candidatos);
  assert.equal(row.contextoSES,undefined);assert.throws(()=>Fontes.aplicarPagina(row,documento,{local:"Página 90",texto:"Outra fonte"}),/não pertence/);
});
