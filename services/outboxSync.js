import { supabase } from "../supabase";
import { syncChecklistSubmission } from "./checklistSync";
import { enqueueOutboxItem, getOutboxItems, removeOutboxItem, updateOutboxItem } from "./outboxQueue";
import { isSyncPaused, requireSyncAllowed, SyncPausedError } from "./maintenanceStatus";

const activeItems = new Map();

export function isTransportError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("failed to send a request to the edge function") ||
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("timed out") ||
    msg.includes("connection")
  );
}

async function requireActiveSession() {
  await requireSyncAllowed();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("No active session found. Please sign in again before submitting or approving forms.");
  }

  return session;
}

export async function syncNearMissSubmission({ payload }) {
  await requireActiveSession();
  const { data, error } = await supabase.functions.invoke("report-near-miss", {
    body: payload,
  });

  if (error || data?.success === false) {
    if (isSyncPaused(error) || isSyncPaused({ message: data?.error })) throw new SyncPausedError("Submission paused because the service is unavailable.");
    throw new Error(error?.message || data?.error || "Could not submit near miss report.");
  }

  return data;
}

export async function syncSelfCertSubmission({ payload }) {
  await requireActiveSession();
  const { data, error } = await supabase.functions.invoke("submit-self-cert", {
    body: payload,
  });

  if (error || data?.success === false) {
    if (isSyncPaused(error) || isSyncPaused({ message: data?.error })) throw new SyncPausedError("Submission paused because the service is unavailable.");
    throw new Error(error?.message || data?.error || "Could not submit self cert form.");
  }

  return data;
}

export async function syncSelfCertApproval({ payload }) {
  await requireActiveSession();
  const { data, error } = await supabase.functions.invoke("approve-self-cert", {
    body: payload,
  });

  if (error || data?.success === false) {
    if (isSyncPaused(error) || isSyncPaused({ message: data?.error })) throw new SyncPausedError("Approval paused because the service is unavailable.");
    throw new Error(error?.message || data?.error || "Could not approve self cert.");
  }

  return data;
}

export async function syncTimesheetApproval({ payload }) {
  await requireActiveSession();
  const { data, error } = await supabase.functions.invoke("approve-timesheet", {
    body: payload,
  });

  if (error || data?.success === false) {
    if (isSyncPaused(error) || isSyncPaused({ message: data?.error })) throw new SyncPausedError("Approval paused because the service is unavailable.");
    throw new Error(error?.message || data?.error || "Could not approve timesheet.");
  }

  return data;
}

async function syncOutboxItem(item) {
  await requireSyncAllowed();
  const type = String(item?.type || "checklist-submit");

  if (type === "checklist-submit") {
    return syncChecklistSubmission({
      ...(item?.data || {}),
      progress: item.progress || {},
      onProgress: (progress) => updateOutboxItem(item.id, (previous) => ({
        ...previous, progress: { ...previous.progress, ...progress },
      })),
    });
  }

  if (type === "near-miss-submit") {
    return syncNearMissSubmission(item?.data || {});
  }

  if (type === "self-cert-submit") {
    return syncSelfCertSubmission(item?.data || {});
  }

  if (type === "self-cert-approve") {
    return syncSelfCertApproval(item?.data || {});
  }

  if (type === "timesheet-approve") {
    return syncTimesheetApproval(item?.data || {});
  }

  throw new Error(`Unsupported outbox item type: ${type}`);
}

export function processOutboxItem(item) {
  if (activeItems.has(item.id)) return activeItems.get(item.id);
  const operation = (async () => {
    try {
      await requireSyncAllowed();
      const current = (await getOutboxItems()).find((entry) => entry.id === item.id);
      if (!current) return { skipped: true };
      await updateOutboxItem(item.id, (previous) => ({ ...previous, status: "syncing" }));
      try {
        const result = await syncOutboxItem(current);
        await removeOutboxItem(item.id);
        return { result };
      } catch (error) {
        const paused = isSyncPaused(error);
        await updateOutboxItem(item.id, (previous) => ({
          ...previous,
          status: paused ? "queued" : "failed",
          retries: Number(previous.retries || 0) + (paused ? 0 : 1),
          lastError: paused ? previous.lastError : String(error?.message || "Sync failed"),
        }));
        throw error;
      }
    } finally {
      activeItems.delete(item.id);
    }
  })();
  activeItems.set(item.id, operation);
  return operation;
}

export async function submitChecklistDurably(data) {
  const item = await enqueueOutboxItem(data);
  try {
    return (await processOutboxItem(item)).result;
  } catch (error) {
    error.outboxSaved = true;
    throw error;
  }
}
