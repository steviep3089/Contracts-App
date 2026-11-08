const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const babel = require("@babel/core");

const root = path.resolve(__dirname, "..");
const storage = new Map();
const memoryStorage = {
  async getItem(key) { return storage.get(key) ?? null; },
  async setItem(key, value) { storage.set(key, value); },
};
let status = { enabled: false, is_super_user: false };
let statusError = null;
let defects = 0;
let saves = 0;
let routes = 0;
let saveError = null;
let saveStatus = null;
let routeError = null;
let handoffError = null;
const mockSupabase = {
  rpc: async (name, args) => {
    assert.equal(name, "get_contracts_maintenance_status");
    assert.deepEqual(args, { p_scope: "app" });
    return statusError ? { error: statusError } : { data: [status], error: null };
  },
  auth: {
    getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    getSession: async () => ({ data: { session: { access_token: "mock" } }, error: null }),
  },
  functions: {
    invoke: async (name) => {
      if (name === "raise-maintenance-defects") {
        defects++;
        return handoffError ? { error: handoffError } : { data: { success: true, createdCount: 1 } };
      }
      if (name === "route-daily-checksheet") {
        routes++;
        return routeError ? { error: routeError } : { data: { success: true } };
      }
      if (["report-near-miss", "submit-self-cert", "approve-self-cert", "approve-timesheet"].includes(name)) {
        return { error: { message: "HTTP error", context: { status: 503 } } };
      }
      throw new Error(`Unexpected function ${name}`);
    },
  },
  from: () => ({
    insert: () => { saves++; return { select: () => ({ single: async () => saveError ? { error: saveError, status: saveStatus } : { data: { id: "saved" } } }) }; },
    update: () => { saves++; return { eq: () => ({ select: () => ({ single: async () => saveError ? { error: saveError, status: saveStatus } : { data: { id: "saved" } } }) }) }; },
  }),
};

const originalLoad = Module._load;
const originalJs = Module._extensions[".js"];
Module._load = function(request, parent, isMain) {
  if (request === "@react-native-async-storage/async-storage") return memoryStorage;
  if ((request === "../supabase" || request === "./supabase") && parent?.filename.startsWith(root)) return { supabase: mockSupabase };
  return originalLoad.call(this, request, parent, isMain);
};
Module._extensions[".js"] = function(module, filename) {
  if (filename.startsWith(path.join(root, "services") + path.sep)) {
    const source = fs.readFileSync(filename, "utf8");
    const transformed = babel.transformSync(source, {
      filename, babelrc: false, configFile: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
    });
    module._compile(transformed.code, filename);
  } else originalJs(module, filename);
};

const maintenance = require("../services/maintenanceStatus");
const queue = require("../services/outboxQueue");
const sync = require("../services/outboxSync");
const checklist = require("../services/checklistSync");
const input = () => ({
  checklistPayload: { created_by: "u1", status: "submitted" },
  defectsPayload: [{ photos: [] }],
});

test.beforeEach(() => {
  storage.clear();
  status = { enabled: false, is_super_user: false };
  statusError = null;
  defects = saves = routes = 0;
  saveError = routeError = handoffError = null;
  saveStatus = null;
  maintenance.setMaintenanceIdentity("u1");
});

test("status checks scope, super user bypass, failures and identity clearing", async () => {
  await maintenance.refreshMaintenanceStatus();
  assert.equal(maintenance.maintenanceBlocks(), false);
  status = { enabled: true, is_super_user: false };
  await maintenance.refreshMaintenanceStatus();
  assert.equal(maintenance.maintenanceBlocks(), true);
  await assert.rejects(maintenance.requireSyncAllowed(), maintenance.SyncPausedError);
  status = { enabled: true, is_super_user: true };
  await assert.rejects(maintenance.requireSyncAllowed(), maintenance.SyncPausedError);
  assert.equal(maintenance.maintenanceBlocks(), false);
  statusError = new Error("offline");
  await assert.rejects(maintenance.requireSyncAllowed(), maintenance.SyncPausedError);
  assert.equal(maintenance.getMaintenanceState().status.is_super_user, true);
  maintenance.setMaintenanceIdentity("other");
  assert.equal(maintenance.getMaintenanceState().status.enabled, true);
  assert.equal(maintenance.getMaintenanceState().status.is_super_user, false);
  assert.equal(maintenance.maintenanceBlocks(), true);
});

test("all outbox attempts pause without changing queued item or retry count", async () => {
  const item = await queue.enqueueOutboxItem(input());
  status = { enabled: true, is_super_user: false };
  await assert.rejects(sync.processOutboxItem(item), maintenance.SyncPausedError);
  const [stored] = await queue.getOutboxItems();
  assert.equal(stored.status, "queued");
  assert.equal(stored.retries, 0);
  assert.equal(defects, 0);
  statusError = new Error("offline");
  await assert.rejects(sync.processOutboxItem(item), maintenance.SyncPausedError);
  assert.equal((await queue.getOutboxItems())[0].retries, 0);
});

