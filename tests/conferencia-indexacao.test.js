const {test}=require("node:test");
const assert=require("node:assert/strict");
const busca=require("../public/conferencia-indexacao.js");
function file(nome,conteudo,aviso="") {
  return {nome,caminho:"Entidade/"+nome,handle:{getFile:async()=>({name:nome,content:conteudo,aviso})}};
}
const apontamentos=[{descricao:"Apresentar comprovante de FGTS referente a 2026",providencia:"Comprovar recolhimento de FGTS",referencia:"FGTS 2026",termosBusca:["FGTS","comprovante"]}];
const API={
  termos:s=>[...new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g)||[])],
  indexar:async()=>({docs:[],erros:[],limite:false}),
  ler:async f=>({partes:f.content?[{local:"Página 1",texto:f.content}]:[],aviso:f.aviso})
};
const corresponder=(item,d)=>{
  if(!d.partes.some(p=>p.texto.includes("FGTS")))return null;
  return {nome:d.nome,caminho:d.caminho,pontos:20,local:"Página 1",trecho:d.partes[0].texto.slice(0,100),achados:["FGTS"]};
};
test("varredura local busca também arquivo sem palavra-chave no nome",async()=>{
  const docs=[file("x1.pdf","Laudo administrativo diverso"),file("aleatorio.pdf","Comprovante de FGTS 2026, pagamento integral.")];
  const r=await busca.pesquisar({name:"Entidade"},apontamentos,{...API,indexar:async()=>({docs,erros:[],limite:false})},{corresponder});
  assert.equal(r.cobertura.comTexto,2);
  assert.equal(r.candidatos[0][0].caminho,"Entidade/aleatorio.pdf");
  assert.equal(r.cobertura.completo,true);
  assert.equal(r.cobertura.verificacaoParcial,false);
});
test("erros, arquivos sem texto e formatos não suportados nunca geram cobertura integral",async()=>{
  const docs=[file("a.pdf",""),file("b.zip","zip"),file("c.pdf","FGTS 2026","PDF pesquisado parcialmente")];
  const r=await busca.pesquisar({name:"Entidade"},apontamentos,{...API,indexar:async()=>({docs,erros:["Pasta proibida"],limite:false})},{corresponder});
  assert.equal(r.cobertura.semTexto,1);
  assert.equal(r.cobertura.naoSuportados,1);
  assert.equal(r.cobertura.pastasFalhas,1);
  assert.equal(r.cobertura.verificacaoParcial,true);
});
test("interrupção preserva cursor e não repete os documentos já lidos",async()=>{
  const docs=[file("1.pdf","FGTS 2026"),file("2.pdf","FGTS 2026"),file("3.pdf","FGTS 2026")];
  let estado,leituras=0;
  const ac=new AbortController();
  const reader={...API,indexar:async()=>({docs,erros:[],limite:false}),ler:async file=>{
    leituras++;if(leituras===1)ac.abort();
    return {partes:[{local:"Página 1",texto:file.content}],aviso:""};
  }};
  await assert.rejects(()=>busca.pesquisar({name:"Entidade"},apontamentos,reader,{signal:ac.signal,corresponder,onState:s=>estado=s}),{name:"AbortError"});
  assert.equal(estado.cursor,0); // arquivo interrompido é refeito
  const r=await busca.pesquisar({name:"Entidade"},apontamentos,reader,{estado,corresponder});
  assert.equal(r.cobertura.lidos,3);
  assert.equal(r.candidatos[0].length,3);
});

test("sigla técnica isolada pode localizar evidência por conteúdo",async()=>{
  const docs=[file("processo.pdf","Guia de pagamento do FGTS referente à competência indicada.")];
  const API2={...API,indexar:async()=>({docs,erros:[],limite:false})};
  const r=await busca.pesquisar({name:"Entidade"},[
    {descricao:"Necessário comprovante específico",providencia:"Documento de recolhimento",referencia:"",termosBusca:["FGTS"]}
  ],API2,{corresponder});
  assert.equal(r.candidatos[0].length,1);
});
