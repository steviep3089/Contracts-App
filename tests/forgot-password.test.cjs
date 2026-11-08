const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require("@babel/core");

const root = path.resolve(__dirname, "..");
function load(file, mocks, globals = {}) {
  const filename = path.join(root, file);
  const code = babel.transformSync(fs.readFileSync(filename, "utf8"), {
    filename, babelrc: false, configFile: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, console, setTimeout, clearTimeout, ...globals,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  return module.exports;
}

function setup() {
  let session = null;
  let user = { id: "verified", email: "user@example.com" };
  let verifyError = null;
  let signOutError = null;
  const calls = [];
  const recoverySupabase = { auth: {
    signOut: async (options) => { calls.push(["recovery-signout", options.scope]); session = null; return { error: null }; },
    verifyOtp: async (args) => {
      calls.push(["verify", args.email, args.token, args.type]);
      if (verifyError) return { error: verifyError };
      session = { user };
      return { data: { user, session }, error: null };
    },
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    updateUser: async (args) => { calls.push(["update", user.id, args.password]); return { error: null }; },
  } };
  const supabase = { auth: {
    signOut: async (options) => { calls.push(["main-signout", options.scope]); return { error: signOutError }; },
  } };
  const recovery = load("services/passwordRecovery.js", { "../supabase": { recoverySupabase, supabase } });
  return {
    recovery, calls,
    setUser: (next) => { user = next; },
    setVerifyError: (next) => { verifyError = next; },
    setSignOutError: (next) => { signOutError = next; },
  };
}

function screen(file, mocks, props) {
  const states = [];
  let index = 0;
  let effects = [];
  let cleanups = [];
  const alerts = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState(initial) {
      const i = index++;
      if (!(i in states)) states[i] = initial;
      return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }];
    },
    useRef(initial) {
      const i = index++;
      if (!(i in states)) states[i] = { current: initial };
      return states[i];
    },
    useEffect(effect) { effects.push(effect); },
  };
  const native = {
    ActivityIndicator: "ActivityIndicator", View: "View", Text: "Text", TextInput: "TextInput", Image: "Image",
    TouchableOpacity: "TouchableOpacity", ScrollView: "ScrollView", KeyboardAvoidingView: "KeyboardAvoidingView",
    Animated: { View: "Animated.View", Value: function() {}, timing: () => ({ start() {} }) },
    Platform: { OS: "android" }, StyleSheet: { create: (x) => x },
    Alert: { alert: (...args) => alerts.push(args) },
  };
  const intervals = [];
  const Component = load(file, {
    react, "react-native": native, "@react-navigation/elements": { useHeaderHeight: () => 88 }, ...mocks,
  }, {
    setInterval: (fn) => { intervals.push(fn); return intervals.length; }, clearInterval() {},
  }).default;
  return {
    alerts, intervals,
    render(runEffects = false) {
      index = 0; effects = [];
      const result = Component(props);
      if (runEffects) cleanups = effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === "function");
      return result;
    },
    unmount() { cleanups.forEach((cleanup) => cleanup()); },
  };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
function button(tree, label) {
  return find(tree, (n) => n.type === "TouchableOpacity" &&
    find(n, (child) => child.type === "Text" && child.children.includes(label)));
}

test("8-digit code verifies recovery account and reset signs out locally", async () => {
  const s = setup();
  await s.recovery.verifyRecoveryCode("user@example.com", "01234567");
  assert.equal(await s.recovery.recoverySessionReady(), true);
  await s.recovery.updateRecoveryPassword("newpassword", async () => {});
  assert.deepEqual(s.calls, [
    ["recovery-signout", "local"], ["verify", "user@example.com", "01234567", "recovery"],
    ["update", "verified", "newpassword"], ["recovery-signout", "local"], ["main-signout", "local"],
  ]);
  assert.equal(await s.recovery.recoverySessionReady(), false);
});

