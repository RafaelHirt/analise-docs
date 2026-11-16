"use strict";
const Snapshot = require("../../public/analise-snapshot.js");

function registrar({ route, store, requests, crypto, ok, created, erro, parseBody }) {
  const uid = ctx => String(ctx.user.id);
  const chave = (ctx,id) => uid(ctx) + "/" + id;
  const valido = id => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  const resumo = r => ({id:r.id,nome:r.nome,criadoEm:r.criadoEm,atualizadoEm:r.atualizadoEm,pastaNome:r.estado.pastaNome,
    etapa:Snapshot.etapa(r.estado),pedidos:r.estado.achados.filter(a=>a.extracao!=="sem_item").length,trechos:r.estado.resultados.reduce((n,r)=>n+r.candidatos.length,0)});
  function entrada(ctx) {
    const raw = ctx.event.isBase64Encoded ? Buffer.from(ctx.event.body||"","base64") : Buffer.from(ctx.event.body||"","utf8");
    if (raw.byteLength > Snapshot.MAX_BYTES) throw Object.assign(new Error("Análise acima do limite de 3 MiB. Exporte o relatório para preservar os resultados."),{statusCode:413});
    const b = parseBody(ctx.event);
    if (typeof b.nome !== "string" || !b.nome.trim() || b.nome.trim().length > 140) throw Object.assign(new Error("Informe um nome de até 140 caracteres para a análise."),{statusCode:400});
    if (b.id != null && !valido(b.id)) throw Object.assign(new Error("Identificador da análise inválido."),{statusCode:400});
    return {id:b.id,nome:b.nome.trim(),estado:Snapshot.normalizar(b.estado)};
  }
  const preparar = (ctx,id) => { const request=requests.getStore(); request.primary="analises/"+chave(ctx,id);request.expected=undefined; };
  route("GET","analises",async ctx=>{
    if (!ctx.user) return erro(401,"Não autenticado.");
    const s=store("analises"),{blobs}=await s.list({prefix:uid(ctx)+"/",paginate:false}),out=[];
    for(let i=0;i<(blobs||[]).length;i+=20){
      const metas=await Promise.all(blobs.slice(i,i+20).map(b=>s.getMetadata(b.key)));
      for(const m of metas)if(m?.metadata?.donoId===uid(ctx)&&valido(m.metadata.id)){
        const {donoId,...item}=m.metadata;out.push(item);
      }
    }
    out.sort((a,b)=>String(b.atualizadoEm).localeCompare(String(a.atualizadoEm))||a.id.localeCompare(b.id));
    return ok(out);
  });
  route("POST","analises",async ctx=>{
    if (!ctx.user) return erro(401,"Não autenticado.");
    const b=entrada(ctx),id=b.id||crypto.randomUUID(),agora=new Date().toISOString();
    const registro={id,donoId:uid(ctx),nome:b.nome,criadoEm:agora,atualizadoEm:agora,estado:b.estado};
    preparar(ctx,id);
    const s=store("analises");
    const igual=r=>r&&r.donoId===uid(ctx)&&r.nome===b.nome&&JSON.stringify(r.estado)===JSON.stringify(b.estado);
    const existente=await s.get(chave(ctx,id),{type:"json"});
    if (existente) return igual(existente)?ok(resumo(existente)):erro(409,"Esta análise já foi salva. Reabra a versão atual ou use Salvar como nova análise.");
    try { await s.setJSON(chave(ctx,id),registro,{onlyIfNew:true,metadata:{...resumo(registro),donoId:uid(ctx)}}); }
    catch(e){
      if(e.statusCode!==409)throw e;
      const atual=await s.get(chave(ctx,id),{type:"json"});if(igual(atual))return ok(resumo(atual));throw e;
    }
    return created(resumo(registro));
  });
  route("GET","analises/:id",async ctx=>{
    if (!ctx.user) return erro(401,"Não autenticado.");
    if (!valido(ctx.params.id)) return erro(400,"Identificador da análise inválido.");
    preparar(ctx,ctx.params.id);
    const r=await store("analises").get(chave(ctx,ctx.params.id),{type:"json"});
    if (!r||r.donoId!==uid(ctx)) return erro(404,"Análise não encontrada.");
    const {donoId,...out}=r;return ok(out);
  });
  route("PUT","analises/:id",async ctx=>{
    if (!ctx.user) return erro(401,"Não autenticado.");
    if (!valido(ctx.params.id)) return erro(400,"Identificador da análise inválido.");
    preparar(ctx,ctx.params.id);
    const s=store("analises"),r=await s.get(chave(ctx,ctx.params.id),{type:"json"});
    if (!r||r.donoId!==uid(ctx)) return erro(404,"Análise não encontrada.");
    const expected=ctx.event.headers["if-match"]||ctx.event.headers["If-Match"];
    if (!expected) return erro(428,"Reabra a análise antes de salvar suas alterações.");
    if (expected!==requests.getStore().etag) return erro(409,"Esta análise foi alterada em outra aba. Seu trabalho foi preservado; reabra a versão salva ou use Salvar como nova análise.");
    const b=entrada(ctx),atualizado={...r,nome:b.nome,estado:b.estado,atualizadoEm:new Date().toISOString()};
    await s.setJSON(chave(ctx,ctx.params.id),atualizado,{metadata:{...resumo(atualizado),donoId:uid(ctx)}});
    return ok(resumo(atualizado));
  });
}
module.exports={registrar};
