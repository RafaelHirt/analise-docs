(function (global) {
  "use strict";
  // Orquestrador da análise documental: a IA interpreta exigências primeiro.
  // Os arquivos são abertos no navegador e somente textos autorizados seguem à API.
  let tela = null;
  const MAX_DOCS_CONTEUDO = 400;
  const MAX_CHUNKS = 8;
  const $esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const extensão = n => (String(n).split(".").pop() || "").toLowerCase();
  const formatos = new Set(["pdf","docx","xlsx","xls","xlsm","txt","csv","md"]);
  function cancelar() {
    global.GemodCompartilhar?.fechar();
    if (tela) { tela.persistencia?.sair(); tela.controle?.abort(); tela.raiz=null; tela.achados=[]; tela.indiceLocal=null;
      tela.respostas?.clear(); tela.avaliacoes?.clear(); tela.urls?.forEach(url=>URL.revokeObjectURL(url)); tela=null; }
  }
  async function requisitar(url,method,body,signal) {
    const resp=await fetch(url,{method,credentials:"same-origin",headers:{"Content-Type":"application/json"},
      body:method==="POST"?JSON.stringify(body):undefined,signal});
    const json=await resp.json().catch(()=>({}));
    if(!resp.ok) {
      const detalhes = [json.modelo ? "Modelo: "+json.modelo : "",json.httpProvedor ? "HTTP "+json.httpProvedor : "",
        json.codigoProvedor && json.codigoProvedor!=="nao_informado" ? "Código: "+json.codigoProvedor : "",
        json.referencia ? "Referência: "+json.referencia : ""].filter(Boolean).join(" · ");
      const erro=new Error((json.erro || "Falha de comunicação com a análise IA (HTTP "+resp.status+").")+(detalhes?" "+detalhes:""));
      erro.aguarde=resp.headers?.get?.("retry-after")||"";
      erro.configuracao=!!json.httpProvedor && [400,401,403,404].includes(json.httpProvedor);
      throw erro;
    }
    return json;
  }
  async function requisitarEconomico(t, url, body, signal) {
    const key = t.modelo + "|" + url + "|" + JSON.stringify(body);
    if (t.respostas.has(key)) { t.consultasReaproveitadas++; return JSON.parse(JSON.stringify(t.respostas.get(key))); }
    const response = await requisitar(url, "POST", body, signal);
    if (tela !== t || signal?.aborted) throw Object.assign(new Error("Interrompida"), { name: "AbortError" });
    const completo = !body.itens || body.itens.every(item=>(response.itens||[]).filter(r=>r.id===item.id).length===1);
    if (completo) {
      if (t.respostas.size >= 64) t.respostas.delete(t.respostas.keys().next().value);
      t.respostas.set(key, JSON.parse(JSON.stringify(response)));
    }
    t.consultasFeitas++;
    return response;
  }
  function payloadPedido(row) {
    return { id: row.id, descricao: row.descricao, providencia: row.providencia, referencia: row.referencia,
      fonteSES: { arquivo: row.origem || "", local: row.local || "", trecho: row.fonteVerificada ? (row.trecho || "").slice(0,1200) : "" },
      candidatos: row.candidatos.filter(c=>c.trecho).slice(0,6).map((c,j)=>({ id: "c"+j, caminho: c.caminho,
        local: c.local, trecho: c.trecho.slice(0,1800), alertasLocais: c.alertas || [] })) };
  }
  const chavePedido = (t, row) => t.modelo + "|" + JSON.stringify(payloadPedido(row));
  const temAvaliacao = row => !!row.avaliacaoConcluida || ["evidencia_compativel","insuficiente","divergente"].includes(row.situacao);
  function recuperarAvaliacao(t,row){
    const salva=t.avaliacoes.get(chavePedido(t,row));
    if(salva)Object.assign(row,salva,{avaliacaoConcluida:true,avaliacaoModelo:t.modelo});
    return temAvaliacao(row);
  }
  function capturarAnalise(t) {
    salvarEdicao(t);
    return global.GemodAnaliseSnapshot.normalizar({versao:1,pastaNome:t.pastaNome,modelo:t.modelo,
      achados:t.achados,resultados:t.resultados.map(row=>({...row,
        avaliacaoConcluida:t.avaliacoes.has(chavePedido(t,row))||!!row.avaliacaoConcluida,
        avaliacaoModelo:t.avaliacoes.has(chavePedido(t,row))?t.modelo:row.avaliacaoModelo})),
      blocosSES:t.blocosSES,proximoBloco:t.proximoBloco,parcialSES:t.parcialSES,
      cobertura:t.cobertura,falhas:t.falhas,falhasPastas:t.falhasPastas,
      buscaPendente:t.buscaPendente||!!t.buscaEstado&&!t.buscaEstado.completos,
      consultasFeitas:t.consultasFeitas,consultasReaproveitadas:t.consultasReaproveitadas,
      filtro:t.container.querySelector("#ia-filtro")?.value,documentoAtivo:t.documentoAtivo});
  }
  async function arquivoDoCandidato(t,c) {
    let handle=c.handle;
    if(!handle){
      if(!t.raiz)throw new Error("Selecione a pasta desta análise em Minhas análises para abrir o PDF original.");
      const partes=c.caminho.split("/");
      if(partes.shift()!==t.raiz.name||!partes.length||partes.some(p=>!p||p==="."||p===".."||p.includes("\u0000")))
        throw new Error("O caminho salvo não pertence à pasta selecionada.");
      let pasta=t.raiz;
      try{
        for(const parte of partes.slice(0,-1))pasta=await pasta.getDirectoryHandle(parte);
        handle=await pasta.getFileHandle(partes.at(-1));
      }catch{throw new Error("O arquivo não foi encontrado nesse caminho. Confira a pasta original e se o PDF foi movido.");}
    }
    const file=await handle.getFile();
    if(Number.isFinite(c.lastModified)&&(file.size!==c.size||file.lastModified!==c.lastModified))
      throw new Error("Arquivo alterado após a pesquisa. Pesquise novamente antes de conferir a evidência.");
    // A snapshot carries a literal quote and its position, never a file handle.
    // Validate only this page when reconnecting, without rebuilding the corpus.
    if(!c.handle&&c.hash){
      const lido=await t.API.ler(file,undefined,{indiceCompleto:true,locais:new Set([c.local])});
      const parte=lido.partes.find(p=>p.local===c.local);
      if(!parte||await global.GemodContexto.assinatura(String(parte.texto).slice(c.inicio,c.fim))!==c.hash)
        throw new Error("O trecho salvo não corresponde ao conteúdo atual do PDF. Faça uma nova busca local.");
    }
    if(tela!==t)throw new Error("A análise foi fechada.");
    return file;
  }
  function lotes(rows) {
    const result = []; let batch = [];
    for (const row of rows) {
      const next = [...batch, row];
      if (batch.length && (next.length > 4 || JSON.stringify(next.map(payloadPedido)).length > 45000)) { result.push(batch); batch = []; }
      batch.push(row);
    }
    if (batch.length) result.push(batch);
    return result;
  }
  function custo(t) {
    const selected = t.resultados.filter(row=>row.paraIA && row.candidatos.some(c=>c.trecho));
    const pending = selected.filter(row=>!t.avaliacoes.has(chavePedido(t,row)));
    const chunks = selected.reduce((sum,row)=>sum+payloadPedido(row).candidatos.length,0);
    const disponiveis=t.resultados.filter(row=>recuperarAvaliacao(t,row)).length;
    const q=(n,um,muitos)=>n+" "+(n===1?um:muitos);
    const el = t.container.querySelector("#ia-custo");
    if (el) el.textContent = q(selected.length,"pedido selecionado","pedidos selecionados")+" · "+q(chunks,"trecho","trechos")+" · "+
      q(selected.length-pending.length,"avaliação já disponível","avaliações já disponíveis")+" · "+q(lotes(pending).length,"nova consulta à IA","novas consultas à IA")+". "+
      (selected.length&&!pending.length?"O resultado selecionado será exibido sem nova consulta.":"Somente os pedidos sem avaliação serão enviados à IA.");
    const ocupado=!!t.controle||!!t.persistencia?.ocupada()||!!global.GemodPastas?.ocupado?.();
    const button = t.container.querySelector("#ia-avaliar");
    if (button){
      button.textContent=t.operacao==="avaliar"?"Avaliando trechos…":selected.length&&!pending.length?"Ver resultado da IA":"Confrontar trechos com IA";
      button.disabled=ocupado||!selected.length||!!pending.length&&(!t.disponivel||!t.container.querySelector("#ia-consentimento").checked);
    }
    const ver=t.container.querySelector("#ia-ver-resultados");
    if(ver){ver.hidden=!disponiveis;ver.disabled=ocupado;ver.textContent=(disponiveis===1?"Ver resultado da IA":"Ver resultados da IA")+" ("+disponiveis+")";}
  }
  function partesParaIA(nome,partes) {
    const out=[];let paginas=[],tamanho=0,parcial=false;
    for(const p of partes){
      const integral=String(p.texto||"");
      if(!integral.trim())continue;
      for(let offset=0;offset<integral.length;offset+=10000){
        const texto=integral.slice(offset,offset+10000);
        if((tamanho+texto.length>45000 || paginas.length>=70) && paginas.length){out.push({nome,paginas});paginas=[];tamanho=0;}
        paginas.push({local:p.local+(integral.length>10000?" (trecho "+(Math.floor(offset/10000)+1)+")":""),texto});tamanho+=texto.length;
      }
    }
    if(paginas.length)out.push({nome,paginas});
    if(out.length>3){parcial=true;out.length=3;}
    return {grupos:out,parcial};
  }
  function consulta(f) {
    return [f.descricao,f.providencia,f.referencia,...(f.termosBusca||[])].filter(Boolean).join(" ");
  }
  function tabelaFindings(t) {
    const el=t.container.querySelector("#ia-achados");
    if (!t.achados.length) {el.innerHTML="<p>Nenhum apontamento encontrado. Verifique os arquivos SES.</p>";return;}
    const grupos=new Map();
    t.achados.forEach((a,i)=>{const fonte=a.documentoId||a.origem||"manual";if(!grupos.has(fonte))grupos.set(fonte,[]);grupos.get(fonte).push({a,i});});
    const documentos=[...grupos];if(!grupos.has(t.documentoAtivo))t.documentoAtivo=documentos[0][0];
    const botao=(fonte,label)=>'<button type="button" class="btn btn-ghost btn-sm" data-ia-abrir-doc="'+$esc(fonte)+'" aria-pressed="'+(fonte===t.documentoAtivo)+'">'+$esc(label)+'</button>';
    el.innerHTML='<nav class="gemod-doc-navigation" aria-label="Documentos SES para revisão">'+documentos.map(([fonte,rows],n)=>botao(fonte,(n+1)+'. '+(rows[0].a.documentoSES||rows[0].a.origem))).join("")+'</nav>'+documentos.map(([fonte,rows],n)=>{
      const primeiro=rows[0].a;
      return '<section data-ia-grupo="'+$esc(fonte)+'" '+(fonte!==t.documentoAtivo?'hidden':'')+'><p class="gemod-doc-position">Documento '+(n+1)+' de '+documentos.length+' · '+$esc(primeiro.origem)+' · '+rows.filter(r=>r.a.extracao!=="sem_item").length+' pedido(s)</p><label class="gemod-ses-title">Documento da SES<input data-ia-documento="'+$esc(fonte)+'" value="'+$esc(primeiro.documentoSES||primeiro.origem||"Documento SES")+'"></label>'+rows.map(({a,i},j)=>'<article class="gemod-finding-card">'+
      '<div class="gemod-finding-top"><label class="gemod-checkline"><input type="checkbox" data-ia-selecionar="'+i+'" '+(a.selecionado!==false?"checked":"")+'> <strong>'+(a.item?'Item '+$esc(a.item):a.extracao==="sem_item"?'Observação geral para revisar':'Apontamento '+(j+1))+'</strong></label>'+
      '<span class="gemod-finding-origin">'+$esc(a.origem)+' · '+$esc(a.local)+'</span></div>'+
      (a.extracao==="texto_original"?'<p class="gemod-extraction-note">Texto original do item numerado. Não é um resumo da IA; confira e ajuste o pedido antes da busca.</p>':a.extracao==="sem_item"?'<p class="gemod-extraction-note">Resumo da IA sem associação confirmada a um item específico. Não está selecionado para a busca.</p>':"")+
      '<div class="gemod-finding-grid"><label>Problema identificado<textarea data-ia-desc="'+i+'" rows="'+(a.extracao==="texto_original"?6:4)+'">'+$esc(a.descricao)+'</textarea></label>'+
      '<label>Providência exigida<textarea data-ia-prov="'+i+'" rows="'+(a.extracao==="texto_original"?6:4)+'">'+$esc(a.providencia)+'</textarea></label></div>'+
      '<label class="gemod-finding-reference">Referências, competência e identificadores<textarea data-ia-ref="'+i+'" rows="2">'+$esc(a.referencia||"")+'</textarea></label>'+
      (global.GemodRelatorio?.fonteHTML?global.GemodRelatorio.fonteHTML(a):a.trecho?'<details open><summary>Trecho original</summary><p class="gemod-source-quote">'+$esc(a.trecho)+'</p></details>':"")+
      '</article>').join("")+'<div class="gemod-doc-next">'+(n?botao(documentos[n-1][0],"Documento anterior"):"")+(n+1<documentos.length?botao(documentos[n+1][0],"Conferir próximo documento →"):"<p>Último documento. Confira os pedidos selecionados antes de pesquisar.</p>")+'</div></section>';
    }).join("");
    el.querySelectorAll("[data-ia-abrir-doc]").forEach(button=>button.addEventListener("click",()=>{
      if(t.controle)return;
      t.documentoAtivo=button.dataset.iaAbrirDoc;
      el.querySelectorAll("[data-ia-grupo]").forEach(section=>{section.hidden=section.dataset.iaGrupo!==t.documentoAtivo;});
      el.querySelectorAll("[data-ia-abrir-doc]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.iaAbrirDoc===t.documentoAtivo)));
      t.persistencia?.atualizar();el.scrollIntoView?.({block:"start"});
    }));
  }
  function documentosPreparados(t){
    const docs=new Map();
    for(const b of t.blocosSES||[]){const id=b.documentoId||b.nome;if(!docs.has(id))docs.set(id,{id,nome:b.nome,titulo:b.documentoSES||b.nome,paginas:[],partesDescartadas:false});const d=docs.get(id);d.paginas.push(...(b.paginas||[]));if(!b.paginas)d.partesDescartadas=true;}
    return [...docs.values()];
  }
  function mostrarLeituraSES(t){
    const el=t.container.querySelector("#ia-textos-lidos");if(!el)return;
    const docs=documentosPreparados(t);el.hidden=!docs.length;
    el.innerHTML=docs.length?'<h3>Confira a leitura dos documentos SES</h3><p>Abra primeiro um PDF, confira os itens e as páginas; depois passe ao próximo. Este texto foi extraído no seu computador, antes da interpretação pela IA.</p>'+docs.map((d,i)=>{
      const itens=global.GemodItensSES?.detectar(d.paginas)||[];
      return '<details class="gemod-ses-reading"><summary>'+String(i+1).padStart(2,"0")+' · '+$esc(d.titulo)+' · '+itens.length+' subitem(ns) com exigência detectado(s)</summary>'+
        '<p>'+$esc(d.nome)+' · '+new Set(d.paginas.map(p=>p.local)).size+' página(s)/parte(s) disponíveis nesta preparação.</p>'+
        (d.partesDescartadas?'<p>Este texto contém apenas blocos pendentes. Os blocos já interpretados não são guardados integralmente; seus pedidos e contextos salvos aparecem na revisão abaixo.</p>':"")+
        (itens.length?'<ul>'+itens.map(item=>'<li><strong>Item '+$esc(item.numero)+'</strong> · '+$esc(item.local)+' · '+$esc(item.titulo)+'</li>').join("")+'</ul>':'<p>A ausência de subitens reconhecidos não significa ausência de pedidos. Confira o texto e use a interpretação ou a inclusão manual.</p>')+
        d.paginas.map(p=>'<details><summary>'+$esc(p.local)+' · texto extraído</summary><pre class="gemod-source-quote">'+$esc(p.texto)+'</pre></details>').join("")+'</details>';
    }).join(""):"";
    const button=t.container.querySelector("#ia-usar-numerados");
    button.hidden=!docs.some(d=>(global.GemodItensSES?.detectar(d.paginas)||[]).length);
  }
  function salvarEdicao(t) {
    const titulos=new Map([...t.container.querySelectorAll("[data-ia-documento]")].map(input=>[input.dataset.iaDocumento,input.value.trim()]));
    (t.blocosSES||[]).forEach(bloco=>{bloco.documentoSES=titulos.get(bloco.documentoId)||bloco.documentoSES;});
    t.achados.forEach((a,i)=>{
      if(!t.container.querySelector('[data-ia-desc="'+i+'"]'))return;
      a.documentoSES=titulos.get(a.documentoId||a.origem||"manual")||a.documentoSES||a.origem;
      a.selecionado=!!t.container.querySelector('[data-ia-selecionar="'+i+'"]')?.checked;
      const descricao=t.container.querySelector('[data-ia-desc="'+i+'"]')?.value.trim() || "";
      const providencia=t.container.querySelector('[data-ia-prov="'+i+'"]')?.value.trim() || "";
      const referencia=t.container.querySelector('[data-ia-ref="'+i+'"]')?.value.trim() || "";
      if (descricao!==a.descricao || providencia!==a.providencia || referencia!==a.referencia) { a.consultasAlternativas=[]; a.termosBusca=[]; }
      a.descricao=descricao; a.providencia=providencia; a.referencia=referencia;
    });
  }
  function buscas(item) {
    return [...new Set([...(item.termosBusca||[]),item.descricao,item.providencia,item.referencia].filter(x=>x&&String(x).trim().length>=3))];
  }
  const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  function maiorCorrespondencia(item,doc,API) {
    let best=null;
    for(const palavra of buscas(item)){
      let p=API.comparar(palavra,doc);
      // Termos como FGTS, CNES e SIGTAP podem aparecer sozinhos no nome.
      if(!p){
        const q=norm(palavra);
        if(q.length>=4 && q.split(" ").length<=3){
          const partes=[{local:"Nome do arquivo",texto:doc.nome},...(doc.partes||[])];
          for(const parte of partes){
            if(norm(parte.texto).includes(q)) {
              const candidate={local:parte.local,pontos:12,achados:[palavra],trecho:parte.local==="Nome do arquivo"?"":String(parte.texto).slice(0,1100)};
              if(!p||candidate.pontos>p.pontos)p=candidate;
            }
          }
        }
      }
      if(p&&(!best||p.pontos>best.pontos))best=p;
    }
    return best;
  }
  function candidata(d,item,API) {
    const nome=maiorCorrespondencia(item,{nome:d.caminho,partes:[]},API);
    const conteudo=maiorCorrespondencia(item,{nome:"",partes:d.partes||[]},API);
    const p=conteudo||nome;
    if(!p)return null;
    return {nome:d.nome,caminho:d.caminho,pontos:p.pontos+(conteudo?15:0),local:p.local,trecho:p.trecho||"",achados:p.achados};
  }
  function preselecionar(docs,items,API) {
    // Distribui o limite de leitura entre todos os apontamentos; não favorece só o primeiro.
    const topPorItem=[];
    for(const item of items) {
      const todos=[];
      for(const d of docs){
        if(!formatos.has(extensão(d.nome)))continue;
        const cand=maiorCorrespondencia(item,{nome:d.caminho,partes:[]},API);
        if(cand)todos.push({d,pontos:cand.pontos});
      }
      todos.sort((a,b)=>b.pontos-a.pontos);
      topPorItem.push(todos);
    }
    const usados=new Set(),selecionados=[];
    for(let rodada=0;rodada<16 && selecionados.length<MAX_DOCS_CONTEUDO;rodada++){
      for(const lista of topPorItem){
        const d=lista[rodada]?.d;
        if(d&&!usados.has(d.caminho)){usados.add(d.caminho);selecionados.push(d);}
        if(selecionados.length===MAX_DOCS_CONTEUDO)break;
      }
    }
    return selecionados;
  }
  function candidatosDoItem(item,docs,API) {
    const lista=[];
    for(const d of docs){
      const c=candidata(d,item,API);
      if(c)lista.push(c);
    }
    lista.sort((a,b)=>b.pontos-a.pontos);
    return lista.slice(0,3);
  }
  const labels={
    localizada_sem_analise:"Trecho localizado · IA não executada",
    evidencia_compativel:"Possível evidência compatível · revisar",
    insuficiente:"Evidência possivelmente insuficiente",
    divergente:"Possível divergência",
    nao_verificavel:"Não verificável com os dados disponíveis",
    sem_candidato:"Nenhum candidato encontrado na busca"
  };
  function mostrarCobertura(t) {
    const c=t.cobertura || {};
    const stats=[
      ["Arquivos listados",c.listados??0],
      ["Com conteúdo pesquisável",c.comTexto??0],
      ["Sem texto selecionável",c.semTexto??0],
      ["Não suportados",c.naoSuportados??0],
      ["Falhas de leitura",c.erros??0],
      ["Pastas inacessíveis",c.pastasFalhas??0],
      ["Índices reaproveitados",c.reaproveitados??0]
    ];
    const aviso=c.verificacaoParcial?
      "COBERTURA PARCIAL — as ausências não comprovam que o documento não existe.":
      "Varredura dos arquivos listados concluída; a conformidade documental ainda depende de revisão.";
    t.container.querySelector("#ia-cobertura").innerHTML=
      '<p class="gemod-coverage-notice '+(c.verificacaoParcial?"gemod-warning":"gemod-ok")+'">'+$esc(aviso)+'</p>'+
      '<div class="gemod-coverage-grid">'+stats.map(([label,n])=>'<div><span>'+$esc(label)+'</span><strong>'+Number(n).toLocaleString("pt-BR")+'</strong></div>').join("")+'</div>';
    const alertas=[...(t.falhasPastas||[]),...(t.falhas || [])].slice(0,100);
    t.container.querySelector("#ia-falhas").innerHTML=
      '<p>Arquivos não suportados, inacessíveis, grandes ou sem texto selecionável não foram avaliados integralmente. PDF digitalizado exige OCR; ZIP não é aberto nesta etapa. Limite de segurança: '+Number(global.GemodBuscaLocal?.MAX_DOCUMENTOS||15000).toLocaleString("pt-BR")+' arquivos por busca. '+
      (c.ignoradosLimite?"Ficaram fora do limite: "+c.ignoradosLimite+". ":"")+
      (c.limiteInventario?"O limite de listagem da pasta também foi atingido. ":"")+
      'Nenhuma ausência equivale a prova de inexistência. Os detalhes abaixo mostram até 100 falhas ou avisos; as contagens da cobertura podem ser maiores.</p>'+
      (alertas.length?'<ul class="gemod-errors-list">'+alertas.map(x=>'<li><strong>'+$esc(x.caminho)+'</strong>: '+$esc(x.motivo)+(x.mensagem?'<p>Mensagem original: '+$esc(x.mensagem)+'</p>':"")+(x.orientacao?'<p>Como verificar: '+$esc(x.orientacao)+'</p>':"")+'</li>').join("")+'</ul>':
      '<p>Não foram registrados detalhes adicionais de falhas de arquivos nesta varredura.</p>');
  }
  function painelAvaliacao(row,indice){
    if(!temAvaliacao(row))return '<p class="gemod-ai-pending">A IA ainda não avaliou este pedido. Selecione-o acima para conferir os trechos encontrados.</p>';
    const titulos={evidencia_compativel:"Evidências possivelmente compatíveis — conferir documentos",insuficiente:"Evidências insuficientes para confirmar o atendimento",
      divergente:"Possível divergência nos trechos analisados",nao_verificavel:"Não foi possível verificar com os trechos recebidos"};
    const titulo=titulos[row.situacao]||"Avaliação disponível";
    const estado=row.situacao==="evidencia_compativel"?"gemod-ai-compatible":row.situacao==="divergente"?"gemod-ai-divergent":"gemod-ai-insufficient";
    const citacoes=(row.evidencias||[]).map(e=>{
      const match=/^c(\d+)$/.exec(e.candidatoId||""),ci=match?Number(match[1]):-1,candidato=row.candidatos[ci];
      return '<li>'+(candidato?'<a href="#gemod-ia-arquivo-'+indice+'-'+ci+'" data-ver-arquivo-ia="'+indice+':'+ci+'">Arquivo candidato '+(ci+1)+' · '+$esc(candidato.local)+'</a>':"")+
        '<blockquote class="gemod-source-quote">'+$esc(e.trecho)+'</blockquote></li>';
    }).join("");
    return '<section id="gemod-ia-resultado-'+indice+'" class="gemod-ai-assessment '+estado+'" tabindex="-1" aria-labelledby="gemod-ia-titulo-'+indice+'">'+
      '<p class="gemod-ai-kicker">Resultado da IA</p><h4 id="gemod-ia-titulo-'+indice+'">'+$esc(titulo)+'</h4>'+
      '<h5>Justificativa da IA</h5><p class="gemod-result-reason">'+$esc(row.justificativa||"A IA não retornou uma justificativa textual. Confira a situação e as pendências desta avaliação.")+'</p>'+
      (row.pendencias?.length?'<h5>O que ainda falta comprovar</h5><ul class="gemod-ai-missing">'+row.pendencias.map(p=>'<li>'+$esc(p)+'</li>').join("")+'</ul>':"")+
      (citacoes?'<h5>Trechos usados nesta avaliação</h5><ul class="gemod-ai-citations">'+citacoes+'</ul>':"")+
      '<p class="gemod-ai-scope">Avaliação dos trechos recebidos. A conclusão precisa de revisão técnica.</p></section>';
  }
  function focarAvaliacao(t){
    const avaliados=t.resultados.map((row,i)=>({row,i})).filter(({row})=>recuperarAvaliacao(t,row));
    const alvo=avaliados.find(({row})=>row.paraIA)||avaliados[0];if(!alvo)return;
    const filtro=t.container.querySelector("#ia-filtro");if(filtro)filtro.value="todos";
    mostrarResultados(t);
    const painel=t.container.querySelector("#gemod-ia-resultado-"+alvo.i);
    painel?.focus({preventScroll:true});painel?.scrollIntoView?.({block:"start"});
  }
  function mostrarResultados(t) {
    const el=t.container.querySelector("#ia-tabela");
    if(!t.resultados){el.innerHTML="";return;}
    t.resultados.forEach(row=>recuperarAvaliacao(t,row));
    const filtro=t.container.querySelector("#ia-filtro")?.value||"todos";
    const visiveis=t.resultados.map((r,i)=>({...r,numero:i+1})).filter(r=>
      filtro==="todos" || filtro==="localizados" && r.candidatos.some(c=>c.trecho) ||
      filtro==="pendentes" && !["evidencia_compativel"].includes(r.situacao));
    const documentosVisiveis=new Set();
    el.innerHTML=visiveis.map(r=>{
      const fonte=r.documentoId||r.origem||"manual";
      const heading=documentosVisiveis.has(fonte)?"":'<h3 class="gemod-ses-results-title">'+$esc(r.documentoSES||r.origem||"Documento SES")+'</h3>';
      documentosVisiveis.add(fonte);
      const temTrecho=r.candidatos.some(c=>c.trecho);
      const cor=r.situacao==="evidencia_compativel"?"gemod-result-ok":
        r.situacao==="divergente"?"gemod-result-danger":"gemod-result-pending";
      const docs=r.candidatos.map((c,j)=>
        '<li id="gemod-ia-arquivo-'+(r.numero-1)+'-'+j+'" tabindex="-1"><div class="gemod-candidate-top"><strong>Arquivo candidato '+(j+1)+'</strong></div>'+
        (global.GemodRelatorio?.caminhoHTML ? global.GemodRelatorio.caminhoHTML(c.caminho,c.local,true) : '<p class="gemod-candidate-path">'+$esc(c.caminho)+' · '+$esc(c.local)+'</p>')+
        (c.motivos?.length?'<p><strong>Por que foi localizado:</strong> '+$esc(c.motivos.join("; "))+'</p>':"")+
        (c.alertas?.length?'<p class="gemod-warning"><strong>Conferir:</strong> '+$esc(c.alertas.join("; "))+'</p>':"")+
        (/\.pdf$/i.test(c.nome)?'<button type="button" class="btn btn-ghost btn-sm" data-abrir-evidencia="'+(r.numero-1)+':'+j+'">'+(c.handle||t.raiz?"Abrir PDF na página":"Selecionar pasta para abrir PDF")+'</button>':"")+
        '<details><summary>'+(c.trecho?"Ver trecho identificado":"Apenas nome/caminho; conteúdo não comprovado")+'</summary>'+
        '<p class="gemod-source-quote">'+$esc(c.trecho||"Não há trecho verificável para este documento.")+'</p></details></li>'
      ).join("");
      return heading+'<article class="gemod-result-card '+cor+'"><div class="gemod-result-head">'+
        '<span class="gemod-result-number">#'+r.numero+'</span>'+
        '<h4 class="gemod-result-title">'+$esc(r.item?"Item "+r.item:"Pedido "+r.numero)+'</h4></div>'+
        '<label class="gemod-checkline"><input type="checkbox" data-enviar-ia="'+(r.numero-1)+'" '+(r.paraIA?'checked ':'')+(!temTrecho?'disabled':'')+'> Selecionar este pedido para conferência paga com IA</label>'+
        painelAvaliacao(r,r.numero-1)+
        '<p class="gemod-result-req"><strong>Pedido da SES:</strong> '+$esc(r.providencia)+'</p>'+
        '<details class="gemod-result-source"><summary>Ver pedido completo e origem na SES</summary><p class="gemod-source-quote">'+$esc(r.descricao)+'</p>'+
        (global.GemodRelatorio?.fonteHTML?global.GemodRelatorio.fonteHTML(r):'<p class="gemod-result-origin">'+$esc(r.origem)+' · '+$esc(r.local)+'</p>')+
        '</details>'+
        '<details class="gemod-candidates"><summary>Ver caminhos e trechos · '+r.candidatos.length+' arquivo(s) candidato(s)'+(temTrecho?" com evidência textual":" · sem evidência textual verificada")+'</summary>'+
        (docs?'<ol>'+docs+'</ol>':'<p>Nenhum candidato confiável localizado entre os arquivos pesquisáveis.</p>')+'</details>'+
        '<button type="button" class="btn btn-ghost btn-sm gemod-image-action" data-gerar-imagem="'+(r.numero-1)+'" '+(t.controle?'disabled':'')+'>Gerar imagem para compartilhar</button>'+
        '</article>';
    }).join("")||'<p class="gemod-empty-state">Nenhum apontamento corresponde ao filtro selecionado.</p>';
    t.container.querySelector("#ia-resultado").hidden=false;
    el.querySelectorAll("[data-enviar-ia]").forEach(input=>input.addEventListener("change",()=>{
      t.resultados[Number(input.dataset.enviarIa)].paraIA=input.checked; custo(t);
    }));
    global.GemodCompartilhar?.ativarCopia(el);
    el.querySelectorAll("[data-ver-arquivo-ia]").forEach(link=>link.addEventListener("click",event=>{
      event.preventDefault();const [ri,ci]=link.dataset.verArquivoIa.split(":").map(Number);
      const arquivo=el.querySelector("#gemod-ia-arquivo-"+ri+"-"+ci);if(!arquivo)return;
      const detalhes=arquivo.closest(".gemod-candidates");if(detalhes)detalhes.open=true;
      arquivo.focus({preventScroll:true});arquivo.scrollIntoView?.({block:"start"});
    }));
    el.querySelectorAll("[data-gerar-imagem]").forEach(button=>button.addEventListener("click",()=>{
      if(t.controle)return;
      try{
        if(!global.GemodCompartilhar)throw new Error("Gerador de imagens indisponível. Guarde o CSV e abra o organizador de relatórios em outra aba.");
        global.GemodCompartilhar.abrir({resultados:t.resultados,cobertura:t.cobertura},{pedido:Number(button.dataset.gerarImagem)});
      }catch(erro){t.container.querySelector("#ia-status").textContent=erro.message;}
    }));
    el.querySelectorAll("[data-abrir-evidencia]").forEach(button=>button.addEventListener("click",async()=>{
      try {
        const [r,c]=button.dataset.abrirEvidencia.split(":").map(Number), candidate=t.resultados[r].candidatos[c];
        if(!candidate.handle&&!t.raiz){t.container.querySelector("[data-vincular-pasta]")?.click();return;}
        button.disabled=true;
        const file=await arquivoDoCandidato(t,candidate);
        const url=URL.createObjectURL(file);t.urls.add(url);
        const page=/Página (\d+)/.exec(candidate.local)?.[1] || "1";
        global.open(url+"#page="+page,"_blank","noopener,noreferrer");
      }catch(error){if(tela===t)t.container.querySelector("#ia-status").textContent=error.message;}
      finally{button.disabled=false;}
    }));
    custo(t);
  }
  function csv(rows,cobertura=null,falhas=[]) {
    const esc=v=>{
      let s=String(v??"").replace(/[\r\n\t]+/g," ");
      if(/^[\s\uFEFF]*[=+\-@]/.test(s))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    const matriz=[["Origem SES","Local SES","Irregularidade/observação","Providência exigida","Referência","Situação da conferência (IA se utilizada)","Justificativa","Pendências","Arquivo entidade","Local entidade","Trecho evidência","Motivos da localização","Alertas da busca","Citações verificadas","Documento SES","Identificador da fonte SES","Trecho original SES","Contexto SES","Fonte SES verificada","Página SES confirmada","Método do contexto SES","Contexto SES parcial","Fonte SES (JSON)","Avaliação IA concluída","Modelo da avaliação IA"]];
    rows.forEach(r=>{
      const bases=[r.origem,r.local,r.descricao,r.providencia,r.referencia,labels[r.situacao]||"",r.justificativa,(r.pendencias||[]).join(" / ")];
      const fonteOriginal={documentoSES:r.documentoSES||r.origem||"",documentoId:r.documentoId||"",trecho:r.fonteVerificada?r.trecho||"":"",contextoSES:r.contextoSES||"",fonteVerificada:!!r.fonteVerificada,paginaConfirmada:!!(r.paginaConfirmada||r.fonteVerificada),contextoMetodo:r.contextoMetodo||"",contextoParcial:!!r.contextoParcial,item:r.item||"",extracao:r.extracao||""};
      const fonte=[fonteOriginal.documentoSES,fonteOriginal.documentoId,fonteOriginal.trecho,fonteOriginal.contextoSES,fonteOriginal.fonteVerificada?"SIM":"NÃO",fonteOriginal.paginaConfirmada?"SIM":"NÃO",fonteOriginal.contextoMetodo,fonteOriginal.contextoParcial?"SIM":"NÃO",JSON.stringify(fonteOriginal)];
      const avaliacao=[temAvaliacao(r)?"SIM":"NÃO",r.avaliacaoModelo||""];
      if(!r.candidatos.length)matriz.push([...bases,"","","","","","",...fonte,...avaliacao]);
      for(const c of r.candidatos)matriz.push([...bases,c.caminho,c.local,c.trecho,(c.motivos||[]).join("; "),(c.alertas||[]).join("; "),(r.evidencias||[]).map(e=>e.trecho).join("; "),...fonte,...avaliacao]);
    });
    if(cobertura){
      matriz.push([],["COBERTURA DA BUSCA LOCAL","Valor"]);
      for(const [label,campo] of [["Arquivos listados","listados"],["Com texto pesquisável","comTexto"],
        ["Sem texto selecionável","semTexto"],["Formatos não suportados","naoSuportados"],
        ["Arquivos com falha","erros"],["Pastas inacessíveis","pastasFalhas"],
        ["Conteúdos parciais ou com avisos","parciais"],["Fora do limite","ignoradosLimite"],
        ["Arquivos reaproveitados do índice local","reaproveitados"],["Arquivos alterados durante a busca","arquivosAlterados"]]) {
        matriz.push([label,cobertura[campo]??0]);
      }
      matriz.push(["Cobertura parcial",cobertura.verificacaoParcial?"SIM — ausência não prova inexistência":"NÃO — para os itens listados e suportados"]);
      if(falhas.length) {
        matriz.push([],["FALHAS E AVISOS","Motivo"]);
        falhas.forEach(f=>matriz.push([f.caminho,f.motivo]));
      }
    }
    return "\uFEFF"+matriz.map(r=>r.map(esc).join(";")).join("\r\n");
  }
  function montar(container,API) {
    cancelar();
    const primeiro=container.querySelector("#pasta-resultado") || container.querySelector(".inventario-local");
    if(!primeiro)return;
    primeiro.insertAdjacentHTML("afterend", "<section id=\"ia-painel\" class=\"painel inventario-local gemod-flow-card\">\n  <div class=\"painel-head gemod-flow-heading\"><div><span class=\"gemod-eyebrow\">02 / 04 · APONTAMENTOS</span><h2>Interpretar as exigências da SES</h2><p>Primeiro organize o que cada área técnica solicita. Depois confronte com os documentos da entidade.</p></div><span class=\"gemod-status-pill\">IA opcional</span></div>\n  <div class=\"painel-body gemod-flow-body\">\n    <p id=\"ia-pasta\" class=\"gemod-folder-label\" role=\"status\">Selecione a pasta da entidade no inventário acima.</p>\n    <div class=\"gemod-flow-inputs\">\n      <div class=\"gemod-upload\"><label for=\"ia-ses\">Documentos das áreas técnicas da SES</label><input id=\"ia-ses\" type=\"file\" multiple accept=\".pdf,.docx,.xlsx,.xls,.xlsm,.txt,.csv,.md\"><small>Ofícios, notas técnicas e despachos · selecione vários arquivos</small></div>\n      <div class=\"gemod-flow-action\">\n        <p id=\"ia-disponibilidade\" class=\"gemod-api-status\" role=\"status\">Verificando a configuração da IA…</p>\n        <label class=\"gemod-checkline\"><input id=\"ia-consentimento\" type=\"checkbox\"><span>Tenho autorização institucional para enviar os textos selecionados ao serviço externo de IA.</span></label>\n        <button class=\"btn btn-primary\" type=\"button\" id=\"ia-interpretar\" disabled>Interpretar documentos SES com IA</button>\n      </div>\n    </div>\n    <details class=\"gemod-manual-mode\"><summary>Sem créditos de IA? Inserir apontamentos manualmente</summary>\n      <p>Digite 1 exigência por linha. A pesquisa na pasta será totalmente local e não gerará consumo de tokens.</p>\n      <textarea id=\"ia-manual-texto\" rows=\"4\" placeholder=\"Ex.: Apresentar comprovantes de FGTS de setembro de 2026\"></textarea>\n      <button id=\"ia-usar-manual\" type=\"button\" class=\"btn btn-ghost\">Usar estes apontamentos</button>\n    </details>\n    <div class=\"gemod-progress-line\"><p id=\"ia-status\" role=\"status\" aria-live=\"polite\">Selecione os documentos para começar.</p><button class=\"btn btn-ghost btn-sm\" type=\"button\" id=\"ia-cancelar\" hidden>Interromper</button></div>\n    <progress id=\"ia-progresso\" class=\"gemod-progress\" hidden></progress>\n    <section id=\"ia-revisao\" class=\"gemod-stage-panel\" hidden>\n      <div class=\"gemod-stage-heading\"><div><span class=\"gemod-eyebrow\">03 / 04 · CONFERÊNCIA</span><h3>Revise os apontamentos</h3><p>Corrija e selecione o que deverá ser procurado na pasta. A IA pode omitir ou interpretar incorretamente exigências.</p></div></div>\n      <div id=\"ia-achados\" class=\"gemod-findings\"></div>\n      <div class=\"gemod-stage-footer\"><div><strong>Busca local abrangente</strong><p>Pesquisa o conteúdo dos arquivos acessíveis, sem enviá-los à IA. Pastas inacessíveis, PDFs sem texto e documentos não suportados são identificados no relatório.</p></div><button class=\"btn btn-primary\" type=\"button\" id=\"ia-buscar\">Pesquisar evidências na pasta</button></div>\n    </section>\n    <section id=\"ia-resultado\" class=\"gemod-stage-panel\" hidden>\n      <div class=\"gemod-stage-heading\"><div><span class=\"gemod-eyebrow\">04 / 04 · EVIDÊNCIAS</span><h3>Resultados do confronto</h3><p id=\"ia-resumo\">Os candidatos localizados precisam de revisão da equipe técnica.</p></div></div>\n      <div id=\"ia-cobertura\" class=\"gemod-coverage\" aria-live=\"polite\"></div>\n      <div class=\"gemod-stage-footer\"><div><strong>Avaliar evidências com IA</strong><p>Opcional. Envia somente os apontamentos e trechos candidatos, após sua autorização. Pode gerar cobrança na API OpenAI.</p></div><button id=\"ia-avaliar\" type=\"button\" class=\"btn btn-primary\" disabled>Confrontar trechos com IA</button></div>\n      <div class=\"gemod-results-toolbar\"><label for=\"ia-filtro\">Mostrar</label><select id=\"ia-filtro\"><option value=\"todos\">Todos os apontamentos</option><option value=\"pendentes\">Pendentes ou insuficientes</option><option value=\"localizados\">Com possíveis evidências</option></select><button class=\"btn btn-ghost btn-sm\" id=\"ia-csv\" type=\"button\">Exportar quadro CSV</button></div>\n      <div id=\"ia-tabela\" class=\"gemod-results\"></div>\n      <details class=\"gemod-manual-mode\"><summary>Sobre a cobertura e as limitações</summary><div id=\"ia-falhas\"></div></details>\n    </section>\n    <p class=\"gemod-privacy-note\"><strong>Privacidade:</strong> o inventário e a pesquisa dos arquivos ocorrem no navegador. Somente textos expressamente autorizados para interpretação ou trechos escolhidos para confronto com IA são enviados ao provedor. Nenhum resultado substitui a conferência técnica.</p>\n  </div>\n</section>");
    const t=tela={container,API,raiz:null,pastaNome:"",controle:null,achados:[],resultados:[],disponivel:false,blocosSES:null,proximoBloco:0,parcialSES:false,buscaEstado:null,buscaPendente:false,avaliados:0,assinaturaBusca:null,cobertura:null,falhas:[],falhasPastas:[],
      indiceLocal:null,respostas:new Map(),avaliacoes:new Map(),modelo:"gpt-5-mini",consultasFeitas:0,consultasReaproveitadas:0,urls:new Set(),operacao:null,mensagemBusca:"",documentoAtivo:""};
    const el=id=>container.querySelector(id);
    el("#ia-pasta").insertAdjacentHTML("afterend",'<p class="metric-extra"><a href="/relatorio-conferencia.html" target="_blank" rel="noopener">Abrir um CSV já salvo como relatório legível</a> · Conversão local, sem repetir a busca ou consultar a IA.</p>');
    el("#ia-csv").insertAdjacentHTML("beforebegin",'<button class="btn btn-primary" id="ia-html" type="button">Salvar relatório legível</button>');
    el("#ia-html").insertAdjacentHTML("beforebegin",'<button class="btn btn-primary" id="ia-salvar" type="button">Salvar análise para continuar depois</button>');
    el("#ia-csv").closest(".gemod-results-toolbar").insertAdjacentHTML("afterend",'<p class="gemod-export-help">Guarde o relatório para abrir depois no navegador, com os pedidos, caminhos e páginas organizados. A exportação não consome créditos de IA.</p>');
    el("#ia-disponibilidade").insertAdjacentHTML("afterend",'<button type="button" class="btn btn-ghost btn-sm" id="ia-diagnostico">Verificar acesso ao modelo (sem documentos)</button>');
    el("#ia-status").closest(".gemod-progress-line").insertAdjacentHTML("afterend",'<div id="ia-textos-lidos" class="gemod-ses-readings" hidden></div><button type="button" id="ia-usar-numerados" class="btn btn-ghost" hidden>Usar itens numerados do texto original (sem IA)</button>');
    el("#ia-buscar").insertAdjacentHTML("beforebegin",'<div><p id="ia-indice-info" class="metric-extra">Índice contextual por página. Será reutilizado nesta tela; novos pedidos não exigem reler toda a pasta. Ao sair, o índice é descartado.</p><button type="button" class="btn btn-ghost btn-sm" id="ia-refazer-indice">Descartar índice e refazer leitura</button></div>');
    el("#ia-buscar").setAttribute("aria-describedby","ia-busca-status");
    el("#ia-buscar").closest(".gemod-stage-footer").insertAdjacentHTML("afterend",'<div class="gemod-search-feedback"><p id="ia-busca-status"></p><progress id="ia-busca-progresso" class="gemod-progress" aria-label="Progresso da pesquisa local" hidden></progress><button type="button" class="btn btn-ghost btn-sm" id="ia-retomar-interpretacao" hidden>Retomar interpretação com IA</button><button type="button" class="btn btn-ghost btn-sm" id="ia-interromper-busca" hidden>Interromper busca local</button></div>');
    el("#ia-resumo").insertAdjacentHTML("afterend",'<p>Em cada apontamento, abra <strong>Ver caminhos e trechos</strong> para conferir o caminho na pasta, a página e a citação. Use <strong>Abrir PDF na página</strong> para consultar o documento.</p>');
    el("#ia-avaliar").insertAdjacentHTML("beforebegin",'<div><div class="gemod-ai-actions"><button type="button" class="btn btn-ghost btn-sm" id="ia-selecionar-todos">Selecionar pedidos com trechos</button><button type="button" class="btn btn-ghost btn-sm" id="ia-ver-resultados" hidden>Ver resultado da IA</button></div><p id="ia-custo" class="metric-extra" role="status" aria-live="polite"></p></div>');
    const interpretacaoPendente=()=>!!t.blocosSES && t.proximoBloco<t.blocosSES.length;
    function atualizarBusca(){
      const buscando=t.operacao==="buscar",pendente=interpretacaoPendente();
      el("#ia-busca-status").textContent=buscando?t.mensagemBusca:
        pendente?"Interpretação incompleta: "+t.proximoBloco+"/"+t.blocosSES.length+" blocos concluídos. "+el("#ia-status").textContent:
        t.controle?el("#ia-status").textContent:
        t.mensagemBusca||"Pronto para pesquisar os apontamentos selecionados. A leitura da pasta ocorre no seu computador e não consome créditos de IA.";
      el("#ia-busca-progresso").hidden=!buscando;
      el("#ia-interromper-busca").hidden=!buscando;
      el("#ia-retomar-interpretacao").hidden=!pendente||!!t.controle;
      el("#ia-retomar-interpretacao").disabled=!t.disponivel||!el("#ia-consentimento").checked||!!t.persistencia?.ocupada();
      el("#ia-retomar-interpretacao").textContent="Retomar interpretação com IA ("+t.proximoBloco+"/"+(t.blocosSES?.length||0)+")";
    }
    function status(s){if(tela===t){el("#ia-status").textContent=s;if(t.operacao==="buscar")t.mensagemBusca=s;atualizarBusca();}}
    function etapa(n) {
      const steps=container.querySelectorAll("[data-flow-step]");
      steps.forEach(x=>{x.classList.toggle("ativo",Number(x.dataset.flowStep)===n);x.classList.toggle("concluido",Number(x.dataset.flowStep)<n)});
    }
    function botoes(){
      const pendente=interpretacaoPendente(),ocupado=!!t.controle||!!t.persistencia?.ocupada()||!!global.GemodPastas?.ocupado?.();
      el("#ia-interpretar").textContent=pendente?(t.proximoBloco?"Retomar interpretação ("+t.proximoBloco+"/"+t.blocosSES.length+")":"Interpretar ofícios com IA ("+t.blocosSES.length+" consulta(s))"):"Preparar ofícios e estimar consultas (local)";
      el("#ia-interpretar").disabled = (pendente&&!t.disponivel) || !t.pastaNome || (pendente&&!el("#ia-consentimento").checked) || (!pendente&&!el("#ia-ses").files?.length) || ocupado;
      el("#ia-buscar").textContent=t.operacao==="buscar"?"Pesquisando na pasta…":
        pendente?"Concluir interpretação para pesquisar":!t.raiz?"Selecione a pasta desta análise":
        t.buscaEstado&&!t.buscaEstado.completos?"Retomar busca local":"Pesquisar evidências na pasta";
      el("#ia-buscar").disabled=ocupado||pendente;
      el("#ia-refazer-indice").disabled=ocupado;
      el("#ia-diagnostico").disabled=ocupado||!!t.verificando;
      el("#ia-selecionar-todos").disabled=ocupado;
      el("#ia-html").disabled=ocupado||!t.resultados.length;
      el("#ia-csv").disabled=ocupado||!t.resultados.length;
      el("#ia-salvar").disabled=ocupado||!t.resultados.length;
      el("#ia-usar-manual").disabled=ocupado;
      el("#ia-usar-numerados").disabled=ocupado;
      el("#ia-ses").disabled=ocupado;
      if(el("#pasta-selecionar"))el("#pasta-selecionar").disabled=ocupado||el("#pasta-parar")?.hidden===false||typeof global.showDirectoryPicker!=="function"||global.isSecureContext!==true;
      container.querySelectorAll("[data-gerar-imagem]").forEach(button=>{button.disabled=ocupado;});
      custo(t);atualizarBusca();t.persistencia?.atualizar();
    }
    function restaurar(estado) {
      global.GemodCompartilhar?.fechar();
      t.urls.forEach(url=>URL.revokeObjectURL(url));t.urls.clear();t.respostas.clear();t.avaliacoes.clear();
      t.raiz=null;t.indiceLocal=null;t.buscaEstado=null;t.assinaturaBusca=null;t.avaliados=0;
      for(const campo of ["pastaNome","achados","resultados","blocosSES","proximoBloco","parcialSES","cobertura","falhas","falhasPastas","buscaPendente","consultasFeitas","consultasReaproveitadas","documentoAtivo"])t[campo]=estado[campo];
      for(const row of t.resultados)if(row.avaliacaoConcluida){
        t.avaliacoes.set(chavePedido({modelo:row.avaliacaoModelo},row),{situacao:row.situacao,justificativa:row.justificativa,
          pendencias:row.pendencias,evidencias:row.evidencias,candidatoIds:row.candidatoIds});
      }
      el("#ia-ses").value="";el("#ia-consentimento").checked=false;el("#ia-manual-texto").value="";
      el("#ia-filtro").value=estado.filtro;
      el("#ia-pasta").textContent=t.pastaNome?"Pasta da análise salva: "+t.pastaNome+" · Selecione a pasta desta análise para abrir os PDFs originais.":"Selecione a pasta da entidade no inventário acima.";
      el("#pasta-status").textContent=t.pastaNome?"Análise recuperada. Os resultados podem ser consultados sem reler a pasta.":"Nenhuma pasta selecionada.";
      el("#pasta-totais").hidden=true;el("#pasta-resultado").hidden=true;
      tabelaFindings(t);mostrarLeituraSES(t);el("#ia-revisao").hidden=!t.achados.length;el("#ia-resultado").hidden=!t.resultados.length;
      if(t.resultados.length){
        mostrarCobertura(t);mostrarResultados(t);
        el("#ia-resumo").textContent=t.resultados.length+" pedido(s) recuperado(s), com caminhos, páginas e trechos salvos. "+(t.cobertura?.verificacaoParcial?"A busca original teve cobertura parcial.":"");
      }
      t.mensagemBusca=t.buscaPendente?"A busca local estava incompleta. Selecione a pasta desta análise e pesquise novamente; o índice será reconstruído sem consumo de IA.":"";
      el("#ia-indice-info").textContent="Os resultados salvos estão disponíveis. Uma nova pesquisa exige a pasta original e uma nova leitura local, sem cobrança de IA.";
      etapa(t.resultados.length?4:t.achados.length?3:t.pastaNome?2:1);
      status(interpretacaoPendente()?"Textos SES pendentes recuperados. Marque a autorização para interpretar somente os blocos restantes.":"Análise recuperada sem consultar a IA. As avaliações e as evidências salvas continuam disponíveis.");
      botoes();
    }
    t.atualizar=botoes;
    if(global.GemodAnalisesSalvas&&global.GemodAnaliseSnapshot)t.persistencia=global.GemodAnalisesSalvas.montar(container,{
      capturar:()=>capturarAnalise(t),restaurar,atualizar:botoes,
      ocupado:()=>!!t.controle||!!global.GemodPastas?.ocupado?.()||el("#pasta-parar")?.hidden===false,
      precisaPasta:()=>!!t.pastaNome&&!t.raiz,
      vincular(raiz){
        if(raiz.name!==t.pastaNome)throw new Error("Selecione a pasta original “"+t.pastaNome+"”. A pasta escolhida tem outro nome.");
        t.raiz=raiz;el("#ia-pasta").textContent="Pasta da entidade: "+raiz.name;
        if(!t.buscaPendente)t.mensagemBusca="Pasta vinculada. Você pode abrir os PDFs nos caminhos salvos ou fazer uma nova busca local.";
        if(t.resultados.length)mostrarResultados(t);botoes();
      },
      nova(){restaurar(global.GemodAnaliseSnapshot.normalizar({versao:1}));}
    });
    el("#ia-salvar").addEventListener("click",()=>{
      container.querySelector("[data-salvar-analise]")?.click();
      container.querySelector(".gemod-saved-analyses")?.scrollIntoView?.({block:"start"});
    });
    function trabalhando(flag,operacao=null){
      t.operacao=flag?operacao:null;
      el("#ia-progresso").hidden=!flag;el("#ia-cancelar").hidden=!flag;
      if(flag)el("#ia-progresso").removeAttribute("value");
      el("#ia-revisao").setAttribute("aria-busy",String(flag));
      el("#ia-ses").disabled=flag;botoes();
    }
    function limparInterpretacao() {
      t.mensagemBusca="";
      t.blocosSES=null;t.proximoBloco=0;t.parcialSES=false;t.achados=[];t.resultados=[];t.buscaEstado=null;t.buscaPendente=false;t.avaliados=0;t.assinaturaBusca=null;t.cobertura=null;t.falhas=[];t.falhasPastas=[];
      el("#ia-achados").replaceChildren();el("#ia-revisao").hidden=true;el("#ia-resultado").hidden=true;etapa(t.pastaNome?2:1);botoes();
      mostrarLeituraSES(t);t.documentoAtivo="";
    }
    el("#ia-ses").addEventListener("change",limparInterpretacao);
    el("#ia-consentimento").addEventListener("change",botoes);
    el("#ia-filtro").addEventListener("change",()=>mostrarResultados(t));
    el("#ia-cancelar").addEventListener("click",()=>t.controle?.abort());
    el("#ia-interromper-busca").addEventListener("click",()=>{if(t.operacao==="buscar")t.controle?.abort();});
    el("#ia-retomar-interpretacao").addEventListener("click",()=>el("#ia-interpretar").click());
    el("#ia-diagnostico").addEventListener("click",async()=>{
      if(t.controle||t.verificando)return;
      t.verificando=true;botoes();status("Consultando somente o acesso ao modelo, sem enviar documentos ou gerar tokens…");
      try {
        const result=await requisitar("/api/analise-ia/diagnostico","GET",null);
        if(tela!==t)return;
        t.modelo=result.modelo||t.modelo;
        status(result.mensagem||"Consulta do modelo concluída. Retome a interpretação para testar a análise.");
      }catch(error){if(tela===t)status(error.message+" Nenhum documento foi enviado neste diagnóstico. Após corrigir a configuração, retome os blocos já preparados.");}
      finally{if(tela===t){t.verificando=false;botoes();}}
    });
    el("#ia-refazer-indice").addEventListener("click",()=>{
      if(t.controle)return;
      t.mensagemBusca="";
      t.indiceLocal=null;t.buscaEstado=null;t.resultados=[];t.avaliacoes.clear();
      el("#ia-resultado").hidden=true;status("Índice descartado. A próxima pesquisa fará uma nova leitura local.");botoes();
    });
    el("#ia-selecionar-todos").addEventListener("click",()=>{
      t.resultados.forEach(row=>{row.paraIA=row.candidatos.some(candidate=>candidate.trecho);});mostrarResultados(t);
    });
    el("#ia-ver-resultados").addEventListener("click",()=>{
      if(t.controle||t.persistencia?.ocupada())return;
      focarAvaliacao(t);status("Resultado da IA exibido. Nenhuma nova consulta foi realizada.");
    });
    requisitar("/api/analise-ia/status","GET",null).then(r=>{
      if(tela!==t)return;
      t.disponivel=!!r.disponivel;
      t.modelo=r.modelo||t.modelo;
      el("#ia-disponibilidade").textContent=r.disponivel?
        "Modelo configurado: "+t.modelo+". Chave presente no Netlify; acesso ao modelo, saldo e permissões ainda não foram verificados. A autorização é exigida a cada análise." :
        "IA indisponível: "+(r.motivo||"Consulte o administrador.");
      botoes();
    }).catch(e=>{if(tela===t)el("#ia-disponibilidade").textContent="Não foi possível verificar a IA: "+e.message;});
    el("#ia-usar-manual").addEventListener("click",()=>{
      if(t.controle||t.persistencia?.ocupada())return;
      if(!t.pastaNome){status("Selecione antes a pasta da entidade.");return;}
      const linhas=el("#ia-manual-texto").value.split(/\n+/).map(s=>s.trim()).filter(s=>s.length>=12).slice(0,60);
      if(!linhas.length){status("Informe pelo menos 1 exigência com 12 caracteres.");return;}
      t.mensagemBusca="";
      t.blocosSES=null;t.proximoBloco=0;t.parcialSES=false;t.buscaEstado=null;t.buscaPendente=false;t.avaliados=0;t.assinaturaBusca=null;t.resultados=[];
      mostrarLeituraSES(t);t.documentoAtivo="";
      t.achados=linhas.map((descricao,i)=>({id:"m"+(i+1),origem:"Inserido manualmente",tipo:"solicitacao",local:"Digitado",descricao,
        providencia:descricao,referencia:"",trecho:"",termosBusca:[],selecionado:true}));
      tabelaFindings(t);el("#ia-revisao").hidden=false;el("#ia-resultado").hidden=true;
      etapa(3);status(linhas.length+" apontamentos manuais prontos para pesquisa local. Nenhuma chamada de IA foi feita.");botoes();
    });
    el("#ia-usar-numerados").addEventListener("click",()=>{
      if(t.controle||t.persistencia?.ocupada()||!global.GemodItensSES)return;
      const itens=documentosPreparados(t).flatMap(d=>global.GemodItensSES.detectar(d.paginas).map(item=>({...global.GemodItensSES.original(item,d.nome),documentoId:d.id,documentoSES:d.titulo})));
      if(!itens.length){status("Não há subitens numerados reconhecidos. Confira as páginas e inclua os pedidos manualmente.");return;}
      if(itens.length>60)t.parcialSES=true;
      t.achados=itens.slice(0,60).map((a,i)=>({...a,id:"l"+(i+1)}));t.documentoAtivo="";
      t.blocosSES=null;t.proximoBloco=0;t.buscaEstado=null;t.buscaPendente=false;t.resultados=[];t.mensagemBusca="";
      el("#ia-usar-numerados").hidden=true;tabelaFindings(t);el("#ia-revisao").hidden=false;el("#ia-resultado").hidden=true;etapa(3);
      status(t.achados.length+" itens numerados aproveitados do texto original, sem consulta à IA. Confira um documento por vez e verifique no texto completo se existem outros pedidos ou condições gerais.");botoes();el("#ia-revisao").scrollIntoView?.({block:"start"});
    });
    el("#ia-interpretar").addEventListener("click",async()=>{
      if(t.controle || t.persistencia?.ocupada() || !t.pastaNome || (interpretacaoPendente()&&(!t.disponivel||!el("#ia-consentimento").checked)))return;
      t.controle=new AbortController();t.mensagemBusca="";trabalhando(true,"interpretar");
      const sinal=t.controle.signal;
      if(!t.blocosSES){t.achados=[];t.resultados=[];el("#ia-revisao").hidden=true;el("#ia-resultado").hidden=true;}
      else if(!el("#ia-revisao").hidden)salvarEdicao(t);
      try {
        // Montar a fila 1 vez: após limite temporário, o próximo clique
        // retoma no bloco faltante sem cobrar outra interpretação dos anteriores.
        if(!t.blocosSES){
          const blocos=[];let parcial=false;
          let numeroFonte=0;
          for(const arq of Array.from(el("#ia-ses").files||[])){
            status("Extraindo o texto do documento SES: "+arq.name);
            const lido=await API.ler(arq,sinal,{indiceCompleto:true});
            if(lido.aviso){parcial=true;status(arq.name+": "+lido.aviso);}
            const fatias=partesParaIA(arq.name,lido.partes);
            const documentoId="ses-"+(++numeroFonte),documentoSES=global.GemodFontesSES?.identificarDocumento(arq.name,lido.partes)||arq.name;
            if(fatias.parcial)parcial=true;
            if(!fatias.grupos.length)throw new Error(arq.name+" não possui texto selecionável. É necessário OCR antes da interpretação.");
            for(const fatia of fatias.grupos){
              if(blocos.length>=MAX_CHUNKS){parcial=true;break;}
              blocos.push({...fatia,documentoId,documentoSES});
            }
          }
          if(!blocos.length)throw new Error("Não foi encontrado texto da SES para interpretar.");
          t.blocosSES=blocos;t.proximoBloco=0;t.parcialSES=parcial;
          mostrarLeituraSES(t);
          status("Leitura local preparada: "+blocos.length+" consulta(s) à IA para interpretar os ofícios. Nenhuma foi enviada. "+
            (parcial?"ATENÇÃO: há conteúdo SES fora dos limites de leitura ou interpretação; a análise será parcial. ":"")+"Confira a autorização e clique em Interpretar ofícios com IA para enviar.");
          return;
        }
        while(t.proximoBloco<t.blocosSES.length){
          const fatia=t.blocosSES[t.proximoBloco];
          status("Interpretando apontamentos técnicos: "+fatia.nome+" (bloco "+(t.proximoBloco+1)+"/"+t.blocosSES.length+")");
          const res=await requisitarEconomico(t,"/api/analise-ia/extrair",{nome:fatia.nome,paginas:fatia.paginas,autorizado:true},sinal);
          if(t.achados.length)salvarEdicao(t);
          t.achados.push(...(res.itens||[]).map(x=>({...x,documentoId:fatia.documentoId,documentoSES:fatia.documentoSES,selecionado:x.selecionado!==false})));
          if(res.leituraParcial)t.parcialSES=true;
          t.proximoBloco++;
          if(t.blocosSES[t.proximoBloco]?.documentoId!==fatia.documentoId){
            // Check the whole prepared document again so an item continuing
            // across an API block boundary is kept with all its pages.
            const blocosDocumento=t.blocosSES.filter(b=>b.documentoId===fatia.documentoId&&b.nome===fatia.nome);
            const paginas=blocosDocumento.flatMap(b=>b.paginas||[]);
            const deste=t.achados.filter(a=>a.documentoId===fatia.documentoId&&a.origem===fatia.nome);
            if(global.GemodItensSES&&blocosDocumento.every(b=>b.paginas?.length)){
              const conferidos=global.GemodItensSES.individualizar(deste,paginas,fatia.nome);
              t.achados=t.achados.filter(a=>!deste.includes(a)).concat(conferidos.itens.map(a=>({...a,documentoId:fatia.documentoId,documentoSES:fatia.documentoSES})));
              if(conferidos.leituraParcial)t.parcialSES=true;
            }
            if(t.achados.length){tabelaFindings(t);el("#ia-revisao").hidden=false;}
          }
        }
        if(tela!==t)return;
        t.blocosSES=null;t.proximoBloco=0;
        if(!t.achados.length)throw new Error("A IA não identificou apontamentos técnicos nesses documentos. Confira os arquivos.");
        if(t.achados.length>60)t.parcialSES=true;
        salvarEdicao(t);
        t.achados=t.achados.slice(0,60);
        tabelaFindings(t);
        el("#ia-revisao").hidden=false;
        t.buscaEstado=null;t.avaliados=0;t.assinaturaBusca=null;etapa(3);
        const pedidos=t.achados.filter(a=>a.extracao!=="sem_item").length,observacoes=t.achados.length-pedidos;
        status(pedidos+" pedido(s) disponível(is)"+(observacoes?" e "+observacoes+" observação(ões) geral(is) inicialmente fora da busca":"")+". Confira primeiro os pedidos de um PDF; use Conferir próximo documento para revisar o seguinte antes de pesquisar evidências."+(t.achados.some(a=>a.extracao==="texto_original")?" Itens que a IA não individualizou foram preservados como texto original, sem nova consulta.":"")+(t.parcialSES?" Atenção: o texto SES foi analisado parcialmente.":""));
      }catch(e){
        if(tela!==t)return;
        const pendente=!!t.blocosSES&&t.proximoBloco<t.blocosSES.length;
        if(t.achados.length){t.achados=t.achados.slice(0,60);tabelaFindings(t);el("#ia-revisao").hidden=false;}
        const aguarde=e.aguarde?" Aguarde pelo menos "+e.aguarde+" s antes de retomar.":"";
        status((e.name==="AbortError"?"Interrompido.":e.message)+aguarde+(pendente?" Progresso preservado: "+t.proximoBloco+"/"+t.blocosSES.length+" blocos. "+
          (e.configuracao?"Verifique o acesso ao modelo e corrija a configuração antes de retomar; repetir sem alteração mantém o erro.":"Retome a interpretação sem reenviar os blocos concluídos. Não prossiga à busca até terminar a interpretação."):""));
      }finally{if(tela===t){t.controle=null;trabalhando(false)}}
    });
    el("#ia-buscar").addEventListener("click",async()=>{
      if(t.controle||t.persistencia?.ocupada()||t.blocosSES&&t.proximoBloco<t.blocosSES.length)return;
      if(!t.raiz){status("Selecione a pasta desta análise em Minhas análises para realizar uma nova pesquisa local.");container.querySelector("[data-vincular-pasta]")?.scrollIntoView?.({block:"center"});return;}
      salvarEdicao(t);
      const items=t.achados.filter(a=>a.selecionado&&a.descricao&&a.providencia);
      if(!items.length){status("Selecione pelo menos 1 apontamento válido.");return;}
      if(!global.GemodBuscaLocal){status("Módulo de indexação indisponível. Atualize o navegador.");return;}
      t.controle=new AbortController();t.mensagemBusca="Preparando pesquisa local. Nenhum documento da pasta será enviado à IA.";
      el("#ia-busca-progresso").removeAttribute("value");
      trabalhando(true,"buscar");etapa(3);
      const sinal=t.controle.signal;
      el("#ia-buscar").disabled=true;
      try{
        const assinatura=JSON.stringify(items.map(a=>[a.descricao,a.providencia,a.referencia,a.termosBusca,a.consultasAlternativas]));
        if(t.buscaEstado && t.assinaturaBusca!==assinatura) {
          t.buscaEstado=null;
          status("Apontamentos alterados: a pesquisa será reiniciada para evitar misturar resultados.");
        }
        t.assinaturaBusca=assinatura;
        const result=await global.GemodBuscaLocal.pesquisar(t.raiz,items,API,{
          estado:t.buscaEstado,signal:sinal,cache:t.indiceLocal,
          onCache:cache=>{t.indiceLocal=cache;},
          corresponder:(item,doc,api)=>candidata(doc,item,api),
          onState:state=>{t.buscaEstado=state;},
          onIndex:s=>{
            el("#ia-progresso").removeAttribute("value");el("#ia-busca-progresso").removeAttribute("value");
            status(s);
          },
          onProgress:s=>{
            for(const selector of ["#ia-progresso","#ia-busca-progresso"]){
              el(selector).max=Math.max(1,s.listados);el(selector).value=s.processados;
            }
            status("Lendo conteúdo local: "+s.processados.toLocaleString("pt-BR")+"/"+s.listados.toLocaleString("pt-BR")+
            " arquivos ("+s.progresso+"%). "+s.comTexto+" com texto; "+s.semTexto+" sem texto; "+s.erros+" falhas.");
          }
        });
        if(tela!==t)return;
        t.buscaEstado=null;t.buscaPendente=false;t.avaliados=0;
        t.indiceLocal=result.cache||t.indiceLocal;
        t.cobertura=result.cobertura;t.falhas=result.falhas;
        t.falhasPastas=result.estado.indice.falhasPastas||(result.estado.indice.erros||[]).map(caminho=>({caminho,motivo:"Não foi possível listar esta pasta; o motivo original não foi registrado nesta leitura"}));
        t.resultados=items.map((a,i)=>({...a,id:"p"+(i+1),candidatos:result.candidatos[i],
          situacao:result.candidatos[i].some(c=>c.trecho)?"localizada_sem_analise":"nao_verificavel",
          justificativa:result.candidatos[i].length?"Trechos selecionados por conceitos, termos específicos e referências. A correspondência local ainda exige conferência dos documentos.":"Não houve evidência textual compatível entre os arquivos pesquisáveis. Isso não demonstra ausência de documento.",pendencias:[],paraIA:false}));
        el("#ia-resumo").textContent=t.resultados.length+" apontamentos; "+
          t.resultados.filter(x=>x.candidatos.some(c=>c.trecho)).length+" com trechos candidatos. "+
          (result.cobertura.verificacaoParcial?"Cobertura parcial: há arquivos não pesquisáveis ou inacessíveis. ":"A leitura de todos os formatos suportados listados foi concluída. ")+
          "A pesquisa local não consumiu tokens de IA.";
        el("#ia-indice-info").textContent=(result.cobertura.reaproveitados||0)+" arquivo(s) reaproveitados do índice desta tela. Apenas arquivos novos ou alterados foram indexados novamente; os candidatos foram reabertos para validar os trechos. Ao sair, o índice é descartado.";
        mostrarCobertura(t);mostrarResultados(t);
        el("#ia-resultado").hidden=false;etapa(4);
        status("Busca local concluída. Abra Ver caminhos e trechos em cada apontamento para consultar os arquivos e as páginas. Conferir estes resultados não consome créditos de IA.");
        el("#ia-resultado").scrollIntoView?.({block:"start"});
      }catch(e){
        if(tela===t)status(e.name==="AbortError"?
          "Busca interrompida. O progresso local foi preservado nesta página; clique em Retomar busca local.":
          "Não foi possível concluir a pesquisa local: "+e.message);
      }finally{if(tela===t){t.controle=null;trabalhando(false)}}
    });
    el("#ia-avaliar").addEventListener("click",async()=>{
      if(t.controle||t.persistencia?.ocupada()||!t.resultados)return;
      const verificaveis=t.resultados.filter(r=>r.paraIA&&r.candidatos.some(c=>c.trecho));
      if(!verificaveis.length)return;
      if(verificaveis.every(row=>t.avaliacoes.has(chavePedido(t,row)))){
        focarAvaliacao(t);status("Resultado da IA reaproveitado e exibido. Nenhuma nova consulta foi realizada.");return;
      }
      if(!t.disponivel||!el("#ia-consentimento").checked)return;
      t.controle=new AbortController();trabalhando(true,"avaliar");
      const sinal=t.controle.signal;
      try {
        for(const row of verificaveis) {
          const previous=t.avaliacoes.get(chavePedido(t,row));
          if(previous)Object.assign(row,JSON.parse(JSON.stringify(previous)));
        }
        const batches=lotes(verificaveis.filter(row=>!t.avaliacoes.has(chavePedido(t,row))));
        let feitas=0;
        for(const lote of batches){
          status("Confrontando somente os pedidos selecionados: lote "+(++feitas)+" de "+batches.length);
          const payload=lote.map(payloadPedido);
          const resp=await requisitarEconomico(t,"/api/analise-ia/avaliar",{autorizado:true,itens:payload},sinal);
          let recebidos=0;
          for(const a of resp.itens||[]){
            const row=lote.find(r=>r.id===a.id);
            if(row){const result={situacao:a.situacao,justificativa:a.justificativa,pendencias:a.pendencias||[],evidencias:a.evidencias||[],candidatoIds:a.candidatoIds||[]};
              t.avaliacoes.set(chavePedido(t,row),result);Object.assign(row,result,{avaliacaoConcluida:true,avaliacaoModelo:t.modelo});recebidos++;}
          }
          mostrarResultados(t);
          if(recebidos!==lote.length)throw new Error("A IA deixou pedidos sem resposta. Os resultados recebidos foram preservados; selecione os pendentes para retomar.");
        }
        mostrarResultados(t);
        status("Confronto dos pedidos selecionados concluído. Resultados idênticos são reaproveitados nesta tela sem nova consulta. As citações devem ser revisadas pela equipe técnica.");
        focarAvaliacao(t);
      }catch(e){if(tela===t)status((e.name==="AbortError"?"Avaliação interrompida.":e.message)+
        " Os lotes já avaliados foram preservados. Clique novamente para continuar, sem repetir lotes concluídos.")}
      finally{if(tela===t){t.controle=null;trabalhando(false)}}
    });
    el("#ia-html").addEventListener("click",()=>{
      if(t.controle||!t.resultados.length)return;
      try{
        if(!global.GemodRelatorio)throw new Error("Organizador de relatórios indisponível. Guarde o CSV e abra a página de conversão para aproveitar estes resultados.");
        global.GemodRelatorio.baixarHTML({resultados:t.resultados,pasta:t.pastaNome,cobertura:t.cobertura,
          falhas:[...(t.falhas||[]),...(t.falhasPastas||[])]});
        status("Download do relatório solicitado. Abra o arquivo .html salvo para consultar os pedidos, caminhos, páginas e trechos depois, sem internet ou cobrança de IA.");
      }catch(erro){status(erro.message);}
    });
    el("#ia-csv").addEventListener("click",()=>{
      if(!t.resultados.length)return;
      const url=URL.createObjectURL(new Blob([csv(t.resultados,t.cobertura,[...(t.falhas||[]),...(t.falhasPastas||[])])],{type:"text/csv;charset=utf-8"}));
      const link=document.createElement("a");link.href=url;
      link.download="gemod-analise-tecnica-"+new Date().toISOString().slice(0,10)+".csv";link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }
  function definirPasta(raiz) {
    if(!tela)return;
    tela.controle?.abort();tela.raiz=raiz;tela.pastaNome=raiz.name;tela.achados=[];tela.resultados=[];tela.blocosSES=null;tela.proximoBloco=0;tela.parcialSES=false;tela.buscaEstado=null;tela.buscaPendente=false;tela.avaliados=0;tela.assinaturaBusca=null;tela.cobertura=null;tela.falhas=[];tela.falhasPastas=[];tela.mensagemBusca="";
    tela.documentoAtivo="";mostrarLeituraSES(tela);
    tela.consultasFeitas=0;tela.consultasReaproveitadas=0;
    tela.indiceLocal=null;tela.avaliacoes.clear();tela.respostas.clear();tela.urls.forEach(url=>URL.revokeObjectURL(url));tela.urls.clear();
    const c=tela.container;c.querySelector("#ia-pasta").textContent="Pasta da entidade: "+raiz.name;
    c.querySelector("#ia-achados").replaceChildren();c.querySelector("#ia-ses").value="";c.querySelector("#ia-consentimento").checked=false;
    c.querySelector("#ia-revisao").hidden=true;c.querySelector("#ia-resultado").hidden=true;c.querySelectorAll("[data-flow-step]").forEach(x=>{x.classList.toggle("ativo",x.dataset.flowStep==="2");x.classList.toggle("concluido",x.dataset.flowStep==="1")});
    tela.persistencia?.pastaNova(raiz.name);tela.atualizar();
  }
  global.GemodAnaliseIA={ montar,definirPasta,sair:cancelar,partesParaIA,consulta,preselecionar,candidatosDoItem,csv,
    abrir:id=>tela?.persistencia?.abrir(id),ativa:()=>!!tela,podeSair:()=>tela?.persistencia?.podeSair()!==false,atualizar:()=>tela?.atualizar() };
})(typeof window==="undefined"?globalThis:window);
