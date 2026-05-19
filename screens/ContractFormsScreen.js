import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../supabase";

const FALLBACK_FORMS = [
  {
    id: "roller_inspection",
    templateCode: "PLANT_DAILY",
    title: "Plant Daily Checklist",
    detail: "Complete daily roller checklist",
    category: "Plant",
  },
];

const HIDDEN_TEMPLATE_CODES = new Set([
  "near_miss",
  "self_cert_approval",
  "timesheet_approval",
  "self_cert_submit",
  "timesheet_submit",
]);

const CONTRACTS_CACHE_TTL_MS = 60 * 1000;
const TEMPLATE_LIBRARY_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CONTRACT_ROWS = 300;

const accessibleContractsCacheByUser = new Map();
let templateLibraryCache = {
  forms: [],
  cachedAt: 0,
};

function isMissingTableError(error, tableName) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  const expected = String(tableName || "").toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  if (expected && message.includes(`could not find the table '${expected}'`)) return true;
  if (expected && message.includes(`relation "${expected}" does not exist`)) return true;
  return false;
}

function parseTemplateCategoryFromDescription(description) {
  const text = String(description || "");
  const markerMatch = text.match(/^\s*\[Category:\s*([^\]]+?)\]\s*/i);
  const legacyMatch = text.match(/^\s*Category:\s*(.+?)\s*\|/i);
  return String(markerMatch?.[1] || legacyMatch?.[1] || "").trim();
}

function inferTemplateCategoryFromTitle(title) {
  const text = String(title || "").trim().toLowerCase();
  if (!text) return "";
  if (/timesheet|payroll/.test(text)) return "Payroll";
  if (/self cert|sickness|absence/.test(text)) return "HR";
  if (/near miss|safety|h&s/.test(text)) return "H&S";
  if (/checksheet|checklist|plant/.test(text)) return "Plant";
  return "";
}

function resolveTemplateCategory({ title, description, templateCode }) {
  const parsed = String(parseTemplateCategoryFromDescription(description) || "").trim();
  const inferred = String(inferTemplateCategoryFromTitle(title) || "").trim();
  const code = String(templateCode || "").toLowerCase();
  const codeHint = code.includes("plant") || code.includes("check") ? "Plant" : "";

  if (parsed && parsed.toLowerCase() !== "operational") return parsed;
  if (inferred) return inferred;
  if (codeHint) return codeHint;
  return parsed || "Operational";
}

function isChecklistTemplate(row) {
  const code = String(row?.templateCode || "").trim().toLowerCase();
  if (!code || HIDDEN_TEMPLATE_CODES.has(code)) return false;

  const category = String(row?.category || "").trim().toLowerCase();
  if (category === "plant") return true;

  const title = String(row?.title || "").toLowerCase();
  const detail = String(row?.detail || "").toLowerCase();
  return /checksheet|checklist|daily check|plant/.test(`${title} ${detail} ${code}`);
}

function normalizeChecklistTemplateTitle(title) {
  const input = String(title || "").trim();
  if (!input) return "Plant Daily Checklist";

  const lowered = input.toLowerCase();
  let next = input;

  // Keep this targeted to your known templates.
  if (lowered.includes("jcb 3cx") || lowered.includes("paver")) {
    next = next.replace(/\s+new\b/gi, "").replace(/\s{2,}/g, " ").trim();
  }

  return next;
}

function normalizeTemplateChecklistPayload(templateChecklist) {
  if (Array.isArray(templateChecklist)) return templateChecklist;
  if (!templateChecklist || typeof templateChecklist !== "object") return [];

  if (Array.isArray(templateChecklist.rows)) return templateChecklist.rows;
  if (Array.isArray(templateChecklist.items)) return templateChecklist.items;
  if (Array.isArray(templateChecklist.checklist)) return templateChecklist.checklist;
  if (Array.isArray(templateChecklist.lines)) return templateChecklist.lines;
  if (templateChecklist.left || templateChecklist.right) return [templateChecklist];

  const keys = Object.keys(templateChecklist).filter((key) => String(key || "").trim());
  if (keys.length > 0) {
    return keys.map((label) => ({ label: String(label).trim() }));
  }

  return [];
}

