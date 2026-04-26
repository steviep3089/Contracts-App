import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Alert, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import SignatureScreen from "react-native-signature-canvas";
import NetInfo from "@react-native-community/netinfo";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../supabase";
import { enqueueOutboxItem, getOutboxCount, getOutboxItems, removeOutboxItem, updateOutboxItem } from "../services/outboxQueue";
import { isTransportError, syncNearMissSubmission, syncOutboxItem, syncSelfCertSubmission } from "../services/outboxSync";

export default function HomeScreen({ navigation }) {
  const [outboxCount, setOutboxCount] = useState(0);
  const [attentionCount, setAttentionCount] = useState(0);
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
  const [selfCertVisible, setSelfCertVisible] = useState(false);
  const [submittingSelfCert, setSubmittingSelfCert] = useState(false);
  const [selfCertName, setSelfCertName] = useState("");
  const [selfCertDepartment, setSelfCertDepartment] = useState("");
  const [selfCertRegions, setSelfCertRegions] = useState([]);
  const [departmentPickerOpen, setDepartmentPickerOpen] = useState(false);
  const [selfCertEmployeeNumber, setSelfCertEmployeeNumber] = useState("");
  const [selfCertFirstDayAbsence, setSelfCertFirstDayAbsence] = useState(new Date());
  const [showSelfCertFirstDayPicker, setShowSelfCertFirstDayPicker] = useState(false);
  const [selfCertWorkingDaysLost, setSelfCertWorkingDaysLost] = useState("");
  const [selfCertNotificationTo, setSelfCertNotificationTo] = useState("");
  const [selfCertReasonSymptoms, setSelfCertReasonSymptoms] = useState("");
  const [selfCertHadInjury, setSelfCertHadInjury] = useState(null);
  const [selfCertInjuryOccurred, setSelfCertInjuryOccurred] = useState(null);
  const [selfCertInjuryDetails, setSelfCertInjuryDetails] = useState("");
  const [selfCertSoughtMedicalAdvice, setSelfCertSoughtMedicalAdvice] = useState(null);
  const [selfCertConsultedDoctorAgain, setSelfCertConsultedDoctorAgain] = useState(null);
  const [selfCertVisitedHospital, setSelfCertVisitedHospital] = useState(null);
  const [selfCertEmployeeSignature, setSelfCertEmployeeSignature] = useState("");
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const signatureRef = useRef(null);
  const [hasSignatureStroke, setHasSignatureStroke] = useState(false);
  const isFocused = useIsFocused();

  const reportDateTimeLabel = useMemo(() => reportDateTime.toLocaleString(), [reportDateTime]);
  const selfCertFirstDayLabel = useMemo(() => selfCertFirstDayAbsence.toLocaleDateString(), [selfCertFirstDayAbsence]);

  const refreshOutboxCount = useCallback(async () => {
    const count = await getOutboxCount();
    setOutboxCount(count);
  }, []);

  const refreshAttentionCount = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      setAttentionCount(0);
      return;
    }

    const { count } = await supabase
      .from("self_cert_forms")
      .select("id", { count: "exact", head: true })
      .eq("line_manager_user_id", user.id)
      .eq("status", "pending_manager_approval");

    setAttentionCount(Number(count || 0));
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
          await syncOutboxItem(item);
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
    refreshAttentionCount();
    processOutbox();
  }, [isFocused, processOutbox, refreshOutboxCount, refreshAttentionCount]);

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
      data: { user: fetchedUser },
      error: userError,
    } = await supabase.auth.getUser();

    let user = fetchedUser;
    if (!user) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      user = session?.user || null;
    }

    if (userError) {
      Alert.alert("Session issue", userError.message || "Could not load signed-in user details.");
    }

    const [{ data: profile }, { data: personByUser }, { data: personByEmail }] = await Promise.all([
      user?.id
        ? supabase.from("user_profiles").select("full_name").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      user?.id
        ? supabase.from("people_directory").select("full_name").eq("portal_user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      user?.email
        ? supabase.from("people_directory").select("full_name").eq("email", user.email).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const metadata = user?.user_metadata || {};
    const emailPrefix = String(user?.email || "").split("@")[0] || "";
    const defaultName =
      String(profile?.full_name || "").trim() ||
      String(personByUser?.full_name || "").trim() ||
      String(personByEmail?.full_name || "").trim() ||
      String(metadata.display_name || "").trim() ||
      metadata.full_name ||
      metadata.name ||
      [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") ||
      emailPrefix ||
      String(user?.email || "").trim();

    const resolvedName = String(defaultName || "").trim() || String(reporterName || "").trim();

    setReportDateTime(new Date());
    setReporterName(resolvedName);
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

      const netState = await NetInfo.fetch();
      const isOnline = Boolean(netState.isConnected && netState.isInternetReachable);

      if (!isOnline) {
        await enqueueOutboxItem({
          type: "near-miss-submit",
          data: { payload },
          meta: { title: payload.site || "Near Miss" },
        });
        await refreshOutboxCount();
        setNearMissVisible(false);
        Alert.alert("Saved To Outbox", "No signal. Near miss queued and will sync automatically when online.");
        return;
      }

      await syncNearMissSubmission({ payload });

      setNearMissVisible(false);
      Alert.alert("Submitted", "Near miss report sent successfully.");
    } catch (error) {
      if (isTransportError(error)) {
        const payload = {
          reportedAt: reportDateTime.toISOString(),
          reporterName: reporterName.trim(),
          site: selectedSite.trim(),
          nearMissDetails: nearMissDetails.trim(),
          actionsTaken: actionsTaken.trim(),
          source: "contracts-app",
        };
        await enqueueOutboxItem({
          type: "near-miss-submit",
          data: { payload },
          meta: { title: payload.site || "Near Miss" },
        });
        await refreshOutboxCount();
        setNearMissVisible(false);
        Alert.alert("Saved To Outbox", "Network issue. Near miss queued and can be retried from Outbox.");
        return;
      }
      Alert.alert("Submission failed", String(error?.message || "Please try again."));
    } finally {
      setSubmittingNearMiss(false);
    }
  }

  async function openSelfCertModal() {
    setSelfCertName("");
    setSelfCertDepartment("");
    setSelfCertRegions([]);
    setDepartmentPickerOpen(false);
    setSelfCertEmployeeNumber("");
    setSelfCertFirstDayAbsence(new Date());
    setShowSelfCertFirstDayPicker(false);
    setSelfCertWorkingDaysLost("");
    setSelfCertNotificationTo("");
    setSelfCertReasonSymptoms("");
    setSelfCertHadInjury(null);
    setSelfCertInjuryOccurred(null);
    setSelfCertInjuryDetails("");
    setSelfCertSoughtMedicalAdvice(null);
    setSelfCertConsultedDoctorAgain(null);
    setSelfCertVisitedHospital(null);
    setSelfCertEmployeeSignature("");
    setShowSignatureModal(false);
    setSelfCertVisible(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const [{ data: profile }, { data: personByUser }] = await Promise.all([
        user?.id
          ? supabase
              .from("user_profiles")
              .select("full_name, regions, employee_number, line_manager_user_id")
              .eq("user_id", user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        user?.id
          ? supabase.from("people_directory").select("full_name").eq("portal_user_id", user.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      let managerName = "";
      if (profile?.line_manager_user_id) {
        const [{ data: managerProfile }, { data: managerDirectory }] = await Promise.all([
          supabase
            .from("user_profiles")
            .select("full_name")
            .eq("user_id", profile.line_manager_user_id)
            .maybeSingle(),
          supabase
            .from("people_directory")
            .select("full_name")
            .eq("portal_user_id", profile.line_manager_user_id)
            .maybeSingle(),
        ]);
        managerName = String(managerProfile?.full_name || managerDirectory?.full_name || "").trim();
      }

      const metadata = user?.user_metadata || {};
      const defaultName =
        String(profile?.full_name || "").trim() ||
        String(personByUser?.full_name || "").trim() ||
        String(metadata.display_name || "").trim() ||
        String(metadata.full_name || "").trim() ||
        [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") ||
        String(user?.email || "").split("@")[0];

      const regionOptions = Array.isArray(profile?.regions)
        ? Array.from(new Set(profile.regions.map((r) => String(r || "").trim()).filter(Boolean)))
        : [];
      const defaultDepartment = String(regionOptions[0] || "");

      setSelfCertName(defaultName || "");
      setSelfCertDepartment(defaultDepartment || "");
      setSelfCertRegions(regionOptions);
      setSelfCertEmployeeNumber(String(profile?.employee_number || ""));
      setSelfCertNotificationTo(managerName || "");
    } catch (error) {
      Alert.alert("Profile load warning", String(error?.message || "Could not prefill user details."));
    }
  }

  function onSelfCertFirstDayPicked(_event, selectedDate) {
    if (Platform.OS === "android") {
      setShowSelfCertFirstDayPicker(false);
    }
    if (!selectedDate) return;
    setSelfCertFirstDayAbsence(selectedDate);
  }

  async function submitSelfCert() {
    if (!selfCertName.trim()) {
      Alert.alert("Missing Name", "Please enter your name.");
      return;
    }
    if (!selfCertWorkingDaysLost.trim()) {
      Alert.alert("Missing Working Days Lost", "Please enter the number of working days lost.");
      return;
    }
    if (!selfCertReasonSymptoms.trim()) {
      Alert.alert("Missing Reason", "Please add reason for absence and symptoms.");
      return;
    }
    if (selfCertHadInjury === true && !selfCertInjuryDetails.trim()) {
      Alert.alert("Injury Details Required", "Please explain how the injury occurred.");
      return;
    }
    if (selfCertHadInjury === true && selfCertInjuryOccurred === null) {
      Alert.alert("Missing Answer", "Please confirm whether the injury happened at work.");
      return;
    }
    if (!selfCertEmployeeSignature.trim()) {
      Alert.alert("Signature Required", "Please enter employee signature.");
      return;
    }

    setSubmittingSelfCert(true);
    try {
      const payload = {
        name: selfCertName.trim(),
        department: selfCertDepartment.trim(),
        employeeNumber: selfCertEmployeeNumber.trim(),
        firstDayOfAbsence: selfCertFirstDayAbsence.toISOString().slice(0, 10),
        workingDaysLost: Number(selfCertWorkingDaysLost),
        notificationOfAbsenceMadeTo: selfCertNotificationTo.trim(),
        reasonAndSymptoms: selfCertReasonSymptoms.trim(),
        injuryOccurred: selfCertHadInjury === true ? selfCertInjuryOccurred === true : false,
        injuryDetails: selfCertHadInjury === true ? selfCertInjuryDetails.trim() : "No injury reported",
        soughtMedicalAdvice: selfCertSoughtMedicalAdvice === true,
        consultedDoctorAgain: selfCertConsultedDoctorAgain === true,
        visitedHospitalOrClinic: selfCertVisitedHospital === true,
        employeeSignature: selfCertEmployeeSignature.trim(),
      };

      const netState = await NetInfo.fetch();
      const isOnline = Boolean(netState.isConnected && netState.isInternetReachable);

      if (!isOnline) {
        await enqueueOutboxItem({
          type: "self-cert-submit",
          data: { payload },
          meta: { title: payload.name || "Self Cert" },
        });
        await refreshOutboxCount();
        setSelfCertVisible(false);
        Alert.alert("Saved To Outbox", "No signal. Self cert queued and will sync automatically when online.");
        return;
      }

      await syncSelfCertSubmission({ payload });

      setSelfCertVisible(false);
      Alert.alert("Submitted", "Self cert submitted. Your line manager has been notified.");
      refreshAttentionCount();
    } catch (error) {
      if (isTransportError(error)) {
        const payload = {
          name: selfCertName.trim(),
          department: selfCertDepartment.trim(),
          employeeNumber: selfCertEmployeeNumber.trim(),
          firstDayOfAbsence: selfCertFirstDayAbsence.toISOString().slice(0, 10),
          workingDaysLost: Number(selfCertWorkingDaysLost),
          notificationOfAbsenceMadeTo: selfCertNotificationTo.trim(),
          reasonAndSymptoms: selfCertReasonSymptoms.trim(),
          injuryOccurred: selfCertHadInjury === true ? selfCertInjuryOccurred === true : false,
          injuryDetails: selfCertHadInjury === true ? selfCertInjuryDetails.trim() : "No injury reported",
          soughtMedicalAdvice: selfCertSoughtMedicalAdvice === true,
          consultedDoctorAgain: selfCertConsultedDoctorAgain === true,
          visitedHospitalOrClinic: selfCertVisitedHospital === true,
          employeeSignature: selfCertEmployeeSignature.trim(),
        };
        await enqueueOutboxItem({
          type: "self-cert-submit",
          data: { payload },
          meta: { title: payload.name || "Self Cert" },
        });
        await refreshOutboxCount();
        setSelfCertVisible(false);
        Alert.alert("Saved To Outbox", "Network issue. Self cert queued and can be retried from Outbox.");
        return;
      }
      Alert.alert("Submission failed", String(error?.message || "Please try again."));
    } finally {
      setSubmittingSelfCert(false);
    }
  }

  function handleSignatureConfirm(signatureDataUrl) {
    if (!signatureDataUrl || signatureDataUrl === "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB") {
      Alert.alert("Signature Required", "Please sign in the box before saving.");
      return;
    }

    setSelfCertEmployeeSignature(signatureDataUrl);
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

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.attentionButton} onPress={() => navigation.navigate("SelfCertApprovals") }>
        <Ionicons name="notifications-outline" size={22} color="#0f172a" />
        {attentionCount > 0 ? (
          <View style={styles.attentionBadge}>
            <Text style={styles.badgeText}>{attentionCount > 99 ? "99+" : String(attentionCount)}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

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

      <TouchableOpacity
        style={styles.buttonQuaternary}
        onPress={() => navigation.navigate("ContractForms", { entryPoint: "daily_plant_checks" })}
      >
        <Text style={styles.buttonQuaternaryText}>Plant Daily Checklists</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.buttonSecondary} onPress={openNearMissModal}>
        <Text style={styles.buttonSecondaryText}>Report A Near Miss</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.buttonTertiary} onPress={openSelfCertModal}>
        <Text style={styles.buttonTertiaryText}>Self Cert</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.bottomTabButton}
        onPress={() => navigation.navigate("MyDocuments")}
      >
        <Ionicons name="documents-outline" size={18} color="#0f172a" />
        <Text style={styles.bottomTabButtonText}>My Documents</Text>
      </TouchableOpacity>

      <Modal visible={nearMissVisible} transparent animationType="slide" onRequestClose={() => setNearMissVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Report A Near Miss</Text>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              scrollEnabled={!showSignatureModal}
            >
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
                  <TouchableOpacity style={styles.pickerCloseButton} onPress={() => setShowDatePicker(false)}>
                    <Ionicons name="close" size={16} color="#334155" />
                  </TouchableOpacity>
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
                  <TouchableOpacity style={styles.pickerCloseButton} onPress={() => setShowTimePicker(false)}>
                    <Ionicons name="close" size={16} color="#334155" />
                  </TouchableOpacity>
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

      <Modal visible={selfCertVisible} transparent animationType="slide" onRequestClose={() => setSelfCertVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Self Cert</Text>
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput style={styles.input} value={selfCertName} onChangeText={setSelfCertName} placeholder="Employee name" />

              <Text style={styles.fieldLabel}>Department</Text>
              {selfCertRegions.length > 1 ? (
                <>
                  <TouchableOpacity style={styles.selectButton} onPress={() => setDepartmentPickerOpen((prev) => !prev)}>
                    <Text style={selfCertDepartment ? styles.selectButtonText : styles.selectPlaceholder}>
                      {selfCertDepartment || "Select department"}
                    </Text>
                    <Ionicons name={departmentPickerOpen ? "chevron-up" : "chevron-down"} size={16} color="#334155" />
                  </TouchableOpacity>
                  {departmentPickerOpen ? (
                    <View style={styles.siteListWrap}>
                      <ScrollView nestedScrollEnabled style={styles.siteList}>
                        {selfCertRegions.map((region) => (
                          <TouchableOpacity
                            key={region}
                            style={styles.siteRow}
                            onPress={() => {
                              setSelfCertDepartment(region);
                              setDepartmentPickerOpen(false);
                            }}
                          >
                            <Text style={styles.siteRowText}>{region}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}
                </>
              ) : (
                <TextInput
                  style={styles.input}
                  value={selfCertDepartment}
                  onChangeText={setSelfCertDepartment}
                  placeholder="Region / Department"
                />
              )}

              <Text style={styles.fieldLabel}>Employee Number</Text>
              <TextInput
                style={styles.input}
                value={selfCertEmployeeNumber}
                onChangeText={setSelfCertEmployeeNumber}
                placeholder="Employee number"
              />

              <Text style={styles.fieldLabel}>First day of absence</Text>
              <TextInput style={[styles.input, styles.readOnlyInput]} value={selfCertFirstDayLabel} editable={false} />
              <View style={styles.dateTimeRow}>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowSelfCertFirstDayPicker(true)}>
                  <Text style={styles.dateTimeButtonText}>Change Date</Text>
                </TouchableOpacity>
              </View>
              {showSelfCertFirstDayPicker ? (
                <View style={styles.pickerWrap}>
                  <TouchableOpacity style={styles.pickerCloseButton} onPress={() => setShowSelfCertFirstDayPicker(false)}>
                    <Ionicons name="close" size={16} color="#334155" />
                  </TouchableOpacity>
                  <DateTimePicker
                    value={selfCertFirstDayAbsence}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={onSelfCertFirstDayPicked}
                  />
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>Working days lost</Text>
              <TextInput
                style={styles.input}
                value={selfCertWorkingDaysLost}
                onChangeText={setSelfCertWorkingDaysLost}
                placeholder="e.g. 2"
                keyboardType="number-pad"
              />

              <Text style={styles.fieldLabel}>Notification of absence made to</Text>
              <TextInput
                style={styles.input}
                value={selfCertNotificationTo}
                onChangeText={setSelfCertNotificationTo}
                placeholder="Line manager"
              />

              <Text style={styles.fieldLabel}>Reason for absence and symptoms</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={selfCertReasonSymptoms}
                onChangeText={setSelfCertReasonSymptoms}
                placeholder="Describe reason and symptoms"
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.fieldLabel}>Was there an injury?</Text>
              <View style={styles.yesNoRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertHadInjury === true && styles.toggleButtonActive]}
                  onPress={() => setSelfCertHadInjury(true)}
                >
                  <Text style={[styles.toggleText, selfCertHadInjury === true && styles.toggleTextActive]}>Yes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertHadInjury === false && styles.toggleButtonActive]}
                  onPress={() => {
                    setSelfCertHadInjury(false);
                    setSelfCertInjuryOccurred(false);
                    setSelfCertInjuryDetails("");
                  }}
                >
                  <Text style={[styles.toggleText, selfCertHadInjury === false && styles.toggleTextActive]}>No</Text>
                </TouchableOpacity>
              </View>
              {selfCertHadInjury === true ? (
                <>
                  <Text style={styles.fieldLabel}>If an injury, specify how it occurred</Text>
                  <TextInput
                    style={[styles.input, styles.multilineInput]}
                    value={selfCertInjuryDetails}
                    onChangeText={setSelfCertInjuryDetails}
                    placeholder="Injury details"
                    multiline
                    textAlignVertical="top"
                  />
                </>
              ) : null}

              <Text style={styles.fieldLabel}>Did it happen at work?</Text>
              <View style={styles.yesNoRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertInjuryOccurred === true && styles.toggleButtonActive]}
                  onPress={() => setSelfCertInjuryOccurred(true)}
                >
                  <Text style={[styles.toggleText, selfCertInjuryOccurred === true && styles.toggleTextActive]}>Yes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertInjuryOccurred === false && styles.toggleButtonActive]}
                  onPress={() => setSelfCertInjuryOccurred(false)}
                >
                  <Text style={[styles.toggleText, selfCertInjuryOccurred === false && styles.toggleTextActive]}>No</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Did you seek medical advice?</Text>
              <View style={styles.yesNoRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertSoughtMedicalAdvice === true && styles.toggleButtonActive]}
                  onPress={() => setSelfCertSoughtMedicalAdvice(true)}
                >
                  <Text style={[styles.toggleText, selfCertSoughtMedicalAdvice === true && styles.toggleTextActive]}>Yes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertSoughtMedicalAdvice === false && styles.toggleButtonActive]}
                  onPress={() => setSelfCertSoughtMedicalAdvice(false)}
                >
                  <Text style={[styles.toggleText, selfCertSoughtMedicalAdvice === false && styles.toggleTextActive]}>No</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Did you consult your doctor again?</Text>
              <View style={styles.yesNoRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertConsultedDoctorAgain === true && styles.toggleButtonActive]}
                  onPress={() => setSelfCertConsultedDoctorAgain(true)}
                >
                  <Text style={[styles.toggleText, selfCertConsultedDoctorAgain === true && styles.toggleTextActive]}>Yes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertConsultedDoctorAgain === false && styles.toggleButtonActive]}
                  onPress={() => setSelfCertConsultedDoctorAgain(false)}
                >
                  <Text style={[styles.toggleText, selfCertConsultedDoctorAgain === false && styles.toggleTextActive]}>No</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Did you visit a Hospital or Clinic?</Text>
              <View style={styles.yesNoRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertVisitedHospital === true && styles.toggleButtonActive]}
                  onPress={() => setSelfCertVisitedHospital(true)}
                >
                  <Text style={[styles.toggleText, selfCertVisitedHospital === true && styles.toggleTextActive]}>Yes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, selfCertVisitedHospital === false && styles.toggleButtonActive]}
                  onPress={() => setSelfCertVisitedHospital(false)}
                >
                  <Text style={[styles.toggleText, selfCertVisitedHospital === false && styles.toggleTextActive]}>No</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Employee signature</Text>
              <TouchableOpacity style={styles.signatureInputButton} onPress={() => setShowSignatureModal(true)}>
                <Text style={selfCertEmployeeSignature ? styles.selectButtonText : styles.selectPlaceholder}>
                  {selfCertEmployeeSignature ? "Signature captured (tap to re-sign)" : "Tap to sign on screen"}
                </Text>
                <Ionicons name="create-outline" size={16} color="#334155" />
              </TouchableOpacity>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setSelfCertVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitButton} onPress={submitSelfCert} disabled={submittingSelfCert}>
                <Text style={styles.submitButtonText}>{submittingSelfCert ? "Submitting..." : "Submit"}</Text>
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
                  <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.cancelButton} onPress={handleSignatureClearPress}>
                      <Text style={styles.cancelButtonText}>Clear</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.submitButton} onPress={handleSignatureSavePress}>
                      <Text style={styles.submitButtonText}>Save Signature</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cancelButton} onPress={() => setShowSignatureModal(false)}>
                      <Text style={styles.cancelButtonText}>Cancel</Text>
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
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 78,
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
  attentionButton: {
    position: "absolute",
    top: 16,
    left: 16,
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
  attentionBadge: {
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
  buttonQuaternary: {
    backgroundColor: "#14532d",
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginBottom: 12,
    width: "90%",
  },
  buttonQuaternaryText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  buttonTertiary: {
    backgroundColor: "#1d4ed8",
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginBottom: 12,
    width: "90%",
  },
  buttonTertiaryText: {
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
  bottomTabButton: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  bottomTabButtonText: {
    color: "#0f172a",
    fontWeight: "700",
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
    position: "relative",
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
  helperText: {
    color: "#64748b",
    fontSize: 14,
    marginBottom: 10,
  },
  yesNoRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  toggleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  toggleButtonActive: {
    borderColor: "#1d4ed8",
    backgroundColor: "#dbeafe",
  },
  toggleText: {
    color: "#334155",
    fontWeight: "600",
  },
  toggleTextActive: {
    color: "#1e40af",
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
    paddingTop: 20,
    backgroundColor: "#fff",
    position: "relative",
  },
  pickerCloseButton: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
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
  signatureModalCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    overflow: "hidden",
    width: "96%",
    maxWidth: 760,
    height: "52%",
    minHeight: 280,
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
  signatureCanvasWrap: {
    flex: 1,
    minHeight: 180,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#fff",
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
