const assert=require("node:assert/strict");
const {test}=require("node:test");
const {readFileSync}=require("node:fs");
const {JSDOM}=require("jsdom");
const IA=require("../netlify/lib/analise-ia.js");
const conf=require("../public/conferencia-documental.js");

test("recusa interpretação sem autorização explícita",()=>{
  assert.throws(()=>IA.validarEntrada("extrair",{nome:"SPAIS",paginas:[{local:"P1",texto:"Apresentar notas fiscais"}]}),/autorização explícita/);
});

test("formata o apontamento técnico com problema, exigência e fonte",()=>{
  const entrada=IA.validarEntrada("extrair",{autorizado:true,nome:"Ofício SES.pdf",paginas:[{local:"Página 4",texto:"Documento 2225479. Apresentar notas fiscais referentes à nota de débito de R$ 55.451,79."}]});
  const saida=IA.sanitizarSaida("extrair",{itens:[{tipo:"irregularidade",descricao:"Ausência das notas fiscais da nota de débito",providencia:"Apresentar notas fiscais que compõem o valor de R$ 55.451,79",referencia:"2225479 — 12/2024",trecho:"não tendo sido anexadas as notas fiscais",local:"Página 4",termosBusca:["nota fiscal","nota de débito","2225479"]}]},entrada);
  assert.equal(saida.itens.length,1);
  assert.match(saida.itens[0].providencia,/55.451,79/);
  assert.equal(saida.itens[0].local,"Página 4");
});

test("não permite concluir atendimento sem trecho verificável",()=>{
  const entrada=IA.validarEntrada("avaliar",{autorizado:true,itens:[{id:"p1",descricao:"Ausência da nota fiscal",providencia:"Apresentar NF",referencia:"",candidatos:[{id:"c1",caminho:"Notas.pdf",local:"Nome do arquivo",trecho:""}]}]});
  const saida=IA.sanitizarSaida("avaliar",{itens:[{id:"p1",situacao:"evidencia_compativel",candidatoId:"c1",justificativa:"Arquivo achado",pendencias:[]}]},entrada);
  assert.equal(saida.itens[0].situacao,"nao_verificavel");
});

test("usa formato estruturado e não pede armazenamento ao provedor",async()=>{
  const oldKey=process.env.GEMOD_OPENAI_API_KEY,oldOn=process.env.GEMOD_AI_ENABLED;
  process.env.GEMOD_OPENAI_API_KEY="fake-test-key";process.env.GEMOD_AI_ENABLED="true";
  try {
    let payload;
    await IA.chamar("extrair",{nome:"SES",paginas:[{local:"P1",texto:"Apresentar comprovantes"}]},async(_,options)=>{
      payload=JSON.parse(options.body);
      assert.equal(options.headers.Authorization,"Bearer fake-test-key");
      return {ok:true,json:async()=>({output:[{content:[{type:"output_text",text:'{"itens":[]}'}]}]})};
    });
    assert.equal(payload.store,false);
    assert.equal(payload.text.format.strict,true);
    assert.equal(payload.text.format.type,"json_schema");
  } finally {
    if(oldKey===undefined)delete process.env.GEMOD_OPENAI_API_KEY;else process.env.GEMOD_OPENAI_API_KEY=oldKey;
    if(oldOn===undefined)delete process.env.GEMOD_AI_ENABLED;else process.env.GEMOD_AI_ENABLED=oldOn;
  }
});

