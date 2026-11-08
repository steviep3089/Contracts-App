import { supabase } from "../supabase";

export const MAINTENANCE_POLL_MS = 30000;
const TIMEOUT_MS = 8000;
const initialState = { userId: null, status: null, error: null, checked: false };
let state = initialState;
let generation = 0;
let request = null;
const listeners = new Set();

function publish(next) {
  state = next;
  listeners.forEach((listener) => listener(state));
}

export function getMaintenanceState() {
  return state;
}

export function subscribeMaintenance(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setMaintenanceIdentity(userId) {
  if (state.userId === userId && state.checked) return;
  generation += 1;
  request = null;
  const status = state.status ? { ...state.status, is_super_user: false } : null;
  publish({ userId, status, error: null, checked: false });
}

export async function fetchMaintenanceStatus(client = supabase, timeoutMs = TIMEOUT_MS) {
  let timer;
  try {
    const result = await Promise.race([
      client.rpc("get_contracts_maintenance_status", { p_scope: "app" }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ error: new Error("Status request timed out.") }), timeoutMs);
      }),
    ]);
    if (result.error) return { ok: false, error: "Unable to check maintenance status." };
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row.enabled !== "boolean" || typeof row.is_super_user !== "boolean") {
      return { ok: false, error: "Invalid maintenance status response." };
    }
    return { ok: true, status: row };
  } catch {
    return { ok: false, error: "Unable to connect to check maintenance status." };
  } finally {
    clearTimeout(timer);
  }
}

export function refreshMaintenanceStatus() {
  if (request) return request;
  const currentGeneration = generation;
  const promise = fetchMaintenanceStatus().then((result) => {
    if (generation === currentGeneration) {
      publish({
        ...state,
        status: result.ok ? result.status : state.status,
        error: result.ok ? null : result.error,
        checked: true,
      });
    }
    return generation === currentGeneration ? result : { ok: false, error: "Session changed." };
  }).finally(() => {
    if (request === promise) request = null;
  });
  request = promise;
  return promise;
}

export function maintenanceBlocks(stateValue = state) {
  return stateValue.status?.enabled === true && stateValue.status?.is_super_user !== true;
}

export function shouldShowMaintenanceOverlay(stateValue, routeName, loginRequested) {
  return maintenanceBlocks(stateValue) &&
    routeName !== "ResetPassword" && !(!stateValue.userId && loginRequested);
}

export class SyncPausedError extends Error {
  constructor(message = "Sync paused until maintenance status is available.") {
    super(message);
    this.name = "SyncPausedError";
  }
}

export async function requireSyncAllowed() {
  const result = await refreshMaintenanceStatus();
  if (!result.ok) throw new SyncPausedError(result.error);
  if (result.status.enabled) {
    throw new SyncPausedError("Sync paused during maintenance.");
  }
}

export function isSyncPaused(error) {
  const status = error?.context?.status ?? error?.status ?? error?.statusCode;
  const message = String(error?.message || "").toLowerCase();
  return error instanceof SyncPausedError || status === 503 ||
    message.includes("service unavailable") || message.includes("maintenance");
}
