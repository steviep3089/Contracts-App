import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../supabase";

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function formatYesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "-";
}

export default function MyDocumentsScreen() {
  const isFocused = useIsFocused();
  const [documents, setDocuments] = useState([]);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        setDocuments([]);
        setLoading(false);
        return;
      }

      const [selfCertRes, checksRes] = await Promise.all([
        supabase
          .from("self_cert_forms")
          .select(
            "id, created_at, status, employee_name, department, employee_number, first_day_absence, working_days_lost, notification_made_to, reason_and_symptoms, injury_occurred, injury_details, sought_medical_advice, consulted_doctor_again, visited_hospital_or_clinic, employee_signed_at, manager_signed_at"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("roller_daily_checks")
          .select(
            "id, created_at, check_date, machine_type, machine_reg, asset_no, serial_no, machine_hours, location, contract_name, completed_by_name, has_defects"
          )
          .eq("created_by", user.id)
          .order("created_at", { ascending: false }),
      ]);

      if (selfCertRes.error) {
        throw new Error(selfCertRes.error.message || "Could not load self cert forms.");
      }

      if (checksRes.error) {
        throw new Error(checksRes.error.message || "Could not load Plant Daily Checklists records.");
      }

      const selfCertDocs = (selfCertRes.data || []).map((row) => ({
        id: `self-cert-${row.id}`,
        createdAt: row.created_at,
        type: "Self Cert",
        title: row.employee_name || "Self Cert",
        status: row.status || "-",
        raw: row,
      }));

      const plantDocs = (checksRes.data || []).map((row) => ({
        id: `plant-check-${row.id}`,
        createdAt: row.created_at,
        type: "Plant Daily Checklists",
        title: row.machine_reg || row.asset_no || row.machine_type || "Plant Check",
        status: row.has_defects ? "Defects Flagged" : "Completed",
        raw: row,
      }));

      const merged = [...selfCertDocs, ...plantDocs].sort((a, b) => {
        const at = new Date(a.createdAt || 0).getTime();
        const bt = new Date(b.createdAt || 0).getTime();
        return bt - at;
      });

      setDocuments(merged);
    } catch (loadError) {
      setError(String(loadError?.message || "Could not load your documents."));
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      loadDocuments();
    }
  }, [isFocused, loadDocuments]);

  function renderSelfCertDetails(row) {
    return (
      <View style={styles.detailsWrap}>
        <Text style={styles.detailRow}>Department: {row.department || "-"}</Text>
        <Text style={styles.detailRow}>Employee No: {row.employee_number || "-"}</Text>
        <Text style={styles.detailRow}>First Day Absence: {row.first_day_absence || "-"}</Text>
        <Text style={styles.detailRow}>Working Days Lost: {row.working_days_lost ?? "-"}</Text>
        <Text style={styles.detailRow}>Notification Made To: {row.notification_made_to || "-"}</Text>
        <Text style={styles.detailRow}>Happened At Work: {formatYesNo(row.injury_occurred)}</Text>
        <Text style={styles.detailRow}>Sought Medical Advice: {formatYesNo(row.sought_medical_advice)}</Text>
        <Text style={styles.detailRow}>Consulted Doctor Again: {formatYesNo(row.consulted_doctor_again)}</Text>
        <Text style={styles.detailRow}>Visited Hospital/Clinic: {formatYesNo(row.visited_hospital_or_clinic)}</Text>
        <Text style={styles.detailRow}>Injury Details: {row.injury_details || "-"}</Text>
        <Text style={styles.detailRow}>Employee Signed At: {formatDate(row.employee_signed_at)}</Text>
        <Text style={styles.detailRow}>Manager Signed At: {formatDate(row.manager_signed_at)}</Text>
        <Text style={styles.detailLabel}>Reason and Symptoms</Text>
        <Text style={styles.reasonText}>{row.reason_and_symptoms || "-"}</Text>
      </View>
    );
  }

  function renderPlantCheckDetails(row) {
    return (
      <View style={styles.detailsWrap}>
        <Text style={styles.detailRow}>Date: {row.check_date || "-"}</Text>
        <Text style={styles.detailRow}>Machine Type: {row.machine_type || "-"}</Text>
        <Text style={styles.detailRow}>Machine Reg: {row.machine_reg || "-"}</Text>
        <Text style={styles.detailRow}>Asset No: {row.asset_no || "-"}</Text>
        <Text style={styles.detailRow}>Serial No: {row.serial_no || "-"}</Text>
        <Text style={styles.detailRow}>Machine Hours: {row.machine_hours ?? "-"}</Text>
        <Text style={styles.detailRow}>Contract: {row.contract_name || row.location || "-"}</Text>
        <Text style={styles.detailRow}>Completed By: {row.completed_by_name || "-"}</Text>
        <Text style={styles.detailRow}>Defects: {row.has_defects ? "Yes" : "No"}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Documents</Text>
      <Text style={styles.subtitle}>Your submitted forms and checklists.</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={documents}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadDocuments} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No documents found.</Text> : null}
        renderItem={({ item }) => {
          const expanded = expandedId === item.id;
          return (
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => setExpandedId((prev) => (prev === item.id ? "" : item.id))}
              >
                <View style={styles.headerTextWrap}>
                  <Text style={styles.typePill}>{item.type}</Text>
                  <Text style={styles.docTitle}>{item.title}</Text>
                  <Text style={styles.docMeta}>{formatDate(item.createdAt)} | Status: {item.status}</Text>
                </View>
                <Text style={styles.expandLabel}>{expanded ? "Hide" : "View"}</Text>
              </TouchableOpacity>

              {expanded
                ? item.type === "Self Cert"
                  ? renderSelfCertDetails(item.raw)
                  : renderPlantCheckDetails(item.raw)
                : null}
            </View>
          );
        }}
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
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  subtitle: {
    color: "#64748b",
    marginBottom: 12,
  },
  error: {
    color: "#b91c1c",
    marginBottom: 10,
  },
  empty: {
    color: "#6b7280",
    textAlign: "center",
    marginTop: 20,
  },
  card: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  headerButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  headerTextWrap: {
    flex: 1,
  },
  typePill: {
    alignSelf: "flex-start",
    backgroundColor: "#eef2ff",
    color: "#3730a3",
    fontSize: 11,
    fontWeight: "700",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  docTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#0f172a",
  },
  docMeta: {
    marginTop: 4,
    color: "#475569",
    fontSize: 13,
  },
  expandLabel: {
    color: "#1d4ed8",
    fontWeight: "700",
    paddingTop: 2,
  },
  detailsWrap: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 10,
    gap: 4,
  },
  detailRow: {
    color: "#334155",
    fontSize: 13,
  },
  detailLabel: {
    marginTop: 8,
    color: "#0f172a",
    fontWeight: "700",
  },
  reasonText: {
    color: "#334155",
    fontSize: 13,
    lineHeight: 18,
  },
});