test("ordinary sessions, wrong email and changed account cannot authorize recovery updates", async () => {
  const s = setup();
  await assert.rejects(s.recovery.updateRecoveryPassword("newpassword", async () => {}), /expired/);
  await assert.rejects(s.recovery.verifyRecoveryCode("other@example.com", "01234567"), /did not match/);
  await assert.rejects(s.recovery.updateRecoveryPassword("newpassword", async () => {}), /expired/);
  await s.recovery.verifyRecoveryCode("user@example.com", "01234567");
  s.setUser({ id: "wrong", email: "user@example.com" });
  await assert.rejects(s.recovery.updateRecoveryPassword("newpassword", async () => {}), /account changed/);
  assert.equal(s.calls.filter((x) => x[0] === "update").length, 0);
  assert.equal(s.recovery.canUseExistingPasswordSetupSession({ id: "ordinary" }), false);
  assert.equal(Boolean(s.recovery.canUseExistingPasswordSetupSession({ id: "invite", invited_at: "now", user_metadata: {} })), true);
  s.recovery.recordLinkRecovery({ user: { id: "link" } });
  assert.equal(s.recovery.canUseExistingPasswordSetupSession({ id: "link" }), true);
  assert.equal(s.recovery.canUseExistingPasswordSetupSession({ id: "other" }), false);
});

test("sign-out failure is surfaced and retry does not update password twice", async () => {
  const s = setup();
  await s.recovery.verifyRecoveryCode("user@example.com", "01234567");
  s.setSignOutError(new Error("offline"));
  await assert.rejects(s.recovery.updateRecoveryPassword("newpassword", async () => {}), /sign-out failed/);
  s.setSignOutError(null);
  await s.recovery.updateRecoveryPassword("newpassword", async () => {});
  assert.equal(s.calls.filter((x) => x[0] === "update").length, 1);
});

test("code screen displays expired and rate-limit errors and resends with cooldown", async () => {
  const s = setup();
  let resends = 0;
  const navigation = { replace: (...args) => s.calls.push(["navigate", ...args]) };
  const ui = screen("screens/VerifyOtpScreen.js", {
    "../supabase": { supabase: { auth: { resetPasswordForEmail: async () => { resends++; return { error: null }; } } } },
    "../services/passwordRecovery": s.recovery,
  }, { navigation, route: { params: { email: "user@example.com" } } });
  let tree = ui.render();
  const input = find(tree, (n) => n.type === "TextInput");
  assert.equal(input.props.maxLength, undefined);
  input.props.onChangeText("01234567");
  s.setVerifyError({ message: "Invalid or expired code" });
  await button(ui.render(), "Verify Code").props.onPress();
  assert.match(ui.alerts[0][1], /expired/);
  s.setVerifyError({ status: 429, message: "rate limited" });
  await button(ui.render(), "Verify Code").props.onPress();
  assert.match(ui.alerts[1][1], /wait/i);
  s.setVerifyError(null);
  await button(ui.render(), "Verify Code").props.onPress();
  assert.equal(s.calls.at(-1)[1], "ResetPassword");
  assert.equal(s.calls.at(-1)[2].fromRecoveryCode, true);
  await button(ui.render(), "Resend Code").props.onPress();
  tree = ui.render(true);
  assert.equal(resends, 1);
  assert.equal(button(tree, "Resend code in 60s").props.disabled, true);
  assert.equal(ui.intervals.length, 1);
});

test("forgot password requests trimmed email and opens verification without closing the app", async () => {
  const calls = [];
  const ui = screen("screens/LoginScreen.js", {
    "../supabase": { supabase: { auth: {
      resetPasswordForEmail: async (email, options) => { calls.push([email, options.redirectTo]); return { error: null }; },
    } } },
    "@react-native-async-storage/async-storage": {},
    "../services/passwordRecovery": setup().recovery,
    "../assets/contracting-app.png": 1,
  }, { navigation: { navigate: (...args) => calls.push(args), isFocused: () => true } });
  find(ui.render(), (n) => n.props.placeholder === "Email").props.onChangeText(" user@example.com ");
  await button(ui.render(), "Forgot password?").props.onPress();
  assert.equal(calls[0][0], "user@example.com");
  assert.equal(calls[0][1], "contractsapp://");
  assert.equal(calls[1][0], "VerifyOtp");
  assert.equal(calls[1][1].email, "user@example.com");
});

