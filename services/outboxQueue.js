import AsyncStorage from "@react-native-async-storage/async-storage";

const OUTBOX_STORAGE_KEY = "contracts_app_outbox_v1";

export async function getOutboxItems() {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveOutboxItems(items) {
  await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
}

export async function enqueueOutboxItem(data) {
  const items = await getOutboxItems();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: "checklist-submit",
    status: "queued",
    retries: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: "",
    data,
  };

  const next = [item, ...items];
  await saveOutboxItems(next);
  return item;
}

export async function removeOutboxItem(id) {
  const items = await getOutboxItems();
  const next = items.filter((item) => item.id !== id);
  await saveOutboxItems(next);
}

export async function updateOutboxItem(id, updater) {
  const items = await getOutboxItems();
  const next = items.map((item) => {
    if (item.id !== id) return item;
    const updated = typeof updater === "function" ? updater(item) : { ...item, ...updater };
    return {
      ...updated,
      updatedAt: new Date().toISOString(),
    };
  });
  await saveOutboxItems(next);
}

export async function getOutboxCount() {
  const items = await getOutboxItems();
  return items.length;
}
