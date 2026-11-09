import { recoverySupabase, supabase } from "../supabase";

let verifiedUserId = null;
let passwordUpdated = false;
let linkRecoveryUserId = null;
let recoveryRequestInProgress = false;

export function setRecoveryRequestInProgress(inProgress) {
  recoveryRequestInProgress = inProgress;
}

export function isRecoveryRequestInProgress() {
  return recoveryRequestInProgress;
}

export function recordLinkRecovery(session) {
  linkRecoveryUserId = session?.user?.id || null;
}

export function isPendingInvitation(user) {
  return !!(user?.invited_at && user.user_metadata?.password_set !== true);
}

export function canUseExistingPasswordSetupSession(user) {
  if (!user?.id) return false;
  if (user.id === linkRecoveryUserId) return true;
  if (isPendingInvitation(user)) return false;
  return (
    user.user_metadata?.force_password_change === true ||
    user.user_metadata?.password_set === false
  );
}

export async function verifyRecoveryCode(email, token) {
  verifiedUserId = null;
  passwordUpdated = false;
  const { error: clearError } = await recoverySupabase.auth.signOut({ scope: "local" });
  if (clearError) throw clearError;
  const { data, error } = await recoverySupabase.auth.verifyOtp({ email, token, type: "recovery" });
  if (error) throw error;
  const user = data?.user;
  if (!user?.id || !user.email || !data?.session?.user?.id ||
      user.id !== data.session.user.id || user.email.toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error("The verified recovery account did not match the requested email.");
  }
  verifiedUserId = user.id;
}

export async function recoverySessionReady() {
  if (!verifiedUserId || passwordUpdated) return false;
  const { data, error } = await recoverySupabase.auth.getSession();
  if (error) throw error;
  return data?.session?.user?.id === verifiedUserId;
}

export async function updateRecoveryPassword(password, clearSavedPassword) {
  if (!passwordUpdated) {
    if (!await recoverySessionReady()) throw new Error("The verified recovery session has expired. Request a new code.");
    const { data, error: userError } = await recoverySupabase.auth.getUser();
    if (userError) throw userError;
    if (data?.user?.id !== verifiedUserId) throw new Error("The recovery account changed. Request a new code.");
    const { error } = await recoverySupabase.auth.updateUser({
      password,
      data: { password_set: true, invited: false, force_password_change: false },
    });
    if (error) throw error;
    passwordUpdated = true;
  }
  await clearSavedPassword();
  const { error: recoveryError } = await recoverySupabase.auth.signOut({ scope: "local" });
  if (recoveryError) throw new Error("Password updated, but recovery sign-out failed. Please retry.");
  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  if (signOutError) throw new Error("Password updated, but sign-out failed. Please retry.");
  verifiedUserId = null;
  passwordUpdated = false;
  linkRecoveryUserId = null;
}
