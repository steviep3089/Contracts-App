import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Alert, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../supabase";
import { getOutboxCount, getOutboxItems, removeOutboxItem, updateOutboxItem } from "../services/outboxQueue";
import { syncChecklistSubmission } from "../services/checklistSync";

export default function HomeScreen({ navigation }) {
  const [outboxCount, setOutboxCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [nearMissVisible, setNearMissVisible] = useState(false);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [sites, setSites] = useState([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [submittingNearMiss, setSubmittingNearMiss] = useState(false);
  const [reportDateTime, setReportDateTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [reporterName, setReporterName] = useState("");
  const [selectedSite, setSelectedSite] = useState("");
  const [nearMissDetails, setNearMissDetails] = useState("");
  const [actionsTaken, setActionsTaken] = useState("");
  const isFocused = useIsFocused();

  const reportDateTimeLabel = useMemo(() => reportDateTime.toLocaleString(), [reportDateTime]);

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

  async function fetchLiveSites() {
    setLoadingSites(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const [contractsRes, roleRes, teamRes] = await Promise.all([
        supabase
          .from("contracts")
          .select("id, name, contract_name, contract_number, status")
          .order("created_at", { ascending: false }),
        user?.id
          ? supabase.from("app_user_roles").select("role").eq("user_id", user.id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        user?.id
          ? supabase.from("contract_team_roles").select("contract_id").eq("user_id", user.id)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (contractsRes.error || roleRes.error || teamRes.error) {
        throw new Error(
          contractsRes.error?.message || roleRes.error?.message || teamRes.error?.message || "Could not load sites"
        );
      }

      const role = String(roleRes.data?.role || "viewer").toLowerCase();
      const isPrivileged = role === "admin" || role === "manager";
      const assignedIds = new Set((teamRes.data || []).map((row) => row.contract_id));

      const filtered = (contractsRes.data || []).filter((row) => {
        if (!isPrivileged && !assignedIds.has(row.id)) return false;
        const status = String(row.status || "").toLowerCase();
        return status === "active" || status === "live" || status === "open";
      });

      const fallback = (contractsRes.data || []).filter((row) => {
        if (isPrivileged) return true;
        return assignedIds.has(row.id);
      });

      const source = filtered.length ? filtered : fallback;
      const mapped = source.map((row) => ({
        id: row.id,
        label: row.name || row.contract_name || row.contract_number || "Unnamed Site",
      }));

      const deduped = [];
      const seen = new Set();
      for (const site of mapped) {
        const key = site.label.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(site);
      }
      setSites(deduped);
    } catch (error) {
      Alert.alert("Could not load sites", String(error?.message || "Please try again."));
      setSites([]);
    } finally {
      setLoadingSites(false);
    }
  }

  async function openNearMissModal() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const metadata = user?.user_metadata || {};
    const defaultName =
      metadata.full_name ||
      metadata.name ||
      [metadata.first_name, metadata.last_name].filter(Boolean).join(" ");

    setReportDateTime(new Date());
    setReporterName(String(defaultName));
    setSelectedSite("");
    setNearMissDetails("");
    setActionsTaken("");
    setNearMissVisible(true);
    setSitePickerOpen(false);
    setShowDatePicker(false);
    setShowTimePicker(false);
    fetchLiveSites();
  }

  function onDatePicked(_event, selectedDate) {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (!selectedDate) return;

    setReportDateTime((prev) => {
      const next = new Date(prev);
      next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      return next;
    });
  }

  function onTimePicked(_event, selectedTime) {
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }
    if (!selectedTime) return;

    setReportDateTime((prev) => {
      const next = new Date(prev);
      next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
      return next;
    });
  }

  async function submitNearMiss() {
    if (!reporterName.trim()) {
      Alert.alert("Name required", "Please enter the name of the person reporting.");
      return;
    }
    if (!selectedSite.trim()) {
      Alert.alert("Site required", "Please select a site.");
      return;
    }
    if (!nearMissDetails.trim()) {
      Alert.alert("Details required", "Please add near miss details.");
      return;
    }
    if (!actionsTaken.trim()) {
      Alert.alert("Action required", "Please describe what has been done about it.");
      return;
    }

    setSubmittingNearMiss(true);
    try {
      const payload = {
        reportedAt: reportDateTime.toISOString(),
        reporterName: reporterName.trim(),
        site: selectedSite.trim(),
        nearMissDetails: nearMissDetails.trim(),
        actionsTaken: actionsTaken.trim(),
        source: "contracts-app",
      };

      const { data, error } = await supabase.functions.invoke("report-near-miss", {
        body: payload,
      });

      if (error || data?.success === false) {
        throw new Error(error?.message || data?.error || "Could not submit near miss report.");
      }

      setNearMissVisible(false);
      Alert.alert("Submitted", "Near miss report sent successfully.");
    } catch (error) {
      Alert.alert("Submission failed", String(error?.message || "Please try again."));
    } finally {
      setSubmittingNearMiss(false);
    }
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

      <TouchableOpacity style={styles.buttonSecondary} onPress={openNearMissModal}>
        <Text style={styles.buttonSecondaryText}>Report A Near Miss</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Modal visible={nearMissVisible} transparent animationType="slide" onRequestClose={() => setNearMissVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Report A Near Miss</Text>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
              <Text style={styles.fieldLabel}>Time / Date</Text>
              <TextInput style={[styles.input, styles.readOnlyInput]} value={reportDateTimeLabel} editable={false} />
              <View style={styles.dateTimeRow}>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowDatePicker(true)}>
                  <Text style={styles.dateTimeButtonText}>Change Date</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                  <Text style={styles.dateTimeButtonText}>Change Time</Text>
                </TouchableOpacity>
              </View>

              {showDatePicker ? (
                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={reportDateTime}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={onDatePicked}
                  />
                </View>
              ) : null}

              {showTimePicker ? (
                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={reportDateTime}
                    mode="time"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={onTimePicked}
                  />
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>Name of person reporting</Text>
              <TextInput
                style={styles.input}
                value={reporterName}
                onChangeText={setReporterName}
                placeholder="Enter name"
                autoCapitalize="words"
              />

              <Text style={styles.fieldLabel}>Site</Text>
              <TouchableOpacity style={styles.selectButton} onPress={() => setSitePickerOpen((prev) => !prev)}>
                <Text style={selectedSite ? styles.selectButtonText : styles.selectPlaceholder}>
                  {selectedSite || (loadingSites ? "Loading live sites..." : "Select site")}
                </Text>
                <Ionicons name={sitePickerOpen ? "chevron-up" : "chevron-down"} size={16} color="#334155" />
              </TouchableOpacity>

              {sitePickerOpen ? (
                <View style={styles.siteListWrap}>
                  <ScrollView nestedScrollEnabled style={styles.siteList}>
                    {sites.map((site) => (
                      <TouchableOpacity
                        key={site.id}
                        style={styles.siteRow}
                        onPress={() => {
                          setSelectedSite(site.label);
                          setSitePickerOpen(false);
                        }}
                      >
                        <Text style={styles.siteRowText}>{site.label}</Text>
                      </TouchableOpacity>
                    ))}
                    {!loadingSites && !sites.length ? (
                      <Text style={styles.emptySiteText}>No live sites found.</Text>
                    ) : null}
                  </ScrollView>
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>{"Near Miss Details (Don't Use People's Names)"}</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={nearMissDetails}
                onChangeText={setNearMissDetails}
                placeholder="Describe what the near miss was"
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.fieldLabel}>What has been done about it</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={actionsTaken}
                onChangeText={setActionsTaken}
                placeholder="Describe actions taken"
                multiline
                textAlignVertical="top"
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setNearMissVisible(false)}
                disabled={submittingNearMiss}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.submitButton} onPress={submitNearMiss} disabled={submittingNearMiss}>
                <Text style={styles.submitButtonText}>{submittingNearMiss ? "Submitting..." : "Submit"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  buttonSecondary: {
    backgroundColor: "#0f766e",
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginBottom: 12,
    width: "90%",
  },
  buttonSecondaryText: {
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.45)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    maxHeight: "90%",
    overflow: "hidden",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f172a",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  modalScroll: {
    maxHeight: 500,
  },
  modalScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    marginTop: 8,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0f172a",
    backgroundColor: "#fff",
  },
  readOnlyInput: {
    backgroundColor: "#f8fafc",
    color: "#475569",
  },
  dateTimeRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  dateTimeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#0f766e",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  dateTimeButtonText: {
    color: "#0f766e",
    fontWeight: "600",
    fontSize: 14,
  },
  pickerWrap: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: "#fff",
  },
  selectButton: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
  },
  selectButtonText: {
    fontSize: 15,
    color: "#0f172a",
  },
  selectPlaceholder: {
    fontSize: 15,
    color: "#64748b",
  },
  siteListWrap: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    marginTop: 8,
    overflow: "hidden",
  },
  siteList: {
    maxHeight: 170,
    backgroundColor: "#fff",
  },
  siteRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  siteRowText: {
    fontSize: 15,
    color: "#0f172a",
  },
  emptySiteText: {
    padding: 12,
    color: "#64748b",
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 100,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 6,
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#334155",
    fontSize: 15,
    fontWeight: "600",
  },
  submitButton: {
    flex: 1,
    backgroundColor: "#0f766e",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  submitButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
});
