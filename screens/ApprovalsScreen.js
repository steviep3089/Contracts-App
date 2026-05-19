import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, ScrollView } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../supabase";

export default function ApprovalsScreen({ navigation }) {
  const [loading, setLoading] = useState(false);
  const [selfCertCount, setSelfCertCount] = useState(0);
  const [timesheetCount, setTimesheetCount] = useState(0);
  const isFocused = useIsFocused();

  const loadCounts = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        setSelfCertCount(0);
        setTimesheetCount(0);
        return;
      }

      const [selfCertRes, timesheetRes] = await Promise.all([
        supabase
          .from("self_cert_forms")
          .select("id", { count: "exact", head: true })
          .eq("line_manager_user_id", user.id)
          .eq("status", "pending_manager_approval"),
        supabase
          .from("timesheet_forms")
          .select("id", { count: "exact", head: true })
          .eq("line_manager_user_id", user.id)
          .eq("status", "pending_manager_approval"),
      ]);

      setSelfCertCount(Number(selfCertRes.count || 0));
      setTimesheetCount(Number(timesheetRes.count || 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) loadCounts();
  }, [isFocused, loadCounts]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadCounts} />}
    >
      <Text style={styles.title}>Approvals</Text>
      <Text style={styles.subtitle}>Review and approve pending forms.</Text>

      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("TimesheetApprovals")}>
        <View>
          <Text style={styles.cardTitle}>Timesheets</Text>
          <Text style={styles.cardMeta}>Pending manager approvals</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{timesheetCount}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("SelfCertApprovals")}>
        <View>
          <Text style={styles.cardTitle}>Self Cert</Text>
          <Text style={styles.cardMeta}>Pending manager approvals</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{selfCertCount}</Text>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 16,
    gap: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    color: "#64748b",
    marginBottom: 6,
  },
  card: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#f8fafc",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  cardMeta: {
    color: "#475569",
    marginTop: 2,
  },
  badge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#1d4ed8",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  badgeText: {
    color: "#fff",
    fontWeight: "700",
  },
});