test("overlay allows recovery and signed-out Super User login without granting a signed-in bypass", () => {
  const state = { userId: "u1", status: { enabled: true, effective_scope: "master", is_super_user: false } };
  assert.equal(maintenance.shouldShowMaintenanceOverlay(state, "Home", false), true);
  assert.equal(maintenance.shouldShowMaintenanceOverlay(state, "ResetPassword", false), false);
  assert.equal(maintenance.shouldShowMaintenanceOverlay(state, "Home", true), true);
  assert.equal(maintenance.shouldShowMaintenanceOverlay({ ...state, userId: null }, "Login", true), false);
  assert.equal(maintenance.shouldShowMaintenanceOverlay({ ...state, status: { enabled: true, is_super_user: true } }, "Home", false), false);
});

test("active maintenance and service 503 pause every non-checklist outbox type", async () => {
  for (const type of ["near-miss-submit", "self-cert-submit", "self-cert-approve", "timesheet-approve"]) {
    const item = await queue.enqueueOutboxItem({ type, data: { payload: {} } });
    status = { enabled: true, is_super_user: false };
    await assert.rejects(sync.processOutboxItem(item), maintenance.SyncPausedError);
    const stored = (await queue.getOutboxItems()).find((entry) => entry.id === item.id);
    assert.equal(stored.retries, 0);
    assert.equal(stored.status, "queued");
    status = { enabled: false, is_super_user: false };
    await assert.rejects(sync.processOutboxItem(stored), maintenance.SyncPausedError);
    const after503 = (await queue.getOutboxItems()).find((entry) => entry.id === item.id);
    assert.equal(after503.retries, 0);
    assert.equal(after503.status, "queued");
  }
});

test("durable handoff marker prevents another defect submission after checklist save fails", async () => {
  saveError = { message: "save rejected" };
  await assert.rejects(sync.submitChecklistDurably(input()), (error) => error.outboxSaved === true);
  let [item] = await queue.getOutboxItems();
  assert.equal(item.progress.defectsHandedOff, true);
  assert.equal(item.retries, 1);
  assert.equal(defects, 1);
  saveError = null;
  await sync.processOutboxItem(item);
  assert.equal(defects, 1);
  assert.equal(saves, 2);
  assert.equal((await queue.getOutboxItems()).length, 0);
});

test("503 preserves progress and retries; later retry does not resave the checklist", async () => {
  routeError = { message: "HTTP error", context: { status: 503 } };
  const item = await queue.enqueueOutboxItem(input());
  await assert.rejects(sync.processOutboxItem(item), maintenance.SyncPausedError);
  const [stored] = await queue.getOutboxItems();
  assert.equal(stored.retries, 0);
  assert.equal(stored.status, "queued");
  assert.equal(stored.progress.defectsHandedOff, true);
  assert.equal(stored.progress.savedRow.id, "saved");
  routeError = null;
  await sync.processOutboxItem(stored);
  assert.equal(defects, 1);
  assert.equal(saves, 1);
  assert.equal(routes, 2);
});

test("PostgREST HTTP 503 preserves defect progress and retry count", async () => {
  saveError = { message: "Gateway error" };
  saveStatus = 503;
  const item = await queue.enqueueOutboxItem(input());
  await assert.rejects(sync.processOutboxItem(item), maintenance.SyncPausedError);
  const [stored] = await queue.getOutboxItems();
  assert.equal(stored.status, "queued");
  assert.equal(stored.retries, 0);
  assert.equal(stored.progress.defectsHandedOff, true);
  saveError = null;
  saveStatus = null;
  await sync.processOutboxItem(stored);
  assert.equal(defects, 1);
  assert.equal((await queue.getOutboxItems()).length, 0);
});

test("503 at defect handoff does not mark a permanent failure or retry", async () => {
  handoffError = { message: "HTTP error", context: { status: 503 } };
  const item = await queue.enqueueOutboxItem(input());
  await assert.rejects(sync.processOutboxItem(item), maintenance.SyncPausedError);
  assert.equal((await queue.getOutboxItems())[0].retries, 0);
  assert.equal(saves, 0);
});

test("concurrent retries of the same item do not send twice", async () => {
  const item = await queue.enqueueOutboxItem(input());
  const results = await Promise.all([sync.processOutboxItem(item), sync.processOutboxItem(item)]);
  assert.equal(results[0].result.savedRow.id, "saved");
  assert.equal(results[1].result.savedRow.id, "saved");
  assert.equal(defects, 1);
});

test("draft submissions also check status before writing", async () => {
  status = { enabled: true, is_super_user: false };
  await assert.rejects(checklist.syncChecklistSubmission({
    checklistPayload: { created_by: "u1", status: "draft" }, defectsPayload: [],
  }), maintenance.SyncPausedError);
  assert.equal(saves, 0);
});
