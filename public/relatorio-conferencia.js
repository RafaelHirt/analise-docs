(function (global) {
  "use strict";
  const MAX_CSV = 12 * 1024 * 1024;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normalizar = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  function partesCaminho(caminho) {
    const original = String(caminho ?? ""), partes = original.split(/[\\/]/).filter(Boolean);
    return { original, pastas: partes.slice(0, -1), arquivo: partes.at(-1) || "Arquivo não informado" };
  }
  const estilosCaminho = `
    .gemod-file-location{padding:18px;background:#eff7f3;border:1px solid #cfe3d8;border-radius:12px;margin:12px 0 16px;min-width:0}
    .gemod-location-label{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#526f60;margin:0 0 12px}
    .gemod-file-location .gemod-folder-trail{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:0;padding:0;list-style:none!important}
    .gemod-folder-trail .gemod-folder-step{display:flex;align-items:center;gap:7px;max-width:100%;padding:0;border:0;background:none}
    .gemod-folder-chip{display:flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid #d3e3d9;border-radius:7px;background:#fff;color:#3f5f4d;font-size:13px;line-height:1.45;overflow-wrap:anywhere;min-width:0}
    .gemod-folder-chip svg{width:16px;height:16px;flex-shrink:0;color:#7b967e}.gemod-path-arrow{color:#87a28e;font-size:20px}
    .gemod-location-file{display:flex;align-items:flex-start;gap:11px;margin:15px 0 10px;min-width:0}.gemod-file-icon{display:inline-block;flex-shrink:0;background:#dceee4;border:1px solid #bad7c6;border-radius:7px;padding:7px 6px;color:#176342;font:700 10px/1.4 system-ui,sans-serif;letter-spacing:.02em}
    .gemod-location-name{font:650 17px/1.5 system-ui,sans-serif;color:#174b34;overflow-wrap:anywhere;word-break:break-word;min-width:0}
    .gemod-location-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.gemod-location-page{display:inline-block;border:1px solid #bfd6c9;background:white;color:#22563c;border-radius:6px;padding:4px 10px;font:650 13px/1.5 system-ui,sans-serif}
    .gemod-copy-path{border:1px solid #bfd6c9!important;border-radius:6px!important;background:white!important;color:#22563c!important;padding:5px 10px!important;font:600 12px/1.5 system-ui,sans-serif!important;cursor:pointer}.gemod-full-path{margin-top:12px!important;font-size:12px;color:#526f60}.gemod-full-path summary{font-size:12px;font-weight:500}.gemod-full-path .path{font:12px/1.65 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;user-select:text;background:white;border-radius:7px;padding:10px;margin:8px 0 0;color:#3b5748}
  `;
  function caminhoHTML(caminho, local, copiar = false) {
    const p = partesCaminho(caminho);
    const iconePasta = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/></svg>';
    return '<div class="gemod-file-location"><p class="gemod-location-label">Localização do documento</p>' +
      (p.pastas.length ? '<ol class="gemod-folder-trail" aria-label="Sequência de pastas">' + p.pastas.map((pasta, i) => '<li class="gemod-folder-step">' + (i ? '<span class="gemod-path-arrow" aria-hidden="true">›</span>' : '') + '<span class="gemod-folder-chip">' + iconePasta + '<span>' + esc(pasta) + '</span></span></li>').join("") + '</ol>' : '') +
      '<div class="gemod-location-file"><span class="gemod-file-icon" aria-hidden="true">' + (/\.pdf$/i.test(p.arquivo) ? 'PDF' : 'ARQ') + '</span><span class="gemod-location-name">' + esc(p.arquivo) + '</span></div>' +
      '<div class="gemod-location-actions"><span class="location gemod-location-page">' + esc(local || "Página ou local não informado") + '</span>' +
      (copiar ? '<button class="gemod-copy-path" type="button" data-copiar-caminho="' + esc(p.original) + '" aria-live="polite">Copiar caminho</button>' : '') + '</div>' +
      '<details class="gemod-full-path"><summary>Ver caminho completo</summary><pre class="path gemod-candidate-path">' + esc(p.original) + '</pre></details></div>';
  }
  const situacoes = {
    localizada_sem_analise: "Trecho candidato localizado · sem avaliação da IA",
    evidencia_compativel: "Possível evidência compatível · conferir o documento",
    insuficiente: "Evidência possivelmente insuficiente",
    divergente: "Possível divergência",
    nao_verificavel: "Não verificável com os dados disponíveis",
    sem_candidato: "Nenhum candidato encontrado na busca",
  };
  const camposCobertura = [
    ["Arquivos listados", "listados"], ["Com texto pesquisável", "comTexto"],
    ["Sem texto selecionável", "semTexto"], ["Formatos não suportados", "naoSuportados"],
    ["Arquivos com falha", "erros"], ["Pastas inacessíveis", "pastasFalhas"],
    ["Conteúdos parciais ou com avisos", "parciais"], ["Fora do limite", "ignoradosLimite"],
    ["Arquivos reaproveitados do índice local", "reaproveitados"], ["Arquivos alterados durante a busca", "arquivosAlterados"],
  ];
  const estilos = `
    *{box-sizing:border-box}body{margin:0;background:#eef3f1;color:#23392f;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
    main{max-width:1120px;margin:0 auto;padding:32px 24px 64px}header{margin-bottom:24px}h1{font-size:2rem;line-height:1.2;margin:8px 0 16px}h2{font-size:1.3rem;line-height:1.4;margin:0 0 16px}h3{font-size:1.08rem;margin:0 0 8px}p{margin:8px 0 16px}a{color:#086246}strong{font-weight:650}
    .eyebrow{color:#086246;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.muted{color:#53665d;font-size:.9rem}.notice{padding:16px 20px;background:#fff5e8;border:1px solid #e6c48d;border-radius:12px;margin:20px 0}.instructions{background:#e4f3ec;border-color:#b4d8c6}
    .summary{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.summary>div{background:white;border:1px solid #d8e3dc;border-radius:10px;flex:1;min-width:170px;padding:16px}.summary strong{display:block;font-size:1.65rem}.summary span{font-size:.85rem;color:#53665d}
    nav ol{display:flex;flex-wrap:wrap;gap:8px 28px;padding-left:22px}nav{margin-bottom:28px}.request{background:white;border:1px solid #d7e3db;border-radius:14px;padding:26px;margin:24px 0;scroll-margin-top:16px}.request-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.request-head h2{margin:0}.badge{border:1px solid #d7dfd8;border-radius:8px;padding:6px 10px;font-size:.82rem;background:#f4f7f5}.description{border-bottom:1px solid #e1e9e4;padding-bottom:12px;margin-bottom:24px}
    .candidate{margin:16px 0 24px;padding:20px;border:1px solid #ccdcd2;border-left:5px solid #13805c;border-radius:10px}.path-box{padding:16px;background:#edf6f1;border-radius:8px;margin:12px 0 16px}.path-box strong{display:block;font-size:.9rem;color:#086246}.path{font:15px/1.7 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:8px 0 12px;user-select:text}.location{display:inline-block;padding:4px 10px;background:white;border:1px solid #b6d0c0;border-radius:6px;font-weight:650}.quote{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #cddad2;padding:12px 16px;margin:8px 0 16px;background:#f7f9f8;font-size:.95rem}.warning{color:#934520}.candidate p,.description p{overflow-wrap:anywhere}.coverage{background:white;border:1px solid #d7e3db;border-radius:14px;padding:26px;margin-top:32px}.coverage dl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 24px}.coverage dt,.coverage dd{margin:0;padding:4px 0}.coverage dd{font-weight:650}details{margin:16px 0}summary{cursor:pointer;font-weight:600}li{overflow-wrap:anywhere}.empty{padding:16px;background:#f7f9f8;border-radius:8px}.source{font-size:.9rem;overflow-wrap:anywhere}footer{font-size:.85rem;color:#53665d;margin-top:24px}
    @media(max-width:640px){main{padding:20px 12px}.request,.coverage{padding:18px}.candidate{padding:14px}h1{font-size:1.65rem}.path{font-size:14px}.coverage dl{gap:6px 12px}}
    @media print{@page{size:A4;margin:14mm}body{background:white;font-size:10.5pt}main{max-width:none;padding:0}.request,.coverage{padding:14px;box-shadow:none}.candidate{break-inside:avoid}.request h2,.candidate h3{break-after:avoid}.summary>div{min-width:120px;padding:10px}.path{font-size:10pt}.quote{font-size:10pt}nav{display:none}a{color:inherit;text-decoration:none}.notice,.path-box{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  `;
  function tabelaCSV(texto) {
    let fonte = String(texto ?? "").replace(/^\uFEFF/, "");
    if (fonte.length > MAX_CSV) throw new Error("CSV acima do limite de 12 MiB. Use o arquivo original exportado pela Análise Docs ou pelo GEMOD.");
    const separadorDeclarado = /^sep=([;,\t])\r?\n/i.exec(fonte);
    if (separadorDeclarado) fonte = fonte.slice(separadorDeclarado[0].length);
    const cabecalho = fonte.split(/\r?\n/, 1)[0];
    const separador = separadorDeclarado?.[1] || [";", ",", "\t"].sort((a, b) => cabecalho.split(b).length - cabecalho.split(a).length)[0];
    const linhas = []; let linha = [], valor = "", aspas = false, fechouAspas = false;
    const campo = () => { linha.push(valor); valor = ""; fechouAspas = false; };
    const concluirLinha = () => { campo(); if (linha.some(c => c.trim())) linhas.push(linha); linha = []; if (linhas.length > 5000) throw new Error("CSV acima do limite de 5.000 linhas."); };
    for (let i = 0; i < fonte.length; i++) {
      const c = fonte[i];
      if (aspas) {
        if (c === '"' && fonte[i + 1] === '"') { valor += '"'; i++; }
        else if (c === '"') { aspas = false; fechouAspas = true; }
        else valor += c;
      } else if (c === separador) campo();
      else if (c === "\n" || c === "\r") { if (c === "\r" && fonte[i + 1] === "\n") i++; concluirLinha(); }
      else if (c === '"') { if (valor.length || fechouAspas) throw new Error("CSV com aspas inválidas. Selecione o arquivo original da Análise Docs ou do GEMOD."); aspas = true; }
      else if (fechouAspas) { if (!/\s/.test(c)) throw new Error("CSV com separadores inválidos. Selecione o arquivo original da Análise Docs ou do GEMOD."); }
      else valor += c;
    }
    if (aspas) throw new Error("CSV incompleto: há um campo sem fechamento de aspas.");
    if (valor.length || linha.length || fechouAspas) concluirLinha();
    return linhas;
  }
  function importarCSV(texto, nome = "") {
    const linhas = tabelaCSV(texto), header = linhas.shift() || [];
    const colunas = new Map(header.map((label, index) => [normalizar(label), index]));
    for (const label of ["Origem SES", "Irregularidade/observação", "Providência exigida", "Arquivo entidade", "Local entidade", "Trecho evidência"]) {
      if (!colunas.has(normalizar(label))) throw new Error("Este arquivo não é o quadro de evidências da Análise Docs ou do GEMOD. Escolha o CSV baixado em Exportar quadro CSV.");
    }
    const obter = (linha, label) => linha[colunas.get(normalizar(label))] || "";
    const itens = new Map(), cobertura = {}, falhas = []; let secao = "pedidos", temCobertura = false;
    for (const linha of linhas) {
      if (linha[0] === "COBERTURA DA BUSCA LOCAL" && linha[1] === "Valor" && linha.slice(2).every(valor => !valor.trim())) { secao = "cobertura"; temCobertura = true; continue; }
      if (secao === "cobertura" && linha[0] === "FALHAS E AVISOS" && linha[1] === "Motivo") { secao = "falhas"; continue; }
      if (secao === "cobertura") {
        const campo = camposCobertura.find(([label]) => normalizar(label) === normalizar(linha[0]));
        if (campo) {
          const numero = Number(String(linha[1] || "").replace(/\./g, ""));
          if (!/^\d+$/.test(String(linha[1] || "").replace(/\./g, "")) || !Number.isSafeInteger(numero)) throw new Error("CSV com contagem de cobertura inválida.");
          cobertura[campo[1]] = numero;
        }
        if (normalizar(linha[0]) === "cobertura parcial") cobertura.verificacaoParcial = /^sim/i.test(linha[1] || "");
        continue;
      }
      if (secao === "falhas") { falhas.push({ caminho: linha[0], motivo: linha[1] || "" }); continue; }
      if (linha.length !== header.length) throw new Error("Uma linha do CSV está incompleta. Selecione o arquivo original exportado pela Análise Docs ou pelo GEMOD.");
      const base = { origem: obter(linha, "Origem SES"), local: obter(linha, "Local SES"), descricao: obter(linha, "Irregularidade/observação"),
        providencia: obter(linha, "Providência exigida"), referencia: obter(linha, "Referência"), situacaoTexto: obter(linha, "Situação da conferência (IA se utilizada)"),
        justificativa: obter(linha, "Justificativa"), pendencias: [obter(linha, "Pendências")].filter(Boolean), citacoesTexto: obter(linha, "Citações verificadas"),
        avaliacaoConcluida:/^sim$/i.test(obter(linha,"Avaliação IA concluída")),avaliacaoModelo:obter(linha,"Modelo da avaliação IA"),
        documentoSES: obter(linha,"Documento SES") || obter(linha,"Origem SES"), documentoId: obter(linha,"Identificador da fonte SES"),
        trecho: obter(linha,"Trecho original SES"), contextoSES: obter(linha,"Contexto SES"), fonteVerificada: /^sim$/i.test(obter(linha,"Fonte SES verificada")),
        paginaConfirmada: /^sim$/i.test(obter(linha,"Página SES confirmada")), contextoMetodo: obter(linha,"Método do contexto SES"), contextoParcial: /^sim$/i.test(obter(linha,"Contexto SES parcial")) };
      const jsonFonte = obter(linha,"Fonte SES (JSON)");
      if (jsonFonte) {
        let fonte; try { fonte = JSON.parse(jsonFonte); } catch { throw new Error("Os dados da fonte SES estão incompletos no CSV."); }
        if (!fonte || typeof fonte !== "object" || Array.isArray(fonte)) throw new Error("Fonte SES inválida no CSV.");
        for (const campo of ["documentoSES","documentoId","trecho","contextoSES","contextoMetodo","item","extracao"]) {
          if(fonte[campo]==null&&["item","extracao"].includes(campo)){base[campo]="";continue;}
          if (typeof fonte[campo] !== "string" || fonte[campo].length > 12000) throw new Error("Fonte SES inválida ou acima do limite de texto.");
          base[campo] = fonte[campo];
        }
        for (const campo of ["fonteVerificada","paginaConfirmada","contextoParcial"]) base[campo] = fonte[campo] === true;
      }
      const chave = JSON.stringify(base);
      if (!itens.has(chave)) itens.set(chave, { ...base, candidatos: [] });
      const caminho = obter(linha, "Arquivo entidade");
      if (caminho) itens.get(chave).candidatos.push({ caminho, nome: caminho.split(/[\\/]/).pop(), local: obter(linha, "Local entidade"),
        trecho: obter(linha, "Trecho evidência"), motivos: [obter(linha, "Motivos da localização")].filter(Boolean), alertas: [obter(linha, "Alertas da busca")].filter(Boolean) });
    }
    if (!itens.size) throw new Error("O CSV não contém apontamentos para apresentar.");
    if (temCobertura) cobertura.verificacaoParcial = cobertura.verificacaoParcial !== false ||
      ["semTexto", "naoSuportados", "erros", "pastasFalhas", "parciais", "ignoradosLimite", "arquivosAlterados"].some(campo => cobertura[campo] > 0);
    return { resultados: [...itens.values()], cobertura: temCobertura ? cobertura : null, falhas, arquivoOrigem: nome };
  }
  const paragrafo = (titulo, valor, classe = "") => valor ? '<p class="' + classe + '"><strong>' + titulo + ':</strong> ' + esc(valor) + '</p>' : "";
  const lista = valores => (valores || []).filter(Boolean).join("; ");
  function avaliacaoTexto(row) {
    if(row.avaliacaoConcluida&&(row.situacao==="nao_verificavel"||row.situacaoTexto===situacoes.nao_verificavel))return situacoes.nao_verificavel;
    if (["evidencia_compativel","insuficiente","divergente"].includes(row.situacao)) return situacoes[row.situacao];
    return /^(?:Poss[íi]vel evid[êe]ncia compat[íi]vel|Evid[êe]ncia possivelmente insuficiente|Poss[íi]vel diverg[êe]ncia)/i.test(row.situacaoTexto || "") ? row.situacaoTexto : "";
  }
  function agruparDocumentos(rows) {
    const grupos = new Map();
    rows.forEach((row, indice) => {
      const chave = JSON.stringify([row.documentoId || "", row.origem || "", row.documentoSES || row.origem || "Documento SES sem identificação"]);
      if (!grupos.has(chave)) grupos.set(chave, { chave, titulo: row.documentoSES || row.origem || "Documento SES sem identificação", origem: row.origem || "", pedidos: [] });
      grupos.get(chave).pedidos.push({ row, indice });
    });
    return [...grupos.values()];
  }
  function fonteHTML(row) {
    const confirmado = row.paginaConfirmada || row.fonteVerificada;
    const local = !row.local || /n[aã]o (?:validado|confirmad[ao])/iu.test(row.local) ? "Página não confirmada" : row.local;
    let contexto = row.contextoSES || (row.fonteVerificada ? row.trecho : "");
    let conteudo = esc(contexto);
    if (row.fonteVerificada && row.trecho && contexto.includes(row.trecho)) {
      const pos = contexto.indexOf(row.trecho);
      conteudo = esc(contexto.slice(0, pos)) + '<mark>' + esc(row.trecho) + '</mark>' + esc(contexto.slice(pos + row.trecho.length));
    }
    return '<section class="ses-source"><h3>Origem do pedido na SES</h3><p class="source">' + esc([row.origem,row.item?'Item '+row.item:"", local].filter(Boolean).join(" · ")) +
      (!confirmado ? ' · <span class="warning">origem a confirmar</span>' : '') + '</p>' +
      (contexto ? '<p class="source-caption">' + (row.contextoMetodo === "pagina_selecionada" ? 'Contexto da página selecionada' : 'Trecho original da SES e contexto') + (row.contextoParcial ? ' · recorte da página' : '') + '</p><blockquote class="quote quote-ses">' + conteudo + '</blockquote>' : '<p class="missing-source">O trecho original da SES não consta neste resultado.</p>') + '</section>';
  }
  function gerarHTML(dados) {
    const rows = dados.resultados || [], c = dados.cobertura;
    if (!rows.length) throw new Error("Pesquise a pasta antes de salvar o relatório.");
    const grupos = agruparDocumentos(rows);
    const pedidoHTML = (row, i) => {
      const arquivos = (row.candidatos || []).map((a, j) => '<section class="candidate"><h3>Arquivo candidato ' + (j + 1) + '</h3>' +
        caminhoHTML(a.caminho, a.local) +
        (a.trecho ? '<strong>Trecho encontrado no documento</strong><blockquote class="quote">' + esc(a.trecho) + '</blockquote>' : '<p class="warning">Este candidato não contém citação textual. O nome ou caminho, sozinho, não comprova o atendimento do pedido.</p>') +
        paragrafo("Por que apareceu na busca", lista(a.motivos), "muted") + paragrafo("O que conferir", lista(a.alertas), "warning") + '</section>').join("");
      const citacoes = row.citacoesTexto || (row.evidencias || []).map(e => {
        const a = (row.candidatos || [])[Number(String(e.candidatoId).replace(/^c/, ""))];
        return (a ? a.caminho + " · " + a.local + ": " : "") + e.trecho;
      }).join("\n\n");
      const avaliacao = avaliacaoTexto(row);
      const resultadoIA=avaliacao?'<section class="ai-evaluation"><h3>Resultado da IA</h3><p><strong>'+esc(avaliacao)+'</strong></p>'+
        paragrafo("Justificativa da IA",row.justificativa)+paragrafo("O que ainda falta comprovar",lista(row.pendencias))+
        (citacoes?'<strong>Trechos usados nesta avaliação</strong><blockquote class="quote">'+esc(citacoes)+'</blockquote>':"")+'</section>':"";
      return '<article class="request" id="pedido-' + (i + 1) + '"><div class="request-head"><h2>Pedido ' + (i + 1) + '</h2>' + (avaliacao ? '<span class="badge">' + esc(avaliacao) + '</span>' : '') + '</div>' +
        resultadoIA+
        '<div class="description"><h3>O que a SES solicita</h3><p>' + esc(row.providencia || "Providência não informada") + '</p>' +
        paragrafo("Problema apontado", row.descricao) + paragrafo("Referências", row.referencia) +
        fonteHTML(row) + (!avaliacao?paragrafo("Pendências", lista(row.pendencias)):"") +
        (citacoes&&!avaliacao ? '<strong>Citações registradas na avaliação</strong><blockquote class="quote">' + esc(citacoes) + '</blockquote>' : "") + '</div>' +
        '<h3>Onde procurar · ' + (row.candidatos || []).length + ' arquivo(s) candidato(s)</h3>' + (arquivos || '<p class="empty">Nenhum candidato encontrado entre os arquivos pesquisáveis. Isso não prova que o documento não existe.</p>') + '</article>';
    };
    const corpo = grupos.map((grupo, i) => '<section class="ses-document" id="documento-' + (i + 1) + '"><header class="ses-document-head"><h1>' + esc(grupo.titulo) + '</h1>' +
      (grupo.origem && grupo.origem !== grupo.titulo ? '<p class="source">Arquivo SES: ' + esc(grupo.origem) + '</p>' : '') + '</header>' + grupo.pedidos.map(p => pedidoHTML(p.row, p.indice)).join("") + '</section>').join("");
    const cobertura = '<section class="coverage" id="cobertura"><h2>Cobertura da leitura' + (c?.verificacaoParcial ? ' · parcial' : '') + '</h2>' +
      (!c ? '<p>Contagens não informadas no resultado.</p>' : '<dl>' +
        camposCobertura.filter(([, campo]) => c[campo] != null).map(([label, campo]) => '<dt>' + label + '</dt><dd>' + esc(Number(c[campo]).toLocaleString("pt-BR")) + '</dd>').join("") + '</dl>') +
      ((dados.falhas || []).length ? '<details><summary>Falhas e avisos registrados · ' + dados.falhas.length + '</summary><ul>' + dados.falhas.map(f => '<li><strong>' + esc(f.caminho) + '</strong>: ' + esc(f.motivo) + '</li>').join("") + '</ul></details>' : "") + '</section>';
    const fontesCSS = '.ai-evaluation{padding:18px;margin:20px 0;background:#fffaf0;border:1px solid #dfce9d;border-left:5px solid #ae7720;border-radius:10px}.ses-document{margin:32px 0 48px}.ses-document-head{padding:18px 0 14px;border-bottom:3px solid #13744f}.ses-document-head h1{font-size:1.7rem;margin:0;overflow-wrap:anywhere}.ses-source{margin:20px 0;padding:18px;background:#edf5f0;border:1px solid #cfe2d5;border-radius:10px}.source-caption{font-size:.85rem;color:#476650}.quote-ses{background:white;font-size:.94rem;line-height:1.7;margin-bottom:0}.quote-ses mark{background:#f5e8ad;color:inherit;padding:1px 0}.missing-source{color:#8a5128;font-size:.9rem;margin-bottom:0}@media print{.ses-document-head{break-after:avoid}.ses-source{break-inside:avoid}}';
    return '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>Análise Docs · Caminhos das evidências</title><style>' + estilos + estilosCaminho + fontesCSS + '</style></head><body><main><header><span class="eyebrow">Análise Docs · Conferência documental</span>' +
      paragrafo("Pasta da entidade", dados.pasta) + '</header>' + corpo + cobertura + '</main></body></html>';
  }
  function baixarHTML(dados) {
    const html = gerarHTML(dados), url = global.URL.createObjectURL(new global.Blob([html], { type: "text/html;charset=utf-8" }));
    const link = global.document.createElement("a"); link.href = url;
    link.download = "gemod-caminhos-evidencias-" + new Date().toISOString().slice(0, 10) + ".html";
    link.click(); global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
    return html;
  }
  const api = { MAX_CSV, tabelaCSV, importarCSV, gerarHTML, baixarHTML, partesCaminho, caminhoHTML, estilosCaminho, situacoes, agruparDocumentos, fonteHTML, avaliacaoTexto };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GemodRelatorio = api;
})(typeof window === "undefined" ? globalThis : window);