async function loadAccessibleContractsForUser(userId, options = {}) {
  const force = options.force === true;
  if (!userId) return { contracts: [], error: null };

  const cached = accessibleContractsCacheByUser.get(userId);
  if (!force && cached && Date.now() - cached.cachedAt < CONTRACTS_CACHE_TTL_MS) {
    return { contracts: cached.contracts, error: null };
  }

  const [contractsRes, roleRes, teamRes, legacyAssignmentsRes, directoryRoleRes] = await Promise.all([
    supabase
      .from("contracts")
      .select("id, name, contract_name, contract_number, client, status")
      .order("created_at", { ascending: false })
      .limit(MAX_CONTRACT_ROWS),
    supabase.from("app_user_roles").select("role").eq("user_id", userId).maybeSingle(),
    supabase.from("contract_team_roles").select("contract_id").eq("user_id", userId),
    supabase.from("user_contracts").select("contract_id").eq("user_id", userId),
    supabase.from("people_directory").select("authority").eq("portal_user_id", userId).maybeSingle(),
  ]);

  const legacyMissing = isMissingTableError(legacyAssignmentsRes.error, "public.user_contracts");
  const legacyError = legacyMissing ? null : legacyAssignmentsRes.error;

  if (contractsRes.error || roleRes.error || teamRes.error || legacyError) {
    return {
      contracts: [],
      error:
        contractsRes.error?.message ||
        roleRes.error?.message ||
        teamRes.error?.message ||
        legacyError?.message ||
        "Could not load contracts",
    };
  }

  const authority = String(directoryRoleRes.data?.authority || "").trim().toLowerCase();
  const fallbackRole = authority === "admin" || authority === "manager" ? authority : "viewer";
  const role = String(roleRes.data?.role || fallbackRole).toLowerCase();
  const isPrivileged = role === "admin" || role === "manager";
  const assignedIds = new Set([
    ...(teamRes.data || []).map((row) => row.contract_id),
    ...(legacyAssignmentsRes.data || []).map((row) => row.contract_id),
  ]);

  const availableContracts = (contractsRes.data || []).filter((row) => {
    if (isPrivileged) return true;
    if (assignedIds.size === 0) return true;
    return assignedIds.has(row.id);
  });

  const mapped = availableContracts.map((row) => ({
    id: row.id,
    contractNo: row.contract_number || "-",
    contractName: row.name || row.contract_name || row.contract_number || "Contract",
    detail: row.client ? `Client: ${row.client}` : "Assigned contract",
    status: row.status || "active",
  }));

  accessibleContractsCacheByUser.set(userId, {
    contracts: mapped,
    cachedAt: Date.now(),
  });

  return { contracts: mapped, error: null };
}

async function loadChecklistTemplateLibrary(options = {}) {
  const force = options.force === true;
  if (
    !force &&
    Array.isArray(templateLibraryCache.forms) &&
    templateLibraryCache.forms.length > 0 &&
    Date.now() - templateLibraryCache.cachedAt < TEMPLATE_LIBRARY_CACHE_TTL_MS
  ) {
    return { forms: templateLibraryCache.forms, error: null };
  }

  const { data, error } = await supabase
    .from("form_templates")
    .select("id, template_code, title, description, checklist, is_active")
    .order("title", { ascending: true });

  if (error) {
    return { forms: [], error };
  }

  const forms = (data || [])
    .filter((row) => row?.is_active !== false)
    .map((row) => {
      const title = normalizeChecklistTemplateTitle(row.title || "Plant Daily Checklist");
      const detail = stripTemplateRoutingMetadata(row.description) || "Checklist";
      return {
        id: String(row.template_code || row.id || ""),
        templateCode: String(row.template_code || "PLANT_DAILY"),
        title,
        detail,
        category: resolveTemplateCategory({
          title: row.title,
          description: row.description,
          templateCode: row.template_code,
        }),
        checklist: normalizeTemplateChecklistPayload(row.checklist),
      };
    })
    .filter((row) => String(row.title || "").trim().toLowerCase() !== "daily plant check")
    .filter((row) => isChecklistTemplate(row));

  templateLibraryCache = {
    forms,
    cachedAt: Date.now(),
  };

  return { forms, error: null };
}

function stripTemplateRoutingMetadata(description) {
  const text = String(description || "");
  return text
    .replace(/^\s*\[Category:\s*[^\]]+\]\s*/i, "")
    .replace(/^\s*Category:\s*.+?\s*\|\s*/i, "")
    .replace(/\[RouteRules:\s*[^\]]*\]\s*/gi, "")
    .replace(/\[RouteType:\s*[^\]]+\]\s*/gi, "")
    .replace(/\[RouteEmail:\s*[^\]]*\]\s*/gi, "")
    .replace(/\[DriveFolder:\s*[^\]]*\]\s*/gi, "")
    .trim();
}

