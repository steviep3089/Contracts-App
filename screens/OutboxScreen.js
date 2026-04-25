import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useIsFocused } from "@react-navigation/native";
import {
  getOutboxItems,
  removeOutboxItem,
  updateOutboxItem,
} from "../services/outboxQueue";
import { syncOutboxItem } from "../services/outboxSync";

function formatTimestamp(isoText) {
  if (!isoText) return "";
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export default function OutboxScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState("");
  const [retryingAll, setRetryingAll] = useState(false);
  const isFocused = useIsFocused();

  const typeCounts = useMemo(() => {
    const counts = {
      checklist: 0,
      nearMiss: 0,
      selfCert: 0,
      approvals: 0,
      other: 0,
    };

    for (const item of items) {
      const type = String(item?.type || "checklist-submit");
      if (type === "checklist-submit") counts.checklist += 1;
      else if (type === "near-miss-submit") counts.nearMiss += 1;
      else if (type === "self-cert-submit") counts.selfCert += 1;
      else if (type === "self-cert-approve") counts.approvals += 1;
      else counts.other += 1;
    }

    return counts;
  }, [items]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const outboxItems = await getOutboxItems();
      setItems(outboxItems);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      loadItems();
    }
  }, [isFocused, loadItems]);

  async function retryItem(item) {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected || !netState.isInternetReachable) {
      Alert.alert("Offline", "You are still offline. Connect to internet and retry.");
      return;
    }

    setRetryingId(item.id);
    try {
      await updateOutboxItem(item.id, (prev) => ({
        ...prev,
        status: "syncing",
        lastError: "",
      }));

      await syncOutboxItem(item);
      await removeOutboxItem(item.id);
      await loadItems();
    } catch (error) {
      await updateOutboxItem(item.id, (prev) => ({
        ...prev,
        status: "failed",
        retries: Number(prev.retries || 0) + 1,
        lastError: String(error?.message || "Retry failed"),
      }));
      await loadItems();
      Alert.alert("Retry Failed", String(error?.message || "Unknown error"));
    } finally {
      setRetryingId("");
    }
  }

  async function retryAll() {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected || !netState.isInternetReachable) {
      Alert.alert("Offline", "You are still offline. Connect to internet and retry.");
      return;
    }

    setRetryingAll(true);
    try {
      const list = await getOutboxItems();
      for (const item of list) {
        await updateOutboxItem(item.id, (prev) => ({
          ...prev,
          status: "syncing",
          lastError: "",
        }));

        try {
          await syncOutboxItem(item);
          await removeOutboxItem(item.id);
        } catch (error) {
          await updateOutboxItem(item.id, (prev) => ({
            ...prev,
            status: "failed",
            retries: Number(prev.retries || 0) + 1,
            lastError: String(error?.message || "Retry failed"),
          }));
        }
      }
    } finally {
      setRetryingAll(false);
      await loadItems();
    }
  }

  function renderItem({ item }) {
    const type = String(item?.type || "checklist-submit");
    const titleByType = {
      "checklist-submit": item?.data?.checklistPayload?.contract_name || item?.data?.checklistPayload?.location || "Checklist Submission",
      "near-miss-submit": item?.title || item?.data?.payload?.site || "Near Miss",
      "self-cert-submit": item?.title || item?.data?.payload?.name || "Self Cert",
      "self-cert-approve": item?.title || "Self Cert Approval",
    };
    const title = titleByType[type] || "Queued Item";

    return (
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>Type: {type}</Text>
        <Text style={styles.meta}>Created: {formatTimestamp(item.createdAt)}</Text>
        <Text style={styles.meta}>Status: {item.status || "queued"}</Text>
        <Text style={styles.meta}>Retries: {Number(item.retries || 0)}</Text>
        {item.lastError ? <Text style={styles.error}>Last Error: {item.lastError}</Text> : null}

        <TouchableOpacity
          style={[styles.retryButton, (retryingAll || retryingId === item.id) && styles.buttonDisabled]}
          onPress={() => retryItem(item)}
          disabled={retryingAll || retryingId === item.id}
        >
          <Text style={styles.retryText}>{retryingId === item.id ? "Retrying..." : "Retry"}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Outbox ({items.length})</Text>
        <TouchableOpacity
          style={[styles.retryAllButton, (retryingAll || items.length === 0) && styles.buttonDisabled]}
          onPress={retryAll}
          disabled={retryingAll || items.length === 0}
        >
          <Text style={styles.retryAllText}>{retryingAll ? "Retrying..." : "Retry All"}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownText}>Checklist: {typeCounts.checklist}</Text>
        <Text style={styles.breakdownText}>Near Miss: {typeCounts.nearMiss}</Text>
        <Text style={styles.breakdownText}>Self Cert: {typeCounts.selfCert}</Text>
        <Text style={styles.breakdownText}>Approvals: {typeCounts.approvals}</Text>
        {typeCounts.other > 0 ? <Text style={styles.breakdownText}>Other: {typeCounts.other}</Text> : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadItems} />}
        ListEmptyComponent={<Text style={styles.emptyText}>No pending submissions.</Text>}
        contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContainer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f172a",
  },
  breakdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  breakdownText: {
    fontSize: 12,
    color: "#334155",
    backgroundColor: "#f1f5f9",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontWeight: "600",
  },
  retryAllButton: {
    backgroundColor: "#007aff",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  retryAllText: {
    color: "#fff",
    fontWeight: "600",
  },
  listContainer: {
    paddingBottom: 18,
  },
  card: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },
  meta: {
    color: "#374151",
    fontSize: 12,
    marginBottom: 2,
  },
  error: {
    color: "#b91c1c",
    fontSize: 12,
    marginTop: 6,
    marginBottom: 8,
  },
  retryButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#eef4ff",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  retryText: {
    color: "#1e4b88",
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: "#6b7280",
    fontSize: 14,
  },
});
