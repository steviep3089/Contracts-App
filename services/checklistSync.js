import { supabase } from "../supabase";

function isEdgeTransportError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("failed to send a request to the edge function") ||
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("timed out")
  );
}

export async function syncChecklistSubmission({ checklistPayload, defectsPayload, formCode = "roller_daily" }) {
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

  let sentDefectCount = 0;
  let photoFallbackUsed = false;
  let routingWarning = "";

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error(sessionError?.message || "No active session token.");
  }

  if (Array.isArray(defectsPayload) && defectsPayload.length > 0) {
    let invokeResult = await supabase.functions.invoke("raise-maintenance-defects", {
      body: { defects: defectsPayload },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const hasAnyPhotos = defectsPayload.some(
      (row) => Array.isArray(row.photos) && row.photos.length > 0
    );

    if (hasAnyPhotos && invokeResult.error && isEdgeTransportError(invokeResult.error)) {
      const payloadNoPhotos = defectsPayload.map((row) => ({
        ...row,
        photos: [],
      }));

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
      throw new Error(invokeResult.error?.message || invokeResult.data?.error || "Defect handoff failed");
    }

    sentDefectCount = Number(invokeResult.data?.createdCount || 0);
  }

  const { data: savedRow, error: saveError } = await supabase
    .from("roller_daily_checks")
    .insert(payload)
    .select()
    .single();

  if (saveError) {
    throw new Error(saveError.message || "Checklist save failed");
  }

  const { data: routingData, error: routingError } = await supabase.functions.invoke(
    "route-daily-checksheet",
    {
      body: {
        source: "app",
        formCode,
        submission: savedRow,
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  );

  if (routingError || routingData?.success === false) {
    routingWarning = routingError?.message || routingData?.error || "Could not route checksheet to destinations.";
  }

  return {
    sentDefectCount,
    photoFallbackUsed,
    routingWarning,
  };
}