test("recovery request does not authenticate, and old password does not imply code verification", async () => {
  const s = setup();
  const calls = [];
  let releaseRequest;
  const requested = new Promise((resolve) => { releaseRequest = resolve; });
  const user = { id: "ordinary", recovery_sent_at: "now", user_metadata: { password_set: true } };
  const auth = {
    resetPasswordForEmail: () => { calls.push("request"); return requested; },
    signInWithPassword: async () => { calls.push("sign-in"); return { error: null }; },
    getUser: async () => ({ data: { user } }),
  };
  const ui = screen("screens/LoginScreen.js", {
    "../supabase": { supabase: { auth } },
    "../services/passwordRecovery": s.recovery,
    "@react-native-async-storage/async-storage": { removeItem: async () => {} },
    "../assets/contracting-app.png": 1,
  }, { navigation: {
    navigate: (name) => calls.push(name), replace: (name) => calls.push(name), isFocused: () => true,
  } });
  find(ui.render(), (n) => n.props.placeholder === "Email").props.onChangeText("user@example.com");
  const pending = button(ui.render(), "Forgot password?").props.onPress();
  assert.equal(s.recovery.isRecoveryRequestInProgress(), true);
  assert.equal(button(ui.render(), "Sign In").props.disabled, true);
  await button(ui.render(), "Forgot password?").props.onPress();
  await button(ui.render(), "Sign In").props.onPress();
  assert.deepEqual(calls, ["request"]);
  releaseRequest({ error: null });
  await pending;
  assert.equal(s.recovery.isRecoveryRequestInProgress(), false);
  assert.deepEqual(calls, ["request", "VerifyOtp"]);
  await button(ui.render(), "Sign In").props.onPress();
  assert.deepEqual(calls, ["request", "VerifyOtp", "sign-in", "Home"]);
  assert.equal(Boolean(s.recovery.canUseExistingPasswordSetupSession(user)), false);
});

test("failed recovery request releases the navigation guard and reports the error", async () => {
  const s = setup();
  const calls = [];
  const ui = screen("screens/LoginScreen.js", {
    "../supabase": { supabase: { auth: {
      resetPasswordForEmail: async () => ({ error: { status: 429, message: "rate limited" } }),
    } } },
    "../services/passwordRecovery": s.recovery,
    "@react-native-async-storage/async-storage": {},
    "../assets/contracting-app.png": 1,
  }, { navigation: { isFocused: () => true, navigate: (name) => calls.push(name) } });
  find(ui.render(), (n) => n.props.placeholder === "Email").props.onChangeText("user@example.com");
  await button(ui.render(), "Forgot password?").props.onPress();
  assert.equal(s.recovery.isRecoveryRequestInProgress(), false);
  assert.equal(button(ui.render(), "Sign In").props.disabled, false);
  assert.match(ui.alerts[0][1], /wait/i);
  assert.deepEqual(calls, []);
});

test("returned and thrown rate-limit errors show a clear message without retry or navigation", async () => {
  for (const [failure, throws] of [
    [{ status: 429, message: "rate limited" }, false],
    [new Error("Too many requests"), true],
    [{ message: "Email rate limit exceeded" }, false],
  ]) {
    let requests = 0;
    const calls = [];
    const ui = screen("screens/LoginScreen.js", {
      "../supabase": { supabase: { auth: {
        resetPasswordForEmail: async () => {
          requests++;
          if (throws) throw failure;
          return { error: failure };
        },
      } } },
      "../services/passwordRecovery": setup().recovery,
      "@react-native-async-storage/async-storage": {},
      "../assets/contracting-app.png": 1,
    }, { navigation: { isFocused: () => true, navigate: (name) => calls.push(name) } });
    find(ui.render(), (n) => n.props.placeholder === "Email").props.onChangeText("user@example.com");
    await button(ui.render(), "Forgot password?").props.onPress();
    assert.equal(requests, 1);
    assert.match(ui.alerts[0][1], /too many requests.*wait/i);
    assert.deepEqual(calls, []);
  }
});

