import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../supabase";
import { getOutboxCount, getOutboxItems, removeOutboxItem, updateOutboxItem } from "../services/outboxQueue";
import { syncChecklistSubmission } from "../services/checklistSync";

export default function HomeScreen({ navigation }) {
  const [outboxCount, setOutboxCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const isFocused = useIsFocused();

  const refreshOutboxCount = useCallback(async () => {
    const count = await getOutboxCount();
    setOutboxCount(count);
  }, []);

  const processOutbox = useCallback(async () => {
    if (isSyncing) return;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected || !netState.isInternetReachable) {
      return;
    }

    setIsSyncing(true);
    try {
      const items = await getOutboxItems();
      for (const item of items) {
        await updateOutboxItem(item.id, (prev) => ({
          ...prev,
          status: "syncing",
          lastError: "",
        }));

        try {
          await syncChecklistSubmission(item.data);
          await removeOutboxItem(item.id);
        } catch (error) {
          await updateOutboxItem(item.id, (prev) => ({
            ...prev,
            status: "failed",
            retries: Number(prev.retries || 0) + 1,
            lastError: String(error?.message || "Sync failed"),
          }));
        }
      }
    } finally {
      setIsSyncing(false);
      await refreshOutboxCount();
    }
  }, [isSyncing, refreshOutboxCount]);

  useEffect(() => {
    if (!isFocused) return;
    refreshOutboxCount();
    processOutbox();
  }, [isFocused, processOutbox, refreshOutboxCount]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        processOutbox();
      }
    });

    return () => unsub();
  }, [processOutbox]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigation.reset({
      index: 0,
      routes: [{ name: "Login" }],
    });
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.outboxButton} onPress={() => navigation.navigate("Outbox")}>
        <Ionicons name="paper-plane-outline" size={24} color="#0f172a" />
        {outboxCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{outboxCount > 99 ? "99+" : String(outboxCount)}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      <Text style={styles.title}>Contracts App</Text>
      <Text style={styles.welcome}>Manage active contracts and complete inspections.</Text>

      <TouchableOpacity
        style={styles.buttonPrimary}
        onPress={() => navigation.navigate("ContractForms")}
      >
        <Text style={styles.buttonPrimaryText}>Contracts</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 60,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  outboxButton: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    zIndex: 2,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 20,
  },
  welcome: {
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 30,
  },
  buttonPrimary: {
    backgroundColor: "#007aff",
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginBottom: 15,
    width: "90%",
  },
  buttonPrimaryText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  signOutButton: {
    marginTop: 20,
  },
  signOutText: {
    color: "red",
    fontSize: 18,
    fontWeight: "600",
  },
});
