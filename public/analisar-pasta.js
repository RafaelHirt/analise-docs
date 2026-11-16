(function (global) {
  "use strict";

  const EXCEL = new Set(["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm", "xla", "xlam", "xlw"]);
  const WORD = new Set(["doc", "docx", "docm", "dot", "dotx", "dotm"]);
  const Diagnostico=typeof module!=="undefined"&&module.exports?require("./leitura-diagnostico.js"):global.GemodLeituraDiagnostico;
  const esc = (valor) => String(valor).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
  const numero = (valor) => Number(valor).toLocaleString("pt-BR");
  const limiteNavegador = "As contagens abrangem apenas os itens que o navegador permite listar. Ele pode omitir itens sem avisar (por exemplo, nomes incompatíveis). A cobertura total da pasta não foi verificada.";
  const estadoLeitura = (resultado) => resultado.completo ? "LEITURA CONCLUÍDA — itens listados pelo navegador" : "RELATÓRIO PARCIAL — não representa toda a pasta";

  function tipoArquivo(nome) {
    const ponto = nome.lastIndexOf(".");
    const extensao = ponto < 0 ? "" : nome.slice(ponto + 1).toLowerCase();
    return extensao === "pdf" ? "pdf" : EXCEL.has(extensao) ? "excel" : WORD.has(extensao) ? "word" : "outros";
  }

  function motivoErro(erro) {
    if (erro.name === "NotAllowedError" || erro.name === "SecurityError") return "Acesso não permitido";
    if (erro.name === "NotFoundError") return "Pasta não encontrada (pode ter sido movida ou excluída)";
    return "Não foi possível listar todos os itens desta pasta";
  }

  async function analisar(raiz, { signal, onProgress } = {}) {
    const resultado = {
      nome: raiz.name,
      iniciadoEm: new Date().toISOString(),
      finalizadoEm: null,
      completo: false,
      interrompido: false,
      pastas: [],
      erros: [],
      totais: { pastas: 0, vazias: 0, arquivos: 0, pdf: 0, excel: 0, word: 0, outros: 0 },
    };
    const pendentes = [{ handle: raiz, caminho: raiz.name }];
    let passos = 0;
    let ultimoAviso = 0;
    const avisar = (forcar = false) => {
      if (forcar || Date.now() - ultimoAviso >= 250) {
        onProgress?.(resultado);
        ultimoAviso = Date.now();
      }
    };
    while (pendentes.length && !signal?.aborted) {
      const { handle, caminho } = pendentes.pop();
      const pasta = { caminho, subpastas: 0, arquivos: 0, pdf: 0, excel: 0, word: 0, outros: 0, lida: false, vazia: null };
      resultado.pastas.push(pasta);
      resultado.totais.pastas++;
      try {
        for await (const item of handle.values()) {
          if (signal?.aborted) break;
          if (item.kind === "directory") {
            pasta.subpastas++;
            pendentes.push({ handle: item, caminho: `${caminho}/${item.name}` });
          } else if (item.kind === "file") {
            const tipo = tipoArquivo(item.name);
            pasta.arquivos++;
            pasta[tipo]++;
            resultado.totais.arquivos++;
            resultado.totais[tipo]++;
          }
          if (++passos % 200 === 0) {
            avisar();
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        if (!signal?.aborted) {
          pasta.lida = true;
          pasta.vazia = pasta.subpastas === 0 && pasta.arquivos === 0;
          if (pasta.vazia) resultado.totais.vazias++;
        }
      } catch (erro) {
        resultado.erros.push(Diagnostico?Diagnostico.diagnosticar(erro,caminho):{ caminho, motivo: motivoErro(erro),codigo:erro.name||"Error",mensagem:erro.message||"" });
      }
      avisar();
    }
    resultado.interrompido = signal?.aborted === true;
    resultado.completo = !resultado.interrompido && resultado.erros.length === 0;
    resultado.finalizadoEm = new Date().toISOString();
    avisar(true);
    return resultado;
  }

  const situacao = (pasta) => !pasta.lida ? "Leitura incompleta" : pasta.vazia ? "Vazia na leitura" : "Lida";
  const linhaTexto = (valor) => String(valor).replace(/[\r\n\t]/g, " ");

  function relatorioTexto(resultado) {
    const t = resultado.totais;
    const linhas = [
      "Análise Docs — Inventário local de pasta",
      `Resultado: ${estadoLeitura(resultado)}`,
      limiteNavegador,
      `Pasta principal: ${linhaTexto(resultado.nome)}`,
      `Início: ${resultado.iniciadoEm}`,
      `Fim: ${resultado.finalizadoEm}`,
      "",
      `Pastas e subpastas listadas (inclui a principal): ${t.pastas}`,
      `Pastas vazias na leitura: ${t.vazias}`,
      `Arquivos: ${t.arquivos}`,
      `PDFs: ${t.pdf}`,
      `Excel: ${t.excel}`,
      `Word: ${t.word}`,
      `Outros arquivos: ${t.outros}`,
      "",
      "Vazia na leitura = sem arquivos E sem subpastas entre os itens listados. Arquivos ocultos também contam quando listados pelo navegador.",
      `Excel: ${[...EXCEL].map((e) => `.${e}`).join(", ")}. CSV e ODS são classificados como outros.`,
      `Word: ${[...WORD].map((e) => `.${e}`).join(", ")}. RTF e ODT são classificados como outros.`,
      "A classificação é pela extensão; o conteúdo dos documentos não foi aberto nem enviado.",
      "O resultado retrata a leitura feita neste momento; alterações na pasta durante a análise podem afetar a contagem.",
      "Os nomes das pastas podem conter informação sensível. Revise antes de compartilhar.",
      "",
      "PASTAS VAZIAS",
      ...resultado.pastas.filter((p) => p.vazia === true).map((p) => linhaTexto(p.caminho)),
      "",
      "DETALHES POR PASTA (contagens diretas, sem somar as subpastas)",
      ...resultado.pastas.map((p) => `${linhaTexto(p.caminho)} | ${situacao(p)} | Subpastas: ${p.subpastas} | Arquivos: ${p.arquivos} | PDF: ${p.pdf} | Excel: ${p.excel} | Word: ${p.word} | Outros: ${p.outros}`),
    ];
    if (resultado.interrompido) linhas.push("", "Análise interrompida. As contagens acima são parciais.");
    if (resultado.erros.length) {
      linhas.push("", "FALHAS DE LEITURA — listagem das pastas, antes de abrir os PDFs", ...resultado.erros.map((e) => `${linhaTexto(e.caminho)}: ${e.motivo}\r\nMensagem original: ${linhaTexto(e.mensagem||"Não informada")}\r\nComo verificar: ${e.orientacao||"Selecione a pasta novamente para testar o acesso."}`));
    }
    return linhas.join("\r\n");
  }

  function celulaCSV(valor) {
    let texto = String(valor);
    if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(texto)) texto = "'" + texto;
    return `"${texto.replace(/"/g, '""')}"`;
  }

  function relatorioCSV(resultado) {
    const linhas = [["Pasta", "Situação", "Subpastas diretas", "Arquivos diretos", "PDF", "Excel", "Word", "Outros", "Resultado da análise", "Limite da contagem","Código do erro","Mensagem original","Como verificar"]];
    resultado.pastas.forEach((p) => {const falha=resultado.erros.find(e=>e.caminho===p.caminho);linhas.push([
      p.caminho, situacao(p), p.subpastas, p.arquivos, p.pdf, p.excel, p.word, p.outros, estadoLeitura(resultado), limiteNavegador,
      falha?.codigo||"",falha?.mensagem||"",falha?.orientacao||""
    ]);});
    return "\uFEFF" + linhas.map((linha) => linha.map(celulaCSV).join(";")).join("\r\n");
  }

  let telaAtual = null;
  function sair() {
    if (!telaAtual) return;
    global.GemodConferencia?.sair();
    telaAtual.ativa = false;
    telaAtual.controle?.abort();
    telaAtual.resultado = null;
    telaAtual.container.replaceChildren();
    telaAtual = null;
  }

  function baixar(conteudo, extensao, mime) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `gemod-inventario-${new Date().toISOString().slice(0, 10)}.${extensao}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render(container) {
    sair();
    const tela = { ativa: true, controle: null, resultado: null, pagina: 0, container };
    telaAtual = tela;
    const suportado = typeof global.showDirectoryPicker === "function" && global.isSecureContext === true;
    container.innerHTML = `
      <section class="gemod-flow-hero" aria-label="Fluxo de conferência documental">
        <div class="gemod-flow-hero-title"><span class="gemod-hero-kicker">Análise Docs · CONFERÊNCIA DOCUMENTAL</span><h2>Da exigência à evidência, com rastreabilidade</h2><p>Inventarie os arquivos, interprete os apontamentos da SES e confronte somente os trechos relevantes. A pesquisa na pasta é local.</p></div>
        <ol class="gemod-flow-steps">
          <li data-flow-step="1" class="ativo"><span>01</span> Inventário</li>
          <li data-flow-step="2"><span>02</span> Ofícios SES</li>
          <li data-flow-step="3"><span>03</span> Busca local</li>
          <li data-flow-step="4"><span>04</span> Confronto</li>
        </ol>
      </section>
      <section class="painel inventario-local gemod-flow-card">
        <div class="painel-head gemod-flow-heading"><div><span class="gemod-eyebrow">01 / 04 · INVENTÁRIO</span><h2>Selecionar a pasta da entidade</h2><p>Conte arquivos e identifique lacunas de acesso antes de começar a conferência técnica.</p></div><span class="gemod-status-pill">Somente leitura</span></div>
        <div class="painel-body">
          <p class="gemod-section-intro">Escolha a pasta principal extraída, não o ZIP. A contagem de arquivos e subpastas ocorre no seu computador, sem upload.</p>
          <details class="gemod-manual-mode"><summary>Entenda o alcance e as limitações do inventário</summary><p>${limiteNavegador}</p><p>A leitura de conteúdos para buscar evidências é uma etapa posterior e separada. Textos só são enviados à IA mediante autorização.</p></details>
          <div class="form-acoes">
            <button type="button" class="btn btn-primary" id="pasta-selecionar" ${suportado ? "" : "disabled"}>Selecionar pasta e analisar</button>
            <button type="button" class="btn btn-ghost" id="pasta-parar" hidden>Interromper</button>
          </div>
          <p class="metric-extra">Chrome ou Edge · Permissão de leitura · Pastas com erro aparecerão no relatório como não verificadas.</p>
          ${suportado ? "" : '<p class="form-erro">Este navegador não oferece o seletor necessário para contar pastas vazias. Abra a Análise Docs no Chrome ou Edge do computador onde está a pasta.</p>'}
          <p class="metric-extra">Use Salvar análise em Minhas análises para guardar os pedidos e resultados. A contagem e o índice local são temporários. Evite mover os arquivos durante a leitura.</p>
          <p id="pasta-status" role="status" aria-live="polite">Nenhuma pasta selecionada.</p>
          <progress id="pasta-progresso" aria-label="Análise da pasta em andamento" hidden></progress>
        </div>
      </section>
      <div class="metric-grid inventario-metricas" id="pasta-totais" hidden></div>
      <section class="painel inventario-local" id="pasta-resultado" hidden>
        <div class="painel-head gemod-flow-heading"><div><span class="gemod-eyebrow">INVENTÁRIO · RESULTADO</span><h2>Cobertura da pasta</h2><p>O relatório diferencia documentos acessíveis de pastas cuja leitura falhou.</p></div></div>
        <div class="painel-body">
          <p id="pasta-resumo" class="gemod-inventory-summary"></p>
          <div id="pasta-diagnostico" class="gemod-read-errors" hidden></div>
          <div class="form-acoes">
            <button type="button" class="btn btn-primary" id="pasta-texto">Baixar relatório para o ChatGPT (.txt)</button>
            <button type="button" class="btn btn-ghost" id="pasta-csv">Baixar planilha (.csv)</button>
          </div>
          <details class="gemod-manual-mode"><summary>Como interpretar esta contagem</summary><p>O relatório TXT contém nomes de pastas (não conteúdos): revise antes de compartilhar. A contagem inclui a pasta principal; vazia significa sem arquivos nem subpastas listados.</p><p>CSV e ODS são Outros; Word inclui DOC, DOCX, DOCM, DOT, DOTX e DOTM. Arquivos RTF e ODT entram em Outros.</p></details>
          <details class="inventario-detalhes">
            <summary>Conferir detalhes por pasta</summary>
            <div class="inventario-filtros">
              <label>Buscar pasta<input type="search" id="pasta-busca" placeholder="Digite parte do nome" /></label>
              <label class="check-item"><input type="checkbox" id="pasta-vazias" /> Somente pastas vazias</label>
            </div>
            <p class="metric-extra">Os números de cada linha são apenas daquela pasta, sem somar o conteúdo das subpastas.</p>
            <div class="tabela-wrap">
              <table class="dados"><caption>Contagem direta de arquivos por pasta</caption>
                <thead><tr><th scope="col">Pasta</th><th scope="col">Situação</th><th scope="col">Subpastas</th><th scope="col">Arquivos</th><th scope="col">PDF</th><th scope="col">Excel</th><th scope="col">Word</th><th scope="col">Outros</th></tr></thead>
                <tbody id="pasta-linhas"></tbody>
              </table>
            </div>
            <div class="inventario-paginacao">
              <button type="button" class="btn btn-ghost btn-sm" id="pasta-anterior">Anterior</button>
              <span id="pasta-pagina" aria-live="polite"></span>
              <button type="button" class="btn btn-ghost btn-sm" id="pasta-proxima">Próxima</button>
            </div>
          </details>
        </div>
      </section>`;
    global.GemodConferencia?.montar(container);
    const $ = (seletor) => container.querySelector(seletor);
    const selecionar = $("#pasta-selecionar");
    const parar = $("#pasta-parar");
    const status = $("#pasta-status");
    const progresso = $("#pasta-progresso");
    const saida = $("#pasta-resultado");
    function totais(resultado) {
      const labels = { pastas: "Pastas listadas (inclui a principal)", vazias: "Vazias na leitura", arquivos: "Arquivos listados", pdf: "PDFs", excel: "Planilhas Excel", word: "Documentos Word", outros: "Outros arquivos" };
      $("#pasta-totais").hidden = false;
      $("#pasta-totais").innerHTML = Object.entries(labels).map(([chave, label]) => `
        <div class="metric-card"><div class="metric-rotulo">${label}</div><div class="metric-valor">${numero(resultado.totais[chave])}</div></div>`).join("");
    }
    function tabela() {
      if (!tela.resultado) return;
      const busca = $("#pasta-busca").value.toLocaleLowerCase("pt-BR");
      const vazias = $("#pasta-vazias").checked;
      const pastas = tela.resultado.pastas.filter((p) => (!vazias || p.vazia === true) && p.caminho.toLocaleLowerCase("pt-BR").includes(busca));
      const paginas = Math.max(1, Math.ceil(pastas.length / 100));
      tela.pagina = Math.min(tela.pagina, paginas - 1);
      $("#pasta-linhas").innerHTML = pastas.slice(tela.pagina * 100, (tela.pagina + 1) * 100).map((p) => `
        <tr><td class="inventario-caminho">${esc(p.caminho)}</td><td>${situacao(p)}</td>${[p.subpastas, p.arquivos, p.pdf, p.excel, p.word, p.outros].map((n) => `<td class="num">${numero(n)}</td>`).join("")}</tr>`).join("") || '<tr><td colspan="8">Nenhuma pasta neste filtro.</td></tr>';
      $("#pasta-pagina").textContent = `Página ${tela.pagina + 1} de ${paginas} · ${numero(pastas.length)} pasta(s)`;
      $("#pasta-anterior").disabled = tela.pagina === 0;
      $("#pasta-proxima").disabled = tela.pagina + 1 >= paginas;
    }
    selecionar.addEventListener("click", async () => {
      if (global.GemodAnaliseIA?.podeSair() === false) return;
      selecionar.disabled = true;
      tela.controle = new AbortController();
      global.GemodAnaliseIA?.atualizar();
      try {
        const raiz = await global.showDirectoryPicker({ mode: "read", id: "gemod-inventario" });
        if (!tela.ativa) return;
        global.GemodConferencia?.definirPasta(raiz);
        container.querySelectorAll("[data-flow-step]").forEach(x=>{x.classList.toggle("ativo",x.dataset.flowStep==="2");x.classList.toggle("concluido",x.dataset.flowStep==="1")});
        tela.resultado = null;
        tela.pagina = 0;
        saida.hidden = true;
        $("#pasta-busca").value = "";
        $("#pasta-vazias").checked = false;
        $("#pasta-totais").hidden = true;
        progresso.hidden = false;
        parar.hidden = false;
        global.GemodAnaliseIA?.atualizar();
        parar.disabled = false;
        status.textContent = `Analisando ${raiz.name}… Aguarde nesta tela. Nenhum documento está sendo enviado.`;
        const resultado = await analisar(raiz, {
          signal: tela.controle.signal,
          onProgress: (parcial) => {
            if (!tela.ativa) return;
            totais(parcial);
            status.textContent = `Analisando ${raiz.name}: ${numero(parcial.totais.pastas)} pasta(s) e ${numero(parcial.totais.arquivos)} arquivo(s) contados…`;
          },
        });
        if (!tela.ativa) return;
        tela.resultado = resultado;
        totais(resultado);
        status.textContent = resultado.completo ? "Leitura concluída nos itens listados pelo navegador. Nenhum documento foi enviado." : "Contagem parcial. Nem todos os itens foram analisados.";
        $("#pasta-resumo").textContent = `${resultado.nome} — ${estadoLeitura(resultado)}.${resultado.interrompido ? " Você interrompeu a análise." : ""}${resultado.erros.length ? ` ${numero(resultado.erros.length)} pasta(s) tiveram falha de leitura; elas não foram consideradas vazias. Consulte o relatório de texto.` : ""}`;
        $("#pasta-resumo").className = resultado.completo ? "" : "form-erro";
        const diagnostico=$("#pasta-diagnostico");diagnostico.hidden=!resultado.erros.length;
        diagnostico.innerHTML=resultado.erros.length?'<h3>Por que estas pastas não foram lidas?</h3><p>A falha ocorreu ao listar os itens da pasta, antes de ler os PDFs. Essa etapa acontece no seu computador e não usa créditos de IA. O que não pôde ser listado não foi considerado vazio.</p>'+resultado.erros.map(e=>'<article class="gemod-read-error"><strong class="gemod-read-path">'+esc(e.caminho)+'</strong><p>'+esc(e.motivo)+'</p><details><summary>Código e mensagem original</summary><p><code>'+esc(e.codigo||"Error")+'</code> · '+esc(e.mensagem||"O navegador não informou uma mensagem adicional.")+'</p></details><p><strong>Como verificar:</strong> '+esc(e.orientacao||"Confira o acesso a esta pasta no computador.")+'</p></article>').join(""):"";
        saida.hidden = false;
        tabela();
      } catch (erro) {
        if (!tela.ativa) return;
        if (erro.name === "AbortError") status.textContent = "Seleção cancelada. Nenhum arquivo foi analisado nesta tentativa.";
        else status.textContent = `${motivoErro(erro)}. Tente novamente e permita a leitura da pasta.`;
      } finally {
        if (tela.ativa) {
          tela.controle = null;
          selecionar.disabled = false;
          parar.hidden = true;
          progresso.hidden = true;
          global.GemodAnaliseIA?.atualizar();
        }
      }
    });
    parar.addEventListener("click", () => {
      tela.controle?.abort();
      parar.disabled = true;
      status.textContent = "Interrompendo a análise…";
    });
    ["#pasta-busca", "#pasta-vazias"].forEach((id) => $(id).addEventListener("input", () => { tela.pagina = 0; tabela(); }));
    $("#pasta-anterior").addEventListener("click", () => { tela.pagina--; tabela(); });
    $("#pasta-proxima").addEventListener("click", () => { tela.pagina++; tabela(); });
    $("#pasta-texto").addEventListener("click", () => {
      if (tela.resultado) baixar(relatorioTexto(tela.resultado), "txt", "text/plain;charset=utf-8");
    });
    $("#pasta-csv").addEventListener("click", () => {
      if (tela.resultado) baixar(relatorioCSV(tela.resultado), "csv", "text/csv;charset=utf-8");
    });
  }

  const api = { analisar, tipoArquivo, relatorioTexto, relatorioCSV, render, sair, ocupado:()=>!!telaAtual?.ativa&&!!telaAtual.controle };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GemodPastas = api;
})(typeof window === "undefined" ? globalThis : window);
