import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, Alert, ScrollView } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import SignatureScreen from "react-native-signature-canvas";
import { supabase } from "../supabase";
import { enqueueOutboxItem } from "../services/outboxQueue";
import { isTransportError, syncSelfCertApproval } from "../services/outboxSync";

export default function SelfCertApprovalsScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [managerSignature, setManagerSignature] = useState("");
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [hasSignatureStroke, setHasSignatureStroke] = useState(false);
  const signatureRef = useRef(null);
  const [approving, setApproving] = useState(false);
  const isFocused = useIsFocused();

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        setItems([]);
        return;
      }

      const { data, error } = await supabase
        .from("self_cert_forms")
        .select(
          "id, employee_name, department, employee_number, first_day_absence, working_days_lost, notification_made_to, reason_and_symptoms, injury_occurred, injury_details, sought_medical_advice, consulted_doctor_again, visited_hospital_or_clinic, employee_signature, employee_signed_at, created_at, status"
        )
        .eq("line_manager_user_id", user.id)
        .eq("status", "pending_manager_approval")
        .order("created_at", { ascending: false });

      if (error) {
        Alert.alert("Load Failed", error.message || "Could not load approvals.");
        setItems([]);
        return;
      }

      setItems(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      loadPending();
    }
  }, [isFocused, loadPending]);

  function handleSignatureConfirm(signatureDataUrl) {
    if (!signatureDataUrl || signatureDataUrl === "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB") {
      Alert.alert("Signature Required", "Please sign in the box before saving.");
      return;
    }

    setManagerSignature(signatureDataUrl);
    setHasSignatureStroke(false);
    setShowSignatureModal(false);
  }

  function handleSignatureSavePress() {
    if (!hasSignatureStroke) {
      Alert.alert("Signature Required", "Please sign in the box before saving.");
      return;
    }
    signatureRef.current?.readSignature();
  }

  function handleSignatureClearPress() {
    signatureRef.current?.clearSignature();
    setHasSignatureStroke(false);
  }

  async function approveSelected() {
    if (!selected?.id) return;
    if (!managerSignature.trim()) {
      Alert.alert("Signature Required", "Please enter manager signature.");
      return;
    }

    setApproving(true);
    try {
      const payload = {
        formId: selected.id,
        managerSignature: managerSignature.trim(),
      };

      const netState = await NetInfo.fetch();
      const isOnline = Boolean(netState.isConnected && netState.isInternetReachable);
      if (!isOnline) {
        await enqueueOutboxItem({
          type: "self-cert-approve",
          data: { payload },
          meta: { title: selected.employee_name || "Self Cert Approval" },
        });
        setSelected(null);
        setManagerSignature("");
        Alert.alert("Saved To Outbox", "No signal. Approval queued and will sync automatically when online.");
        await loadPending();
        return;
      }

      await syncSelfCertApproval({ payload });

      setSelected(null);
      setManagerSignature("");
      Alert.alert("Approved", "Self cert approved and forwarded for HR.");
      await loadPending();
    } catch (err) {
      if (isTransportError(err)) {
        const payload = {
          formId: selected.id,
          managerSignature: managerSignature.trim(),
        };
        await enqueueOutboxItem({
          type: "self-cert-approve",
          data: { payload },
          meta: { title: selected.employee_name || "Self Cert Approval" },
        });
        setSelected(null);
        setManagerSignature("");
        Alert.alert("Saved To Outbox", "Network issue. Approval queued and can be retried from Outbox.");
        await loadPending();
        return;
      }
      Alert.alert("Approval Failed", String(err?.message || "Please try again."));
    } finally {
      setApproving(false);
    }
  }

  function boolLabel(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return "-";
  }

  function textValue(value) {
    const text = String(value || "").trim();
    return text || "-";
  }

  function signatureLabel(value) {
    const text = String(value || "").trim();
    if (!text) return "-";
    if (text.startsWith("data:image/")) return "Captured signature";
    return text;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Self Cert Approvals</Text>
      <Text style={styles.subtitle}>Items awaiting manager action.</Text>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={loadPending}
        ListEmptyComponent={<Text style={styles.empty}>No items requiring attention.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => {
              setSelected(item);
              setManagerSignature("");
              setShowSignatureModal(false);
              setHasSignatureStroke(false);
            }}
          >
            <Text style={styles.name}>{item.employee_name || "Employee"}</Text>
            <Text style={styles.meta}>{item.department || "-"}</Text>
            <Text style={styles.meta}>First day: {item.first_day_absence || "-"}</Text>
            <Text style={styles.meta}>Days lost: {item.working_days_lost ?? "-"}</Text>
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Approve Self Cert</Text>
            <ScrollView style={styles.detailsScroll} contentContainerStyle={styles.detailsScrollContent}>
              <Text style={styles.sectionTitle}>Employee Details</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Employee Name</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.employee_name)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Department</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.department)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Employee Number</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.employee_number)}</Text>
              </View>

              <Text style={styles.sectionTitle}>Absence Details</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>First Day of Absence</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.first_day_absence)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Working Days Lost</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.working_days_lost)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Notification Made To</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.notification_made_to)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Reason and Symptoms</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.reason_and_symptoms)}</Text>
              </View>

              <Text style={styles.sectionTitle}>Medical / Injury</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Happened At Work</Text>
                <Text style={styles.readOnlyValue}>{boolLabel(selected?.injury_occurred)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Injury Details</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.injury_details)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Sought Medical Advice</Text>
                <Text style={styles.readOnlyValue}>{boolLabel(selected?.sought_medical_advice)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Consulted Doctor Again</Text>
                <Text style={styles.readOnlyValue}>{boolLabel(selected?.consulted_doctor_again)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Visited Hospital/Clinic</Text>
                <Text style={styles.readOnlyValue}>{boolLabel(selected?.visited_hospital_or_clinic)}</Text>
              </View>

              <Text style={styles.sectionTitle}>Employee Signature</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Employee Signature</Text>
                <Text style={styles.readOnlyValue}>{signatureLabel(selected?.employee_signature)}</Text>
              </View>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyLabel}>Employee Signed At</Text>
                <Text style={styles.readOnlyValue}>{textValue(selected?.employee_signed_at)}</Text>
              </View>

              <Text style={styles.label}>Manager Signature</Text>
              <TouchableOpacity style={styles.signatureInputButton} onPress={() => setShowSignatureModal(true)}>
                <Text style={managerSignature ? styles.selectButtonText : styles.selectPlaceholder}>
                  {managerSignature ? "Signature captured (tap to re-sign)" : "Tap to sign on screen"}
                </Text>
                <Ionicons name="create-outline" size={16} color="#334155" />
              </TouchableOpacity>
            </ScrollView>

            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setSelected(null);
                  setShowSignatureModal(false);
                  setHasSignatureStroke(false);
                }}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.approveBtn} onPress={approveSelected} disabled={approving}>
                <Text style={styles.approveText}>{approving ? "Approving..." : "Approve"}</Text>
              </TouchableOpacity>
            </View>

            {showSignatureModal ? (
              <View style={styles.signatureOverlay}>
                <View style={styles.signatureModalCard}>
                  <Text style={styles.modalTitle}>Sign Below</Text>
                  <View style={styles.signatureCanvasWrap}>
                    <SignatureScreen
                      ref={signatureRef}
                      onBegin={() => setHasSignatureStroke(true)}
                      onOK={handleSignatureConfirm}
                      onEmpty={() => {
                        setHasSignatureStroke(false);
                        Alert.alert("Signature Required", "Please sign in the box before saving.");
                      }}
                      descriptionText="Sign"
                      clearText=""
                      confirmText=""
                      autoClear={false}
                      webStyle={`
                        .m-signature-pad--footer { display: none; margin: 0; }
                        .m-signature-pad { box-shadow: none; border: none; }
                        .m-signature-pad--body { border: 1px solid #cbd5e1; border-radius: 8px; }
                        canvas { width: 100% !important; height: 100% !important; }
                        body,html { width: 100%; height: 100%; }
                      `}
                    />
                  </View>
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={handleSignatureClearPress}>
                      <Text style={styles.cancelText}>Clear</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.approveBtn} onPress={handleSignatureSavePress}>
                      <Text style={styles.approveText}>Save Signature</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSignatureModal(false)}>
                      <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    color: "#64748b",
    marginBottom: 12,
  },
  empty: {
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 20,
  },
  card: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#f8fafc",
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  meta: {
    fontSize: 13,
    color: "#475569",
    marginBottom: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.45)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    position: "relative",
    maxHeight: "92%",
  },
    detailsScroll: {
      maxHeight: 520,
    },
    detailsScrollContent: {
      paddingBottom: 8,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: "#0f172a",
      marginTop: 8,
      marginBottom: 6,
    },
    readOnlyField: {
      borderWidth: 1,
      borderColor: "#e2e8f0",
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginBottom: 8,
      backgroundColor: "#f8fafc",
    },
    readOnlyLabel: {
      fontSize: 12,
      color: "#64748b",
      marginBottom: 4,
      fontWeight: "600",
    },
    readOnlyValue: {
      fontSize: 14,
      color: "#0f172a",
    },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 10,
    marginBottom: 6,
  },
  signatureInputButton: {
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
  signatureOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(2, 6, 23, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    zIndex: 20,
  },
  signatureModalCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    overflow: "hidden",
    width: "96%",
    maxWidth: 760,
    height: "52%",
    minHeight: 280,
  },
  signatureCanvasWrap: {
    flex: 1,
    minHeight: 180,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#fff",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: {
    color: "#334155",
    fontWeight: "600",
  },
  approveBtn: {
    flex: 1,
    backgroundColor: "#16a34a",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  approveText: {
    color: "#fff",
    fontWeight: "700",
  },
});
