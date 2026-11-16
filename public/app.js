/* global GemodPastas, GemodAnaliseIA */
(function () {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const labels = { overview: "Visão geral", analysis: "Área de análise", saved: "Minhas análises", reports: "Relatórios", settings: "Configurações", help: "Como funciona" };
  const etapas = { pasta: "Pasta selecionada", oficios_preparados: "Ofícios preparados", interpretacao_parcial: "Interpretação pendente", pedidos: "Pedidos revisáveis", pesquisa_pendente: "Busca pendente", resultados: "Com resultados", confronto: "Confronto realizado" };
  let user = null, setup = false, mounted = false, current = "overview", analyses = [], refreshGeneration = 0, aiStatus = null;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const withResults = item => ["resultados", "confronto"].includes(item.etapa);
  const fmt = value => Number(value || 0).toLocaleString("pt-BR");
  function toast(message, error = false) {
    const el = document.createElement("div"); el.className = "toast" + (error ? " error" : ""); el.textContent = message;
    $("#toasts").append(el); setTimeout(() => el.remove(), 6500);
  }
  async function api(path, { method = "GET", body } = {}) {
    const response = await fetch("/api/" + path, { method, credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && user) window.tratarSessaoExpirada();
      throw new Error(payload.erro || "Não foi possível acessar o serviço. Verifique sua conexão.");
    }
    return payload;
  }
  function closeMenu() {
    $("#sidebar").classList.remove("open"); $("#menu-backdrop").hidden = true;
    $("#menu-toggle").setAttribute("aria-expanded", "false");
  }
  function navigate(view, updateHash = true) {
    if (!user || !labels[view]) return;
    current = view;
    $$(".view").forEach(el => { el.hidden = el.id !== "view-" + view; });
    $$("[data-nav]").forEach(el => {
      const active = el.dataset.nav === view; el.classList.toggle("active", active);
      if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    $("#breadcrumb-current").textContent = labels[view]; document.title = labels[view] + " · Análise Docs";
    if (updateHash) history.replaceState(null, "", "#" + view);
    closeMenu(); window.scrollTo({ top: 0, behavior: "instant" });
    if (["overview", "saved"].includes(view)) refreshAnalyses();
    if (view === "settings") refreshAI();
  }
  function savePanel() {
    navigate("analysis"); const panel = $(".work-save"); if (!panel) return; panel.open = true;
    panel.scrollIntoView({ block: "start", behavior: "smooth" });
    $("[data-nome-analise]").focus({ preventScroll: true });
  }
  function mountAnalysis() {
    if (mounted) return;
    if (!window.GemodPastas?.render || !window.GemodAnaliseIA) {
      $("#analysis-workspace").innerHTML = '<div class="notice error-notice"><p>Não foi possível carregar a ferramenta de análise. Atualize a página para tentar novamente.</p><button class="btn btn-ghost" data-reload>Atualizar página</button></div>';
      return;
    }
    GemodPastas.render($("#analysis-workspace")); mounted = true;
    const hero = $(".gemod-flow-hero"); hero.setAttribute("aria-label", "Andamento da análise");
    const saved = $(".gemod-saved-analyses"), wrapper = document.createElement("details");
    wrapper.className = "work-save";
    wrapper.innerHTML = "<summary>Salvar análise e acessar trabalhos anteriores</summary>";
    saved.before(wrapper); wrapper.append(saved);
    $(".gemod-saved-analyses h2").textContent = "Salvar e retomar";
    $(".gemod-hero-kicker").textContent = "ANÁLISE DOCS · CONFERÊNCIA DOCUMENTAL";
    const updateDraft = () => { $("#draft-dot").hidden = !$("[data-nome-analise]").value && !$("[data-ia-desc]"); };
    const observer = new MutationObserver(updateDraft);
    observer.observe($("#ia-achados"), { childList: true, subtree: true });
    $("[data-nome-analise]").addEventListener("input", updateDraft);
  }
  function emptyState(filtered = false) {
    return `<div class="empty-state"><span class="empty-illustration">${icon(filtered ? "search" : "folder")}</span><h3>${filtered ? "Nenhuma análise corresponde à busca" : "Sua primeira análise começa aqui"}</h3><p>${filtered ? "Experimente outro nome, pasta ou etapa." : "Conecte os pedidos da SES às evidências da sua pasta. Seus trabalhos salvos aparecerão aqui."}</p>${filtered ? "" : `<button class="btn btn-ghost" data-new-analysis>${icon("plus")} Criar minha primeira análise</button>`}</div>`;
  }
  function analysisTable(items) {
    return `<table class="analysis-list"><thead><tr><th class="name-cell">Análise</th><th>Etapa</th><th class="date-cell">Atualização</th><th class="action-cell"><span class="sr-only">Abrir</span></th></tr></thead><tbody>${items.map(item => {
      const time = new Date(item.atualizadoEm);
      const validDate = Number.isFinite(time.getTime());
      const date = validDate ? time.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short" }) : "—";
      return `<tr><td><div class="analysis-name"><span class="file-tile">${icon("file")}</span><div><strong>${esc(item.nome)}</strong><small>${fmt(item.pedidos)} pedido(s) · ${fmt(item.trechos)} trecho(s)</small></div></div></td><td><span class="badge ${withResults(item) ? "done" : "progress"}">${esc(etapas[item.etapa] || "Em preparação")}</span></td><td class="date-cell">${date}</td><td class="action-cell"><button class="text-button" data-open-analysis="${esc(item.id)}" aria-label="Abrir ${esc(item.nome)}" title="Abrir análise">${icon("arrow")}</button></td></tr>`;
    }).join("")}</tbody></table>`;
  }
  function renderSaved() {
    const search = $("#saved-search").value.trim().toLocaleLowerCase("pt-BR"), filter = $("#saved-filter").value;
    const list = analyses.filter(item => (item.nome + " " + (item.pastaNome || "")).toLocaleLowerCase("pt-BR").includes(search)
      && (filter === "all" || (filter === "results" ? withResults(item) : !withResults(item))));
    $("#saved-analyses").innerHTML = list.length ? analysisTable(list) : emptyState(!!analyses.length || !!search || filter !== "all");
  }
  async function refreshAnalyses() {
    const generation = ++refreshGeneration;
    const refresh = $("#refresh-analyses"); refresh.disabled = true;
    try {
      const data = await api("analises");
      if (generation !== refreshGeneration || !user) return;
      analyses = data;
      $("#metric-analyses").textContent = fmt(data.length);
      $("#metric-requests").textContent = fmt(data.reduce((sum, item) => sum + item.pedidos, 0));
      $("#metric-evidence").textContent = fmt(data.reduce((sum, item) => sum + item.trechos, 0));
      $("#metric-results").textContent = fmt(data.filter(withResults).length);
      $("#saved-count").textContent = fmt(data.length);
      $("#recent-analyses").innerHTML = data.length ? analysisTable(data.slice(0, 5)) : emptyState();
      $("#overview-error").hidden = true; renderSaved();
    } catch (error) {
      if (generation !== refreshGeneration) return;
      $("#overview-error").hidden = false; $("#overview-error").textContent = error.message;
      const message = `<div class="empty-state"><span class="empty-illustration">${icon("clock")}</span><h3>Não foi possível carregar suas análises</h3><p>${esc(error.message)}</p><button class="btn btn-ghost" data-retry-analyses>Tentar novamente</button></div>`;
      $("#recent-analyses").innerHTML = message; $("#saved-analyses").innerHTML = message;
      ["analyses", "requests", "evidence", "results"].forEach(key => { $("#metric-" + key).textContent = "—"; });
      $("#saved-count").textContent = "—";
    } finally { if (generation === refreshGeneration) refresh.disabled = false; }
  }
  async function refreshAI() {
    try {
      aiStatus = await api("analise-ia/status");
      $("#ai-config-badge").textContent = aiStatus.disponivel ? "Configurada" : "Indisponível";
      $("#ai-config-badge").className = "badge " + (aiStatus.disponivel ? "done" : "progress");
      $("#ai-config-description").textContent = aiStatus.disponivel ? "A interpretação e o confronto estão habilitados. Você escolhe quando autorizar o envio. O acesso ao modelo e o saldo dependem do provedor." : aiStatus.motivo;
      $("#ai-model").textContent = aiStatus.modelo || "—";
      $("#check-ai").disabled = !aiStatus.disponivel;
    } catch (error) { $("#ai-config-description").textContent = error.message; $("#check-ai").disabled = true; }
  }
  function activate(account) {
    if (user?.id !== account.id) {
      analyses = []; $("#recent-analyses").textContent = "Carregando análises…"; $("#saved-analyses").textContent = "Carregando análises…";
      ["analyses", "requests", "evidence", "results"].forEach(key => { $("#metric-" + key).textContent = "—"; });
      $("#saved-count").textContent = "—";
    }
    $("#name-field").hidden = true; $("#auth-name").required = false;
    $("#token-field").hidden = true; $("#auth-token").required = false;
    $("#auth-password").autocomplete = "current-password"; $("#auth-password").minLength = 1;
    $("#auth-title").textContent = "Bem-vindo de volta"; $("#auth-submit").innerHTML = "Entrar" + icon("arrow");
    user = account; $("#auth-screen").hidden = true; $("#app").hidden = false;
    $("#user-name").textContent = user.nome; $("#user-role").textContent = user.perfil === "admin" ? "Administrador" : "Analista";
    $("#user-avatar").textContent = user.nome.split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();
    $("#create-user-card").hidden = user.perfil !== "admin"; $("#admin-ai-help").hidden = user.perfil !== "admin";
    mountAnalysis(); const target = location.hash.slice(1); navigate(labels[target] ? target : "overview", false); refreshAI();
  }
  async function bootstrap() {
    $("#auth-screen").hidden = false; $("#auth-submit").disabled = true; $("#auth-retry").hidden = true; $("#auth-error").hidden = true;
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (response.ok) { activate(await response.json()); return; }
      if (response.status !== 401) throw new Error("Não foi possível conectar ao serviço. Tente novamente.");
      const status = await api("setup/status"); setup = !status.configurado;
      $("#auth-title").textContent = setup ? "Prepare seu espaço" : "Bem-vindo de volta";
      $("#auth-description").textContent = setup ? "Crie o administrador deste painel para começar." : "Entre para continuar suas conferências documentais.";
      $("#name-field").hidden = !setup; $("#auth-name").required = setup;
      $("#token-field").hidden = !setup || !status.exigeToken; $("#auth-token").required = setup && !!status.exigeToken;
      $("#auth-password").minLength = setup ? 10 : 1;
      $("#auth-password").autocomplete = setup ? "new-password" : "current-password";
      $("#auth-submit").innerHTML = (setup ? "Criar e acessar" : "Entrar") + icon("arrow");
      $("#auth-submit").disabled = false;
    } catch (error) { $("#auth-error").textContent = error.message; $("#auth-error").hidden = false; $("#auth-retry").hidden = false; }
  }
  window.tratarSessaoExpirada = () => {
    // Preserve the in-memory analysis so it can be saved after logging into the same account.
    $("#app").hidden = true; $("#auth-screen").hidden = false; $("#auth-submit").disabled = false;
    $("#auth-error").hidden = false; $("#auth-error").textContent = "Sua sessão expirou. Entre novamente para continuar.";
  };
  $("#auth-form").addEventListener("submit", async event => {
    event.preventDefault(); const button = $("#auth-submit"); button.disabled = true; $("#auth-error").hidden = true;
    try {
      const account = await api(setup ? "setup" : "auth/login", { method: "POST", body: {
        nome: $("#auth-name").value, email: $("#auth-email").value, senha: $("#auth-password").value, token: $("#auth-token").value,
      } });
      if (user && user.id !== account.id) {
        // A different account must never inherit the previous user's in-memory documents.
        GemodPastas.sair(); mounted = false;
      }
      $("#auth-password").value = ""; $("#auth-token").value = ""; setup = false; activate(account);
    } catch (error) { $("#auth-error").textContent = error.message; $("#auth-error").hidden = false; }
    finally { button.disabled = false; }
  });
  $("#auth-retry").addEventListener("click", bootstrap);
  $("#logout-btn").addEventListener("click", async () => {
    if (window.GemodAnaliseIA?.podeSair() === false) return;
    try { await api("auth/logout", { method: "POST", body: {} }); GemodPastas.sair(); location.reload(); }
    catch (error) { toast(error.message, true); }
  });
  document.addEventListener("click", async event => {
    const nav = event.target.closest("[data-nav]"); if (nav) { event.preventDefault(); navigate(nav.dataset.nav); }
    if (event.target.closest("[data-reload]")) location.reload();
    if (event.target.closest("[data-new-analysis]")) {
      navigate("analysis"); if (!mounted) return; $("[data-nova-analise]").click();
      $("#pasta-selecionar").scrollIntoView({ block: "center", behavior: "smooth" });
    }
    if (event.target.closest("[data-retry-analyses]")) refreshAnalyses();
    const open = event.target.closest("[data-open-analysis]");
    if (open) { open.disabled = true; try { await GemodAnaliseIA.abrir(open.dataset.openAnalysis); } finally { open.disabled = false; } }
    const jump = event.target.closest("[data-jump]");
    if (jump) {
      const target = document.getElementById(jump.dataset.jump);
      if (target.hidden || target.closest("[hidden]")) { toast("Conclua a preparação dos documentos para acessar esta etapa."); return; }
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  });
  $("#save-shortcut").addEventListener("click", savePanel);
  $("#analysis-workspace").addEventListener("click", event => { if (event.target.closest("#ia-salvar")) savePanel(); });
  $("#saved-search").addEventListener("input", renderSaved); $("#saved-filter").addEventListener("change", renderSaved);
  $("#refresh-analyses").addEventListener("click", refreshAnalyses);
  window.addEventListener("analise:erro", event => toast(event.detail || "Não foi possível abrir a análise.", true));
  window.addEventListener("analise:salva", refreshAnalyses); window.addEventListener("analise:aberta", () => { navigate("analysis"); toast("Análise reaberta. Nenhuma consulta à IA foi feita."); });
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1), false));
  $("#menu-toggle").addEventListener("click", () => {
    const open = $("#sidebar").classList.toggle("open"); $("#menu-backdrop").hidden = !open; $("#menu-toggle").setAttribute("aria-expanded", String(open));
  });
  $("#menu-backdrop").addEventListener("click", closeMenu); document.addEventListener("keydown", event => { if (event.key === "Escape") closeMenu(); });
  $("#export-current").addEventListener("click", () => {
    const button = $("#ia-html");
    if (!button || button.disabled) { toast("Conclua uma busca ou reabra uma análise com resultados antes de exportar."); return; }
    button.click(); toast("Download do relatório solicitado.");
  });
  $("#check-ai").addEventListener("click", async () => {
    $("#check-ai").disabled = true; $("#ai-check-status").textContent = "Consultando metadados do modelo, sem documentos…";
    try { const result = await api("analise-ia/diagnostico"); $("#ai-check-status").textContent = result.mensagem || "Modelo localizado. A consulta não comprova saldo nem permissão de geração."; }
    catch (error) { $("#ai-check-status").textContent = error.message; }
    finally { $("#check-ai").disabled = !aiStatus?.disponivel; }
  });
  function bindForm(selector, path, success) {
    const form = $(selector); form.addEventListener("submit", async event => {
      event.preventDefault(); const status = form.querySelector("[data-form-status]"), button = form.querySelector("button[type=submit]");
      status.textContent = "Salvando…"; button.disabled = true;
      try { await api(path, { method: "POST", body: Object.fromEntries(new FormData(form)) }); form.reset(); status.textContent = success; }
      catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }
  bindForm("#password-form", "auth/trocar-senha", "Senha atualizada. As outras sessões foram revogadas.");
  bindForm("#user-form", "users", "Conta criada. A pessoa já pode entrar com estas credenciais.");
  bootstrap();
})();
