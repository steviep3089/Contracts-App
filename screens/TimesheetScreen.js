import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import SignatureScreen from "react-native-signature-canvas";
import { supabase } from "../supabase";

const DAY_NAMES = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
const SHIFT_TYPES = ["Days", "Nights"];
const OVERNIGHT_OPTIONS = ["No", "Yes"];
const DEFAULT_START_TIME = "07:00";
const DEFAULT_END_TIME = "17:00";

function toIsoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatDisplayDate(isoDate) {
  const d = parseIsoDate(isoDate);
  if (!d) return "-";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getClosestThursday(baseDate = new Date()) {
  const base = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const day = base.getDay();
  const toPrevThursday = -((day - 4 + 7) % 7);
  const toNextThursday = (4 - day + 7) % 7;
  const prev = addDays(base, toPrevThursday);
  const next = addDays(base, toNextThursday);

  const prevDiff = Math.abs(prev.getTime() - base.getTime());
  const nextDiff = Math.abs(next.getTime() - base.getTime());
  return nextDiff < prevDiff ? next : prev;
}

function buildWeekEndingOptions(baseDate = new Date()) {
  const closest = getClosestThursday(baseDate);
  const optionDates = [addDays(closest, -7), closest, addDays(closest, 7), addDays(closest, 14)];
  return optionDates.map((d) => {
    const iso = toIsoDate(d);
    return {
      value: iso,
      label: formatDisplayDate(iso),
    };
  });
}

function parseTimeToMinutes(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutesAsTime(totalMinutes) {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, Number(totalMinutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function roundMinutesToQuarter(minutes) {
  if (!Number.isFinite(minutes)) return 0;
  const rounded = Math.round(minutes / 15) * 15;
  if (rounded >= 24 * 60) return 24 * 60 - 15;
  if (rounded < 0) return 0;
  return rounded;
}

function toDateFromTime(value, fallbackTime = DEFAULT_START_TIME) {
  const parsed = parseTimeToMinutes(value);
  const fallback = parseTimeToMinutes(fallbackTime) ?? 0;
  const minutes = parsed ?? fallback;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

function computeDurationHours(startTime, endTime) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null) return 0;
  let duration = endMinutes - startMinutes;
  if (duration < 0) duration += 24 * 60;
  return duration / 60;
}

function alignTravelStartBeforeShift(travelStartMinutes, shiftStartAbsMinutes) {
  const candidates = [
    travelStartMinutes - 24 * 60,
    travelStartMinutes,
    travelStartMinutes + 24 * 60,
  ];
  const valid = candidates.filter((value) => value <= shiftStartAbsMinutes);
  if (valid.length > 0) return Math.max(...valid);
  return Math.min(...candidates);
}

function alignTravelEndAfterShift(travelEndMinutes, shiftEndAbsMinutes) {
  const candidates = [
    travelEndMinutes,
    travelEndMinutes + 24 * 60,
    travelEndMinutes + 48 * 60,
  ];
  const valid = candidates.filter((value) => value >= shiftEndAbsMinutes);
  if (valid.length > 0) return Math.min(...valid);
  return Math.max(...candidates);
}

function computeTravelHoursFromShiftEnvelope(startTime, endTime, travelStartTime, travelEndTime) {
  const shiftStart = parseTimeToMinutes(startTime);
  const shiftEnd = parseTimeToMinutes(endTime);
  const travelStart = parseTimeToMinutes(travelStartTime);
  const travelEnd = parseTimeToMinutes(travelEndTime);
  if (shiftStart === null || shiftEnd === null || travelStart === null || travelEnd === null) return 0;

  const shiftStartAbs = shiftStart;
  const shiftEndAbs = shiftEnd >= shiftStart ? shiftEnd : shiftEnd + 24 * 60;
  const travelStartAbs = alignTravelStartBeforeShift(travelStart, shiftStartAbs);
  const travelEndAbs = alignTravelEndAfterShift(travelEnd, shiftEndAbs);

  const preShiftTravelMinutes = Math.max(0, shiftStartAbs - travelStartAbs);
  const postShiftTravelMinutes = Math.max(0, travelEndAbs - shiftEndAbs);
  return (preShiftTravelMinutes + postShiftTravelMinutes) / 60;
}

function toSafeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function isMissingTableError(error, tableName) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  const expected = String(tableName || "").toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  if (expected && message.includes(`could not find the table '${expected}'`)) return true;
  if (expected && message.includes(`relation "${expected}" does not exist`)) return true;
  return false;
}

function buildEntry(overrides = {}) {
  return {
    day: "Friday",
    contractNumber: "",
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
    travelStartTime: DEFAULT_START_TIME,
    travelEndTime: DEFAULT_END_TIME,
    shiftType: "Days",
    travelPayment: "0",
    bonusOtherPayments: "0",
    overnightAllowance: "No",
    payrollHoursPaid: "",
    havsPoints: "0",
    plantUsedTypeTimes: "",
    bonusPaymentJustification: "",
    ...overrides,
  };
}

function nextDayName(day) {
  const idx = DAY_NAMES.indexOf(String(day || ""));
  if (idx < 0) return "Friday";
  return DAY_NAMES[(idx + 1) % DAY_NAMES.length];
}

function summarizeTimesheetTotals(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  const totals = rows.reduce(
    (acc, row) => {
      const site = Math.max(0, computeDurationHours(row?.startTime, row?.endTime));
      const travel = Math.max(
        0,
        computeTravelHoursFromShiftEnvelope(
          row?.startTime,
          row?.endTime,
          row?.travelStartTime,
          row?.travelEndTime
        )
      );
      const payroll = String(row?.payrollHoursPaid || "").trim()
        ? Math.max(0, toSafeNumber(row?.payrollHoursPaid))
        : site + travel;
      return {
        site: acc.site + site,
        travel: acc.travel + travel,
        payroll: acc.payroll + payroll,
      };
    },
    { site: 0, travel: 0, payroll: 0 }
  );

  return {
    totalSiteHours: Number(totals.site.toFixed(2)),
    totalTravelHours: Number(totals.travel.toFixed(2)),
    totalHours: Number((totals.site + totals.travel).toFixed(2)),
    totalPayrollHoursPaid: Number(totals.payroll.toFixed(2)),
  };
}

function computeAutoPayrollHoursForRow(row) {
  const site = computeDurationHours(row?.startTime, row?.endTime);
  const travel = computeTravelHoursFromShiftEnvelope(
    row?.startTime,
    row?.endTime,
    row?.travelStartTime,
    row?.travelEndTime
  );
  return Math.max(0, site + travel);
}

export default function TimesheetScreen({ navigation }) {
  const [saving, setSaving] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const [employeeName, setEmployeeName] = useState("");
  const [department, setDepartment] = useState("");
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [weekEnding, setWeekEnding] = useState(() => {
    const options = buildWeekEndingOptions(new Date());
    return options[1]?.value || options[0]?.value || toIsoDate(new Date());
  });
  const [weekEndingOptions, setWeekEndingOptions] = useState(() => buildWeekEndingOptions(new Date()));

  const [entries, setEntries] = useState([buildEntry({ day: "Friday" })]);
  const [notes, setNotes] = useState("");

  const [contractOptions, setContractOptions] = useState([]);

  const [selectorState, setSelectorState] = useState({
    visible: false,
    title: "",
    options: [],
    onSelect: null,
  });

  const [timePickerState, setTimePickerState] = useState({
    visible: false,
    rowIndex: -1,
    field: "",
    value: new Date(),
  });

  const [employeeSignature, setEmployeeSignature] = useState("");
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [hasSignatureStroke, setHasSignatureStroke] = useState(false);
  const signatureRef = useRef(null);
  const [lineManagerUserId, setLineManagerUserId] = useState(null);
  const [lineManagerName, setLineManagerName] = useState("");
  const [lineManagerEmail, setLineManagerEmail] = useState("");

  const totals = useMemo(() => summarizeTimesheetTotals(entries), [entries]);

  const contractLabelByNumber = useMemo(() => {
    const map = new Map();
    (contractOptions || []).forEach((item) => {
      const key = String(item.contractNo || "").trim();
      if (!key) return;
      map.set(key, key + (item.contractName ? ` - ${item.contractName}` : ""));
    });
    return map;
  }, [contractOptions]);

  useEffect(() => {
    loadProfileDefaults();
    loadContracts();
  }, []);

  async function loadContracts() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) return;

      const [contractsRes, roleRes, teamRes, legacyAssignmentsRes, directoryRoleRes] = await Promise.all([
        supabase
          .from("contracts")
          .select("id, name, contract_name, contract_number, status")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase.from("app_user_roles").select("role").eq("user_id", user.id).maybeSingle(),
        supabase.from("contract_team_roles").select("contract_id").eq("user_id", user.id),
        supabase.from("user_contracts").select("contract_id").eq("user_id", user.id),
        supabase.from("people_directory").select("authority").eq("portal_user_id", user.id).maybeSingle(),
      ]);

      const legacyMissing = isMissingTableError(legacyAssignmentsRes.error, "public.user_contracts");
      const legacyError = legacyMissing ? null : legacyAssignmentsRes.error;

      if (contractsRes.error || roleRes.error || teamRes.error || legacyError) {
        return;
      }

      const authority = String(directoryRoleRes.data?.authority || "").trim().toLowerCase();
      const fallbackRole = authority === "admin" || authority === "manager" ? authority : "viewer";
      const role = String(roleRes.data?.role || fallbackRole).toLowerCase();
      const isPrivileged = role === "admin" || role === "manager";
      const assignedIds = new Set([
        ...(teamRes.data || []).map((row) => row.contract_id),
        ...(legacyAssignmentsRes.data || []).map((row) => row.contract_id),
      ]);

      const visible = (contractsRes.data || []).filter((row) => {
        const status = String(row.status || "").toLowerCase();
        const isLive = status === "active" || status === "live" || status === "open";
        if (!isLive) return false;
        if (isPrivileged) return true;
        if (assignedIds.size === 0) return true;
        return assignedIds.has(row.id);
      });

      const mapped = visible
        .map((row) => ({
          id: row.id,
          contractNo: String(row.contract_number || "").trim(),
          contractName: String(row.name || row.contract_name || "").trim(),
        }))
        .filter((row) => row.contractNo);

      setContractOptions(mapped);
    } catch {
      // Keep screen usable without blocking.
    }
  }

  async function loadProfileDefaults() {
    setLoadingProfile(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) return;

      const [profileRes, personRes] = await Promise.all([
        supabase
          .from("user_profiles")
          .select("full_name, employee_number, line_manager_user_id, regions")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("people_directory")
          .select("full_name, email, authority, line_manager_name, line_manager_email")
          .eq("portal_user_id", user.id)
          .maybeSingle(),
      ]);

      const resolvedName =
        String(profileRes?.data?.full_name || "").trim() ||
        String(personRes?.data?.full_name || "").trim() ||
        String(user.user_metadata?.full_name || "").trim() ||
        String(user.email || "").split("@")[0];

      const regions = Array.isArray(profileRes?.data?.regions)
        ? profileRes.data.regions.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const authority = String(personRes?.data?.authority || "").trim();
      const options = Array.from(new Set([...(regions || []), authority].filter(Boolean)));

      setDepartmentOptions(options);
      setDepartment((prev) => prev || options[0] || authority || "National Plant");
      setEmployeeName((prev) => prev || resolvedName || "");
      setEmployeeNumber((prev) => prev || String(profileRes?.data?.employee_number || "").trim());
      setLineManagerUserId(profileRes?.data?.line_manager_user_id || null);
      setLineManagerName(String(personRes?.data?.line_manager_name || "").trim());
      setLineManagerEmail(String(personRes?.data?.line_manager_email || "").trim());

      const refreshedWeekOptions = buildWeekEndingOptions(new Date());
      setWeekEndingOptions(refreshedWeekOptions);
      if (!refreshedWeekOptions.some((opt) => opt.value === weekEnding)) {
        setWeekEnding(refreshedWeekOptions[1]?.value || refreshedWeekOptions[0]?.value || weekEnding);
      }
    } catch {
      // Non-blocking.
    } finally {
      setLoadingProfile(false);
    }
  }

  function updateEntry(index, field, value) {
    setEntries((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function openSelector(title, options, onSelect) {
    setSelectorState({ visible: true, title, options, onSelect });
  }

  function closeSelector() {
    setSelectorState({ visible: false, title: "", options: [], onSelect: null });
  }

  function openDepartmentPicker() {
    const options = (departmentOptions || []).map((item) => ({ value: item, label: item }));
    if (options.length === 0) {
      Alert.alert("No Departments", "No assigned departments found for your account.");
      return;
    }
    openSelector("Select Department", options, (value) => setDepartment(String(value || "")));
  }

  function openWeekEndingPicker() {
    const options = (weekEndingOptions || []).map((item) => ({ value: item.value, label: item.label }));
    openSelector("Select Week Ending (Thursday)", options, (value) => setWeekEnding(String(value || "")));
  }

  function openDayPicker(rowIndex) {
    openSelector(
      `Select Day (${rowIndex + 1})`,
      DAY_NAMES.map((day) => ({ value: day, label: day })),
      (value) => updateEntry(rowIndex, "day", String(value || "Friday"))
    );
  }

  function openContractPicker(rowIndex) {
    const options = (contractOptions || []).map((item) => ({
      value: item.contractNo,
      label: item.contractNo + (item.contractName ? ` - ${item.contractName}` : ""),
    }));

    if (options.length === 0) {
      Alert.alert("No Live Contracts", "No active contracts available for your account.");
      return;
    }

    openSelector("Select Contract", options, (value) => updateEntry(rowIndex, "contractNumber", String(value || "")));
  }

  function openSimpleFieldPicker(rowIndex, field, title, values) {
    openSelector(
      title,
      values.map((value) => ({ value, label: value })),
      (value) => updateEntry(rowIndex, field, String(value || ""))
    );
  }

  function openTimePicker(rowIndex, field, fallback) {
    const current = entries?.[rowIndex]?.[field];
    setTimePickerState({
      visible: true,
      rowIndex,
      field,
      value: toDateFromTime(current, fallback),
    });
  }

  function closeTimePicker() {
    setTimePickerState({ visible: false, rowIndex: -1, field: "", value: new Date() });
  }

  function onTimePickerChange(_event, selectedDate) {
    if (!selectedDate) return;

    const d = new Date(selectedDate);
    const minutes = roundMinutesToQuarter(d.getHours() * 60 + d.getMinutes());
    const snapped = new Date(d);
    snapped.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

    setTimePickerState((prev) => ({
      ...prev,
      value: snapped,
    }));

    if (Platform.OS === "android") {
      const formatted = formatMinutesAsTime(minutes);
      updateEntry(timePickerState.rowIndex, timePickerState.field, formatted);
      closeTimePicker();
    }
  }

  function confirmTimePicker() {
    const d = timePickerState.value;
    const minutes = roundMinutesToQuarter(d.getHours() * 60 + d.getMinutes());
    updateEntry(timePickerState.rowIndex, timePickerState.field, formatMinutesAsTime(minutes));
    closeTimePicker();
  }

  function addCopiedDay() {
    setEntries((prev) => {
      const last = prev[prev.length - 1] || buildEntry();
      const next = {
        ...last,
        day: nextDayName(last.day),
      };
      return [...prev, next];
    });
  }

  function addNewDay() {
    setEntries((prev) => {
      const last = prev[prev.length - 1] || buildEntry();
      const next = buildEntry({
        day: nextDayName(last.day),
        contractNumber: "",
        startTime: "",
        endTime: "",
        travelStartTime: "",
        travelEndTime: "",
        payrollHoursPaid: "",
      });
      return [...prev, next];
    });
  }

  function removeDay(index) {
    setEntries((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  function openSignatureModal() {
    setShowSignatureModal(true);
    setHasSignatureStroke(false);
  }

  function handleSignatureOk(signature) {
    setEmployeeSignature(signature);
    setShowSignatureModal(false);
  }

  function handleSignatureEnd() {
    setHasSignatureStroke(true);
  }

  function handleSignatureConfirm() {
    if (!hasSignatureStroke) {
      Alert.alert("Signature Required", "Please sign before confirming.");
      return;
    }
    signatureRef.current?.readSignature();
  }

  function handleSignatureClearPress() {
    signatureRef.current?.clearSignature();
    setHasSignatureStroke(false);
  }

  function buildDbEntries() {
    return entries.map((row) => ({
      day: row.day,
      contractNumber: String(row.contractNumber || "").trim(),
      startTime: String(row.startTime || "").trim(),
      endTime: String(row.endTime || "").trim(),
      siteHours: Math.max(0, computeDurationHours(row.startTime, row.endTime)).toFixed(2),
      travelStartTime: String(row.travelStartTime || "").trim(),
      travelEndTime: String(row.travelEndTime || "").trim(),
      shiftType: String(row.shiftType || "Days").trim().toLowerCase(),
      travelPayment: String(row.travelPayment || "0").trim(),
      bonusOtherPayments: String(row.bonusOtherPayments || "0").trim(),
      overnightAllowance: String(row.overnightAllowance || "No").trim().toLowerCase(),
      payrollHoursPaid:
        String(row.payrollHoursPaid || "").trim() ||
        String(
          (
            computeDurationHours(row.startTime, row.endTime) +
            computeTravelHoursFromShiftEnvelope(row.startTime, row.endTime, row.travelStartTime, row.travelEndTime)
          ).toFixed(2)
        ),
      havsPoints: String(row.havsPoints || "0").trim(),
      plantUsedTypeTimes: String(row.plantUsedTypeTimes || "").trim(),
      bonusPaymentJustification: String(row.bonusPaymentJustification || "").trim(),
    }));
  }

  function hasAnyShiftData(row) {
    return Boolean(String(row.startTime || "").trim() || String(row.endTime || "").trim());
  }

  function validateBeforeSubmit() {
    if (!employeeName.trim()) {
      Alert.alert("Missing Field", "Employee name is required.");
      return false;
    }
    if (!department.trim()) {
      Alert.alert("Missing Field", "Department is required.");
      return false;
    }
    if (!weekEnding) {
      Alert.alert("Missing Field", "Week ending is required.");
      return false;
    }
    if (!employeeSignature) {
      Alert.alert("Missing Signature", "Employee signature is required.");
      return false;
    }

    for (const row of entries) {
      if (hasAnyShiftData(row) && !String(row.contractNumber || "").trim()) {
        Alert.alert("Missing Contract Number", `Select contract number for ${row.day} when shift times are set.`);
        return false;
      }

      if (String(row.startTime || "").trim() && parseTimeToMinutes(row.startTime) === null) {
        Alert.alert("Invalid Time", `${row.day}: start time must be HH:MM.`);
        return false;
      }
      if (String(row.endTime || "").trim() && parseTimeToMinutes(row.endTime) === null) {
        Alert.alert("Invalid Time", `${row.day}: end time must be HH:MM.`);
        return false;
      }
      if (String(row.travelStartTime || "").trim() && parseTimeToMinutes(row.travelStartTime) === null) {
        Alert.alert("Invalid Time", `${row.day}: travel start must be HH:MM.`);
        return false;
      }
      if (String(row.travelEndTime || "").trim() && parseTimeToMinutes(row.travelEndTime) === null) {
        Alert.alert("Invalid Time", `${row.day}: travel end must be HH:MM.`);
        return false;
      }
    }
    return true;
  }

  async function submitTimesheet() {
    if (!validateBeforeSubmit()) return;

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        Alert.alert("Auth Error", "Please sign in again.");
        return;
      }

      const payloadEntries = buildDbEntries();
      const { totalSiteHours, totalTravelHours, totalHours } = summarizeTimesheetTotals(payloadEntries);
      const totalPayroll = payloadEntries.reduce((sum, row) => sum + Math.max(0, toSafeNumber(row.payrollHoursPaid)), 0);

      const { error } = await supabase.from("timesheet_forms").insert({
        user_id: user.id,
        employee_name: employeeName.trim(),
        department: department.trim() || null,
        employee_number: employeeNumber.trim() || null,
        week_commencing: weekEnding,
        entries: payloadEntries,
        total_regular_hours: Number(totalSiteHours.toFixed(2)),
        total_overtime_hours: Number(totalTravelHours.toFixed(2)),
        total_break_hours: 0,
        total_hours: Number(totalHours.toFixed(2)),
        notes: notes.trim() || null,
        employee_signature: employeeSignature,
        employee_signed_at: new Date().toISOString(),
        line_manager_user_id: lineManagerUserId,
        line_manager_name: lineManagerName || null,
        line_manager_email: lineManagerEmail || null,
        status: "pending_manager_approval",
      });

      if (error) {
        Alert.alert("Save Failed", error.message || "Could not submit timesheet.");
        return;
      }

      Alert.alert("Submitted", `Timesheet submitted for approval.\nTotal Hours Paid: ${Number(totalPayroll.toFixed(2))}`, [
        {
          text: "OK",
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error) {
      Alert.alert("Save Failed", String(error?.message || "Unknown error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Timesheet</Text>
        <Text style={styles.subtitle}>Create a new weekly timesheet quickly.</Text>

        <Text style={styles.fieldLabel}>Employee Name</Text>
        <TextInput style={styles.input} value={employeeName} onChangeText={setEmployeeName} placeholder="Employee name" />

        <Text style={styles.fieldLabel}>Department</Text>
        <TouchableOpacity style={styles.selectButton} onPress={openDepartmentPicker}>
          <Text style={styles.selectButtonText}>{department || "Select assigned department"}</Text>
        </TouchableOpacity>

        <Text style={styles.fieldLabel}>Employee Number</Text>
        <TextInput style={styles.input} value={employeeNumber} onChangeText={setEmployeeNumber} placeholder="Employee number" />

        <Text style={styles.fieldLabel}>Week Ending (Thursday)</Text>
        <TouchableOpacity style={styles.selectButton} onPress={openWeekEndingPicker}>
          <Text style={styles.selectButtonText}>{formatDisplayDate(weekEnding)}</Text>
        </TouchableOpacity>

        <Text style={[styles.fieldLabel, styles.sectionTop]}>Daily Entries</Text>

        {entries.map((row, index) => (
          <View key={`entry_${index}`} style={styles.entryCard}>
            <View style={styles.entryHeaderRow}>
              <Text style={styles.entryTitle}>Day {index + 1}</Text>
              {entries.length > 1 ? (
                <TouchableOpacity
                  style={styles.deleteDayButton}
                  onPress={() => removeDay(index)}
                >
                  <Text style={styles.deleteDayButtonText}>X</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Day</Text>
                <TouchableOpacity style={styles.selectButton} onPress={() => openDayPicker(index)}>
                  <Text style={styles.selectButtonText}>{row.day || "Select day"}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Contract Number</Text>
                <TouchableOpacity style={styles.selectButton} onPress={() => openContractPicker(index)}>
                  <Text style={styles.selectButtonText}>
                    {row.contractNumber ? contractLabelByNumber.get(row.contractNumber) || row.contractNumber : "Select live contract"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Start Time</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => openTimePicker(index, "startTime", DEFAULT_START_TIME)}
                >
                  <Text style={styles.selectButtonText}>{row.startTime || "Select time"}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>End Time</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => openTimePicker(index, "endTime", DEFAULT_END_TIME)}
                >
                  <Text style={styles.selectButtonText}>{row.endTime || "Select time"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Travel Start</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => openTimePicker(index, "travelStartTime", DEFAULT_START_TIME)}
                >
                  <Text style={styles.selectButtonText}>{row.travelStartTime || "Select time"}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Travel End</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => openTimePicker(index, "travelEndTime", DEFAULT_END_TIME)}
                >
                  <Text style={styles.selectButtonText}>{row.travelEndTime || "Select time"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Shift Type</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => openSimpleFieldPicker(index, "shiftType", "Select Shift Type", SHIFT_TYPES)}
                >
                  <Text style={styles.selectButtonText}>{row.shiftType || "Select shift"}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Overnight Allowance</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => openSimpleFieldPicker(index, "overnightAllowance", "Select Overnight", OVERNIGHT_OPTIONS)}
                >
                  <Text style={styles.selectButtonText}>{row.overnightAllowance || "Select"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Travel Payment</Text>
                <TextInput
                  style={styles.input}
                  value={row.travelPayment}
                  onChangeText={(value) => updateEntry(index, "travelPayment", value)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Bonus / Other</Text>
                <TextInput
                  style={styles.input}
                  value={row.bonusOtherPayments}
                  onChangeText={(value) => updateEntry(index, "bonusOtherPayments", value)}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>HAVS Points</Text>
                <TextInput
                  style={styles.input}
                  value={row.havsPoints}
                  onChangeText={(value) => updateEntry(index, "havsPoints", value)}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.smallLabel}>Total Hours Paid (override)</Text>
                <TextInput
                  style={styles.input}
                  value={row.payrollHoursPaid}
                  onChangeText={(value) => updateEntry(index, "payrollHoursPaid", value)}
                  keyboardType="decimal-pad"
                  placeholder={`Auto: ${computeAutoPayrollHoursForRow(row).toFixed(2)}`}
                />
              </View>
            </View>
          </View>
        ))}

        <View style={styles.rowActionWrap}>
          <TouchableOpacity style={styles.copyButton} onPress={addCopiedDay}>
            <Text style={styles.copyButtonText}>Copy Day</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.newButton} onPress={addNewDay}>
            <Text style={styles.newButtonText}>New Day</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.fieldLabel, styles.sectionTop]}>Totals</Text>
        <View style={styles.totalsCard}>
          <Text style={styles.totalLine}>Total Site Hours: {totals.totalSiteHours}</Text>
          <Text style={styles.totalLine}>Total Travel Hours: {totals.totalTravelHours}</Text>
          <Text style={styles.totalLine}>Total Hours: {totals.totalHours}</Text>
          <Text style={styles.totalLine}>Total Hours Paid (Payroll): {totals.totalPayrollHoursPaid}</Text>
        </View>

        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes"
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.fieldLabel}>Employee Signature</Text>
        <TouchableOpacity style={styles.signatureButton} onPress={openSignatureModal}>
          <Text style={styles.signatureButtonText}>
            {employeeSignature ? "Edit Signature" : "Tap/click to sign with mouse"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.submitButton, saving && styles.submitButtonDisabled]}
          onPress={submitTimesheet}
          disabled={saving}
        >
          <Text style={styles.submitButtonText}>{saving ? "Submitting..." : "Submit Timesheet"}</Text>
        </TouchableOpacity>
        {loadingProfile ? <Text style={styles.helperText}>Loading your defaults...</Text> : null}
      </ScrollView>

      <Modal visible={selectorState.visible} transparent animationType="fade" onRequestClose={closeSelector}>
        <View style={styles.modalBackdrop}>
          <View style={styles.selectorModal}>
            <Text style={styles.modalTitle}>{selectorState.title}</Text>
            <ScrollView style={styles.selectorList}>
              {(selectorState.options || []).map((option) => (
                <TouchableOpacity
                  key={`${option.value}`}
                  style={styles.selectorOption}
                  onPress={() => {
                    selectorState.onSelect?.(option.value);
                    closeSelector();
                  }}
                >
                  <Text style={styles.selectorOptionText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.cancelButton} onPress={closeSelector}>
              <Text style={styles.cancelButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={timePickerState.visible} transparent animationType="fade" onRequestClose={closeTimePicker}>
        <View style={styles.modalBackdrop}>
          <View style={styles.timeModal}>
            <Text style={styles.modalTitle}>Select Time (15 min)</Text>
            <DateTimePicker
              value={timePickerState.value}
              mode="time"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              minuteInterval={15}
              is24Hour
              onChange={onTimePickerChange}
            />
            {Platform.OS === "ios" ? (
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={closeTimePicker}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={confirmTimePicker}>
                  <Text style={styles.confirmButtonText}>Use Time</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={showSignatureModal} transparent animationType="fade" onRequestClose={() => setShowSignatureModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.signatureModal}>
            <Text style={styles.modalTitle}>Sign Timesheet</Text>
            <View style={styles.signaturePadWrap}>
              <SignatureScreen
                ref={signatureRef}
                onOK={handleSignatureOk}
                onEnd={handleSignatureEnd}
                onEmpty={() => Alert.alert("Signature Required", "Please provide a signature before confirming.")}
                descriptionText=""
                clearText="Clear"
                confirmText="Save"
                autoClear
                webStyle={`
                  .m-signature-pad { box-shadow: none; border: 1px solid #d7d7d7; border-radius: 10px; }
                  .m-signature-pad--body { border: none; }
                  .m-signature-pad--footer { display: none; margin: 0; }
                `}
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowSignatureModal(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearButton} onPress={handleSignatureClearPress}>
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={handleSignatureConfirm}>
                <Text style={styles.confirmButtonText}>Use Signature</Text>
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
    backgroundColor: "#fff",
  },
  content: {
    padding: 16,
    paddingBottom: 28,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  subtitle: {
    color: "#64748b",
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 6,
  },
  smallLabel: {
    fontSize: 12,
    color: "#334155",
    marginBottom: 4,
    fontWeight: "600",
  },
  sectionTop: {
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#fff",
  },
  selectButton: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  selectButtonText: {
    color: "#0f172a",
    fontSize: 14,
  },
  twoColRow: {
    flexDirection: "row",
    gap: 8,
  },
  col: {
    flex: 1,
  },
  entryCard: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#f8fafc",
  },
  entryTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
  },
  entryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  deleteDayButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteDayButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 12,
  },
  rowActionWrap: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
    marginBottom: 12,
  },
  copyButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#eef2ff",
  },
  copyButtonText: {
    color: "#1e40af",
    fontWeight: "700",
  },
  newButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#0f766e",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#ecfeff",
  },
  newButtonText: {
    color: "#0f766e",
    fontWeight: "700",
  },
  totalsCard: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  totalLine: {
    fontSize: 14,
    color: "#0f172a",
    marginBottom: 4,
  },
  notesInput: {
    minHeight: 90,
  },
  signatureButton: {
    borderWidth: 1,
    borderColor: "#c7d2fe",
    borderRadius: 8,
    backgroundColor: "#eef2ff",
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
    alignItems: "center",
  },
  signatureButtonText: {
    color: "#1e3a8a",
    fontWeight: "600",
  },
  submitButton: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  helperText: {
    marginTop: 8,
    color: "#64748b",
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "center",
    padding: 16,
  },
  selectorModal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    maxHeight: "75%",
  },
  selectorList: {
    marginBottom: 10,
  },
  selectorOption: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  selectorOptionText: {
    color: "#0f172a",
    fontWeight: "600",
  },
  timeModal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
  },
  signatureModal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  signaturePadWrap: {
    height: 260,
    overflow: "hidden",
    borderRadius: 10,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  cancelButtonText: {
    color: "#334155",
    fontWeight: "600",
  },
  clearButton: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f8fafc",
  },
  clearButtonText: {
    color: "#334155",
    fontWeight: "600",
  },
  confirmButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#2563eb",
  },
  confirmButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
});
