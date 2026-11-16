const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {randomUUID}=require("node:crypto");
const {JSDOM}=require("jsdom");
const Snapshot=require("../public/analise-snapshot.js");
const proxima=()=>new Promise(resolve=>setImmediate(resolve));

test("analysis snapshots preserve literal sources and evidence but exclude files, handles and credentials",()=>{
  const fonte={id:"p1",documentoSES:"OFÍCIO Nº 87129/2025/SES",descricao:"Pedido fiscal",providencia:"Comprovar despesa",
    trecho:"Original\ncom quebras e ‘acentos’",contextoSES:"Contexto\nexato",fonteVerificada:true,local:"Página 3"};
  const input={versao:1,pastaNome:"Entidade",achados:[fonte],resultados:[{...fonte,situacao:"insuficiente",avaliacaoConcluida:true,avaliacaoModelo:"modelo",
    candidatos:[{nome:"NF.pdf",caminho:"Entidade/Financeiro/NF.pdf",local:"Página 2",trecho:"Citação\nexata",hash:"a".repeat(64),inicio:5,fim:25,
      handle:{file:"privado"},file:{bytes:"privados"},textoIntegral:"nunca"}]}],indiceLocal:{termos:"privados"},apiKey:"nunca"};
  const out=Snapshot.normalizar(input);
  assert.equal(out.achados[0].trecho,fonte.trecho);assert.equal(out.resultados[0].contextoSES,fonte.contextoSES);
  assert.equal(out.resultados[0].candidatos[0].hash,"a".repeat(64));
  assert.doesNotMatch(JSON.stringify(out),/privado|nunca|handle|apiKey|textoIntegral|indiceLocal/);
  assert.equal(Snapshot.etapa(out),"confronto");
  assert.deepEqual(Snapshot.normalizar(out),out,"serialized snapshots have a stable canonical form");
});

test("snapshots preserve pending interpretation without retaining completed page bodies",()=>{
  const out=Snapshot.normalizar({versao:1,proximoBloco:1,blocosSES:[{nome:"Ofício",paginas:[{texto:"Concluído"}]},
    {nome:"Relatório",paginas:[{local:"Página 20",texto:"Texto pendente\noriginal"}]}]});
  assert.equal(out.blocosSES[0].paginas,undefined);assert.equal(out.blocosSES[0].concluido,true);
  assert.equal(out.blocosSES[1].paginas[0].texto,"Texto pendente\noriginal");assert.equal(Snapshot.etapa(out),"interpretacao_parcial");
  for(const v of [{versao:2},{versao:1,proximoBloco:1},{versao:1,achados:Array(61).fill({})},
    {versao:1,blocosSES:[{paginas:[{texto:"x".repeat(10001)}]}]},
    {versao:1,resultados:[{situacao:"inventada"}]}])assert.throws(()=>Snapshot.normalizar(v));
});

function tela(fetch) {
  const dom=new JSDOM('<main><section class="gemod-flow-hero"></section><input id="externo"></main>',{url:"http://localhost",runScripts:"outside-only"});
  const w=dom.window;w.fetch=fetch;w.crypto.randomUUID=randomUUID;w.GemodAnaliseSnapshot=Snapshot;
  w.confirm=()=>true;
  w.eval(readFileSync(require.resolve("../public/analises-salvas.js"),"utf8"));
  let estado=Snapshot.normalizar({versao:1,pastaNome:"Entidade",achados:[{descricao:"Pedido a preservar"}]}),restauracoes=0;
  const controller=w.GemodAnalisesSalvas.montar(w.document.querySelector("main"),{
    capturar:()=>estado,restaurar:s=>{estado=s;restauracoes++;},atualizar(){},ocupado:()=>false,precisaPasta:()=>false,vincular(){},nova(){}
  });
  return {w,controller,get estado(){return estado;},get restauracoes(){return restauracoes;},el:s=>w.document.querySelector(s),close(){controller.sair();w.close();}};
}
const response=(payload,status=200,etag="v1")=>({ok:status<400,status,json:async()=>payload,headers:new Headers({"x-record-version":etag})});