test("seleção recupera arquivo por assunto e documento contém página",()=>{
  const {window}=new JSDOM("<div></div>",{url:"https://gemod.example",runScripts:"outside-only"});
  window.eval(readFileSync(require.resolve("../public/conferencia-ia.js"),"utf8"));
  const finder=window.GemodAnaliseIA;
  const docs=[{nome:"nota_fiscal.pdf",caminho:"Entidade/Contas/nota_fiscal.pdf",partes:[{local:"Página 4",texto:"Nota fiscal de dezembro de 2024, no valor de R$ 55.451,79"}]}];
  const item={descricao:"Ausência de notas fiscais",providencia:"Apresentar notas fiscais de dezembro de 2024 referentes à nota de débito",referencia:"R$ 55.451,79",termosBusca:["nota fiscal","notas fiscais"]};
  assert.equal(finder.preselecionar(docs,[item],conf).length,1);
  assert.equal(finder.candidatosDoItem(item,docs,conf)[0].local,"Página 4");
  const fatias=finder.partesParaIA("SES.pdf",[{local:"Página 1",texto:"A".repeat(190000)}]);
  assert.equal(fatias.parcial,true);
  window.close();
});

test("IA indisponível não autoriza início de envio",async t=>{
  const dom=new JSDOM("<div id='view'><section class='painel inventario-local'></section></div>",{url:"https://gemod.example",runScripts:"outside-only"});
  t.after(()=>dom.window.close());
  const w=dom.window;
  w.fetch=async()=>({ok:true,json:async()=>({disponivel:false,motivo:"IA não configurada."})});
  w.eval(readFileSync(require.resolve("../public/conferencia-ia.js"),"utf8"));
  w.eval(readFileSync(require.resolve("../public/conferencia-documental.js"),"utf8"));
  // HTML do inventário é criado normalmente pelo próprio módulo legado.
  w.GemodConferencia.montar(w.document.querySelector("#view"));
  await new Promise(r=>setImmediate(r));
  assert.ok(w.document.querySelector("#ia-consentimento"));
  assert.equal(w.document.querySelector("#ia-interpretar").disabled,true);
  assert.match(w.document.querySelector("#ia-disponibilidade").textContent,/não configurada/);
  w.GemodAnaliseIA.sair();
});

test("HTTP 429 de saldo vazio explica billing sem expor mensagem bruta",()=>{
  const e=IA.erroDoProvedor(429,{error:{code:"credit_balance_exhausted",message:"conteúdo sensível não deve aparecer"}},"");
  assert.equal(e.httpStatus,429);
  assert.match(e.message,/sem créditos disponíveis/);
  assert.doesNotMatch(e.message,/conteúdo sensível/);
});
test("HTTP 429 de limite de requisições respeita retry-after",()=>{
  const e=IA.erroDoProvedor(429,{error:{code:"rate_limit_exceeded"}},"15");
  assert.match(e.message,/limite temporário/);
  assert.match(e.message,/15 segundos/);
});
test("HTTP 429 de limite de projeto distingue saldo e gasto",()=>{
  const e=IA.erroDoProvedor(429,{error:{code:"project_spend_limit_exceeded"}},"");
  assert.match(e.message,/limite de gastos da API/);
  assert.doesNotMatch(e.message,/sem créditos disponíveis/);
});

test("provider diagnostics distinguish model_not_found from generic 403/404 without echoing raw errors",()=>{
  const notFound=IA.erroDoProvedor(404,{error:{code:"model_not_found",message:"sk-sensitive conteúdo privado"}},null,"gpt-5-mini","req_test123");
  assert.equal(notFound.publicCode,"MODELO_INDISPONIVEL_IA");
  assert.equal(notFound.modelo,"gpt-5-mini");assert.equal(notFound.codigoProvedor,"model_not_found");
  assert.equal(notFound.requestId,"req_test123");assert.match(notFound.message,/não foi encontrado ou não está disponível/);
  assert.doesNotMatch(notFound.message,/sk-sensitive|conteúdo privado/);
  const forbidden=IA.erroDoProvedor(403,null,null,"gpt-5-mini");
  assert.equal(forbidden.publicCode,"ACESSO_NEGADO_IA");assert.match(forbidden.message,/bloqueios de rede/);
  assert.doesNotMatch(forbidden.message,/modelo.*não foi encontrado/);
  assert.equal(IA.erroDoProvedor(404,null,null).publicCode,"RECURSO_NAO_ENCONTRADO_IA");
});

