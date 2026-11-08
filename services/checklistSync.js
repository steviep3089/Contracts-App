import { supabase } from "../supabase";
import { isSyncPaused, requireSyncAllowed, SyncPausedError } from "./maintenanceStatus";

function isEdgeTransportError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("failed to send a request to the edge function") ||
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("timed out")
  );
}

export async function syncChecklistSubmission({ checklistPayload, defectsPayload, formCode = "roller_daily", progress = {}, onProgress }) {
  if (!checklistPayload) {
    throw new Error("Missing checklist payload");
  }

  const payload = { ...checklistPayload };
  if (!payload.created_by) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.id) {
      throw new Error("No active signed-in user for outbox sync. Please sign in and retry.");
    }

    payload.created_by = user.id;
  }

  let sentDefectCount = progress.sentDefectCount || 0;
  let photoFallbackUsed = progress.photoFallbackUsed || false;
  let routingWarning = "";
  const submissionStatus = String(checklistPayload?.status || "submitted").trim().toLowerCase() === "draft"
    ? "draft"
    : "submitted";
  const existingId = String(checklistPayload?.id || "").trim();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error(sessionError?.message || "No active session token.");
  }

  if (!progress.defectsHandedOff && submissionStatus === "submitted" && Array.isArray(defectsPayload) && defectsPayload.length > 0) {
    await requireSyncAllowed();
    let invokeResult = await supabase.functions.invoke("raise-maintenance-defects", {
      body: { defects: defectsPayload },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const hasAnyPhotos = defectsPayload.some(
      (row) => Array.isArray(row.photos) && row.photos.length > 0
    );

    if (hasAnyPhotos && invokeResult.error && !isSyncPaused(invokeResult.error) && isEdgeTransportError(invokeResult.error)) {
      const payloadNoPhotos = defectsPayload.map((row) => ({
        ...row,
        photos: [],
      }));

      await requireSyncAllowed();
      invokeResult = await supabase.functions.invoke("raise-maintenance-defects", {
        body: { defects: payloadNoPhotos },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!invokeResult.error && invokeResult.data?.success) {
        photoFallbackUsed = true;
      }
    }

    if (invokeResult.error || !invokeResult.data?.success) {
      if (isSyncPaused(invokeResult.error) || isSyncPaused({ message: invokeResult.data?.error })) {
        throw new SyncPausedError("Defect submission paused because the service is unavailable.");
      }
      throw new Error(invokeResult.error?.message || invokeResult.data?.error || "Defect handoff failed");
    }

    sentDefectCount = Number(invokeResult.data?.createdCount || 0);
    if (onProgress) await onProgress({ defectsHandedOff: true, sentDefectCount, photoFallbackUsed });
  }

  payload.status = submissionStatus;
  payload.submitted_at = submissionStatus === "submitted" ? new Date().toISOString() : null;

  let saveQuery = supabase
    .from("roller_daily_checks");

  delete payload.id;

  let saveResult;
  if (progress.savedRow) {
    saveResult = { data: progress.savedRow, error: null };
  } else if (existingId) {
    await requireSyncAllowed();
    saveResult = await saveQuery
      .update(payload)
      .eq("id", existingId)
      .select()
      .single();
  } else {
    await requireSyncAllowed();
    saveResult = await saveQuery
      .insert(payload)
      .select()
      .single();
  }

  const { data: savedRow, error: saveError } = saveResult;

  if (saveError) {
    if (isSyncPaused(saveResult) || isSyncPaused(saveError)) throw new SyncPausedError("Checklist save paused because the service is unavailable.");
    throw new Error(saveError.message || "Checklist save failed");
  }
  if (!progress.savedRow && onProgress) await onProgress({ savedRow });

  let routingData = null;
  let routingError = null;
  if (submissionStatus === "submitted") {
    await requireSyncAllowed();
    const routingResult = await supabase.functions.invoke("route-daily-checksheet", {
      body: {
        source: "app",
        formCode,
        submission: savedRow,
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    routingData = routingResult.data;
    routingError = routingResult.error;
  }

  if (isSyncPaused(routingError) || isSyncPaused({ message: routingData?.error })) {
    throw new SyncPausedError("Checklist routing paused because the service is unavailable.");
  }
  if (routingError || routingData?.success === false) {
    routingWarning = routingError?.message || routingData?.error || "Could not route checksheet to destinations.";
  }

  return {
    savedRow,
    submissionStatus,
    sentDefectCount,
    photoFallbackUsed,
    routingWarning,
  };
}
