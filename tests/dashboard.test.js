const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { JSDOM } = require("jsdom");
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function screen(t, { missingEngine = false, failList = false } = {}) {
  const dom = new JSDOM(readFileSync(require.resolve("../public/index.html"), "utf8"), { url: "https://analise.example.test/", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close());
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  const item = { id: "test-id", nome: '<img src=x onerror="alert(1)">', pastaNome: "Entidade", etapa: "resultados", pedidos: 3, trechos: 5, atualizadoEm: "2026-11-16T10:00:00Z" };
  w.fetch = async url => {
    if (url.endsWith("/auth/me")) return response({ id: "admin", nome: "Admin Teste", perfil: "admin" });
    if (url.endsWith("/analises")) return response(failList ? { erro: "Falha de conexão" } : [item], failList ? 503 : 200);
    return response({ disponivel: false, modelo: "modelo-teste", motivo: "IA desabilitada" });
  };
  if (!missingEngine) {
    w.GemodPastas = { render(container) { container.innerHTML = '<section class="gemod-flow-hero"><span class="gemod-hero-kicker"></span></section><section class="gemod-saved-analyses"><h2>Minhas análises</h2><input data-nome-analise></section><div id="ia-achados"></div>'; } };
    w.GemodAnaliseIA = { podeSair: () => true };
  }
  w.eval(readFileSync(require.resolve("../public/app.js"), "utf8"));
  return { w, el: selector => w.document.querySelector(selector) };
}

test("dashboard uses real summaries, escapes titles and filters analyses without clearing the workspace", async t => {
  const s = screen(t); await tick(); await tick();
  assert.equal(s.el("#app").hidden, false);
  assert.equal(s.el("#metric-analyses").textContent, "1");
  assert.equal(s.el("#metric-requests").textContent, "3");
  assert.equal(s.el("#metric-evidence").textContent, "5");
  assert.equal(s.el("#recent-analyses img"), null);
  assert.match(s.el("#recent-analyses").textContent, /<img/);
  s.el("[data-nome-analise]").value = "Rascunho preservado";
  s.el('[data-nav="saved"]').click(); await tick();
  s.el("#saved-search").value = "inexistente"; s.el("#saved-search").dispatchEvent(new s.w.Event("input"));
  assert.match(s.el("#saved-analyses").textContent, /Nenhuma análise corresponde/);
  s.el('[data-nav="analysis"]').click();
  assert.equal(s.el("[data-nome-analise]").value, "Rascunho preservado");
  s.w.tratarSessaoExpirada();
  assert.equal(s.el("#app").hidden, true); assert.equal(s.el("#auth-screen").hidden, false);
  assert.equal(s.el("[data-nome-analise]").value, "Rascunho preservado", "expired session does not silently destroy unsaved work");
});
test("unavailable analysis scripts leave a recoverable screen and navigation still works", async t => {
  const s = screen(t, { missingEngine: true }); await tick(); await tick();
  s.el('[data-nav="analysis"]').click();
  assert.match(s.el("#analysis-workspace").textContent, /Não foi possível carregar/);
  assert.ok(s.el("[data-reload]"));
  s.el('[data-nav="help"]').click(); assert.equal(s.el("#view-help").hidden, false);
});
test("failed summary requests never present a false zero or an empty-success state", async t => {
  const s = screen(t, { failList: true }); await tick(); await tick();
  assert.equal(s.el("#metric-analyses").textContent, "—");
  assert.match(s.el("#recent-analyses").textContent, /Não foi possível carregar/);
  assert.ok(s.el("[data-retry-analyses]"));
});