test("model metadata check uses no documents, generation endpoint or token payload",async()=>{
  const old={key:process.env.GEMOD_OPENAI_API_KEY,on:process.env.GEMOD_AI_ENABLED,model:process.env.GEMOD_AI_MODEL};
  process.env.GEMOD_OPENAI_API_KEY="fake-test-key";process.env.GEMOD_AI_ENABLED="true";process.env.GEMOD_AI_MODEL="  gpt-5-mini  ";
  try {
    const result=await IA.verificarModelo(async(url,options)=>{
      assert.equal(url,"https://api.openai.com/v1/models/gpt-5-mini");assert.equal(options.method,"GET");
      assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,"Bearer fake-test-key");
      return {ok:true,json:async()=>({id:"gpt-5-mini",object:"model",owned_by:"private-metadata-not-forwarded"})};
    });
    assert.equal(result.encontrado,true);assert.equal(result.geraTokens,false);
    assert.equal(result.owned_by,undefined);assert.match(result.mensagem,/não comprova saldo ou permissão/);
    await assert.rejects(IA.verificarModelo(async()=>({ok:false,status:403,headers:{get:()=>null},json:async()=>({error:{code:"insufficient_permissions"}})})),/chave restrita.*Responses/);
    process.env.GEMOD_AI_MODEL="sk-sensitive-model-misconfiguration";
    await assert.rejects(IA.verificarModelo(async()=>{throw new Error("must not send a secret-like model value in a URL");}),/GEMOD_AI_MODEL deve conter/);
    assert.equal(IA.modeloPublico(),"valor de GEMOD_AI_MODEL inválido");
  }finally{
    for(const [name,value]of[["GEMOD_OPENAI_API_KEY",old.key],["GEMOD_AI_ENABLED",old.on],["GEMOD_AI_MODEL",old.model]])
      if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});