test("delayed login listener does not replace the verification screen and is unsubscribed", async () => {
  const s = setup();
  let listener, releaseUser;
  let focused = true;
  let unsubscribed = false;
  const calls = [];
  const userResult = new Promise((resolve) => { releaseUser = resolve; });
  const ui = screen("screens/LoginScreen.js", {
    "../supabase": { supabase: { auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: () => userResult,
      onAuthStateChange: (callback) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
      },
    } }, isRefreshTokenError: () => false },
    "../services/passwordRecovery": s.recovery,
    "@react-native-async-storage/async-storage": { getItem: async () => null, removeItem: async () => {} },
    "../assets/contracting-app.png": 1,
  }, { navigation: { isFocused: () => focused, replace: (name) => calls.push(name) } });
  ui.render(true);
  listener("SIGNED_IN", { user: { id: "invite", invited_at: "now", user_metadata: {} } });
  focused = false;
  releaseUser({ data: { user: { id: "invite", invited_at: "now", user_metadata: {} } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
  ui.unmount();
  assert.equal(unsubscribed, true);
});

test("root listener preserves code entry while still handling invites and real recovery links", async () => {
  const s = setup();
  const timers = [];
  const calls = [];
  let currentRoute = "Login";
  let listener;
  const navigation = {
    isReady: () => true, getCurrentRoute: () => ({ name: currentRoute }),
    navigate: (name) => calls.push(name),
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: () => ({ current: navigation }),
    useState: () => [null, () => {}],
    useEffect: (effect) => effect(),
  };
  const dummy = () => null;
  const mocks = {
    react,
    "@react-navigation/native": { NavigationContainer: dummy },
    "@react-navigation/native-stack": { createNativeStackNavigator: () => ({ Navigator: dummy, Screen: dummy }) },
    "react-native-safe-area-context": { SafeAreaProvider: dummy },
    "expo-linking": { getInitialURL: async () => null },
    "./supabase": { supabase: { auth: {
      onAuthStateChange: (callback) => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      getUser: async () => ({ data: { user: { id: "invite", invited_at: "now", user_metadata: {} } } }),
    } } },
    "./services/passwordRecovery": s.recovery,
    "./MaintenanceGate": dummy,
  };
  for (const name of ["SplashScreen", "LoginScreen", "VerifyOtpScreen", "ResetPasswordScreen", "HomeScreen",
    "ContractFormsScreen", "FillFormScreen", "OutboxScreen", "SelfCertApprovalsScreen", "MyDocumentsScreen",
    "TimesheetScreen", "TimesheetApprovalsScreen", "ApprovalsScreen"]) mocks[`./screens/${name}`] = dummy;
  load("App.js", mocks, { setTimeout: (callback) => { timers.push(callback); } }).default();
  const session = { user: { id: "invite", invited_at: "now", user_metadata: {} } };
  listener("SIGNED_IN", session);
  await new Promise((resolve) => setImmediate(resolve));
  currentRoute = "VerifyOtp";
  timers.shift()();
  assert.deepEqual(calls, []);
  currentRoute = "Login";
  s.recovery.setRecoveryRequestInProgress(true);
  listener("SIGNED_IN", session);
  await new Promise((resolve) => setImmediate(resolve));
  timers.shift()();
  assert.deepEqual(calls, []);
  s.recovery.setRecoveryRequestInProgress(false);
  listener("SIGNED_IN", session);
  await new Promise((resolve) => setImmediate(resolve));
  timers.shift()();
  assert.deepEqual(calls, ["ResetPassword"]);
  calls.length = 0;
  currentRoute = "VerifyOtp";
  listener("PASSWORD_RECOVERY", session);
  timers.shift()();
  assert.deepEqual(calls, ["ResetPassword"]);
  assert.equal(s.recovery.canUseExistingPasswordSetupSession(session.user), true);
});

test("remember email clears legacy passwords and never stores temporary credentials", async () => {
  for (const remember of [true, false]) {
    const stored = new Map([["savedEmail", "old@example.com"], ["savedPassword", "legacy-secret"]]);
    const writes = [];
    const navigationCalls = [];
    const ui = screen("screens/LoginScreen.js", {
      "../supabase": { supabase: { auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithPassword: async () => ({ error: null }),
        getUser: async () => ({ data: { user: { id: "new-user", user_metadata: { force_password_change: true } } } }),
      } }, isRefreshTokenError: () => false },
      "../services/passwordRecovery": setup().recovery,
      "@react-native-async-storage/async-storage": {
        getItem: async (key) => stored.get(key) || null,
        setItem: async (key, value) => { writes.push(key); stored.set(key, value); },
        removeItem: async (key) => { stored.delete(key); },
      },
      "../assets/contracting-app.png": 1,
    }, { navigation: { isFocused: () => true, replace: (name) => navigationCalls.push(name) } });
    ui.render(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stored.has("savedPassword"), false);
    let tree = ui.render();
    assert.equal(find(tree, (n) => n.props.placeholder === "Email").props.value, "old@example.com");
    assert.equal(find(tree, (n) => n.props.placeholder === "Password").props.value, "");
    find(tree, (n) => n.props.placeholder === "Password").props.onChangeText("temporary-secret");
    if (!remember) button(ui.render(), "Remember email").props.onPress();
    await button(ui.render(), "Sign In").props.onPress();
    assert.deepEqual(navigationCalls, ["ResetPassword"]);
    assert.equal(stored.has("savedPassword"), false);
    assert.equal(stored.has("savedEmail"), remember);
    assert.equal(writes.includes("savedPassword"), false);
    ui.unmount();
  }
});

