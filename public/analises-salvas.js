(function (global) {
  "use strict";
  const etapas={pasta:"Pasta selecionada",oficios_preparados:"Ofícios preparados",interpretacao_parcial:"Interpretação pendente",pedidos:"Pedidos revisáveis",pesquisa_pendente:"Nova busca local necessária",resultados:"Resultados disponíveis",confronto:"Com avaliações salvas"};
  const data=value=>new Date(value).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
  const digital=(nome,estado)=>JSON.stringify({nome,estado:{...estado,modelo:""}});
  function montar(container,opcoes) {
    let ativa=true,ocupada=false,atual=null,rascunhoId=null,ultima=null;const controle=new AbortController();
    const card=global.document.createElement("section");card.className="painel gemod-flow-card gemod-saved-analyses";
    card.innerHTML='<div class="painel-head"><h2>Minhas análises</h2><button class="btn btn-ghost btn-sm" type="button" data-atualizar-analises>Atualizar lista</button></div><div class="painel-body"><div class="gemod-save-controls"><label>Nome da análise<input data-nome-analise maxlength="140" placeholder="Ex.: RAFIC · dezembro de 2024"></label><button type="button" class="btn btn-primary" data-salvar-analise>Salvar análise</button><button type="button" class="btn btn-ghost" data-copiar-analise hidden>Salvar como nova</button><button type="button" class="btn btn-ghost" data-nova-analise>Nova análise</button><button type="button" class="btn btn-ghost" data-vincular-pasta hidden>Selecionar pasta desta análise</button></div><p class="gemod-save-status" role="status" aria-live="polite" data-analise-status>Dê um nome e salve para voltar aos pedidos e resultados depois.</p><p class="metric-extra">Os resultados e os textos SES pendentes ficam vinculados ao seu login. Os PDFs da entidade permanecem no computador. Reabrir uma análise não consulta a IA.</p><div data-lista-analises aria-live="polite"></div></div>';
    const hero=container.querySelector(".gemod-flow-hero");if(hero)hero.after(card);else container.prepend(card);
    const el=s=>card.querySelector(s),nome=el("[data-nome-analise]"),status=msg=>{if(ativa)el("[data-analise-status]").textContent=msg;};
    const ocupado=()=>ocupada||!!opcoes.ocupado();
    const haDados=()=>{try{const s=opcoes.capturar();return!!(s.pastaNome||s.achados.length||s.blocosSES?.length||s.resultados.length);}catch{return true;}};
    function atualizar() {
      if(!ativa)return;
      el("[data-salvar-analise]").disabled=ocupado()||!haDados();
      el("[data-copiar-analise]").hidden=!atual&&!rascunhoId;
      el("[data-copiar-analise]").disabled=ocupado()||!haDados();
      el("[data-nova-analise]").disabled=ocupado();
      el("[data-vincular-pasta]").hidden=!opcoes.precisaPasta();
      el("[data-vincular-pasta]").disabled=ocupado();
      el("[data-atualizar-analises]").disabled=ocupada;
      card.querySelectorAll("[data-abrir-analise]").forEach(b=>{b.disabled=ocupado();});
      if(!ocupada&&ultima&&temAlteracoes()&&/^(Salvo em|Análise reaberta)/.test(el("[data-analise-status]").textContent))status("Há alterações ainda não salvas. Use Salvar análise para atualizar sua cópia.");
    }
    async function requisitar(path,method="GET",body,versao) {
      const headers={"Content-Type":"application/json"};if(versao)headers["If-Match"]=versao;
      const response=await global.fetch("/api/"+path,{method,credentials:"same-origin",headers,body:body?JSON.stringify(body):undefined,signal:controle.signal});
      const payload=await response.json().catch(()=>({}));
      if(response.status===401){global.tratarSessaoExpirada?.();throw new Error("Sessão expirada. Entre novamente para acessar suas análises.");}
      if(!response.ok)throw new Error(payload.erro||"Não foi possível acessar as análises salvas.");
      return {payload,versao:response.headers?.get("x-record-version")||null};
    }
    function temAlteracoes() {
      if(!haDados())return false;
      try{return ultima!==digital(nome.value.trim(),opcoes.capturar());}catch{return true;}
    }
    function podeSair() {
      if(!ativa)return true;
      if(ocupado())return global.confirm("Há uma operação em andamento. Deseja sair e interromper esta tela?");
      return !temAlteracoes()||global.confirm("Há alterações desta análise que ainda não foram salvas. Deseja sair mesmo assim?");
    }
    async function abrirAnalise(id) {
      if(ocupado()){status("Aguarde ou interrompa a operação atual antes de reabrir outra análise.");return;}
      if(temAlteracoes()&&!global.confirm("Reabrir substituirá as alterações ainda não salvas desta tela. Deseja continuar?"))return;
      ocupada=true;atualizar();opcoes.atualizar();status("Reabrindo a análise salva…");
      try{
        const r=await requisitar("analises/"+encodeURIComponent(id));if(!ativa)return;
        opcoes.restaurar(global.GemodAnaliseSnapshot.normalizar(r.payload.estado));
        atual={id:r.payload.id,versao:r.versao};rascunhoId=null;nome.value=r.payload.nome;
        ultima=digital(nome.value.trim(),opcoes.capturar());
        status("Análise reaberta · salva em "+data(r.payload.atualizadoEm)+". Os resultados foram recuperados sem nova consulta à IA.");
        global.dispatchEvent(new global.CustomEvent("analise:aberta"));
      }catch(e){if(ativa){status(e.message);global.dispatchEvent(new global.CustomEvent("analise:erro",{detail:e.message}));}}finally{if(ativa){ocupada=false;atualizar();opcoes.atualizar();}}

    }
    async function listar() {
      if(!ativa)return;
      const area=el("[data-lista-analises]");area.textContent="Carregando suas análises…";
      try{
        const {payload}=await requisitar("analises");if(!ativa)return;
        area.replaceChildren();
        if(!payload.length){area.textContent="Nenhuma análise salva na sua conta.";return;}
        for(const item of payload){
          const row=global.document.createElement("div");row.className="gemod-saved-row";
          const details=global.document.createElement("div"),titulo=global.document.createElement("strong"),info=global.document.createElement("p");
          titulo.textContent=item.nome;info.textContent=data(item.atualizadoEm)+" · "+(etapas[item.etapa]||"Análise salva")+" · "+item.pedidos+" pedido(s) · "+item.trechos+" trecho(s)";
          details.append(titulo,info);const abrir=global.document.createElement("button");abrir.type="button";abrir.className="btn btn-ghost btn-sm";abrir.dataset.abrirAnalise=item.id;abrir.textContent="Reabrir análise";
          abrir.addEventListener("click",()=>abrirAnalise(item.id));
          row.append(details,abrir);area.append(row);
        }
        atualizar();
      }catch(e){if(ativa)area.textContent=e.message+" Use Atualizar lista para tentar novamente.";}
    }
    async function salvar(comoNova=false) {
      if(ocupado()){status("Aguarde ou interrompa a leitura antes de salvar a análise.");return;}
      const titulo=nome.value.trim();if(!titulo){status("Informe um nome para a análise.");nome.focus();return;}
      let estado;try{estado=global.GemodAnaliseSnapshot.normalizar(opcoes.capturar());}catch(e){status(e.message);return;}
      if(comoNova){atual=null;rascunhoId=null;ultima=null;}
      if(!atual&&!rascunhoId)rascunhoId=global.crypto.randomUUID();
      const corpo={nome:titulo,estado,...(!atual?{id:rascunhoId}:{})};
      const antes=digital(titulo,estado);ocupada=true;atualizar();opcoes.atualizar();status("Salvando análise… Aguarde a confirmação.");
      try{
        const r=await requisitar(atual?"analises/"+encodeURIComponent(atual.id):"analises",atual?"PUT":"POST",corpo,atual?.versao);if(!ativa)return;
        atual={id:r.payload.id,versao:r.versao};rascunhoId=null;ultima=antes;
        const mudou=antes!==digital(nome.value.trim(),opcoes.capturar());
        status("Salvo em "+data(r.payload.atualizadoEm)+(mudou?". Há alterações recentes ainda não salvas.":". Você pode sair e reabrir em Minhas análises."));
        await listar();
        global.dispatchEvent(new global.CustomEvent("analise:salva"));
      }catch(e){if(ativa)status(e.message+" Seu trabalho continua nesta tela.");}
      finally{if(ativa){ocupada=false;atualizar();opcoes.atualizar();}}
    }
    el("[data-salvar-analise]").addEventListener("click",()=>salvar());
    el("[data-copiar-analise]").addEventListener("click",()=>salvar(true));
    el("[data-atualizar-analises]").addEventListener("click",listar);
    el("[data-vincular-pasta]").addEventListener("click",async()=>{
      if(ocupado())return;
      try{if(!global.showDirectoryPicker)throw new Error("Use Chrome ou Edge para selecionar a pasta original.");
        const raiz=await global.showDirectoryPicker({mode:"read",id:"gemod-analise-salva"});if(!ativa)return;
        opcoes.vincular(raiz);status("Pasta vinculada. Os arquivos serão conferidos individualmente quando abertos.");atualizar();opcoes.atualizar();
      }catch(e){if(ativa&&e.name!=="AbortError")status(e.message);}
    });
    el("[data-nova-analise]").addEventListener("click",()=>{
      if(ocupado()||temAlteracoes()&&!global.confirm("Iniciar outra análise descartará as alterações ainda não salvas desta tela. Deseja continuar?"))return;
      atual=null;rascunhoId=null;ultima=null;nome.value="";opcoes.nova();status("Nova análise. Selecione a pasta e os documentos da SES.");atualizar();opcoes.atualizar();
    });
    nome.addEventListener("input",()=>{if(ultima)status("Nome alterado. Salve para atualizar a análise.");});
    const mudou=event=>{if(!card.contains(event.target))atualizar();};
    container.addEventListener("input",mudou);container.addEventListener("change",mudou);
    function antesDeSair(event){if(temAlteracoes()||ocupada){event.preventDefault();event.returnValue="";}}
    global.addEventListener("beforeunload",antesDeSair);
    listar();atualizar();
    return {abrir:abrirAnalise,atualizar,temAlteracoes,podeSair,ocupada:()=>ocupada,
      pastaNova(nomePasta){atual=null;rascunhoId=null;ultima=null;nome.value=String(nomePasta||"").slice(0,140);status("Análise ainda não salva. Use Salvar análise para voltar a ela depois.");atualizar();},
      sair(){ativa=false;controle.abort();container.removeEventListener("input",mudou);container.removeEventListener("change",mudou);global.removeEventListener("beforeunload",antesDeSair);card.remove();}};
  }
  global.GemodAnalisesSalvas={montar};
})(window);