export default function ContractFormsScreen({ navigation, route }) {
  const isFocused = useIsFocused();
  const [contracts, setContracts] = useState([]);
  const [selectedContract, setSelectedContract] = useState(null);
  const [forms, setForms] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [copyingFormId, setCopyingFormId] = useState("");
  const entryPoint = String(route?.params?.entryPoint || "");
  const isPlantEntryPoint = entryPoint === "daily_plant_checks";

  useEffect(() => {
    if (isFocused) {
      if (isPlantEntryPoint) {
        fetchPlantAssignedForms({ showSpinner: false });
      } else if (selectedContract?.id) {
        fetchAssignedForms(selectedContract, { showSpinner: false });
      } else {
        fetchContracts({ showSpinner: false });
      }
    }
  }, [isFocused, selectedContract?.id, isPlantEntryPoint]);

  async function fetchContracts(options = {}) {
    const showSpinner = options.showSpinner !== false;
    const force = options.force === true;
    if (showSpinner) setRefreshing(true);
    setMessage("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const result = await loadAccessibleContractsForUser(user?.id, { force });
      if (result.error) {
        setMessage(result.error);
        setContracts([]);
        return;
      }
      const mapped = result.contracts || [];

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
        .select("id, form_template_id, is_active, form_templates(template_code, title, description, checklist)")
        .eq("contract_id", contract.id)
        .eq("is_active", true);

      if (error) {
        setMessage(error.message || "Could not load assigned forms.");
        setForms(FALLBACK_FORMS);
        return;
      }

      const mapped = (data || [])
        .map((row) => ({
          id: `${row.contract_id || contract.id || "contract"}:${row.form_template_id || row.id}`,
          templateCode: row.form_templates?.template_code || "PLANT_DAILY",
          title: row.form_templates?.title || "Plant Daily Checklist",
          detail:
            stripTemplateRoutingMetadata(row.form_templates?.description) ||
            "Complete daily roller checklist",
          category: resolveTemplateCategory({
            title: row.form_templates?.title,
            description: row.form_templates?.description,
            templateCode: row.form_templates?.template_code,
          }),
          checklist: normalizeTemplateChecklistPayload(row.form_templates?.checklist),
          contractId: contract.id,
          contractLocked: true,
          contractOptions: [
            {
              id: contract.id,
              contractNo: contract.contractNo || "-",
              contractName: contract.contractName || "Contract",
            },
          ],
        }))
        .filter((row) => Boolean(row.id) && !HIDDEN_TEMPLATE_CODES.has(String(row.templateCode || "").toLowerCase()));

      const isPlantEntryPoint = String(route?.params?.entryPoint || "") === "daily_plant_checks";
      const entryPointFiltered = isPlantEntryPoint
        ? mapped.filter((row) => isChecklistTemplate(row))
        : mapped;

      if (!isPlantEntryPoint) {
        if (!mapped.length) {
          setForms([]);
          setMessage("No templates assigned to this contract yet.");
          return;
        }
        setForms(mapped);
        return;
      }

      setForms(entryPointFiltered.length ? entryPointFiltered : []);

      if (isPlantEntryPoint && !entryPointFiltered.length) {
        const library = await loadChecklistTemplateLibrary();
        if (library.forms.length > 0) {
          const libraryForms = library.forms.map((row) => ({
            ...row,
            id: `${contract.id}:${row.templateCode}`,
            contractId: contract.id,
            contractNo: contract.contractNo,
            contractName: contract.contractName,
            detail: `${row.detail} | ${contract.contractName || "Contract"}`,
            contractLocked: true,
            contractOptions: [
              {
                id: contract.id,
                contractNo: contract.contractNo || "-",
                contractName: contract.contractName || "Contract",
              },
            ],
          }));
          setForms(libraryForms);
          setMessage("Showing Plant checklist templates.");
          return;
        }

        if (!mapped.length) {
          setMessage("No specific forms assigned.");
        } else if (isPlantEntryPoint && !entryPointFiltered.length) {
          setMessage("No Plant checklists are assigned for this contract. Showing default Plant checklist.");
        }
      }
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  async function fetchPlantAssignedForms(options = {}) {
    const showSpinner = options.showSpinner !== false;
    const force = options.force === true;
    if (showSpinner) setRefreshing(true);
    setMessage("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const result = await loadAccessibleContractsForUser(user?.id, { force });
      if (result.error) {
        setMessage(result.error);
        setContracts([]);
        setForms(FALLBACK_FORMS);
        return;
      }
      const mappedContracts = (result.contracts || []).map((row) => ({
        id: row.id,
        contractNo: row.contractNo || "-",
        contractName: row.contractName || "Contract",
      }));

      setContracts(mappedContracts);

      if (!mappedContracts.length) {
        setForms(FALLBACK_FORMS);
        setMessage("No contracts assigned to your account yet.");
        return;
      }
      const defaultContract = selectedContract?.id
        ? mappedContracts.find((row) => row.id === selectedContract.id) || mappedContracts[0]
        : mappedContracts[0];
      setSelectedContract(defaultContract || null);

      const library = await loadChecklistTemplateLibrary({ force });
      if (library.error) {
        setMessage(library.error.message || "Could not load checklist template library.");
        setForms(FALLBACK_FORMS);
        return;
      }

      const plantForms = (library.forms || []).map((row) => ({
        ...row,
        id: `${defaultContract?.id || "contract"}:${row.templateCode}`,
        contractId: defaultContract?.id || null,
        contractNo: defaultContract?.contractNo || "-",
        contractName: defaultContract?.contractName || "Contract",
        detail: row.detail,
        contractLocked: false,
        contractOptions: mappedContracts.map((contract) => ({
          id: contract.id,
          contractNo: contract.contractNo || "-",
          contractName: contract.contractName || "Contract",
        })),
      }));

      if (plantForms.length > 0) {
        setForms(plantForms);
        setMessage("Showing all Plant checklist templates.");
        return;
      }

      setForms(FALLBACK_FORMS);
      setMessage("No Plant checklist templates found in template library. Showing default Plant checklist.");
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  const showContractsLayer = useMemo(
    () => !selectedContract && !isPlantEntryPoint,
    [selectedContract, isPlantEntryPoint]
  );

  function openContract(contract) {
    setSelectedContract(contract);
    fetchAssignedForms(contract, { showSpinner: true });
  }

  function backToContracts() {
    if (isPlantEntryPoint) {
      navigation.goBack();
      return;
    }

    setSelectedContract(null);
    setForms([]);
    setMessage("");
  }

  function onPullRefresh() {
    if (isPlantEntryPoint) {
      fetchPlantAssignedForms({ showSpinner: true, force: true });
      return;
    }

    if (showContractsLayer) {
      fetchContracts({ showSpinner: true, force: true });
      return;
    }

    fetchAssignedForms(selectedContract, { showSpinner: true, force: true });
  }

  function buildFillFormPayload(item, launch) {
    const isContractLocked = item.contractLocked !== false;
    const lockedContractNo = selectedContract?.contractNo || item.contractNo;
    const lockedContractName = selectedContract?.contractName || item.contractName;
    const lockedContractId = selectedContract?.id || item.contractId || null;
    return {
      id: item.id,
      contractNo: isContractLocked ? lockedContractNo : "",
      contractName: isContractLocked ? lockedContractName : "",
      contractId: isContractLocked ? lockedContractId : null,
      title: item.title,
      templateCode: item.templateCode,
      checklist: Array.isArray(item?.checklist) ? item.checklist : [],
      contractLocked: isContractLocked,
      contractOptions: Array.isArray(item.contractOptions) ? item.contractOptions : [],
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
    const contractId = selectedContract?.id || item.contractId;
    if (!contractId) return;

    setCopyingFormId(item.id);
    try {
      const { data, error } = await supabase
        .from("roller_daily_checks")
        .select(
          "id, created_at, sheet_version, machine_type, machine_reg, asset_no, serial_no, machine_hours, checklist, notes"
        )
        .eq("contract_id", contractId)
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
          <Text style={styles.subtitle}>
            {entryPoint === "daily_plant_checks"
              ? "Plant Daily Checklists"
              : "Select a contract before choosing a template."}
          </Text>

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
            {!isPlantEntryPoint && (
              <View style={styles.headerMeta}>
                <Text style={styles.contractNo}>{selectedContract?.contractNo}</Text>
                <Text style={styles.formTitle}>{selectedContract?.contractName}</Text>
              </View>
            )}
          </View>

          <Text style={styles.title}>{entryPoint === "daily_plant_checks" ? "Plant Daily Checklists" : "Templates"}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <FlatList
            data={forms}
            keyExtractor={(item) => item.id}
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.formTitle}>{item.title}</Text>

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
