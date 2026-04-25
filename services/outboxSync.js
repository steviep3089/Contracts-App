import { supabase } from "../supabase";
import { syncChecklistSubmission } from "./checklistSync";

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

export async function syncNearMissSubmission({ payload }) {
  const { data, error } = await supabase.functions.invoke("report-near-miss", {
    body: payload,
  });

  if (error || data?.success === false) {
    throw new Error(error?.message || data?.error || "Could not submit near miss report.");
  }

  return data;
}

export async function syncSelfCertSubmission({ payload }) {
  const { data, error } = await supabase.functions.invoke("submit-self-cert", {
    body: payload,
  });

  if (error || data?.success === false) {
    throw new Error(error?.message || data?.error || "Could not submit self cert form.");
  }

  return data;
}

export async function syncSelfCertApproval({ payload }) {
  const { data, error } = await supabase.functions.invoke("approve-self-cert", {
    body: payload,
  });

  if (error || data?.success === false) {
    throw new Error(error?.message || data?.error || "Could not approve self cert.");
  }

  return data;
}

export async function syncOutboxItem(item) {
  const type = String(item?.type || "checklist-submit");

  if (type === "checklist-submit") {
    return syncChecklistSubmission(item?.data || {});
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

  throw new Error(`Unsupported outbox item type: ${type}`);
}
