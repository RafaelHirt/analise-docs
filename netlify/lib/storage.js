"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const requests = new AsyncLocalStorage();
const HISTORY = new Set(["contratos", "aditivos", "processos", "fluxos", "contatos", "tarefas", "condicionantes", "informativos", "analises"]);
const conflict = () => Object.assign(new Error("Este registro mudou durante a edição. Recarregue os dados e confira suas alterações antes de tentar novamente."), { statusCode: 409 });

// ETags are enforced by Blobs, including across separate function instances.
// Deleted records become conditional tombstones so deletion cannot erase a newer write.
function store(name) {
  const raw = getStore({ ...requests.getStore()?.blobsOptions, name, consistency: "strong" });
  const state = () => requests.getStore();
  const identity = (key) => `${name}/${key}`;
  async function read(key, options = {}) {
    const result = await raw.getWithMetadata(String(key), options);
    // Route handlers edit returned objects in place. Preserve an independent
    // snapshot so recovery contains the previous value, not the edited object.
    const record = { etag: result?.etag, data: structuredClone(result?.data) };
    state()?.reads.set(identity(key), record);
    if (state()?.primary === identity(key)) {
      state().etag = record.etag;
      if (!state().versionChecked && state().expected && state().expected !== record.etag) throw conflict();
      state().versionChecked = true;
    }
    return result?.data?.__gemodDeleted ? null : result?.data ?? null;
  }
  async function write(key, data, options = {}, binary = false) {
    const id = identity(key);
    let previous = state()?.reads.get(id);
    if (!previous) {
      await read(key, { type: binary ? "arrayBuffer" : "json" });
      previous = state()?.reads.get(id);
    }
    if (!previous) throw new Error("Gravação fora do contexto da requisição.");
    if (previous.data && HISTORY.has(name)) {
      await getStore({ ...state().blobsOptions, name: "history", consistency: "strong" }).setJSON(`${name}/${key}/${randomUUID()}`, {
        store: name, key: String(key), savedAt: new Date().toISOString(),
        actorId: state().user?.id ?? null, actorName: state().user?.nome || "",
        data: previous.data,
      }, { onlyIfNew: true });
    }
    const conditions = options.onlyIfNew || state().allocated.has(String(key))
      ? { onlyIfNew: true }
      : previous.etag ? { onlyIfMatch: previous.etag } : { onlyIfNew: true };
    const result = await raw[binary ? "set" : "setJSON"](String(key), data, { ...options, ...conditions });
    if (!result.modified) throw conflict();
    state().lists?.delete(name);
    state().reads.set(id, { etag: result.etag, data: structuredClone(data) });
    if (state().primary === id) state().etag = result.etag;
    return result;
  }
  return {
    name,
    get: read,
    getWithMetadata: (...args) => raw.getWithMetadata(...args),
    getMetadata: (...args) => raw.getMetadata(...args),
    list: (options) => raw.list(options),
    setJSON: (key, data, options) => write(key, data, options),
    set: (key, data, options) => write(key, data, options, true),
    delete: async (key) => {
      if (!HISTORY.has(name)) return raw.delete(String(key));
      return write(key, { __gemodDeleted: true, deletedAt: new Date().toISOString() });
    },
  };
}

module.exports = { store, requests };
