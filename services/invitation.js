import { invitationSupabase } from "../supabase";

let invitedUserId = null;
let passwordUpdated = false;
let linksInProgress = 0;

export function isInvitationInProgress() {
  return linksInProgress > 0 || !!invitedUserId || passwordUpdated;
}

function readParameters(url) {
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  const parts = [];
  if (queryIndex !== -1 && (hashIndex === -1 || queryIndex < hashIndex)) {
    parts.push(url.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex));
  }
  if (hashIndex !== -1) parts.push(url.slice(hashIndex + 1));
  const params = Object.create(null);
  for (const part of parts) {
    for (const pair of part.split("&")) {
      if (!pair) continue;
      const equals = pair.indexOf("=");
      const key = decodeURIComponent((equals === -1 ? pair : pair.slice(0, equals)).replace(/\+/g, " "));
      const value = decodeURIComponent((equals === -1 ? "" : pair.slice(equals + 1)).replace(/\+/g, " "));
      if (Object.prototype.hasOwnProperty.call(params, key)) throw new Error("Duplicate link parameter");
      params[key] = value;
    }
  }
  return params;
}

export function isInvitationLink(url) {
  if (typeof url !== "string" || !/^contractsapp:\/\//i.test(url)) return false;
  try {
    const params = readParameters(url);
    return params.type === "invite" || !!params.error || !!params.error_code;
  } catch {
    return /(?:[?&#])(?:type|access_token|refresh_token|error|error_code)=/i.test(url);
  }
}

async function clearInvitationSession() {
  const { error } = await invitationSupabase.auth.signOut({ scope: "local" });
  if (error) throw error;
}

export async function acceptInvitationLink(url) {
  invitedUserId = null;
  passwordUpdated = false;
  await clearInvitationSession();
  if (!isInvitationLink(url)) throw new Error("Invalid invitation link");
  const params = readParameters(url);
  if (params.error || params.error_code || params.type !== "invite" ||
      !params.access_token || !params.refresh_token) {
    throw new Error("Invalid invitation link");
  }

  const { data, error } = await invitationSupabase.auth.setSession({
    access_token: params.access_token,
    refresh_token: params.refresh_token,
  });
  if (error || !data?.user?.id || data.session?.user?.id !== data.user.id) {
    throw new Error("Invalid invitation session");
  }
  const { data: refreshed, error: refreshError } = await invitationSupabase.auth.refreshSession();
  if (refreshError || refreshed?.user?.id !== data.user.id ||
      refreshed.session?.user?.id !== data.user.id) {
    await clearInvitationSession();
    throw new Error("Invalid invitation session");
  }
  const { data: verified, error: userError } = await invitationSupabase.auth.getUser();
  const user = verified?.user;
  if (userError || user?.id !== data.user.id || !user.invited_at ||
      user.user_metadata?.password_set === true) {
    await clearInvitationSession();
    throw new Error("Invitation is not pending");
  }
  invitedUserId = user.id;
}

export async function invitationSessionReady() {
  if (!invitedUserId || passwordUpdated) return false;
  try {
    const { data, error } = await invitationSupabase.auth.getSession();
    if (error) throw error;
    if (data?.session?.user?.id === invitedUserId) return true;
    invitedUserId = null;
    return false;
  } catch (error) {
    invitedUserId = null;
    throw error;
  }
}

export async function updateInvitationPassword(password) {
  if (!passwordUpdated) {
    if (!await invitationSessionReady()) throw new Error("Invitation session expired. Request a new link.");
    const { data, error } = await invitationSupabase.auth.getUser();
    if (error) throw error;
    if (data?.user?.id !== invitedUserId || !data.user.invited_at ||
        data.user.user_metadata?.password_set === true) {
      invitedUserId = null;
      throw new Error("Invitation session changed. Request a new link.");
    }
    const { error: updateError } = await invitationSupabase.auth.updateUser({
      password,
      data: { password_set: true, invited: false, force_password_change: false },
    });
    if (updateError) throw updateError;
    passwordUpdated = true;
  }
  try {
    await clearInvitationSession();
  } catch {
    throw new Error("Password updated, but sign-out failed. Please retry.");
  }
  invitedUserId = null;
  passwordUpdated = false;
}

export function createInvitationLinking({ linking, navigationRef, alert }) {
  let ready = false;
  let active = true;
  let pending = null;
  let sequence = Promise.resolve();
  const queuedUrls = new Set();

  function showPending() {
    if (!active || !ready || !pending) return;
    const result = pending;
    pending = null;
    if (result === "success") {
      navigationRef.current?.resetRoot({
        index: 0,
        routes: [{ name: "ResetPassword", params: { fromInvitation: true } }],
      });
    } else {
      alert("Link unavailable", "This invitation or recovery link is invalid, expired or already used. Please request a new link.");
    }
  }

  function handle(url) {
    if (!isInvitationLink(url)) return false;
    if (queuedUrls.has(url)) return true;
    queuedUrls.add(url);
    linksInProgress += 1;
    sequence = sequence.then(async () => {
      try {
        await acceptInvitationLink(url);
        pending = "success";
      } catch {
        pending = "error";
      } finally {
        queuedUrls.delete(url);
        linksInProgress -= 1;
      }
      showPending();
    });
    return true;
  }

  return {
    async getInitialURL() {
      const url = await linking.getInitialURL();
      return handle(url) ? null : url;
    },
    subscribe(listener) {
      active = true;
      const subscription = linking.addEventListener("url", ({ url }) => {
        if (!handle(url)) listener(url);
      });
      return () => {
        active = false;
        subscription.remove();
      };
    },
    onReady() {
      ready = true;
      showPending();
    },
  };
}