test("model diagnostics preserve prepared SES blocks and discourage unchanged config retries",async t=>{
  const dom=new JSDOM("<div id='view'><section class='painel inventario-local'></section></div>",{url:"https://gemod.example",runScripts:"outside-only"});
  t.after(()=>dom.window.close());const w=dom.window,c=w.document.querySelector("#view");let posts=0,checks=0;
  w.fetch=async(url,options)=>{
    if(String(url).endsWith("/status"))return {ok:true,json:async()=>({disponivel:true,modelo:"gpt-5-mini"})};
    if(String(url).endsWith("/diagnostico")){checks++;assert.equal(options.method,"GET");assert.equal(options.body,undefined);
      return {ok:false,status:404,headers:{get:()=>null},json:async()=>({erro:"Modelo indisponível",modelo:"gpt-5-mini",httpProvedor:404,codigoProvedor:"model_not_found",codigo:"MODELO_INDISPONIVEL_IA"})};}
    posts++;return {ok:false,status:404,headers:{get:()=>null},json:async()=>({erro:"Modelo indisponível",modelo:"gpt-5-mini",httpProvedor:404,codigoProvedor:"model_not_found",codigo:"MODELO_INDISPONIVEL_IA"})};
  };
  w.eval(readFileSync(require.resolve("../public/conferencia-ia.js"),"utf8"));
  w.GemodAnaliseIA.montar(c,{ler:async()=>({partes:[{local:"Página 1",texto:"Apresentar comprovantes de recolhimento de FGTS."}],aviso:""})});
  w.GemodAnaliseIA.definirPasta({name:"Entidade"});
  Object.defineProperty(c.querySelector("#ia-ses"),"files",{value:[{name:"SES.pdf"}],configurable:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(c.querySelector("#ia-disponibilidade").textContent,/Modelo configurado: gpt-5-mini/);
  c.querySelector("#ia-interpretar").click();await new Promise(resolve=>setImmediate(resolve));
  c.querySelector("#ia-consentimento").checked=true;c.querySelector("#ia-consentimento").dispatchEvent(new w.Event("change"));
  c.querySelector("#ia-interpretar").click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posts,1);assert.match(c.querySelector("#ia-status").textContent,/model_not_found/);
  assert.match(c.querySelector("#ia-status").textContent,/corrija a configuração antes de retomar/);
  c.querySelector("#ia-diagnostico").click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(checks,1);assert.equal(posts,1);
  assert.match(c.querySelector("#ia-status").textContent,/Nenhum documento foi enviado/);
  assert.match(c.querySelector("#ia-interpretar").textContent,/1 consulta/);
});

test("interpretação da SES retoma após HTTP 429 sem repetir blocos já concluídos",async t=>{
  const dom=new JSDOM("<div id='view'><section class='painel inventario-local'></section></div>",{url:"https://gemod.example",runScripts:"outside-only"});
  t.after(()=>dom.window.close());
  const w=dom.window,container=w.document.querySelector("#view");
  const chamadas=[];
  let falhou=false;
  w.fetch=async (url,opts)=>{
    if(String(url).endsWith("/status"))return {ok:true,json:async()=>({disponivel:true})};
    const body=JSON.parse(opts.body);chamadas.push(body.nome);
    if(body.nome==="SES2.pdf"&&!falhou){
      falhou=true;
      return {ok:false,status:429,headers:{get:()=> "15"},json:async()=>({erro:"OpenAI: limite temporário; aguarde.",codigo:"LIMITE_TEMPORARIO_IA"})};
    }
    return {ok:true,json:async()=>({itens:[{id:"p1",origem:body.nome,local:"Página 1",descricao:"Exigência da "+body.nome,providencia:"Apresentar documento",referencia:"",trecho:"Apresentar documento",termosBusca:[]}]})};
  };
  w.eval(readFileSync(require.resolve("../public/conferencia-ia.js"),"utf8"));
  w.GemodAnaliseIA.montar(container,{ler:async()=>({partes:[{local:"Página 1",texto:"Apresentar documento para análise."}],aviso:""})});
  w.GemodAnaliseIA.definirPasta({name:"Entidade"});
  const input=container.querySelector("#ia-ses");
  Object.defineProperty(input,"files",{configurable:true,value:[{name:"SES1.pdf"},{name:"SES2.pdf"}]});
  const consent=container.querySelector("#ia-consentimento");consent.checked=true;consent.dispatchEvent(new w.Event("change"));
  await new Promise(resolve=>setTimeout(resolve,15));
  const btn=container.querySelector("#ia-interpretar");
  assert.equal(btn.disabled,false);
  btn.click();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(chamadas,[],"preflight reads locally and shows the budget before any API call");
  assert.match(btn.textContent,/2 consulta/);
  btn.click();
  await new Promise(resolve=>setTimeout(resolve,45));
  assert.deepEqual(chamadas,["SES1.pdf","SES2.pdf"]);
  assert.match(btn.textContent,/Retomar interpretação/);
  assert.match(container.querySelector("#ia-status").textContent,/Progresso preservado: 1\/2/);
  assert.equal(container.querySelector("#ia-buscar").disabled,true);
  assert.match(container.querySelector("#ia-buscar").textContent,/Concluir interpretação/);
  assert.match(container.querySelector("#ia-busca-status").textContent,/Interpretação incompleta: 1\/2/);
  assert.match(container.querySelector("#ia-busca-status").textContent,/limite temporário/);
  const retomar=container.querySelector("#ia-retomar-interpretacao");
  assert.equal(retomar.hidden,false);
  container.querySelector("[data-ia-desc]").value="Exigência revisada antes de retomar";
  retomar.click();
  await new Promise(resolve=>setTimeout(resolve,45));
  assert.deepEqual(chamadas,["SES1.pdf","SES2.pdf","SES2.pdf"]);
  assert.equal(container.querySelector("#ia-buscar").disabled,false);
  assert.equal(container.querySelectorAll("[data-ia-desc]").length,2);
  assert.equal(container.querySelector("[data-ia-desc]").value,"Exigência revisada antes de retomar");
  assert.equal(retomar.hidden,true);
  assert.match(container.querySelector("#ia-busca-status").textContent,/não consome créditos/);
});

test("interface apresenta etapas e deixa busca local disponível sem saldo de IA",async t=>{
  const dom=new JSDOM("<div id='view'><section class='painel inventario-local'></section></div>",{url:"https://gemod.example",runScripts:"outside-only"});
  t.after(()=>dom.window.close());const w=dom.window,c=w.document.querySelector("#view");
  w.fetch=async()=>({ok:true,json:async()=>({disponivel:false,motivo:"Sem créditos na API"})});
  w.eval(readFileSync(require.resolve("../public/conferencia-ia.js"),"utf8"));
  w.GemodAnaliseIA.montar(c,{});
  w.GemodAnaliseIA.definirPasta({name:"Entidade"});
  assert.ok(c.querySelector("#ia-manual-texto"));
  c.querySelector("#ia-manual-texto").value="Apresentar comprovante de recolhimento FGTS 2026";
  c.querySelector("#ia-usar-manual").click();
  assert.equal(c.querySelectorAll("[data-ia-desc]").length,1);
  assert.equal(c.querySelector("#ia-buscar").disabled,false);
  assert.equal(c.querySelector("#ia-avaliar").disabled,true);
});

test("manual search starts, interruption and resumption pass the actual signal and preserved state", async t => {
  const dom = new JSDOM("<div id='view'><section class='painel inventario-local'></section></div>", { url: "https://gemod.example", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window, c = w.document.querySelector("#view");
  w.fetch = async () => ({ ok: true, json: async () => ({ disponivel: false }) });
  let chamadas = 0;
  const estado = { cursor: 1 };
  w.GemodBuscaLocal = { pesquisar: async (raiz, items, api, options) => {
    chamadas++;
    assert.equal(typeof options.signal.aborted, "boolean");
    assert.equal(items.length, 1);
    if (chamadas === 1) {
      options.onState(estado);
      options.onIndex("Enumerando pastas locais");
      options.onProgress({listados:7000,processados:10,progresso:0,comTexto:8,semTexto:1,erros:1});
      await new Promise(resolve => options.signal.addEventListener("abort", resolve, { once: true }));
      throw Object.assign(new Error("Interrompida"), { name: "AbortError" });
    }
    assert.equal(options.estado, estado);
    return { candidatos: [[]], cobertura: { listados: 1, processados: 1, comTexto: 1, semTexto: 0, erros: 0 }, falhas: [], estado: { indice: { erros: [] } } };
  } };
  w.eval(readFileSync(require.resolve("../public/conferencia-ia.js"), "utf8"));
  w.GemodAnaliseIA.montar(c, {});
  w.GemodAnaliseIA.definirPasta({ name: "Fictícia" });
  c.querySelector("#ia-manual-texto").value = "Apresentar comprovante de recolhimento FGTS 2026";
  c.querySelector("#ia-usar-manual").click();
  c.querySelector("#ia-buscar").click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(chamadas, 1);
  assert.equal(c.querySelector("#ia-buscar").disabled,true);
  assert.match(c.querySelector("#ia-buscar").textContent,/Pesquisando na pasta/);
  assert.match(c.querySelector("#ia-busca-status").textContent,/10\/7\.000 arquivos/);
  assert.equal(c.querySelector("#ia-busca-progresso").hidden,false);
  assert.equal(c.querySelector("#ia-busca-progresso").value,10);
  assert.equal(c.querySelector("#ia-busca-progresso").max,7000);
  const parar = c.querySelector("#ia-interromper-busca");
  assert.ok(parar);
  assert.equal(parar.hidden,false);
  parar.click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(c.querySelector("#ia-busca-status").textContent,/Busca interrompida/);
  assert.equal(c.querySelector("#ia-busca-progresso").hidden,true);
  assert.equal(parar.hidden,true);
  assert.equal(c.querySelector("#ia-buscar").disabled,false);
  assert.match(c.querySelector("#ia-buscar").textContent,/Retomar busca local/);
  c.querySelector("#ia-buscar").click();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(chamadas, 2);
  assert.match(c.querySelector("#ia-busca-status").textContent,/Ver caminhos e trechos/);
  assert.match(c.querySelector("#ia-busca-status").textContent,/não consome créditos/);
  assert.equal(c.querySelector("#ia-busca-progresso").hidden,true);
  assert.doesNotMatch(c.querySelector("#ia-status").textContent, /signal is not defined/);
});

test("assessment validates complementary literal citations and rejects invented quotes and unknown IDs", () => {
  const entrada=IA.validarEntrada("avaliar",{autorizado:true,itens:[{id:"p1",descricao:"NF 782 e pagamento",providencia:"Conferir ambos",candidatos:[
    {id:"c0",caminho:"Notas/NF.pdf",local:"Página 2",trecho:"Nota fiscal 782 emitida para a entidade no valor de R$ 5.000,00."},
    {id:"c1",caminho:"Pagamentos/PIX.pdf",local:"Página 4",trecho:"Pagamento efetuado referente à NF 782. Valor pago R$ 5.000,00."},
  ]}]});
  const data={itens:[{id:"p1",situacao:"evidencia_compativel",candidatoId:"c0",candidatoIds:["c0","c1","inventado"],
    evidencias:[{candidatoId:"c0",trecho:"Nota fiscal 782 emitida para a entidade"},{candidatoId:"c1",trecho:"Pagamento efetuado referente à NF 782."}],justificativa:"Há vínculo explícito",pendencias:[]}]};
  const good=IA.sanitizarSaida("avaliar",data,entrada).itens[0];
  assert.equal(good.situacao,"evidencia_compativel");
  assert.deepEqual(good.candidatoIds,["c0","c1"]);
  assert.equal(good.evidencias.length,2);
  data.itens[0].evidencias[1].trecho="O pagamento foi efetuado em março de 2020, que não consta no original";
  const partial=IA.sanitizarSaida("avaliar",data,entrada).itens[0];
  assert.equal(partial.situacao,"insuficiente");
  assert.equal(partial.evidencias.length,1);
  data.itens[0].evidencias=[];
  assert.equal(IA.sanitizarSaida("avaliar",data,entrada).itens[0].situacao,"nao_verificavel");
});

test("assessment bounds the number of paid items and snippets", () => {
  const item={id:"1",descricao:"Teste",providencia:"Conferir",candidatos:[]};
  assert.throws(()=>IA.validarEntrada("avaliar",{autorizado:true,itens:Array(5).fill(item)}),/1 a 4/);
  assert.throws(()=>IA.validarEntrada("avaliar",{autorizado:true,itens:[{...item,candidatos:Array(7).fill({})}]}),/Até 6/);
});

test("manual contextual search is free and repeated selected assessments reuse completed results", async t=>{
  const dom=new JSDOM("<div id='view'><section class='painel inventario-local'></section></div>",{url:"https://gemod.example",runScripts:"outside-only"});
  t.after(()=>dom.window.close());
  const w=dom.window,c=w.document.querySelector("#view"),paid=[];
  w.fetch=async(url,options)=>{
    if(String(url).endsWith("/status"))return {ok:true,json:async()=>({disponivel:true,modelo:"test"})};
    const body=JSON.parse(options.body);paid.push(body);
    assert.ok(body.itens.every(item=>item.candidatos.every(candidate=>candidate.trecho.length<=1800)));
    return {ok:true,json:async()=>({itens:body.itens.map(item=>({id:item.id,situacao:"nao_verificavel",justificativa:"Conferir período",pendencias:["Falta comprovar a competência exigida"],evidencias:[]}))})};
  };
  let searches=0;
  w.GemodBuscaLocal={pesquisar:async(raiz,items,api,options)=>{
    searches++;
    if(searches>1)assert.ok(options.cache,"a new requirement reuses the same local index");
    return {candidatos:items.map(()=>[{nome:"NF.pdf",caminho:"Entidade/Notas/NF.pdf",local:"Página 3",trecho:"Nota fiscal 782 referente a setembro de 2026.",motivos:["Referência exata: nf:782"],alertas:[]}]),
      cobertura:{listados:7000,processados:7000,comTexto:7000,reaproveitados:searches>1?7000:0},falhas:[],estado:{indice:{erros:[]}},cache:{}};
  }};
  w.eval(readFileSync(require.resolve("../public/conferencia-ia.js"),"utf8"));
  w.GemodAnaliseIA.montar(c,{});w.GemodAnaliseIA.definirPasta({name:"Entidade"});
  await new Promise(resolve=>setImmediate(resolve));
  c.querySelector("#ia-manual-texto").value="Apresentar a nota fiscal 782 de setembro de 2026";
  c.querySelector("#ia-usar-manual").click();c.querySelector("#ia-buscar").click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(paid.length,0);
  assert.match(c.querySelector("#ia-tabela").textContent,/Entidade\/Notas\/NF.pdf/);
  assert.match(c.querySelector("#ia-custo").textContent,/0 pedido/);
  const consent=c.querySelector("#ia-consentimento");consent.checked=true;consent.dispatchEvent(new w.Event("change"));
  c.querySelector("#ia-selecionar-todos").click();
  assert.match(c.querySelector("#ia-custo").textContent,/1 pedido selecionado.*1 trecho.*1 nova consulta/);
  c.querySelector("#ia-avaliar").click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(paid.length,1);
  const painel=c.querySelector(".gemod-ai-assessment");
  assert.ok(painel);assert.equal(painel.closest("details"),null,"an inconclusive assessment is visible outside collapsed source text");
  assert.match(painel.textContent,/Não foi possível verificar.*Justificativa da IA.*Conferir período.*Falta comprovar a competência/s);
  assert.equal(w.document.activeElement,painel,"completion takes the user directly to the assessment");
  assert.match(c.querySelector("#ia-custo").textContent,/1 pedido selecionado.*1 avaliação já disponível.*0 novas consultas/);
  assert.equal(c.querySelector("#ia-avaliar").textContent,"Ver resultado da IA");
  consent.checked=false;consent.dispatchEvent(new w.Event("change"));
  assert.equal(c.querySelector("#ia-avaliar").disabled,false,"viewing a completed result needs no new authorization to send documents");
  c.querySelector("[data-enviar-ia]").checked=false;c.querySelector("[data-enviar-ia]").dispatchEvent(new w.Event("change"));
  c.querySelector("#ia-ver-resultados").click();
  assert.equal(paid.length,1);assert.equal(w.document.activeElement.id,"gemod-ia-resultado-0");
  c.querySelector("[data-enviar-ia]").checked=true;c.querySelector("[data-enviar-ia]").dispatchEvent(new w.Event("change"));
  c.querySelector("#ia-avaliar").click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(paid.length,1,"a completed identical result causes no extra paid call");
  c.querySelector("#ia-usar-manual").click();c.querySelector("#ia-buscar").click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(searches,2);
  assert.equal(paid.length,1);
  assert.match(c.querySelector(".gemod-ai-assessment").textContent,/Conferir período/,"an identical local search immediately shows its cached assessment");
  c.querySelector("#ia-selecionar-todos").click();c.querySelector("#ia-avaliar").click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(paid.length,1,"the same selected evidence remains cached after repeating a local search");
});
