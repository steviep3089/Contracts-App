const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require("@babel/core");

const root = path.resolve(__dirname, "..");
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function createStartup({ userId = null, enabled = true, superUser = false } = {}) {
  const slots = [];
  let slot = 0;
  const effects = [];
  let authListener;
  let session = userId ? { user: { id: userId } } : null;
  let status = { enabled, is_super_user: superUser, message: "Scheduled maintenance" };
  let hideCalls = 0;
  let resetRoutes = [];
  const client = {
    auth: {
      onAuthStateChange(callback) {
        authListener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session }, error: null }),
      signOut: async () => {
        session = null;
        authListener("SIGNED_OUT", null);
        return { error: null };
      },
    },
    rpc: async (name, args) => {
      assert.equal(name, "get_contracts_maintenance_status");
      assert.equal(args.p_scope, "app");
      return { data: [status], error: null };
    },
  };
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat() };
    },
    useState(initial) {
      const index = slot++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      }];
    },
    useEffect(effect) { if (!effects.length) effects.push(effect); },
  };
  const native = {
    View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView",
    AppState: { addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (styles) => styles },
  };
  function load(relative, overrides) {
    const filename = path.join(root, relative);
    const source = fs.readFileSync(filename, "utf8");
    const transformed = babel.transformSync(source, {
      filename, babelrc: false, configFile: false,
      plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"],
    }).code;
    const module = { exports: {} };
    const context = {
      module, exports: module.exports, console, setTimeout, clearTimeout,
      setInterval: () => 1, clearInterval() {},
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        throw new Error(`Unexpected dependency: ${name}`);
      },
    };
    vm.runInNewContext(transformed, context, { filename });
    return module.exports;
  }
  const maintenance = load("services/maintenanceStatus.js", { "../supabase": { supabase: client } });
  const Gate = load("MaintenanceGate.js", {
    react,
    "react-native": native,
    "@react-native-community/netinfo": { addEventListener: () => () => {} },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-splash-screen": { hideAsync: async () => { hideCalls++; } },
    "./supabase": { supabase: client },
    "./services/maintenanceStatus": maintenance,
  }).default;
  const navigationRef = { current: { resetRoot: (routes) => { resetRoutes.push(routes); } } };
  function render(routeName = "Splash") {
    slot = 0;
    return Gate({ children: { type: "Navigator", props: {}, children: [] }, routeName, navigationRef });
  }
  function find(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of node.children || []) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  return {
    render, find, effects, maintenance,
    get hideCalls() { return hideCalls; },
    get resetRoutes() { return resetRoutes; },
    signIn(id, isSuperUser) {
      status = { ...status, is_super_user: isSuperUser };
      session = { user: { id } };
      authListener("SIGNED_IN", session);
    },
  };
}

test("startup in maintenance renders an in-tree overlay, clears splash and permits Super User login", async () => {
  const app = createStartup();
  app.render();
  const cleanup = app.effects[0]();
  await settle();
  const tree = app.render();
  assert.ok(app.find(tree, (node) => node.type === "Navigator"));
  const overlay = app.find(tree, (node) => node.props.accessibilityViewIsModal);
  assert.ok(overlay);
  assert.equal(overlay.props.style.position, "absolute");
  for (const edge of ["top", "bottom", "left", "right"]) assert.equal(overlay.props.style[edge], 0);
  const safeArea = app.find(overlay, (node) => node.type === "SafeAreaView");
  assert.equal(safeArea.props.edges.includes("bottom"), true);
  const scroll = app.find(safeArea, (node) => node.type === "ScrollView");
  assert.equal(scroll.props.contentContainerStyle.flexGrow, 1);
  assert.equal(scroll.props.contentContainerStyle.justifyContent, "center");
  assert.ok(app.find(scroll, (node) => node.type === "Pressable"));
  assert.ok(app.find(overlay, (node) => node.children?.includes("Scheduled maintenance")));
  assert.equal(app.find(tree, (node) => node.type === "Modal"), null);
  overlay.props.onLayout();
  assert.equal(app.hideCalls, 1);
  app.find(overlay, (node) => node.type === "Pressable").props.onPress();
  assert.equal(app.resetRoutes[0].routes[0].name, "Login");
  assert.equal(app.find(app.render("Login"), (node) => node.props.accessibilityViewIsModal), null);
  assert.equal(app.find(app.render("ResetPassword"), (node) => node.props.accessibilityViewIsModal), null);
  app.signIn("super-user", true);
  await settle();
  assert.equal(app.find(app.render("Home"), (node) => node.props.accessibilityViewIsModal), null);
  assert.equal(app.maintenance.getMaintenanceState().status.is_super_user, true);
  cleanup();
});

test("existing normal user sees maintenance, while maintenance OFF preserves normal startup", async () => {
  for (const enabled of [true, false]) {
    const app = createStartup({ userId: "normal-user", enabled });
    app.render();
    const cleanup = app.effects[0]();
    await settle();
    const tree = app.render();
    assert.ok(app.find(tree, (node) => node.type === "Navigator"));
    const overlay = app.find(tree, (node) => node.props.accessibilityViewIsModal);
    assert.equal(Boolean(overlay), enabled);
    if (overlay) {
      overlay.props.onLayout();
      assert.equal(app.hideCalls, 1);
    } else {
      assert.equal(app.hideCalls, 0);
    }
    cleanup();
  }
});
