import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../supabase";

const FALLBACK_FORMS = [
  {
    id: "roller_inspection",
    templateCode: "PLANT_DAILY",
    title: "Roller Inspection",
    detail: "Complete daily roller checklist",
  },
];

export default function ContractFormsScreen({ navigation }) {
  const isFocused = useIsFocused();
  const [contracts, setContracts] = useState([]);
  const [selectedContract, setSelectedContract] = useState(null);
  const [forms, setForms] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [copyingFormId, setCopyingFormId] = useState("");

  useEffect(() => {
    if (isFocused) {
      if (selectedContract?.id) {
        fetchAssignedForms(selectedContract, { showSpinner: false });
      } else {
        fetchContracts({ showSpinner: false });
      }
    }
  }, [isFocused, selectedContract?.id]);

  async function fetchContracts(options = {}) {
    const showSpinner = options.showSpinner !== false;
    if (showSpinner) setRefreshing(true);
    setMessage("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const [contractsRes, roleRes, teamRes] = await Promise.all([
        supabase
          .from("contracts")
          .select("id, name, contract_name, contract_number, client, status")
          .order("created_at", { ascending: false }),
        user?.id
          ? supabase.from("app_user_roles").select("role").eq("user_id", user.id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        user?.id
          ? supabase.from("contract_team_roles").select("contract_id").eq("user_id", user.id)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (contractsRes.error || roleRes.error || teamRes.error) {
        setMessage(
          contractsRes.error?.message || roleRes.error?.message || teamRes.error?.message || "Could not load contracts"
        );
        setContracts([]);
        return;
      }

      const role = String(roleRes.data?.role || "viewer").toLowerCase();
      const isPrivileged = role === "admin" || role === "manager";
      const assignedIds = new Set((teamRes.data || []).map((row) => row.contract_id));

      const availableContracts = (contractsRes.data || []).filter((row) => {
        if (isPrivileged) return true;
        return assignedIds.has(row.id);
      });

      const mapped = availableContracts.map((row) => ({
        id: row.id,
        contractNo: row.contract_number || "-",
        contractName: row.name || row.contract_name || row.contract_number || "Contract",
        detail: row.client ? `Client: ${row.client}` : "Assigned contract",
        status: row.status || "active",
      }));

      setContracts(mapped);

      if (!mapped.length) {
        setMessage("No contracts assigned to your account yet.");
      }
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  async function fetchAssignedForms(contract, options = {}) {
    const showSpinner = options.showSpinner !== false;
    if (showSpinner) setRefreshing(true);
    setMessage("");

    try {
      const { data, error } = await supabase
        .from("contract_required_forms")
        .select("id, form_template_id, is_active, form_templates(template_code, title, description)")
        .eq("contract_id", contract.id)
        .eq("is_active", true);

      if (error) {
        setMessage(error.message || "Could not load assigned forms.");
        setForms(FALLBACK_FORMS);
        return;
      }

      const mapped = (data || [])
        .map((row) => ({
          id: row.id,
          templateCode: row.form_templates?.template_code || "PLANT_DAILY",
          title: row.form_templates?.title || "Roller Inspection",
          detail: row.form_templates?.description || "Complete daily roller checklist",
        }))
        .filter((row) => Boolean(row.id));

      setForms(mapped.length ? mapped : FALLBACK_FORMS);

      if (!mapped.length) {
        setMessage("No specific forms assigned. Showing default form.");
      }
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  const showContractsLayer = useMemo(() => !selectedContract, [selectedContract]);

  function openContract(contract) {
    setSelectedContract(contract);
    fetchAssignedForms(contract, { showSpinner: true });
  }

  function backToContracts() {
    setSelectedContract(null);
    setForms([]);
    setMessage("");
  }

  function onPullRefresh() {
    if (showContractsLayer) {
      fetchContracts({ showSpinner: true });
      return;
    }

    fetchAssignedForms(selectedContract, { showSpinner: true });
  }

  function buildFillFormPayload(item, launch) {
    return {
      id: item.id,
      contractNo: selectedContract?.contractNo,
      contractName: selectedContract?.contractName,
      title: item.title,
      detail: item.detail,
      templateCode: item.templateCode,
      launch,
    };
  }

  function handleStartNew(item) {
    navigation.navigate("FillForm", {
      form: buildFillFormPayload(item, {
        mode: "new",
        token: Date.now(),
      }),
    });
  }

  async function handleStartCopy(item) {
    if (!selectedContract?.id) return;

    setCopyingFormId(item.id);
    try {
      const { data, error } = await supabase
        .from("roller_daily_checks")
        .select(
          "id, created_at, sheet_version, machine_type, machine_reg, asset_no, serial_no, machine_hours, checklist, notes"
        )
        .eq("contract_id", selectedContract.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        Alert.alert("Copy Failed", error.message || "Could not copy from latest form.");
        return;
      }

      if (!data) {
        Alert.alert(
          "No Previous Form",
          "No previous completed form found for this contract. Starting a new form instead."
        );
        handleStartNew(item);
        return;
      }

      navigation.navigate("FillForm", {
        form: buildFillFormPayload(item, {
          mode: "copy",
          token: Date.now(),
          copiedFromId: data.id,
          data: {
            sheet_version: data.sheet_version,
            machine_type: data.machine_type,
            machine_reg: data.machine_reg,
            asset_no: data.asset_no,
            serial_no: data.serial_no,
            machine_hours: data.machine_hours,
            checklist: data.checklist,
            notes: data.notes,
          },
        }),
      });
    } finally {
      setCopyingFormId("");
    }
  }

  return (
    <View style={styles.container}>
      {showContractsLayer ? (
        <>
          <Text style={styles.title}>Contracts</Text>
          <Text style={styles.subtitle}>Select a contract before choosing a form.</Text>

          {message ? <Text style={styles.message}>{message}</Text> : null}

          <FlatList
            data={contracts}
            keyExtractor={(item) => item.id}
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.card} onPress={() => openContract(item)}>
                <Text style={styles.contractNo}>{item.contractNo}</Text>
                <Text style={styles.formTitle}>{item.contractName}</Text>
                <Text style={styles.formDetail}>{item.detail}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={!refreshing ? <Text style={styles.empty}>No contracts available.</Text> : null}
          />
        </>
      ) : (
        <>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.backButton} onPress={backToContracts}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <View style={styles.headerMeta}>
              <Text style={styles.contractNo}>{selectedContract?.contractNo}</Text>
              <Text style={styles.formTitle}>{selectedContract?.contractName}</Text>
            </View>
          </View>

          <Text style={styles.title}>Assigned Forms</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <FlatList
            data={forms}
            keyExtractor={(item) => item.id}
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.formTitle}>{item.title}</Text>
                <Text style={styles.formDetail}>{item.detail}</Text>

                <View style={styles.formActionsRow}>
                  <TouchableOpacity style={styles.actionButton} onPress={() => handleStartNew(item)}>
                    <Text style={styles.actionButtonText}>New</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonSecondary]}
                    onPress={() => handleStartCopy(item)}
                    disabled={copyingFormId === item.id}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonSecondaryText]}>
                      {copyingFormId === item.id ? "Copying..." : "Copy"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </>
      )}
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
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 6,
  },
  subtitle: {
    color: "#64748b",
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 10,
  },
  headerMeta: {
    flex: 1,
  },
  backButton: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  backText: {
    color: "#334155",
    fontWeight: "600",
  },
  message: {
    color: "#475569",
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
    padding: 14,
    marginBottom: 10,
  },
  contractNo: {
    fontSize: 12,
    color: "#666",
    marginBottom: 6,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  formDetail: {
    marginTop: 6,
    fontSize: 13,
    color: "#5e5e5e",
  },
  formActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  actionButton: {
    backgroundColor: "#007aff",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 90,
    alignItems: "center",
  },
  actionButtonSecondary: {
    backgroundColor: "#eef4ff",
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  actionButtonSecondaryText: {
    color: "#1e4b88",
  },
});
