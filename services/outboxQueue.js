import AsyncStorage from "@react-native-async-storage/async-storage";

const OUTBOX_STORAGE_KEY = "contracts_app_outbox_v1";
let mutation = Promise.resolve();

export async function getOutboxItems() {
  const raw = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("The outbox data is invalid.");
  return parsed;
}

async function saveOutboxItems(items) {
  await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
}

function mutateOutbox(change) {
  const next = mutation.then(async () => {
    const items = await getOutboxItems();
    const result = change(items);
    await saveOutboxItems(result.items);
    return result.value;
  });
  mutation = next.catch(() => {});
  return next;
}

export async function enqueueOutboxItem(input, typeOverride = "") {
  let type = "checklist-submit";
  let data = input;
  let meta = {};

  if (typeOverride) {
    type = typeOverride;
  } else if (
    input &&
    typeof input === "object" &&
    typeof input.type === "string" &&
    Object.prototype.hasOwnProperty.call(input, "data")
  ) {
    type = input.type;
    data = input.data;
    meta = input.meta && typeof input.meta === "object" ? input.meta : {};
  }

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    status: "queued",
    retries: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: "",
    data,
    ...meta,
  };

  return mutateOutbox((items) => ({ items: [item, ...items], value: item }));
}

export async function removeOutboxItem(id) {
  return mutateOutbox((items) => ({ items: items.filter((item) => item.id !== id) }));
}

export async function updateOutboxItem(id, updater) {
  return mutateOutbox((items) => {
    let found = false;
    const next = items.map((item) => {
      if (item.id !== id) return item;
      found = true;
      const updated = typeof updater === "function" ? updater(item) : { ...item, ...updater };
      return { ...updated, updatedAt: new Date().toISOString() };
    });
    if (!found) throw new Error("Outbox item no longer exists.");
    return { items: next };
  });
}

export async function getOutboxCount() {
  const items = await getOutboxItems();
  return items.length;
}