test("remembered login storage failures are reported", async () => {
  const ui = screen("screens/LoginScreen.js", {
    "../supabase": { supabase: { auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }, isRefreshTokenError: () => false },
    "../services/passwordRecovery": setup().recovery,
    "@react-native-async-storage/async-storage": { removeItem: async () => { throw new Error("storage failure"); } },
    "../assets/contracting-app.png": 1,
  }, { navigation: { isFocused: () => true } });
  ui.render(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ui.alerts[0][1], /could not remove/i);
  ui.unmount();
});

test("password screen validates before completion and returns to login after reset", async () => {
  let updates = 0;
  const resets = [];
  const ui = screen("screens/ResetPasswordScreen.js", {
    "../supabase": { supabase: { auth: {} } },
    "@react-native-async-storage/async-storage": { removeItem: async () => {} },
    "../services/passwordRecovery": {
      recoverySessionReady: async () => true,
      updateRecoveryPassword: async () => { updates++; },
      canUseExistingPasswordSetupSession: () => false,
    },
  }, { navigation: { reset: (value) => resets.push(value) }, route: { params: { fromRecoveryCode: true } } });
  ui.render(true);
  await new Promise((resolve) => setImmediate(resolve));
  let tree = ui.render();
  find(tree, (n) => n.props.placeholder === "New Password").props.onChangeText("short");
  find(tree, (n) => n.props.placeholder === "Confirm Password").props.onChangeText("different");
  await button(ui.render(), "Reset Password").props.onPress();
  assert.match(ui.alerts[0][1], /match/);
  find(ui.render(), (n) => n.props.placeholder === "Confirm Password").props.onChangeText("short");
  await button(ui.render(), "Reset Password").props.onPress();
  assert.match(ui.alerts[1][1], /8 characters/);
  find(ui.render(), (n) => n.props.placeholder === "New Password").props.onChangeText("longpassword");
  find(ui.render(), (n) => n.props.placeholder === "Confirm Password").props.onChangeText("longpassword");
  await button(ui.render(), "Reset Password").props.onPress();
  assert.equal(updates, 1);
  ui.alerts[2][2][0].onPress();
  assert.equal(resets[0].routes[0].name, "Login");
});

test("password form uses a scrollable keyboard-aware layout on Android and iOS", async () => {
  for (const os of ["android", "ios"]) {
    const ui = screen("screens/ResetPasswordScreen.js", {
      "react-native": {
        View: "View", Text: "Text", TextInput: "TextInput", TouchableOpacity: "TouchableOpacity",
        ActivityIndicator: "ActivityIndicator", ScrollView: "ScrollView", KeyboardAvoidingView: "KeyboardAvoidingView",
        Platform: { OS: os }, StyleSheet: { create: (styles) => styles }, Alert: { alert() {} },
      },
      "../supabase": { supabase: { auth: {} } },
      "@react-native-async-storage/async-storage": {},
      "../services/passwordRecovery": { recoverySessionReady: async () => true },
    }, { navigation: {}, route: { params: { fromRecoveryCode: true } } });
    ui.render(true);
    await new Promise((resolve) => setImmediate(resolve));
    const tree = ui.render();
    assert.equal(tree.type, "KeyboardAvoidingView");
    assert.equal(tree.props.behavior, os === "ios" ? "padding" : undefined);
    assert.equal(tree.props.keyboardVerticalOffset, 88);
    const scroll = find(tree, (n) => n.type === "ScrollView");
    assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
    assert.equal(scroll.props.contentContainerStyle.flexGrow, 1);
    assert.equal(scroll.props.contentContainerStyle.justifyContent, "center");
    assert.ok(find(scroll, (n) => n.props.placeholder === "New Password"));
    assert.ok(find(scroll, (n) => n.props.placeholder === "Confirm Password"));
    assert.ok(button(scroll, "Reset Password"));
  }
});

test("existing invited session remains usable but an ordinary session cannot open password setup", async () => {
  const s = setup();
  for (const [user, allowed] of [
    [{ id: "ordinary", user_metadata: {} }, false],
    [{ id: "invite", invited_at: "now", user_metadata: { password_set: false } }, true],
  ]) {
    const ui = screen("screens/ResetPasswordScreen.js", {
      "../supabase": { supabase: { auth: { getSession: async () => ({ data: { session: { user } }, error: null }) } } },
      "@react-native-async-storage/async-storage": { removeItem: async () => {} },
      "../services/passwordRecovery": s.recovery,
    }, { navigation: { replace() {} }, route: { params: {} } });
    ui.render(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(Boolean(find(ui.render(), (n) => n.props.placeholder === "New Password")), allowed);
    assert.equal(ui.alerts.length, allowed ? 0 : 1);
  }
});
