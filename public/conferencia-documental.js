(function (global) {
  "use strict";
  const MAX_ARQUIVOS = 400, MAX_TAMANHO = 25 * 1024 * 1024, MAX_PAGINAS = 80;
  const MAX_APONTAMENTOS = 160;
  const Diagnostico=typeof module!=="undefined"&&module.exports?require("./leitura-diagnostico.js"):global.GemodLeituraDiagnostico;
  const stop = new Set("para pela pelo pelos pelas com sem sobre entre conforme mediante foram seria deverá deverá quando onde qual quais esse essa esses essas destes desta deste aquilo aquele aquela solicitamos solicitado solicitado solicita apresentou apresentada apresentadas documentos documento arquivos arquivo observações observacao apontamento verifica consta consta constam não nao nem dos das da de do ao aos no na nos nas em uma umas uns um e ou os as a o que se sua seu suas seus este esta estes estas foram ser ter bem ainda como realizar realizada realizado considerando necessário necessária tecnico tecnica areas area ses entidade unidade analise apresentar comprovar comprovação informações informação item itens folhas folha processo anexo anexos falta ausência ausente".split(/\s+/));
  const $norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const ext = n => (String(n).split(".").pop() || "").toLowerCase();
  const abortar = sinal => { if (sinal && sinal.aborted) { const e = new Error("Interrompida"); e.name = "AbortError"; throw e; } };
  function termos(texto) {
    return Array.from(new Set($norm(texto).split(/\s+/).filter(s => s.length >= 3 && !stop.has(s)))).slice(0, 32);
  }
  function apontamentos(texto, origem) {
    const linhas = String(texto || "").replace(/\r/g, "\n").split(/\n+/);
    const vistos = new Set(), saida = [];
    for (const linha of linhas) {
      const frase = linha.replace(/^[\s\-\u2022]*(?:\d+(?:\.\d+)*[.)-]?\s*)?/, "").replace(/\s+/g, " ").trim();
      if (frase.length < 25 || termos(frase).length < 2) continue;
      const chave = $norm(frase);
      if (!vistos.has(chave)) { vistos.add(chave); saida.push({ origem, texto: frase.slice(0, 900) }); }
      if (saida.length >= MAX_APONTAMENTOS) break;
    }
    return saida;
  }
  function comparar(frase, documento) {
    const t = termos(frase);
    if (t.length < 2) return null;
    const partes = [{ local: "Nome do arquivo", texto: documento.nome, nome: true }].concat(documento.partes || []);
    let melhor = null;
    for (const p of partes) {
      const alvo = $norm(p.texto);
      const achados = t.filter(w => alvo.includes(w));
      const proporcao = achados.length / t.length;
      if (achados.length < 2 || proporcao < 0.35) continue;
      let pontos = Math.round((p.nome ? 20 : 12) * proporcao + achados.length * (p.nome ? 4 : 1));
      const ids = t.filter(w => /\d{4,}/.test(w));
      if (ids.some(w => alvo.includes(w))) pontos += 12;
      if (proporcao >= .75) pontos += 7;
      if (!melhor || pontos > melhor.pontos) {
        const pos = Math.max(0, alvo.indexOf(achados[0]));
        melhor = { pontos, local: p.local, achados, trecho: p.nome ? "" : String(p.texto).slice(Math.max(0, pos - 60), pos + 160).replace(/\s+/g, " ") };
      }
    }
    return melhor;
  }
  function cruzar(lista, docs, parcial) {
    return lista.map(a => {
      const candidatos = [];
      for (const d of docs) {
        const s = comparar(a.texto, d);
        if (s) candidatos.push({ caminho: d.caminho, nome: d.nome, ...s });
      }
      candidatos.sort((a,b) => b.pontos - a.pontos || a.caminho.localeCompare(b.caminho));
      return { ...a, situacao: candidatos.length ? "Possível correspondência (revisar)" : parcial ? "Não confirmado — leitura parcial" : "Não localizado nos arquivos lidos", candidatos: candidatos.slice(0, 3) };
    });
  }
  async function ler(file, sinal, opcoes = {}) {
    abortar(sinal);
    if (file.size > MAX_TAMANHO) return { partes: [], aviso: "Acima de 25 MB; somente nome pesquisado" };
    const tipo = ext(file.name);
    if (global.GemodLeitores) await global.GemodLeitores.carregar(tipo);
    if (["txt","csv","md"].includes(tipo)) {
      const texto = await file.text();
      if (opcoes.indiceCompleto) {
        const parte = { local: "Texto", texto };
        if (opcoes.onParte) { await opcoes.onParte(parte); return { partes: [], aviso: "" }; }
        return { partes: [parte], aviso: "" };
      }
      return { partes: [{ local: "Texto", texto: texto.slice(0, 200000) }], aviso: texto.length > 200000 ? "Texto pesquisado parcialmente: limite de 200.000 caracteres por arquivo" : "" };
    }
    if (tipo === "pdf") {
      if (!global.pdfjsLib) return { partes: [], aviso: "Leitor PDF indisponível" };
      const pdf = await global.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, cMapUrl: "/vendor/cmaps/", cMapPacked: true, standardFontDataUrl: "/vendor/standard_fonts/", wasmUrl: "/vendor/wasm/" }).promise;
      const partes = [], avisos = []; let caracteres = 0, paginasComTexto = 0, paginasSemTexto = 0;
      try {
        const maximo = opcoes.indiceCompleto ? pdf.numPages : Math.min(MAX_PAGINAS, pdf.numPages);
        for (let i = 1; i <= maximo && (opcoes.indiceCompleto || caracteres < 200000); i++) {
          abortar(sinal);
          if (opcoes.locais && !opcoes.locais.has("Página " + i)) continue;
          const pg = await pdf.getPage(i);
          const dados = await pg.getTextContent();
          const inteiro = dados.items.map(p => String(p.str || "") + (p.hasEOL ? "\n" : " ")).join("");
          const limite = opcoes.indiceCompleto ? 200000 : Math.min(20000, 200000 - caracteres);
          const texto = inteiro.slice(0, limite);
          if (inteiro.length > limite) avisos.push("Página " + i + ": texto cortado em " + limite + " caracteres");
          if (texto.trim()) {
            const parte = { local: "Página " + i, texto };
            if (opcoes.onParte) await opcoes.onParte(parte); else partes.push(parte);
            caracteres += texto.length; paginasComTexto++;
          } else paginasSemTexto++;
          pg.cleanup?.();
          if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
        }
      } finally { if (pdf.destroy) await pdf.destroy(); }
      if (!paginasComTexto) avisos.push("PDF digitalizado ou sem texto pesquisável; exige OCR");
      else if (paginasSemTexto) avisos.push(paginasSemTexto + " página(s) sem texto pesquisável; podem exigir OCR");
      if (!opcoes.indiceCompleto && (pdf.numPages > MAX_PAGINAS || caracteres >= 200000)) avisos.push("PDF pesquisado parcialmente: limite de páginas ou caracteres");
      return { partes, aviso: avisos.join("; ") };
    }
    if (tipo === "docx") {
      if (!global.mammoth) return { partes: [], aviso: "Leitor Word indisponível" };
      const res = await global.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      if (opcoes.indiceCompleto) {
        const parte = { local: "Texto do Word (página indisponível)", texto: String(res.value || "") };
        if (opcoes.onParte) { await opcoes.onParte(parte); return { partes: [], aviso: !parte.texto.trim() ? "Word sem texto pesquisável" : "" }; }
        return { partes: [parte], aviso: !parte.texto.trim() ? "Word sem texto pesquisável" : "" };
      }
      return { partes: [{ local: "Texto do Word (página indisponível)", texto: String(res.value || "").slice(0, 200000) }], aviso: !String(res.value || "").trim() ? "Word sem texto pesquisável" : String(res.value || "").length > 200000 ? "Word pesquisado parcialmente" : "" };
    }
    if (["xlsx","xls","xlsm"].includes(tipo)) {
      if (!global.XLSX) return { partes: [], aviso: "Leitor Excel indisponível" };
      const livro = await global.XLSX.read(await file.arrayBuffer(), { type: "array" });
      const partes = [], avisos = [], nomes = opcoes.indiceCompleto ? livro.SheetNames : livro.SheetNames.slice(0, 20);
      for (const nome of nomes) {
        abortar(sinal);
        if (opcoes.locais && !opcoes.locais.has("Aba " + nome)) continue;
        const texto = global.XLSX.utils.sheet_to_csv(livro.Sheets[nome], { FS: " ", RS: "\n" });
        if (!opcoes.indiceCompleto && texto.length > 40000) avisos.push("Aba " + nome + ": texto cortado em 40.000 caracteres");
        const parte = { local: "Aba " + nome, texto: opcoes.indiceCompleto ? texto : texto.slice(0, 40000) };
        if (opcoes.onParte) await opcoes.onParte(parte); else partes.push(parte);
      }
      if (!opcoes.indiceCompleto && livro.SheetNames.length > 20) avisos.push("Somente 20 abas pesquisadas");
      return { partes, aviso: avisos.join("; ") };
    }
    return { partes: [], aviso: "Formato não pesquisável por conteúdo" };
  }
  async function indexar(raiz, sinal, progresso = () => {}) {
    const pendentes = [{ handle: raiz, caminho: raiz.name }], docs = [], erros = [], falhasPastas=[];
    let itens = 0, limite = false;
    while (pendentes.length) {
      abortar(sinal);
      abortar(sinal);
      const dir = pendentes.pop();
      try {
        for await (const item of dir.handle.values()) {
          abortar(sinal);
          if (++itens > 20000) { limite = true; break; }
          const caminho = dir.caminho + "/" + item.name;
          if (item.kind === "directory") pendentes.push({ handle: item, caminho });
          else if (item.kind === "file") docs.push({ handle: item, caminho, nome: item.name, partes: [] });
          if (itens % 100 === 0) { progresso("Indexando pastas: " + itens + " itens…"); await new Promise(r => setTimeout(r, 0)); }
        }
      } catch (error) { if (error.name === "AbortError") throw error; erros.push(dir.caminho);
        falhasPastas.push(Diagnostico?Diagnostico.diagnosticar(error,dir.caminho):{caminho:dir.caminho,motivo:error.name||"Falha ao listar pasta"}); }
      if (limite) break;
    }
    return { docs, erros, falhasPastas, limite };
  }
  function csv(lista) {
    const fmt = s => {
      let v = String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ");
      if (/^[\s\uFEFF]*[=+\-@]/.test(v)) v = "'" + v;
      return '"' + v.replace(/"/g, '""') + '"';
    };
    const linhas = [["Arquivo SES","Apontamento","Situação","Arquivo da entidade","Caminho","Página/aba","Termos coincidentes","Trecho"]];
    lista.forEach(r => {
      if (!r.candidatos.length) linhas.push([r.origem,r.texto,r.situacao,"","","","",""]);
      r.candidatos.forEach(c => linhas.push([r.origem,r.texto,r.situacao,c.nome,c.caminho,c.local,c.achados.join(", "),c.trecho]));
    });
    return "\uFEFF" + linhas.map(row => row.map(fmt).join(";")).join("\r\n");
  }
  let tela = null;
  function sair() {
    global.GemodAnaliseIA?.sair();
    if (tela) { if (tela.controle) tela.controle.abort(); tela.raiz = null; tela.resultados = null; tela = null; }
  }
  function montar(container) {
    if (global.GemodAnaliseIA) return global.GemodAnaliseIA.montar(container, api);
    sair();
    const primeiro = container.querySelector(".inventario-local");
    if (!primeiro) return;
    primeiro.insertAdjacentHTML("afterend",
      '<section class="painel inventario-local" id="conf-painel"><div class="painel-head"><h2>Conferir apontamentos da SES</h2></div><div class="painel-body">' +
      '<p>Mantenha a contagem acima. Depois anexe os apontamentos das áreas técnicas da SES e pesquise onde podem estar os documentos correspondentes na pasta da entidade, inclusive nas subpastas.</p>' +
      '<p class="inventario-privacidade"><strong>Pesquisa local.</strong> Os documentos são lidos no navegador e não são enviados ao servidor. A ferramenta sugere correspondências, não atesta atendimento do apontamento.</p>' +
      '<label>Arquivos de apontamentos da SES (PDF, DOCX, Excel, TXT)<input id="conf-ses" type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.xlsm,.txt,.csv,.md"></label>' +
      '<label>Apontamentos adicionais (opcional, 1 por linha)<textarea id="conf-manual" rows="3" placeholder="Ex.: Apresentar comprovante do recolhimento de FGTS de setembro de 2026"></textarea></label>' +
      '<div class="form-acoes"><button id="conf-iniciar" class="btn btn-primary" type="button" disabled>Conferir apontamentos</button><button id="conf-parar" class="btn btn-ghost" type="button" hidden>Interromper</button></div>' +
      '<p id="conf-pasta" class="metric-extra">Selecione primeiro a pasta da entidade no botão acima.</p>' +
      '<p class="metric-extra">São pesquisados nomes de todos os arquivos listados e o conteúdo de até 400 arquivos compatíveis, até 25 MB por arquivo e 80 páginas por PDF. PDF digitalizado sem texto, arquivo protegido ou formato antigo exige conferência manual.</p>' +
      '<p id="conf-status" role="status" aria-live="polite"></p><progress id="conf-progresso" hidden></progress>' +
      '<div id="conf-resultado" hidden><h3>Resultado dos apontamentos</h3><p id="conf-resumo"></p>' +
      '<div class="form-acoes"><button id="conf-csv" type="button" class="btn btn-ghost">Baixar conferência (.csv)</button></div>' +
      '<div class="tabela-wrap"><table class="dados"><caption>Correspondências sugeridas para conferência humana</caption>' +
      '<thead><tr><th>Arquivo SES</th><th>Apontamento</th><th>Situação</th><th>Possível localização na pasta da entidade</th></tr></thead><tbody id="conf-linhas"></tbody></table></div>' +
      '<p class="metric-extra">Até 100 apontamentos na tela. O CSV inclui todos e até 3 sugestões por apontamento.</p></div></div></section>');
    const t = tela = { container, raiz: null, controle: null, resultados: null };
    const el = id => container.querySelector(id);
    el("#conf-parar").addEventListener("click", () => { if (t.controle) t.controle.abort(); });
    el("#conf-iniciar").addEventListener("click", async () => {
      if (!t.raiz || t.controle) return;
      const ctrl = t.controle = new AbortController(), sinal = ctrl.signal;
      const status = el("#conf-status");
      const progresso = msg => { if (tela === t) status.textContent = msg; };
      el("#conf-iniciar").disabled = true;
      el("#conf-parar").hidden = false;
      el("#conf-progresso").hidden = false;
      el("#conf-resultado").hidden = true;
      try {
        const ses = Array.from(el("#conf-ses").files || []);
        if (!ses.length && !el("#conf-manual").value.trim()) throw new Error("Informe apontamentos digitados ou selecione arquivos da SES.");
        let lista = apontamentos(el("#conf-manual").value, "Digitado");
        const alertas = [];
        for (const arq of ses) {
          abortar(sinal);
          progresso("Lendo apontamentos SES: " + arq.name);
          try {
            const r = await ler(arq, sinal);
            lista.push(...apontamentos(r.partes.map(p => p.texto).join("\n"), arq.name));
            if (r.aviso) alertas.push(arq.name + ": " + r.aviso);
          } catch (e) { if (e.name === "AbortError") throw e; alertas.push(arq.name + ": falha na leitura"); }
        }
        lista = lista.slice(0, MAX_APONTAMENTOS);
        if (!lista.length) throw new Error("Não foi possível extrair apontamentos. Use DOCX, PDF com texto selecionável ou digite-os.");
        progresso("Listando todos os arquivos e caminhos da entidade…");
        const indice = await indexar(t.raiz, sinal, progresso);
        const suportados = indice.docs.filter(d => ["pdf","docx","xlsx","xls","xlsm","txt","csv","md"].includes(ext(d.nome)));
        const lerLista = suportados.map(d => ({ d, relevancia: Math.max(0, ...lista.map(a => { const p = comparar(a.texto, d); return p ? p.pontos : 0; })) })).sort((a,b) => b.relevancia - a.relevancia).slice(0, MAX_ARQUIVOS).map(x => x.d);
        let falhas = 0, feitas = 0;
        for (const d of lerLista) {
          abortar(sinal);
          progresso("Pesquisando conteúdo " + (feitas + 1) + "/" + lerLista.length + ": " + d.nome);
          try {
            const r = await ler(await d.handle.getFile(), sinal);
            d.partes = r.partes;
            if (r.aviso) falhas++;
          } catch (e) { if (e.name === "AbortError") throw e; falhas++; }
          feitas++;
          if (feitas % 5 === 0) await new Promise(r => setTimeout(r, 0));
        }
        abortar(sinal);
        const formatosNaoPesquisaveis = indice.docs.length - suportados.length;
        const parcial = indice.limite || indice.erros.length > 0 || suportados.length > MAX_ARQUIVOS || falhas > 0 || formatosNaoPesquisaveis > 0;
        const resultados = cruzar(lista, indice.docs, parcial);
        if (tela !== t) return;
        t.resultados = resultados;
        const achados = resultados.filter(r => r.candidatos.length).length;
        el("#conf-resumo").textContent = resultados.length + " apontamentos; " + achados + " com possível correspondência; " + (resultados.length - achados) + " sem correspondência. " + indice.docs.length + " arquivos da entidade indexados; " + feitas + " lidos por conteúdo. " + (parcial ? "ATENÇÃO: busca parcial; ausência de correspondência não prova inexistência. " : "Busca realizada nos arquivos listados pelo navegador. ") + (alertas.length ? "Limitações SES: " + alertas.join("; ") : "");
        el("#conf-linhas").innerHTML = resultados.slice(0,100).map(r => {
          const candidatos = r.candidatos.length ? r.candidatos.map(c => "<p><strong>" + esc(c.caminho) + "</strong> — " + esc(c.local) + (c.trecho ? "<span class=\"metric-extra\"> | Trecho: " + esc(c.trecho) + "</span>" : "") + "</p>").join("") : "—";
          return "<tr><td>" + esc(r.origem) + "</td><td>" + esc(r.texto) + "</td><td>" + esc(r.situacao) + "</td><td>" + candidatos + "</td></tr>";
        }).join("");
        el("#conf-resultado").hidden = false;
        progresso("Conferência concluída. Verifique os documentos sugeridos antes de decidir se atendem aos apontamentos.");
      } catch (e) { if (tela === t) progresso(e.name === "AbortError" ? "Pesquisa interrompida sem conclusão." : "Não foi possível concluir: " + e.message); }
      finally {
        if (tela === t) {
          t.controle = null;
          el("#conf-iniciar").disabled = !t.raiz;
          el("#conf-parar").hidden = true;
          el("#conf-progresso").hidden = true;
        }
      }
    });
    el("#conf-csv").addEventListener("click", () => {
      if (!t.resultados) return;
      const url = URL.createObjectURL(new Blob([csv(t.resultados)], { type:"text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "gemod-conferencia-ses-" + new Date().toISOString().slice(0,10) + ".csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function definirPasta(raiz) {
    if (global.GemodAnaliseIA) return global.GemodAnaliseIA.definirPasta(raiz);
    if (!tela) return;
    if (tela.controle) tela.controle.abort();
    tela.raiz = raiz;
    tela.resultados = null;
    const c = tela.container;
    c.querySelector("#conf-pasta").textContent = "Pasta da entidade: " + raiz.name;
    c.querySelector("#conf-iniciar").disabled = false;
    c.querySelector("#conf-resultado").hidden = true;
  }
  const api = { termos, apontamentos, comparar, cruzar, ler, indexar, csv, montar, definirPasta, sair };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GemodConferencia = api;
})(typeof window === "undefined" ? globalThis : window);
