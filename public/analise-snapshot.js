(function (global) {
  "use strict";
  const MAX_BYTES = 3 * 1024 * 1024;
  const falha = mensagem => { throw Object.assign(new Error(mensagem), { statusCode: 400 }); };
  const objeto = (v, nome) => v && typeof v === "object" && !Array.isArray(v) ? v : falha(nome + " inválido.");
  function texto(v, max, nome) {
    if (v == null) return "";
    if (typeof v !== "string" || v.length > max) falha(nome + " inválido ou acima do limite.");
    return v;
  }
  function numero(v, max = Number.MAX_SAFE_INTEGER, padrao = 0) {
    if (v == null) return padrao;
    if (!Number.isSafeInteger(v) || v < 0 || v > max) falha("Contagem ou posição inválida na análise.");
    return v;
  }
  function lista(v, max, transformar) {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > max) falha("Quantidade de itens acima do limite da análise.");
    return v.map(transformar);
  }
  const textos = (v, max, tamanho) => lista(v, max, x => texto(x, tamanho, "Texto"));
  const flags = (origem, destino, campos) => { for (const campo of campos) destino[campo] = origem[campo] === true; };
  function apontamento(valor) {
    const v = objeto(valor, "Pedido"), out = {};
    for (const [campo, max] of [["id",100],["origem",500],["tipo",30],["descricao",4000],["providencia",4000],["referencia",1500],
      ["documentoSES",500],["documentoId",100],["trecho",4000],["contextoSES",12000],["contextoMetodo",60],["local",250],["item",40],["extracao",40]]) out[campo] = texto(v[campo], max, campo);
    flags(v, out, ["fonteVerificada","paginaConfirmada","contextoParcial"]);
    out.selecionado = v.selecionado !== false;
    out.termosBusca = textos(v.termosBusca, 10, 100); out.consultasAlternativas = textos(v.consultasAlternativas, 4, 250);
    return out;
  }
  function candidato(valor) {
    const v = objeto(valor, "Candidato"), out = {};
    for (const [campo,max] of [["nome",500],["caminho",4096],["local",250],["trecho",12000]]) out[campo] = texto(v[campo], max, campo);
    if (!out.caminho) falha("Caminho do candidato ausente.");
    for (const campo of ["size","lastModified","inicio","fim"]) if (v[campo] != null) out[campo] = numero(v[campo]);
    if (v.hash != null) { if (!/^[a-f0-9]{64}$/i.test(v.hash)) falha("Assinatura do candidato inválida."); out.hash = v.hash; }
    out.pontos = Number.isFinite(v.pontos) ? v.pontos : 0;
    out.achados = textos(v.achados, 100, 500); out.motivos = textos(v.motivos, 30, 1500); out.alertas = textos(v.alertas, 30, 1500);
    return out;
  }
  function resultado(valor) {
    const v = objeto(valor, "Resultado"), out = apontamento(v);
    const situacoes = ["localizada_sem_analise","evidencia_compativel","insuficiente","divergente","nao_verificavel","sem_candidato"];
    if (!situacoes.includes(v.situacao)) falha("Situação de conferência inválida.");
    out.situacao = v.situacao; out.justificativa = texto(v.justificativa, 4000, "Justificativa");
    out.pendencias = textos(v.pendencias, 20, 1000); out.candidatos = lista(v.candidatos, 6, candidato);
    out.evidencias = lista(v.evidencias, 6, e => ({ candidatoId: texto(e?.candidatoId, 40, "Candidato citado"), trecho: texto(e?.trecho, 1000, "Citação") }));
    out.candidatoIds = textos(v.candidatoIds, 6, 40); out.paraIA = v.paraIA === true;
    out.avaliacaoConcluida = v.avaliacaoConcluida === true;
    out.avaliacaoModelo = out.avaliacaoConcluida ? texto(v.avaliacaoModelo, 120, "Modelo da avaliação") : "";
    return out;
  }
  function cobertura(valor) {
    if (valor == null) return null;
    const v = objeto(valor, "Cobertura"), out = {};
    for (const campo of ["listados","suportados","naoSuportados","lidos","comTexto","semTexto","parciais","erros","pastasFalhas","ignoradosLimite","reaproveitados","arquivosAlterados","processados","progresso","avaliaveis"]) out[campo] = numero(v[campo]);
    flags(v, out, ["limiteInventario","limiteIndice","completo","verificacaoParcial"]); return out;
  }
  function normalizar(valor) {
    const v = objeto(valor, "Análise");
    if (v.versao !== 1) falha("Versão do arquivo de análise não suportada.");
    const out = { versao: 1, pastaNome: texto(v.pastaNome, 500, "Nome da pasta"), modelo: texto(v.modelo, 120, "Modelo"),
      achados: lista(v.achados, 60, apontamento), resultados: lista(v.resultados, 60, resultado), parcialSES: v.parcialSES === true,
      cobertura: cobertura(v.cobertura), buscaPendente: v.buscaPendente === true,documentoAtivo:texto(v.documentoAtivo,500,"Documento em revisão"),
      falhas: lista(v.falhas, 2000, falhaLeitura),
      falhasPastas: lista(v.falhasPastas, 2000, falhaLeitura),
      consultasFeitas: numero(v.consultasFeitas), consultasReaproveitadas: numero(v.consultasReaproveitadas),
      filtro: ["todos","pendentes","localizados"].includes(v.filtro) ? v.filtro : "todos", proximoBloco: numero(v.proximoBloco, 8), blocosSES: null };
    if (v.blocosSES != null) {
      out.blocosSES = lista(v.blocosSES, 8, (bloco, i) => {
        const b = objeto(bloco, "Bloco SES"), comum = { nome: texto(b.nome, 500, "Documento SES"), documentoId: texto(b.documentoId,100,"Fonte"), documentoSES: texto(b.documentoSES,500,"Identificação") };
        if (i < out.proximoBloco) return { ...comum, concluido: true };
        const paginas = lista(b.paginas,70,p=>({local:texto(p?.local,100,"Página"),texto:texto(p?.texto,10000,"Texto SES")}));
        if (!paginas.length || paginas.reduce((n,p)=>n+p.texto.length,0)>45000) falha("Bloco SES pendente inválido.");
        return { ...comum, paginas };
      });
      if (out.proximoBloco > out.blocosSES.length) falha("Progresso de interpretação inválido.");
    } else if (out.proximoBloco) falha("Blocos da interpretação ausentes.");
    return out;
  }
  function falhaLeitura(f){
    const out={caminho:texto(f?.caminho,4096,"Caminho"),motivo:texto(f?.motivo,1500,"Motivo")};
    for(const [campo,max] of [["codigo",100],["mensagem",1000],["etapa",100],["orientacao",1500]])if(f?.[campo]!=null)out[campo]=texto(f[campo],max,campo);
    return out;
  }
  function etapa(v) {
    if (v.blocosSES?.length) return v.proximoBloco ? "interpretacao_parcial" : "oficios_preparados";
    if (v.buscaPendente) return "pesquisa_pendente";
    if (v.resultados.length) return v.resultados.some(r=>r.avaliacaoConcluida) ? "confronto" : "resultados";
    return v.achados.length ? "pedidos" : "pasta";
  }
  const api = { normalizar, etapa, MAX_BYTES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GemodAnaliseSnapshot = api;
})(typeof window === "undefined" ? globalThis : window);
