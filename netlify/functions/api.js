"use strict";

// Standalone API. The conference engine and versioned analysis storage come from GEMOD.
const { store, requests } = require("../lib/storage");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const IA = require("../lib/analise-ia");
const SESSION_SECONDS = 7 * 86400;
const json = (statusCode, body, headers = {}) => ({ statusCode, headers: {
  "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers,
}, body: JSON.stringify(body) });
const ok = body => json(200, body);
const created = body => json(201, body);
const erro = (status, message) => json(status, { erro: message });
const isAdmin = user => user?.perfil === "admin";
const emailNormalizado = value => String(value || "").trim().toLowerCase();
function parseBody(event) {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw Object.assign(new Error("Envie um objeto JSON válido."), { statusCode: 400 }); }
}
function cookie(event) {
  return /(?:^|;\s*)ses=([a-f0-9]{64})(?:;|$)/.exec(event.headers.cookie || "")?.[1];
}
const sessionCookie = (token, seconds = SESSION_SECONDS) => `ses=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
const sanitizeUser = user => ({ id: user.id, nome: user.nome, email: user.email, perfil: user.perfil });
function sameSecret(a, b) {
  const aa = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return aa.length > 0 && aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function getSessionUser(event) {
  const token = cookie(event);
  if (!token) return null;
  const session = await store("sessions").get(token, { type: "json" });
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const user = await store("users").get(String(session.userId), { type: "json" });
  return user?.ativo && (user.authVersion || null) === (session.authVersion || null) ? user : null;
}
async function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  await store("sessions").setJSON(token, { userId: user.id, authVersion: user.authVersion || null,
    expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString() }, { onlyIfNew: true });
  return json(200, sanitizeUser(user), { "set-cookie": sessionCookie(token) });
}
function validateAccount(body) {
  const nome = String(body.nome || "").trim(), email = emailNormalizado(body.email), senha = body.senha;
  if (!nome || nome.length > 140 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw Object.assign(new Error("Informe nome e e-mail válidos."), { statusCode: 400 });
  if (typeof senha !== "string" || senha.length < 10 || Buffer.byteLength(senha) > 72)
    throw Object.assign(new Error("A senha deve ter ao menos 10 caracteres e no máximo 72 bytes."), { statusCode: 400 });
  return { nome, email, senha };
}
const routes = [];
function route(method, pattern, handler) {
  const parts = pattern.split("/");
  routes.push({ method, re: new RegExp("^" + parts.map(p => p.startsWith(":") ? "([^/]+)" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/") + "$"),
    names: parts.filter(p => p.startsWith(":")).map(p => p.slice(1)), handler });
}

route("GET", "setup/status", async ctx => ok({
  configurado: !!await store("users").get("admin", { type: "json" }),
  exigeToken: typeof ctx.event.localBlobsFetch !== "function",
}));
route("POST", "setup", async ctx => {
  const body = parseBody(ctx.event);
  // A new public deployment must not let the first visitor claim its administrator.
  if (typeof ctx.event.localBlobsFetch !== "function") {
    const secret = process.env.ANALISE_SETUP_TOKEN;
    if (!secret || secret.length < 16) return erro(503, "Configure ANALISE_SETUP_TOKEN no Netlify (mínimo de 16 caracteres) para criar o administrador.");
    if (!sameSecret(body.token, secret)) return erro(403, "Código de configuração inválido.");
  }
  const users = store("users");
  if (await users.get("admin", { type: "json" })) return erro(409, "Sistema já configurado. Entre com sua conta.");
  const { nome, email, senha } = validateAccount(body);
  const user = { id: "admin", nome, email, perfil: "admin", ativo: true,
    senhaHash: await bcrypt.hash(senha, 10), criadoEm: new Date().toISOString() };
  await users.setJSON("admin", user, { onlyIfNew: true });
  // Login also resolves the bootstrap account directly, so a failed index write cannot strand it.
  return createSession(user);
});
route("POST", "auth/login", async ctx => {
  const { email, senha } = parseBody(ctx.event), emailNorm = emailNormalizado(email);
  if (!emailNorm || typeof senha !== "string" || Buffer.byteLength(senha) > 72) return erro(400, "Informe e-mail e senha válidos.");
  const counters = store("config");
  const key = "login-" + new Date().toISOString().slice(0, 13) + "-" + crypto.createHash("sha256").update(emailNorm).digest("hex");
  const counter = await counters.get(key, { type: "json" }) || { tentativas: 0 };
  if (counter.tentativas >= 15) return erro(429, "Muitas tentativas de acesso. Tente novamente na próxima hora.");
  await counters.setJSON(key, { tentativas: counter.tentativas + 1 });
  const users = store("users"), admin = await users.get("admin", { type: "json" });
  const reference = admin?.email === emailNorm ? { id: "admin" } : await users.get("email:" + emailNorm, { type: "json" });
  const user = reference && await users.get(String(reference.id), { type: "json" });
  if (!user?.ativo || !await bcrypt.compare(senha, user.senhaHash)) return erro(401, "E-mail ou senha inválidos.");
  await counters.setJSON(key, { tentativas: 0 });
  return createSession(user);
});
route("GET", "auth/me", async ctx => ctx.user ? ok(sanitizeUser(ctx.user)) : erro(401, "Não autenticado."));
route("POST", "auth/logout", async ctx => {
  const token = cookie(ctx.event);
  if (token) await store("sessions").delete(token);
  return { statusCode: 204, headers: { "set-cookie": sessionCookie("", 0), "cache-control": "no-store" }, body: "" };
});
route("POST", "auth/trocar-senha", async ctx => {
  if (!ctx.user) return erro(401, "Não autenticado.");
  const body = parseBody(ctx.event);
  const { senha } = validateAccount({ ...ctx.user, senha: body.novaSenha });
  if (typeof body.senhaAtual !== "string" || !await bcrypt.compare(body.senhaAtual, ctx.user.senhaHash)) return erro(401, "Senha atual incorreta.");
  const updated = { ...ctx.user, senhaHash: await bcrypt.hash(senha, 10), authVersion: crypto.randomBytes(32).toString("hex") };
  await store("users").setJSON(String(updated.id), updated);
  return createSession(updated);
});
route("POST", "users", async ctx => {
  if (!ctx.user) return erro(401, "Não autenticado.");
  if (!isAdmin(ctx.user)) return erro(403, "Apenas administradores podem criar contas.");
  const body = parseBody(ctx.event), { nome, email, senha } = validateAccount(body);
  if (!["admin", "analista"].includes(body.perfil)) return erro(400, "Escolha um perfil válido.");
  const users = store("users"), admin = await users.get("admin", { type: "json" });
  if (admin?.email === email) return erro(409, "Já existe uma conta com esse e-mail.");
  const id = crypto.randomUUID();
  // Reserve the unique email before exposing the user account.
  await users.setJSON("email:" + email, { id }, { onlyIfNew: true });
  try {
    await users.setJSON(id, { id, nome, email, ativo: true, perfil: body.perfil,
      senhaHash: await bcrypt.hash(senha, 10), criadoEm: new Date().toISOString() }, { onlyIfNew: true });
  } catch (error) { await users.delete("email:" + email); throw error; }
  return created({ id, nome, email, perfil: body.perfil });
});

// Analysis snapshots keep user ownership, conditional writes and original source validation.
require("../lib/analises").registrar({ route, store, requests, crypto, ok, created, erro, parseBody });

function falhaPublicaIA(e) {
  const provider = e.name === "OpenAIProviderError";
  const status = provider ? e.httpStatus : /^GEMOD_AI_MODEL/.test(e.message || "") ? 400 : 502;
  const message = ["TypeError", "SyntaxError"].includes(e.name) ? "Falha de comunicação com o serviço de IA. Não foi possível confirmar a resposta." : String(e.message || "Falha na análise.");
  return json(status, { erro: message.slice(0,900), codigo: provider ? e.publicCode : "FALHA_CONEXAO_IA", modelo: e.modelo || IA.modeloPublico(),
    ...(provider ? { httpProvedor: e.httpStatus, codigoProvedor: e.codigoProvedor, referencia: e.requestId || "" } : {}) });
}
route("GET", "analise-ia/status", async (ctx) => {
  if (!ctx.user) return erro(401, "Não autenticado.");
  return ok({disponivel: IA.habilitado() && isAdmin(ctx.user), exigeAutorizacao: true, modelo: IA.modeloPublico(),
    motivo: !IA.habilitado() ? "IA não habilitada no Netlify: configure GEMOD_OPENAI_API_KEY e GEMOD_AI_ENABLED=true." :
      !isAdmin(ctx.user) ? "Acesso inicial restrito a administradores." : ""});
});
route("GET", "analise-ia/diagnostico", async (ctx) => {
  if (!ctx.user) return erro(401,"Não autenticado.");
  if (!isAdmin(ctx.user)) return erro(403,"Diagnóstico de IA restrito a administradores.");
  if (!IA.habilitado()) return erro(503,"IA não configurada. Verifique GEMOD_AI_ENABLED e a presença da chave no Netlify.");
  try { return ok(await IA.verificarModelo()); }
  catch(e) { return falhaPublicaIA(e); }
});
for (const fase of ["extrair","avaliar"]) {
  route("POST", "analise-ia/" + fase, async (ctx) => {
    if (!ctx.user) return erro(401,"Não autenticado.");
    if (!isAdmin(ctx.user)) return erro(403,"Recurso de IA restrito a administradores nesta fase.");
    if (!IA.habilitado()) return erro(503,"IA ainda não configurada no Netlify.");
    if (String(ctx.event.body || "").length > 220000) return erro(413,"Texto enviado excede o limite permitido.");
    try {
      const entrada=IA.validarEntrada(fase,parseBody(ctx.event));
      // Limite diário para evitar cobranças não planejadas por chamadas repetidas.
      const key="ai-consumo-" + new Date().toISOString().slice(0,10) + "-" + ctx.user.id;
      const config=store("config");
      const consumo=(await config.get(key,{type:"json"})) || {chamadas:0};
      if (consumo.chamadas >= 35) return erro(429,"Limite diário de IA atingido. Consulte o administrador.");
      await config.setJSON(key,{chamadas:consumo.chamadas+1});
      const resposta=await IA.chamar(fase,entrada);
      return ok(IA.sanitizarSaida(fase,resposta,entrada));
    } catch(e) {
      // Nunca registrar documentos, dados técnicos ou respostas em logs.
      const msg=String(e.message||"Falha na análise.");
      if (/^(É necessária|Informe de|Documento SES|O documento excede|Envie de|Até 6|Texto da avaliação|Etapa desconhecida)/.test(msg)) return erro(400,msg);
      console.error("Falha da IA documental:",e.name || "Error");
      return falhaPublicaIA(e);
    }
  });
}


exports.handler = async original => requests.run({ reads: new Map(), allocated: new Set() }, async () => {
  const event = { ...original, headers: Object.fromEntries(Object.entries(original.headers || {}).map(([key, value]) => [key.toLowerCase(), value])) };
  const raw = (event.path || "").replace(/^\/?\.netlify\/functions\/api\/?/, "").replace(/^\/?api\/?/, "").replace(/^\/+|\/+$/g, "");
  try {
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(event.httpMethod);
    if (mutation) {
      if (!(event.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return erro(415, "Use Content-Type application/json.");
      const origin = event.headers.origin;
      if (origin && new URL(origin).host !== (event.headers["x-forwarded-host"] || event.headers.host)) return erro(403, "Origem da requisição não permitida.");
      const bytes = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").length : Buffer.byteLength(event.body || "");
      if (bytes > 4 * 1024 * 1024) return erro(413, "Corpo da requisição acima do limite de 4 MiB.");
    }
    const encoded = event.blobs || event.headers["x-nf-blobs-info"];
    if (encoded) {
      const context = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      requests.getStore().blobsOptions = { siteID: event.headers["x-nf-site-id"], token: context.token,
        edgeURL: context.url, uncachedEdgeURL: context.url_uncached,
        ...(typeof event.localBlobsFetch === "function" ? { fetch: event.localBlobsFetch } : {}) };
    }
    const match = routes.map(r => ({ ...r, match: raw.match(r.re) })).find(r => r.method === event.httpMethod && r.match);
    if (!match) return erro(404, "Endpoint não encontrado.");
    const user = await getSessionUser(event), request = requests.getStore();
    request.user = user;
    if (!user && !["setup/status", "setup", "auth/login", "auth/me", "auth/logout"].includes(raw)) return erro(401, "Não autenticado.");
    const params = Object.fromEntries(match.names.map((key, i) => [key, decodeURIComponent(match.match[i + 1])]));
    const response = await match.handler({ event, user, params });
    if (request.etag) response.headers = { ...response.headers, "x-record-version": request.etag };
    return response;
  } catch (error) {
    if (!error.statusCode) console.error("Falha da API:", error.name || "Error");
    return erro(error.statusCode || 500, error.statusCode ? error.message : "Não foi possível concluir a operação. Tente novamente.");
  }
});