test("saving confirms only after the server responds, blocks duplicate clicks and sends versioned updates",async()=>{
  let resolver;const writes=[];
  const t=tela(async(url,options)=>{
    if(options.method==="GET")return response([]);
    writes.push({url,...options});return new Promise(resolve=>{resolver=resolve;});
  });
  try{
    await proxima();t.el("[data-nome-analise]").value="Fiscal SES";const save=t.el("[data-salvar-analise]");
    save.click();save.click();assert.equal(writes.length,1);assert.equal(save.disabled,true);
    assert.match(t.el("[data-analise-status]").textContent,/Salvando análise/);
    assert.equal(t.controller.temAlteracoes(),true);
    const body=JSON.parse(writes[0].body);assert.match(body.id,/^[a-f0-9-]{36}$/);assert.equal(body.estado.pastaNome,"Entidade");
    resolver(response({id:body.id,atualizadoEm:new Date().toISOString()}));await proxima();await proxima();
    assert.match(t.el("[data-analise-status]").textContent,/^Salvo em/);assert.equal(t.controller.temAlteracoes(),false);
    t.estado.achados[0].descricao="Pedido editado";save.click();
    assert.equal(writes[1].method,"PUT");assert.equal(writes[1].headers["If-Match"],"v1");
    resolver(response({erro:"Esta análise mudou em outra aba."},409));await proxima();
    assert.match(t.el("[data-analise-status]").textContent,/outra aba.*Seu trabalho continua/);
    assert.equal(t.estado.achados[0].descricao,"Pedido editado");assert.equal(save.disabled,false);assert.equal(t.controller.temAlteracoes(),true);
  }finally{t.close();}
});

test("failed saves preserve work and retry the same creation id instead of duplicating the analysis",async()=>{
  const writes=[];const t=tela(async(url,o)=>{if(o.method==="GET")return response([]);writes.push(JSON.parse(o.body));throw new Error("Sem conexão");});
  try{
    await proxima();t.el("[data-nome-analise]").value="Análise offline";
    t.el("[data-salvar-analise]").click();await proxima();
    assert.match(t.el("[data-analise-status]").textContent,/Sem conexão.*Seu trabalho continua/);
    t.el("[data-salvar-analise]").click();await proxima();assert.equal(writes[0].id,writes[1].id);
    assert.equal(t.estado.achados[0].descricao,"Pedido a preservar");
    t.w.confirm=()=>false;assert.equal(t.controller.podeSair(),false);
  }finally{t.close();}
});

test("invalid edited content can still be submitted for an explicit error and keeps the unsaved-work guard",async()=>{
  const t=tela(async()=>response([]));
  try{
    await proxima();t.el("[data-nome-analise]").value="Análise longa";
    t.estado.achados[0].descricao="x".repeat(4001);
    t.controller.atualizar();assert.equal(t.el("[data-salvar-analise]").disabled,false);
    t.el("[data-salvar-analise]").click();await proxima();assert.match(t.el("[data-analise-status]").textContent,/limite/);
    assert.equal(t.controller.temAlteracoes(),true);assert.equal(t.estado.achados[0].descricao.length,4001);
  }finally{t.close();}
});

test("reopening restores saved state without a generation request and disposes navigation guards on exit",async()=>{
  const calls=[],id=randomUUID(),estado=Snapshot.normalizar({versao:1,pastaNome:"Pasta salva",achados:[{descricao:"Pedido recuperado"}]});
  const t=tela(async(url,o)=>{calls.push([url,o.method]);return response(url.endsWith("/"+id)?{id,nome:"<img src=x onerror=alert(1)>",estado,atualizadoEm:new Date().toISOString()}:
    [{id,nome:"<img src=x onerror=alert(1)>",pedidos:1,trechos:0,atualizadoEm:new Date().toISOString()}]);});
  try{
    await proxima();assert.equal(t.el(".gemod-saved-row img"),null);
    t.el("[data-abrir-analise]").click();await proxima();
    assert.equal(t.restauracoes,1);assert.equal(t.estado.pastaNome,"Pasta salva");assert.equal(t.controller.temAlteracoes(),false);
    assert.deepEqual(calls,[["/api/analises","GET"],["/api/analises/"+id,"GET"]]);
    t.estado.achados[0].descricao="Modificado";
    const before=new t.w.Event("beforeunload",{cancelable:true});t.w.dispatchEvent(before);assert.equal(before.defaultPrevented,true);
    t.controller.sair();const after=new t.w.Event("beforeunload",{cancelable:true});t.w.dispatchEvent(after);assert.equal(after.defaultPrevented,false);
  }finally{t.close();}
});
