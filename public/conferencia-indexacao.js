(function (global) {
  "use strict";
  const Contexto = typeof module !== "undefined" && module.exports ? require("./conferencia-contexto.js") : global.GemodContexto;
  const Diagnostico=typeof module!=="undefined"&&module.exports?require("./leitura-diagnostico.js"):global.GemodLeituraDiagnostico;
  const SUPORTADOS = new Set(["pdf", "docx", "xlsx", "xls", "xlsm", "txt", "csv", "md"]);
  const MAX_DOCUMENTOS = 15000, MAX_BYTES_INDICE = 128 * 1024 * 1024, MAX_EVIDENCIAS = 6;
  const extensao = name => String(name || "").split(".").pop().toLowerCase();
  const abortar = signal => { if (signal?.aborted) throw Object.assign(new Error("Pesquisa interrompida"), { name: "AbortError" }); };
  const pausa = () => new Promise(resolve => setTimeout(resolve, 0));
  const fingerprint = file => Number.isFinite(file.size) && Number.isFinite(file.lastModified)
    ? file.size + ":" + file.lastModified : null;
  function criarCache(raiz) {
    // Session-only sparse index: token numbers, concepts and offsets. No document bodies.
    return { raiz, arquivos: new Map(), vocabulario: new Map(), bytes: 0 };
  }
  function prepararTermos(item) { return Contexto.plano(item).termos; }
  function indicadores(state) {
    const c = state.cobertura;
    return { ...c, processados: state.cursor, progresso: c.listados ? Math.floor(state.cursor / c.listados * 100) : 100,
      completo: !!state.completos, avaliaveis: state.melhores.filter(rows => rows.length).length,
      verificacaoParcial: !!(c.pastasFalhas || c.limiteInventario || c.naoSuportados || c.semTexto || c.parciais
        || c.erros || c.ignoradosLimite || c.limiteIndice || c.arquivosAlterados) };
  }
  async function pesquisar(raiz, apontamentos, API, opts = {}) {
    if (!Contexto) throw new Error("Módulo de busca contextual indisponível. Atualize a página.");
    const signal = opts.signal;
    abortar(signal);
    let state = opts.estado;
    if (!state) {
      const indice = await API.indexar(raiz, signal, message => opts.onIndex?.(message));
      abortar(signal);
      const cache = opts.cache?.raiz === raiz ? opts.cache : criarCache(raiz);
      const paths = new Set(indice.docs.map(doc => doc.caminho));
      for (const [path, entry] of cache.arquivos) if (!paths.has(path)) { cache.bytes -= entry.bytes; cache.arquivos.delete(path); }
      state = { indice, cache, cursor: 0, melhores: apontamentos.map(() => []), erros: [], completos: false,
        cobertura: { listados: indice.docs.length, pastasFalhas: indice.erros.length, limiteInventario: !!indice.limite,
          suportados: 0, naoSuportados: 0, lidos: 0, comTexto: 0, semTexto: 0, parciais: 0, erros: 0,
          ignoradosLimite: 0, reaproveitados: 0, limiteIndice: false, arquivosAlterados: 0 } };
      opts.onState?.(state);
    }
    const cache = state.cache;
    opts.onCache?.(cache);
    const docs = state.indice.docs, max = Math.min(MAX_DOCUMENTOS, docs.length);
    for (; state.cursor < max;) {
      abortar(signal);
      const doc = docs[state.cursor], c = state.cobertura;
      if (!SUPORTADOS.has(extensao(doc.nome))) c.naoSuportados++;
      else {
        try {
          const file = await doc.handle.getFile(); abortar(signal);
          const mark = fingerprint(file), old = cache.arquivos.get(doc.caminho);
          let entry = old && mark && old.mark === mark ? old : null;
          if (entry) c.reaproveitados++;
          else {
            const rows = []; let bytes = 0, limited = false, streamed = false;
            const available = MAX_BYTES_INDICE - cache.bytes + (old?.bytes || 0);
            const process = async part => {
              abortar(signal); streamed = true;
              for (const row of Contexto.fragmentar(part, cache.vocabulario)) {
                const size = row.tokens.byteLength + 300;
                if (bytes + size > available) { limited = true; break; }
                row.hash = await Contexto.assinatura(String(part.texto).slice(row.inicio,row.fim));
                rows.push(row); bytes += size;
                if (rows.length % 200 === 0) { abortar(signal); await pausa(); }
              }
              if (cache.vocabulario.size >= 250000) limited = true;
              await pausa();
            };
            const read = await API.ler(file, signal, { indiceCompleto: true, onParte: process });
            abortar(signal);
            if (!streamed) for (const part of read.partes || []) await process(part);
            entry = { mark, bytes, rows, aviso: [read.aviso, limited ? "Limite de memória do índice local atingido; conteúdo parcialmente indexado" : ""].filter(Boolean).join("; "),
              limited, caminho: doc.caminho, nome: doc.nome, size: file.size, lastModified: file.lastModified };
            cache.bytes += bytes - (old?.bytes || 0);
            cache.arquivos.set(doc.caminho, entry);
          }
          c.suportados++; c.lidos++;
          if (entry.rows.length) c.comTexto++; else c.semTexto++;
          if (entry.limited) c.limiteIndice = true;
          if (entry.aviso) { c.parciais++; if (state.erros.length < 100) state.erros.push({ caminho: doc.caminho, motivo: entry.aviso }); }
        } catch (error) {
          if (error.name === "AbortError") throw error;
          const previous = cache.arquivos.get(doc.caminho);
          if (previous) { cache.bytes -= previous.bytes; cache.arquivos.delete(doc.caminho); }
          c.suportados++; c.erros++;
          if (state.erros.length < 100) state.erros.push(Diagnostico?Diagnostico.diagnosticar(error,doc.caminho,"ler conteúdo do arquivo"):{ caminho: doc.caminho, motivo: "Falha de leitura do arquivo",codigo:error.name||"Error",mensagem:error.message||"" });
        }
      }
      state.cursor++;
      if (state.cursor % 10 === 0 || state.cursor === max) { opts.onProgress?.(indicadores(state)); await pausa(); }
    }
    state.cobertura.ignoradosLimite = Math.max(0, docs.length - max);
    opts.onIndex?.("Selecionando trechos por contexto, competência e referências. Nenhuma chamada de IA nesta etapa.");
    const rows = [], postings = new Map(), concepts = new Map(), identifiers = new Map();
    const plans = apontamentos.map(Contexto.plano);
    const wantedTokens = new Set(plans.flatMap(plan=>plan.termos.map(term=>cache.vocabulario.get(term))).filter(Boolean));
    const wantedConcepts = new Set(plans.flatMap(plan=>plan.conceitos)), wantedIds = new Set(plans.flatMap(plan=>plan.ids));
    const add = (map, key, id) => { if (!map.has(key)) map.set(key, []); map.get(key).push(id); };
    for (const doc of docs.slice(0, max)) {
      const entry = cache.arquivos.get(doc.caminho);
      if (!entry) continue;
      const arquivo = { ...entry, handle: doc.handle, contexto: { conceitos: [...new Set(entry.rows.flatMap(row=>row.conceitos))] } };
      for (const row of entry.rows) {
        const id = rows.length; rows.push({ row, arquivo });
        for (const token of row.tokens) if(wantedTokens.has(token)) add(postings, token, id);
        for (const concept of row.conceitos) if(wantedConcepts.has(concept)) add(concepts, concept, id);
        for (const reference of row.ids) if(wantedIds.has(reference)) add(identifiers, reference, id);
        if (rows.length % 500 === 0) { abortar(signal); await pausa(); }
      }
    }
    const selected = [];
    for (const plan of plans) {
      abortar(signal);
      const possible = new Set();
      const keys = plan.termos.map(term => cache.vocabulario.get(term)).filter(id => postings.has(id))
        .sort((a, b) => postings.get(a).length - postings.get(b).length).slice(0, 8);
      for (const key of keys) for (const id of postings.get(key)) possible.add(id);
      for (const key of plan.conceitos) for (const id of concepts.get(key) || []) possible.add(id);
      for (const key of plan.ids) for (const id of identifiers.get(key) || []) possible.add(id);
      let scored = []; let visited = 0;
      const leaders = new Map();
      const compact = values => {
        const counts = new Map();
        return values.sort((a,b)=>b.pontos-a.pontos).filter(value=>{
          const count = counts.get(value.arquivo.caminho)||0;counts.set(value.arquivo.caminho,count+1);return count<4;
        }).slice(0,128);
      };
      for (const id of possible) {
        const candidate = rows[id];
        const score = Contexto.pontuar(plan, candidate.row, cache.vocabulario, postings, rows.length, candidate.arquivo.contexto);
        if (score) {
          const value = { ...candidate, ...score };scored.push(value);
          for(const concept of plan.conceitos)if(candidate.row.conceitos.includes(concept)) {
            const best=[...(leaders.get(concept)||[]),value].sort((a,b)=>b.pontos-a.pontos).slice(0,2);leaders.set(concept,best);
          }
          if(scored.length>=256)scored=compact(scored);
        }
        if (++visited % 800 === 0) { abortar(signal); await pausa(); }
      }
      const distinct = new Map([...compact(scored),...Array.from(leaders.values()).flat()].map(candidate=>[
        candidate.arquivo.caminho+"|"+candidate.row.local+"|"+candidate.row.inicio,candidate]));
      selected.push(Contexto.selecionar([...distinct.values()], plan, MAX_EVIDENCIAS));
    }
    // Recover literal quotes by reopening only the selected source files.
    const files = new Map();
    selected.flat().forEach(candidate => {
      const path = candidate.arquivo.caminho;
      if (!files.has(path)) files.set(path, { arquivo: candidate.arquivo, locals: new Set(), candidates: [] });
      files.get(path).locals.add(candidate.row.local);
      files.get(path).candidates.push(candidate);
    });
    const quotes = new Map();
    for (const [path, group] of files) {
      abortar(signal);
      try {
        const file = await group.arquivo.handle.getFile();
        if (group.arquivo.mark && fingerprint(file) !== group.arquivo.mark) throw new Error("Arquivo alterado durante a busca");
        const read = await API.ler(file, signal, { indiceCompleto: true, locais: group.locals });
        const recovered = new Map();
        for (const candidate of group.candidates) {
          const row=candidate.row, part=(read.partes||[]).find(value=>value.local===row.local);
          if (!part) throw new Error("Página de origem indisponível");
          const quote=String(part.texto).slice(row.inicio,row.fim);
          if (await Contexto.assinatura(quote)!==row.hash) throw new Error("Conteúdo do trecho foi alterado");
          recovered.set(row.local+"|"+row.inicio,quote);
        }
        quotes.set(path,recovered);
      } catch (error) {
        if (error.name === "AbortError") throw error;
        const stale=cache.arquivos.get(path);
        if(stale){cache.bytes-=stale.bytes;cache.arquivos.delete(path);}
        state.cobertura.arquivosAlterados++;
        if (state.erros.length < 100) state.erros.push({ caminho: path, motivo: "Não foi possível validar o trecho na versão atual do arquivo; pesquise novamente" });
      }
    }
    state.melhores = selected.map(list => list.flatMap(candidate => {
      const { arquivo, row } = candidate, text = quotes.get(arquivo.caminho)?.get(row.local+"|"+row.inicio);
      if (typeof text !== "string") return [];
      return [{ nome: arquivo.nome, caminho: arquivo.caminho, local: row.local, trecho: text,
        pontos: candidate.pontos, achados: candidate.achados, motivos: candidate.motivos, alertas: candidate.alertas,
        handle: arquivo.handle, size: arquivo.size, lastModified: arquivo.lastModified,
        inicio: row.inicio, fim: row.fim, hash: row.hash }];
    }));
    state.completos = true; opts.onProgress?.(indicadores(state));
    return { estado: state, candidatos: state.melhores, cobertura: indicadores(state), falhas: state.erros.slice(), cache };
  }
  const api = { pesquisar, prepararTermos, indicadores, criarCache, SUPORTADOS, MAX_DOCUMENTOS, MAX_EVIDENCIAS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GemodBuscaLocal = api;
})(typeof window === "undefined" ? globalThis : window);
