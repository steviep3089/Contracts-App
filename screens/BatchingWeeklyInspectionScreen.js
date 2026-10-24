import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Modal, Alert } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import SignatureScreen from "react-native-signature-canvas";
import { supabase } from "../supabase";
import { enqueueOutboxItem } from "../services/outboxQueue";
import { syncChecklistSubmission } from "../services/checklistSync";
import {
  BATCHING_INSPECTION_CONFIG,
  BATCHING_STATUS_OPTIONS,
  BATCHING_WEEK_DAYS,
  BATCHING_WORK_DAYS,
} from "../config/batchingWeeklyInspectionConfig";

function formatContractChoice(option) {
  if (!option) return "";
  const number = String(option.contractNo || "").trim();
  const name = String(option.contractName || "").trim();
  if (number && number !== "-" && name) return `${number} - ${name}`;
  return name || number || "";
}

function buildTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCurrentTimeValue() {
  const now = new Date();
  const totalMinutes = Math.min(Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15, 23 * 60 + 45);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

const QUARTER_HOUR_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

function buildNextSundayIsoDate() {
  const now = new Date();
  const nextSunday = new Date(now);
  const daysUntilSunday = (7 - now.getDay()) % 7;
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  const y = nextSunday.getFullYear();
  const m = String(nextSunday.getMonth() + 1).padStart(2, "0");
  const d = String(nextSunday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isTransportError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("network") || msg.includes("fetch") || msg.includes("timed out");
}

const BATCHING_PLANT_OPTIONS = ["BX22", "BX33", "BX64", "MM2", "MM3", "RMX1"];

function inferPlantOption(source) {
  const text = String(source || "").trim().toUpperCase();
  return BATCHING_PLANT_OPTIONS.find((item) => text.includes(item)) || BATCHING_PLANT_OPTIONS[0];
}

function dedupeNames(names = []) {
  const seen = new Set();
  return names.filter((item) => {
    const value = String(item || "").trim();
    if (!value) return false;
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NOT_OPERATIONAL_LABEL = "None Operational";
const OPERATIONAL_STATUS_COLORS = {
  operational: { backgroundColor: "#f0fdf4", borderColor: "#16a34a", textColor: "#166534" },
  not_operational: { backgroundColor: "#fef2f2", borderColor: "#dc2626", textColor: "#991b1b" },
};

const ENVIRONMENTAL_STATUS_COLORS = {
  satisfactory: { backgroundColor: "#f0fdf4", borderColor: "#16a34a", textColor: "#166534" },
  unsatisfactory: { backgroundColor: "#fef2f2", borderColor: "#dc2626", textColor: "#991b1b" },
  dry: { backgroundColor: "#f0fdf4", borderColor: "#16a34a", textColor: "#166534" },
  raining: { backgroundColor: "#fef2f2", borderColor: "#dc2626", textColor: "#991b1b" },
  variable: { backgroundColor: "#fffbeb", borderColor: "#d97706", textColor: "#92400e" },
  snow: { backgroundColor: "#fef2f2", borderColor: "#dc2626", textColor: "#991b1b" },
};

const ENVIRONMENTAL_STATUS_OPTIONS = [
  { value: "satisfactory", label: "Satisfactory" },
  { value: "unsatisfactory", label: "Unsatisfactory" },
];
const ENVIRONMENTAL_WEATHER_OPTIONS = [
  { value: "dry", label: "Dry" },
  { value: "raining", label: "Raining" },
  { value: "variable", label: "Variable" },
  { value: "snow", label: "Snow" },
];

function createGuardChecksState() {
  return Object.fromEntries(
    BATCHING_WEEK_DAYS.map((day) => [
      day,
      { checkedBy: "", defectReported: "", operatorSignature: "", signedTime: "", siteNotOperational: false },
    ])
  );
}

function isGuardDayNotOperational(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.siteNotOperational) return true;
  return String(entry.checkedBy || "").trim().toLowerCase() === NOT_OPERATIONAL_LABEL.toLowerCase();
}

function getNotOperationalDays(guardChecks) {
  return new Set(BATCHING_WEEK_DAYS.filter((day) => isGuardDayNotOperational(guardChecks?.[day])));
}

function deriveInitialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getDayInitials(guardChecks, day, fallbackName) {
  const entry = guardChecks?.[day];
  if (isGuardDayNotOperational(entry)) return "";
  return deriveInitialsFromName(String(entry?.checkedBy || "").trim() || fallbackName);
}

function createMaintenanceDailyState() {
  const tasks = BATCHING_INSPECTION_CONFIG.sheets[0].dailySections[1].tasks;
  return Object.fromEntries(
    BATCHING_WORK_DAYS.map((day) => [
      day,
      {
        initials: "",
        tasks: Object.fromEntries(tasks.map((task) => [task, ""])),
      },
    ])
  );
}

function createQualityDailyState() {
  const tasks = BATCHING_INSPECTION_CONFIG.sheets[2].dailySections[0].tasks;
  return Object.fromEntries(
    BATCHING_WORK_DAYS.map((day) => [
      day,
      Object.fromEntries(tasks.map((task) => [task, { am: "", pm: "" }])),
    ])
  );
}

function createEnvDailyLogState() {
  const groups = BATCHING_INSPECTION_CONFIG.sheets[1].dailySections[0].groups;
  return Object.fromEntries(
    BATCHING_WEEK_DAYS.map((day) => [
      day,
      Object.fromEntries(
        groups.map((group) => {
          if (group.slots.includes("pre_start")) {
            return [group.key, { time: "", initials: "", status: "", comment: "" }];
          }
          return [
            group.key,
            Object.fromEntries(
              group.slots.map((slot) => [slot, { time: "", initials: "", status: "", comment: "" }])
            ),
          ];
        })
      ),
    ])
  );
}

function createPowderDeliveriesState() {
  return Object.fromEntries(BATCHING_WEEK_DAYS.map((day) => [day, []]));
}

function createEnvEmissionsState() {
  const areas = BATCHING_INSPECTION_CONFIG.sheets[1].dailySections[2].areas;
  return Object.fromEntries(
    BATCHING_WEEK_DAYS.map((day) => [
      day,
      {
        spillageAction: "",
        ratings: Object.fromEntries(areas.map((area) => [area, ""])),
      },
    ])
  );
}

function createWeeklyState() {
  const state = {};
  BATCHING_INSPECTION_CONFIG.sheets.forEach((sheet) => {
    state[sheet.key] = {};
    (sheet.weeklySections || []).forEach((section) => {
      state[sheet.key][section.key] = {};
    });
  });
  return state;
}

function buildBatchingSummary(checklist) {
  const lines = [];
  lines.push(["Form Kind", "Batching Plant Weekly Inspection"]);
  lines.push(["Sheets Completed", BATCHING_INSPECTION_CONFIG.sheets.map((sheet) => sheet.title).join(", ")]);

  const notOperationalDays = getNotOperationalDays(checklist.health_and_safety.daily_guard_checks);
  const operationalDayCount = BATCHING_WEEK_DAYS.length - notOperationalDays.size;
  const guardCount = Object.entries(checklist.health_and_safety.daily_guard_checks || {}).filter(
    ([day, entry]) => !notOperationalDays.has(day) && String(entry?.checkedBy || "").trim()
  ).length;
  lines.push(["H&S Daily Guard Checks", `${guardCount}/${operationalDayCount} operational days completed`]);
  if (notOperationalDays.size > 0) {
    lines.push(["Not Operational Days", BATCHING_WEEK_DAYS.filter((day) => notOperationalDays.has(day)).join(", ")]);
  }
  Object.entries(checklist.health_and_safety.daily_guard_checks || {}).forEach(([day, entry], index) => {
    if (notOperationalDays.has(day)) return;
    const detail = [
      entry?.checkedBy,
      entry?.operatorSignature ? "Signed" : "",
      entry?.defectReported ? `Defect: ${entry.defectReported}` : "",
    ]
      .filter((item) => String(item || "").trim())
      .join(" | ");
    if (detail) {
      lines.push([index === 0 ? "H&S Guard Details" : "", `${day}: ${detail}`]);
    }
  });

  const maintenanceDays = Object.entries(checklist.health_and_safety.plant_maintenance_daily || {})
    .filter(([day]) => !notOperationalDays.has(day))
    .map(([day, entry]) => {
      const completed = Object.values(entry?.tasks || {}).filter(Boolean).length;
      return `${day}: ${completed} tasks`;
    });
  maintenanceDays.forEach((line, index) => {
    lines.push([index === 0 ? "H&S Daily Maintenance" : "", line]);
  });

  const envDeliveryCounts = Object.entries(checklist.environmental.powder_deliveries || {})
    .filter(([day]) => !notOperationalDays.has(day))
    .map(([day, entries]) => `${day}: ${Array.isArray(entries) ? entries.length : 0} deliveries`);
  envDeliveryCounts.forEach((line, index) => {
    lines.push([index === 0 ? "Environmental Deliveries" : "", line]);
  });

  const qualityDays = Object.entries(checklist.quality.daily_checks || {})
    .filter(([day]) => !notOperationalDays.has(day))
    .map(([day, entry]) => {
      const completed = Object.values(entry || {}).reduce((count, taskSlots) => {
        const am = String(taskSlots?.am || "").trim();
        const pm = String(taskSlots?.pm || "").trim();
        return count + (am ? 1 : 0) + (pm ? 1 : 0);
      }, 0);
      return `${day}: ${completed} slots completed`;
    });
  qualityDays.forEach((line, index) => {
    lines.push([index === 0 ? "Quality Daily" : "", line]);
  });

  BATCHING_INSPECTION_CONFIG.sheets.forEach((sheet) => {
    (sheet.weeklySections || []).forEach((section) => {
      const completed = checklist[sheet.key]?.[section.key] || {};
      Object.entries(completed).forEach(([task, value], index) => {
        const detail = [
          value.not_applicable ? "N/A" : "",
          value.checked_by,
          value.day,
          value.time,
          value.operator_signature ? "Signed" : "",
          value.defect_reported,
        ]
          .filter((item) => String(item || "").trim())
          .join(" | ");
        lines.push([
          index === 0 ? `${sheet.title} - ${section.title}` : "",
          detail ? `${task} (${detail})` : task,
        ]);
      });
    });
  });

  return Object.fromEntries(
    lines.map(([key, value], index) => [`${index + 1}. ${key || "Detail"}`, value || "-"])
  );
}

function buildHasDefects(checklist) {
  const hasGuardDefects = Object.values(checklist.health_and_safety.daily_guard_checks || {}).some((entry) =>
    String(entry?.defectReported || "").trim()
  );
  if (hasGuardDefects) return true;

  const hasWeeklyDefects = BATCHING_INSPECTION_CONFIG.sheets.some((sheet) =>
    (sheet.weeklySections || []).some((section) => {
      const completed = checklist[sheet.key]?.[section.key] || {};
      return Object.values(completed).some((value) => String(value?.defect_reported || "").trim());
    })
  );
  if (hasWeeklyDefects) return true;

  return Object.values(checklist.environmental.emissions_ratings || {}).some((entry) =>
    String(entry?.spillageAction || "").trim()
  );
}

function isBatchingWeeklyInspectionForm(form) {
  const title = `${String(form?.title || "")} ${String(form?.templateCode || form?.id || "")}`.toLowerCase();
  return title.includes("weekly inspection") || title.includes("batching");
}

export { isBatchingWeeklyInspectionForm };

function SectionPills({ options, selected, onSelect, colorByValue = {} }) {
  return (
    <View style={styles.pillRow}>
      {options.map((option) => {
        const key = typeof option === "string" ? option : option.value;
        const label = typeof option === "string" ? option : option.label;
        const active = selected === key;
        const colors = colorByValue[key];
        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.pill,
              active && styles.pillActive,
              colors && {
                backgroundColor: active ? colors.borderColor : colors.backgroundColor,
                borderColor: colors.borderColor,
              },
            ]}
            onPress={() => onSelect(key)}
          >
            <Text
              style={[
                styles.pillText,
                active && styles.pillTextActive,
                colors && !active && { color: colors.textColor },
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function BatchingWeeklyInspectionScreen({ route, navigation }) {
  const form = route?.params?.form;
  const launch = form?.launch || null;
  const contractLocked = form?.contractLocked !== false;
  const contractOptions = useMemo(() => {
    const fromForm = Array.isArray(form?.contractOptions) ? form.contractOptions : [];
    const normalized = fromForm
      .map((item) => ({
        id: item?.id || null,
        contractNo: String(item?.contractNo || "").trim(),
        contractName: String(item?.contractName || "").trim(),
      }))
      .filter((item) => Boolean(item.contractNo || item.contractName));

    if (normalized.length > 0) return normalized;

    const fallbackNo = String(form?.contractNo || "").trim();
    const fallbackName = String(form?.contractName || "").trim();
    if (!fallbackNo && !fallbackName) return [];
    return [
      {
        id: form?.contractId || null,
        contractNo: fallbackNo,
        contractName: fallbackName,
      },
    ];
  }, [form?.contractId, form?.contractName, form?.contractNo, form?.contractOptions]);

  const defaultContractChoice = useMemo(() => {
    if (contractOptions.length === 0) return null;
    if (form?.contractId) {
      const match = contractOptions.find((item) => item.id === form.contractId);
      if (match) return match;
    }
    if (form?.contractNo) {
      const match = contractOptions.find((item) => item.contractNo === String(form.contractNo).trim());
      if (match) return match;
    }
    return contractOptions[0];
  }, [contractOptions, form?.contractId, form?.contractNo]);

  const defaultContractName = String(
    defaultContractChoice?.contractName ||
      defaultContractChoice?.contractNo ||
      form?.contractName ||
      form?.contractNo ||
      "Batching Plant"
  ).trim();
  const defaultContractNumber = String(defaultContractChoice?.contractNo || form?.contractNo || "").trim();

  const [version, setVersion] = useState("2.2");
  const [completedBy, setCompletedBy] = useState("");
  const [currentUserName, setCurrentUserName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [weekEndingDate, setWeekEndingDate] = useState(buildNextSundayIsoDate());
  const [plantName, setPlantName] = useState(inferPlantOption(defaultContractName));
  const [contractPlant, setContractPlant] = useState("");
  const plantOptions = useMemo(
    () => (contractPlant && !BATCHING_PLANT_OPTIONS.includes(contractPlant) ? [contractPlant, ...BATCHING_PLANT_OPTIONS] : BATCHING_PLANT_OPTIONS),
    [contractPlant]
  );
  const [selectedContractChoice, setSelectedContractChoice] = useState(defaultContractChoice);
  const [contractPickerVisible, setContractPickerVisible] = useState(false);
  const [plantPickerVisible, setPlantPickerVisible] = useState(false);
  const [teamMemberOptions, setTeamMemberOptions] = useState([]);
  const [teamPicker, setTeamPicker] = useState({ visible: false, target: null, day: "", title: "Select team member" });
  const [activeSheet, setActiveSheet] = useState("health_and_safety");
  const [maintenanceDay, setMaintenanceDay] = useState("Monday");
  const [qualityDay, setQualityDay] = useState("Monday");
  const [envDay, setEnvDay] = useState("Monday");
  const [powderDay, setPowderDay] = useState("Monday");
  const [generalNotes, setGeneralNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftRecordId, setDraftRecordId] = useState("");
  const [weeklyModal, setWeeklyModal] = useState({ visible: false, sheetKey: "", sectionKey: "", task: "", values: {} });
  const [groupSelect, setGroupSelect] = useState(null);
  const [defectModalVisible, setDefectModalVisible] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState(null);
  const timePickerScrollRef = useRef(null);
  const [signatureTarget, setSignatureTarget] = useState({ type: null, day: "", title: "Sign Check" });
  const [defectTarget, setDefectTarget] = useState({ type: null, day: "", title: "Report Defect" });
  const [hasSignatureStroke, setHasSignatureStroke] = useState(false);
  const signatureRef = useRef(null);

  const [guardChecks, setGuardChecks] = useState(createGuardChecksState);
  const [maintenanceDaily, setMaintenanceDaily] = useState(createMaintenanceDailyState);
  const [envDailyLog, setEnvDailyLog] = useState(createEnvDailyLogState);
  const [powderDeliveries, setPowderDeliveries] = useState(createPowderDeliveriesState);
  const [envEmissions, setEnvEmissions] = useState(createEnvEmissionsState);
  const [qualityDaily, setQualityDaily] = useState(createQualityDailyState);
  const [weeklyCompleted, setWeeklyCompleted] = useState(createWeeklyState);
  const lastLaunchTokenRef = useRef(null);

  const notOperationalDays = useMemo(() => getNotOperationalDays(guardChecks), [guardChecks]);
  const operationalWeekDays = useMemo(
    () => BATCHING_WEEK_DAYS.filter((day) => !notOperationalDays.has(day)),
    [notOperationalDays]
  );
  const operationalWorkDays = useMemo(
    () => BATCHING_WORK_DAYS.filter((day) => !notOperationalDays.has(day)),
    [notOperationalDays]
  );

  const lastAutoInitialsRef = useRef({});

  useEffect(() => {
    const defaults = Object.fromEntries(
      BATCHING_WEEK_DAYS.map((day) => [day, getDayInitials(guardChecks, day, completedBy)])
    );
    const previous = lastAutoInitialsRef.current;
    lastAutoInitialsRef.current = defaults;

    // Fill when empty, when it is a partial prefix, or when it still holds the last auto-filled value.
    const resolve = (current, day) => {
      const next = defaults[day];
      if (!next) return current;
      const value = String(current || "").trim().toUpperCase();
      if (!value) return next;
      if (value === previous[day] && value !== next) return next;
      if (value.length < next.length && next.startsWith(value)) return next;
      return current;
    };

    setMaintenanceDaily((prev) => {
      let changed = false;
      const result = { ...prev };
      BATCHING_WORK_DAYS.forEach((day) => {
        const next = resolve(prev[day]?.initials, day);
        if (next !== prev[day]?.initials) {
          result[day] = { ...prev[day], initials: next };
          changed = true;
        }
      });
      return changed ? result : prev;
    });

    setEnvDailyLog((prev) => {
      let changed = false;
      const result = { ...prev };
      BATCHING_WEEK_DAYS.forEach((day) => {
        const dayState = prev[day];
        if (!dayState) return;
        const nextDay = { ...dayState };
        Object.entries(dayState).forEach(([groupKey, groupState]) => {
          if (groupState && typeof groupState === "object" && "initials" in groupState) {
            const next = resolve(groupState.initials, day);
            if (next !== groupState.initials) {
              nextDay[groupKey] = { ...groupState, initials: next };
              changed = true;
            }
            return;
          }
          const nextGroup = { ...groupState };
          Object.entries(groupState || {}).forEach(([slot, slotState]) => {
            const next = resolve(slotState?.initials, day);
            if (next !== slotState?.initials) {
              nextGroup[slot] = { ...slotState, initials: next };
              changed = true;
            }
          });
          nextDay[groupKey] = nextGroup;
        });
        result[day] = nextDay;
      });
      return changed ? result : prev;
    });

    setPowderDeliveries((prev) => {
      let changed = false;
      const result = { ...prev };
      BATCHING_WEEK_DAYS.forEach((day) => {
        const entries = Array.isArray(prev[day]) ? prev[day] : [];
        const nextEntries = entries.map((entry) => {
          const next = resolve(entry?.initials, day);
          if (next === entry?.initials) return entry;
          changed = true;
          return { ...entry, initials: next };
        });
        result[day] = nextEntries;
      });
      return changed ? result : prev;
    });
  }, [guardChecks, completedBy]);

  const pickerCurrentValue = timePickerTarget
    ? powderDeliveries[timePickerTarget.day]?.[timePickerTarget.index]?.[timePickerTarget.field] || ""
    : weeklyModal.values.time || "";

  const weeklySubModalOpen =
    timePickerVisible ||
    (showSignatureModal && signatureTarget.type === "weekly") ||
    (teamPicker.visible && teamPicker.target === "weekly_checked_by") ||
    (defectModalVisible && defectTarget.type === "weekly");

  useEffect(() => {
    if (operationalWorkDays.length > 0) {
      if (!operationalWorkDays.includes(maintenanceDay)) setMaintenanceDay(operationalWorkDays[0]);
      if (!operationalWorkDays.includes(qualityDay)) setQualityDay(operationalWorkDays[0]);
    }
    if (operationalWeekDays.length > 0 && !operationalWeekDays.includes(envDay)) {
      setEnvDay(operationalWeekDays[0]);
    }
  }, [operationalWorkDays, operationalWeekDays, maintenanceDay, qualityDay, envDay]);

  function setGuardDayOperational(day, operational) {
    setGuardChecks((prev) => ({
      ...prev,
      [day]: operational
        ? {
            ...prev[day],
            siteNotOperational: false,
            checkedBy: String(currentUserName || completedBy || "").trim(),
          }
        : {
            checkedBy: NOT_OPERATIONAL_LABEL,
            defectReported: "",
            operatorSignature: "",
            siteNotOperational: true,
          },
    }));
  }
  useEffect(() => {
    setSelectedContractChoice(defaultContractChoice);
  }, [defaultContractChoice]);

  useEffect(() => {
    if (!plantOptions.includes(plantName)) {
      setPlantName(inferPlantOption(defaultContractName));
    }
  }, [defaultContractName, plantName, plantOptions]);

  const selectedContractId = selectedContractChoice?.id || null;
  const launchToken = launch?.token || null;
  const launchMode = launch?.mode || "";
  useEffect(() => {
    let cancelled = false;
    if (!selectedContractId) {
      setContractPlant("");
      return undefined;
    }
    supabase
      .from("contracts")
      .select("plant")
      .eq("id", selectedContractId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const plant = String(data?.plant || "").trim();
        setContractPlant(plant);
        if (plant && launchMode !== "draft" && launchMode !== "copy") {
          setPlantName(plant);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedContractId, launchToken, launchMode]);

  const currentContractName = String(
    selectedContractChoice?.contractName ||
      selectedContractChoice?.contractNo ||
      defaultContractName ||
      plantName
  ).trim();
  const currentContractNumber = String(
    selectedContractChoice?.contractNo || defaultContractNumber || currentContractName
  ).trim();

  function resetToNewInspection() {
    setVersion("2.2");
    setWeekEndingDate(buildNextSundayIsoDate());
    setPlantName(inferPlantOption(defaultContractName));
    setGeneralNotes("");
    setGuardChecks(createGuardChecksState());
    setMaintenanceDaily(createMaintenanceDailyState());
    setEnvDailyLog(createEnvDailyLogState());
    setPowderDeliveries(createPowderDeliveriesState());
    setEnvEmissions(createEnvEmissionsState());
    setQualityDaily(createQualityDailyState());
    setWeeklyCompleted(createWeeklyState());
    setDraftRecordId("");
  }

  function hydrateFromSavedRow(source, mode = "draft") {
    const structured = source?.checklist || {};
    const meta = structured?.meta || {};

    setVersion(String(source?.sheet_version || meta?.version || "2.2"));
    setCompletedBy(String(source?.completed_by_name || ""));
    setJobTitle(String(source?.job_title || ""));
    setWeekEndingDate(
      String(mode === "copy" ? buildNextSundayIsoDate() : meta?.week_ending_date || source?.check_date || buildNextSundayIsoDate())
    );
    setPlantName(inferPlantOption(meta?.plant_name || source?.machine_reg || defaultContractName));
    setGeneralNotes(String(structured?.notes || source?.notes || ""));
    setGuardChecks({
      ...createGuardChecksState(),
      ...(structured?.health_and_safety?.daily_guard_checks || {}),
    });
    setMaintenanceDaily({
      ...createMaintenanceDailyState(),
      ...(structured?.health_and_safety?.plant_maintenance_daily || {}),
    });
    setEnvDailyLog({
      ...createEnvDailyLogState(),
      ...(structured?.environmental?.daily_logbook || {}),
    });
    setPowderDeliveries({
      ...createPowderDeliveriesState(),
      ...(structured?.environmental?.powder_deliveries || {}),
    });
    setEnvEmissions({
      ...createEnvEmissionsState(),
      ...(structured?.environmental?.emissions_ratings || {}),
    });
    setQualityDaily({
      ...createQualityDailyState(),
      ...(structured?.quality?.daily_checks || {}),
    });
    setWeeklyCompleted({
      ...createWeeklyState(),
      health_and_safety: {
        ...createWeeklyState().health_and_safety,
        weekly_equipment_checks: structured?.health_and_safety?.weekly_equipment_checks || {},
        plant_maintenance_weekly: structured?.health_and_safety?.plant_maintenance_weekly || {},
      },
      environmental: {
        ...createWeeklyState().environmental,
        environmental_weekly_checks: structured?.environmental?.environmental_weekly_checks || {},
      },
      quality: {
        ...createWeeklyState().quality,
        quality_weekly_checks: structured?.quality?.quality_weekly_checks || {},
      },
    });
    setDraftRecordId(mode === "draft" ? String(source?.id || "") : "");
  }

  useEffect(() => {
    initializeUserDefaults();
  }, []);

  useEffect(() => {
    if (!launch?.token || launch.token === lastLaunchTokenRef.current) return;

    lastLaunchTokenRef.current = launch.token;
    if ((launch.mode === "draft" || launch.mode === "copy") && launch.data) {
      hydrateFromSavedRow(launch.data, launch.mode);
      Alert.alert(
        launch.mode === "draft" ? "Draft Loaded" : "Copied",
        launch.mode === "draft"
          ? "Draft restored for continued editing."
          : "Copied from an existing inspection."
      );
      return;
    }

    resetToNewInspection();
  }, [launch, defaultContractName]);

  useEffect(() => {
    loadContractTeamMembers();
  }, [selectedContractChoice?.id, currentUserName]);

  async function initializeUserDefaults() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) return;

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("full_name, job_role")
      .eq("user_id", user.id)
      .maybeSingle();

    const defaultName =
      String(profile?.full_name || "").trim() ||
      String(user?.user_metadata?.display_name || "").trim() ||
      String(user?.user_metadata?.full_name || "").trim() ||
      String(user?.email || "").trim();

    const defaultRole =
      String(profile?.job_role || "").trim() ||
      String(user?.user_metadata?.job_role || "").trim();

    setCompletedBy((prev) => (String(prev || "").trim() ? prev : defaultName));
    setCurrentUserName(defaultName);
    setJobTitle((prev) => (String(prev || "").trim() ? prev : defaultRole));
    setGuardChecks((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([day, entry]) => [
          day,
          {
            ...entry,
            checkedBy: String(entry?.checkedBy || "").trim() || defaultName,
          },
        ])
      )
    );
  }

  async function loadContractTeamMembers() {
    const fallback = dedupeNames([currentUserName, completedBy]);
    const contractId = selectedContractChoice?.id;
    if (!contractId) {
      setTeamMemberOptions(fallback);
      return;
    }

    try {
      const { data: roleRows, error: rolesError } = await supabase
        .from("contract_team_roles")
        .select("user_id")
        .eq("contract_id", contractId);

      if (rolesError) throw rolesError;

      const userIds = [...new Set((roleRows || []).map((row) => row?.user_id).filter(Boolean))];
      if (userIds.length === 0) {
        setTeamMemberOptions(fallback);
        return;
      }

      const [profileRes, directoryRes] = await Promise.all([
        supabase.from("user_profiles").select("user_id, full_name").in("user_id", userIds),
        supabase.from("people_directory").select("portal_user_id, full_name, email").in("portal_user_id", userIds),
      ]);

      const profileMap = new Map(
        (profileRes.data || []).map((row) => [String(row.user_id), String(row.full_name || "").trim()])
      );
      const directoryMap = new Map(
        (directoryRes.data || []).map((row) => [
          String(row.portal_user_id),
          String(row.full_name || row.email || "").trim(),
        ])
      );

      const names = dedupeNames([
        currentUserName,
        completedBy,
        ...userIds.map((id) => profileMap.get(String(id)) || directoryMap.get(String(id)) || ""),
      ]);
      setTeamMemberOptions(names);
    } catch {
      setTeamMemberOptions(fallback);
    }
  }

  function openWeeklyModal(sheetKey, sectionKey, task, existing = {}, groupTasks = null) {
    setWeeklyModal({
      visible: true,
      sheetKey,
      sectionKey,
      task,
      groupTasks,
      values: {
        checked_by: String(existing.checked_by || completedBy || "").trim(),
        defect_reported: String(existing.defect_reported || "").trim(),
        day: String(existing.day || envDay || "Monday").trim(),
        time: String(existing.time || "").trim() || getCurrentTimeValue(),
        operator_signature: String(existing.operator_signature || "").trim(),
      },
    });
  }

  function startGroupSelect(sheetKey, sectionKey, task) {
    setGroupSelect((prev) =>
      prev && prev.sheetKey === sheetKey && prev.sectionKey === sectionKey
        ? prev.tasks.includes(task)
          ? prev
          : { ...prev, tasks: [...prev.tasks, task] }
        : { sheetKey, sectionKey, tasks: [task] }
    );
  }

  function toggleGroupTask(task) {
    setGroupSelect((prev) => {
      if (!prev) return prev;
      const tasks = prev.tasks.includes(task) ? prev.tasks.filter((item) => item !== task) : [...prev.tasks, task];
      return tasks.length === 0 ? null : { ...prev, tasks };
    });
  }

  function openGroupWeeklyModal() {
    if (!groupSelect || groupSelect.tasks.length === 0) return;
    const count = groupSelect.tasks.length;
    openWeeklyModal(
      groupSelect.sheetKey,
      groupSelect.sectionKey,
      `${count} selected check${count === 1 ? "" : "s"}`,
      {},
      groupSelect.tasks
    );
  }

  function openTeamMemberPicker(target, day = "") {
    setTeamPicker({
      visible: true,
      target,
      day,
      title: "Select team member",
    });
  }

  function applyTeamMemberSelection(name) {
    if (teamPicker.target === "guard_checked_by" && teamPicker.day) {
      setGuardChecks((prev) => ({
        ...prev,
        [teamPicker.day]: {
          ...prev[teamPicker.day],
          checkedBy: name,
        },
      }));
    }

    if (teamPicker.target === "weekly_checked_by") {
      setWeeklyModal((prev) => ({
        ...prev,
        values: {
          ...prev.values,
          checked_by: name,
          operator_signature:
            String(prev.values.checked_by || "").trim().toLowerCase() === String(name || "").trim().toLowerCase()
              ? prev.values.operator_signature
              : "",
        },
      }));
    }

    setTeamPicker({ visible: false, target: null, day: "", title: "Select team member" });
  }

  function openSignatureModal() {
    setShowSignatureModal(true);
    setHasSignatureStroke(false);
  }

  function openGuardSignature(day) {
    setSignatureTarget({ type: "guard", day, title: `Sign Daily Guard Check - ${day}` });
    openSignatureModal();
  }

  function findSavedSignatureForPerson(name) {
    const target = String(name || "").trim().toLowerCase();
    if (!target) return "";

    for (const day of operationalWeekDays) {
      const entry = guardChecks[day];
      if (String(entry?.checkedBy || "").trim().toLowerCase() === target && String(entry?.operatorSignature || "").trim()) {
        return entry.operatorSignature;
      }
    }

    for (const sheet of BATCHING_INSPECTION_CONFIG.sheets) {
      for (const section of sheet.weeklySections || []) {
        const completed = weeklyCompleted[sheet.key]?.[section.key] || {};
        for (const value of Object.values(completed)) {
          if (
            String(value?.checked_by || "").trim().toLowerCase() === target &&
            String(value?.operator_signature || "").trim()
          ) {
            return value.operator_signature;
          }
        }
      }
    }

    return "";
  }

  function openWeeklySignature() {
    const hasSignature = Boolean(String(weeklyModal.values.operator_signature || "").trim());
    if (!hasSignature) {
      const saved = findSavedSignatureForPerson(weeklyModal.values.checked_by);
      if (saved) {
        setWeeklyModal((prev) => ({
          ...prev,
          values: { ...prev.values, operator_signature: saved },
        }));
        return;
      }
    }
    setSignatureTarget({ type: "weekly", day: "", title: `Sign Weekly Check` });
    openSignatureModal();
  }

  function handleSignatureOk(signature) {
    if (signatureTarget.type === "guard" && signatureTarget.day) {
      setGuardChecks((prev) => ({
        ...prev,
        [signatureTarget.day]: {
          ...prev[signatureTarget.day],
          operatorSignature: signature,
          signedTime: getCurrentTimeValue(),
        },
      }));
    } else {
      setWeeklyModal((prev) => ({
        ...prev,
        values: {
          ...prev.values,
          operator_signature: signature,
        },
      }));
    }
    setSignatureTarget({ type: null, day: "", title: "Sign Check" });
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

  function openGuardDefect(day) {
    setDefectTarget({ type: "guard", day, title: `Report Defect - ${day}` });
    setDefectModalVisible(true);
  }

  function openWeeklyDefect() {
    setDefectTarget({ type: "weekly", day: "", title: "Report Defect" });
    setDefectModalVisible(true);
  }

  function setDefectText(value) {
    if (defectTarget.type === "guard" && defectTarget.day) {
      setGuardChecks((prev) => ({
        ...prev,
        [defectTarget.day]: {
          ...prev[defectTarget.day],
          defectReported: value,
        },
      }));
      return;
    }

    setWeeklyModal((prev) => ({
      ...prev,
      values: {
        ...prev.values,
        defect_reported: value,
      },
    }));
  }

  function getDefectText() {
    if (defectTarget.type === "guard" && defectTarget.day) {
      return guardChecks[defectTarget.day]?.defectReported || "";
    }
    return weeklyModal.values.defect_reported || "";
  }

  function saveWeeklyModal() {
    const { sheetKey, sectionKey, task, values, groupTasks } = weeklyModal;
    if (!sheetKey || !sectionKey || !task) {
      setWeeklyModal({ visible: false, sheetKey: "", sectionKey: "", task: "", values: {} });
      return;
    }
    const savedTasks = Array.isArray(groupTasks) && groupTasks.length > 0 ? groupTasks : [task];

    const section = BATCHING_INSPECTION_CONFIG.sheets
      .find((sheet) => sheet.key === sheetKey)
      ?.weeklySections?.find((entry) => entry.key === sectionKey);

    const requiredFields = section?.fields || [];
      for (const field of requiredFields) {
        if (field === "defect_reported") continue;
        if (!String(values[field] || "").trim()) {
          Alert.alert("Missing Field", `Enter ${field.replace(/_/g, " ")} for ${task}.`);
          return;
      }
    }

    if (!String(values.operator_signature || "").trim()) {
      Alert.alert("Missing Signature", `Add or reuse an operator signature for ${task}.`);
      return;
    }

    const completedValue = {
      checked_by: String(values.checked_by || "").trim(),
      defect_reported: String(values.defect_reported || "").trim(),
      day: String(values.day || "").trim(),
      time: String(values.time || "").trim(),
      operator_signature: String(values.operator_signature || "").trim(),
    };

    setWeeklyCompleted((prev) => ({
      ...prev,
      [sheetKey]: {
        ...prev[sheetKey],
        [sectionKey]: {
          ...prev[sheetKey][sectionKey],
          ...Object.fromEntries(savedTasks.map((item) => [item, { ...completedValue }])),
        },
      },
    }));

    setGroupSelect(null);
    setWeeklyModal({ visible: false, sheetKey: "", sectionKey: "", task: "", values: {} });
  }

  function saveWeeklyNotApplicable() {
    const { sheetKey, sectionKey, task, values, groupTasks } = weeklyModal;
    if (!sheetKey || !sectionKey || !task) return;
    const targetTasks = Array.isArray(groupTasks) && groupTasks.length > 0 ? groupTasks : [task];
    const naValue = {
      not_applicable: true,
      checked_by: String(values.checked_by || "").trim(),
      defect_reported: "",
      day: String(values.day || "").trim(),
      time: String(values.time || "").trim(),
      operator_signature: "",
    };

    setWeeklyCompleted((prev) => ({
      ...prev,
      [sheetKey]: {
        ...prev[sheetKey],
        [sectionKey]: {
          ...prev[sheetKey][sectionKey],
          ...Object.fromEntries(targetTasks.map((item) => [item, { ...naValue }])),
        },
      },
    }));

    setGroupSelect(null);
    setWeeklyModal({ visible: false, sheetKey: "", sectionKey: "", task: "", values: {} });
  }

  function removeWeeklyTask(sheetKey, sectionKey, task) {
    setWeeklyCompleted((prev) => {
      const nextSection = { ...prev[sheetKey][sectionKey] };
      delete nextSection[task];
      return {
        ...prev,
        [sheetKey]: {
          ...prev[sheetKey],
          [sectionKey]: nextSection,
        },
      };
    });
  }

  function setMaintenanceTaskStatus(day, task, status) {
    setMaintenanceDaily((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        tasks: {
          ...prev[day].tasks,
          [task]: prev[day].tasks[task] === status ? "" : status,
        },
      },
    }));
  }

  function setQualityTaskStatus(day, task, slot, status) {
    setQualityDaily((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [task]: {
          ...prev[day][task],
          [slot]: prev[day][task][slot] === status ? "" : status,
        },
      },
    }));
  }

  function confirmMarkAllDailyChecks(onConfirm) {
    Alert.alert(
      "Mark all as complete",
      "By selecting Yes, this is acknowledgement that all checks have been undertaken.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: onConfirm },
      ]
    );
  }

  function markAllMaintenanceTasksComplete(day) {
    confirmMarkAllDailyChecks(() => {
      setMaintenanceDaily((prev) => ({
        ...prev,
        [day]: {
          ...prev[day],
          tasks: Object.fromEntries(
            Object.keys(prev[day]?.tasks || {}).map((task) => [task, "yes"])
          ),
        },
      }));
    });
  }

  function markAllQualityTasksComplete(day) {
    confirmMarkAllDailyChecks(() => {
      setQualityDaily((prev) => ({
        ...prev,
        [day]: Object.fromEntries(
          Object.keys(prev[day] || {}).map((task) => [
            task,
            {
              am: "yes",
              pm: "yes",
            },
          ])
        ),
      }));
    });
  }

  function addPowderDelivery(day) {
    const initials =
      getDayInitials(guardChecks, day, completedBy) || deriveInitialsFromName(completedBy || currentUserName);
    setPowderDeliveries((prev) => ({
      ...prev,
      [day]: [...prev[day], { start: getCurrentTimeValue(), finish: "", initials }],
    }));
  }

  function openDeliveryTimePicker(day, index, field) {
    setTimePickerTarget({ day, index, field });
    setTimePickerVisible(true);
  }

  function selectPickerTime(option) {
    if (timePickerTarget) {
      updatePowderDelivery(timePickerTarget.day, timePickerTarget.index, timePickerTarget.field, option);
    } else {
      setWeeklyModal((prev) => ({ ...prev, values: { ...prev.values, time: option } }));
    }
    setTimePickerVisible(false);
  }

  function closeTimePicker() {
    setTimePickerVisible(false);
  }

  function updatePowderDelivery(day, index, field, value) {
    setPowderDeliveries((prev) => ({
      ...prev,
      [day]: prev[day].map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      ),
    }));
  }

  function removePowderDelivery(day, index) {
    setPowderDeliveries((prev) => ({
      ...prev,
      [day]: prev[day].filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function buildStructuredChecklist() {
    const offDays = getNotOperationalDays(guardChecks);
    const blankMaintenance = createMaintenanceDailyState();
    const blankEnvLog = createEnvDailyLogState();
    const blankEmissions = createEnvEmissionsState();
    const blankQuality = createQualityDailyState();
    const clearOffDays = (source, blank) =>
      Object.fromEntries(
        Object.entries(source).map(([day, value]) => [day, offDays.has(day) && blank[day] ? blank[day] : value])
      );

    const payload = {
      __kind: BATCHING_INSPECTION_CONFIG.kind,
      meta: {
        version,
        plant_name: plantName.trim(),
        week_ending_date: weekEndingDate,
      },
      health_and_safety: {
        daily_guard_checks: guardChecks,
        plant_maintenance_daily: clearOffDays(maintenanceDaily, blankMaintenance),
        weekly_equipment_checks: weeklyCompleted.health_and_safety.weekly_equipment_checks,
        plant_maintenance_weekly: weeklyCompleted.health_and_safety.plant_maintenance_weekly,
      },
      environmental: {
        daily_logbook: clearOffDays(envDailyLog, blankEnvLog),
        powder_deliveries: powderDeliveries,
        emissions_ratings: clearOffDays(envEmissions, blankEmissions),
        environmental_weekly_checks: weeklyCompleted.environmental.environmental_weekly_checks,
      },
      quality: {
        daily_checks: clearOffDays(qualityDaily, blankQuality),
        quality_weekly_checks: weeklyCompleted.quality.quality_weekly_checks,
      },
      notes: generalNotes.trim(),
    };
    return {
      ...payload,
      summary: buildBatchingSummary(payload),
    };
  }

  function buildChecklistPayload(userId = null) {
    const contractName =
      String(
        selectedContractChoice?.contractName ||
          selectedContractChoice?.contractNo ||
          currentContractName ||
          plantName
      ).trim() || plantName.trim();
    const structuredChecklist = buildStructuredChecklist();
    return {
      id: draftRecordId || null,
      created_by: userId || null,
      sheet_version: version,
      completed_by_name: completedBy.trim(),
      job_title: jobTitle.trim() || null,
      check_date: weekEndingDate,
      machine_reg: plantName.trim(),
      asset_no: null,
      serial_no: null,
      machine_hours: null,
      machine_type: "Batching Plant",
      template_code: String(form?.templateCode || form?.id || "").trim() || null,
      template_title: String(form?.title || "").trim() || null,
      location: contractName,
      contract_id: selectedContractChoice?.id || form?.contractId || null,
      contract_name: contractName,
      contract_number: String(selectedContractChoice?.contractNo || currentContractNumber || contractName).trim(),
      checklist: structuredChecklist,
      notes: generalNotes.trim() || null,
      has_defects: buildHasDefects(structuredChecklist),
    };
  }

  async function getCurrentUserId({ silent = false } = {}) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user?.id) {
      if (!silent) {
        Alert.alert("Auth Error", "Could not identify signed-in user. Please sign in again.");
      }
      return "";
    }

    return user.id;
  }

  async function enqueueSubmission({ checklistPayload, defectsPayload, formCode, reason }) {
    await enqueueOutboxItem({ checklistPayload, defectsPayload, formCode });
    Alert.alert("Saved To Outbox", reason, [{ text: "OK", onPress: () => navigation.goBack() }]);
  }

  async function saveDraft() {
    if (!contractLocked && !selectedContractChoice) {
      Alert.alert("Missing Contract", "Please select an active contract before saving this draft.");
      return;
    }

    try {
      setSaving(true);
      const netState = await NetInfo.fetch();
      const isOnline = Boolean(netState.isConnected && netState.isInternetReachable);

      if (!isOnline) {
        Alert.alert(
          "Internet Required",
          "Save Draft stores the form against the contract folder, so it needs an internet connection."
        );
        return;
      }

      const userId = await getCurrentUserId();
      if (!userId) return;

      const result = await syncChecklistSubmission({
        checklistPayload: {
          ...buildChecklistPayload(userId),
          status: "draft",
        },
        defectsPayload: [],
        formCode: form?.templateCode || form?.id || "batching_weekly_inspection",
      });

      setDraftRecordId(String(result?.savedRow?.id || draftRecordId || ""));
      Alert.alert("Draft Saved", "Draft saved to the contract folder.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert("Draft Save Failed", String(error?.message || "Unknown error while saving draft."));
    } finally {
      setSaving(false);
    }
  }

  function validateBeforeSubmit() {
    if (!contractLocked && !selectedContractChoice) {
      return "Please select an active contract.";
    }
    if (!completedBy.trim()) return "Completed By is required.";
    if (!plantName.trim()) return "Plant name is required.";

    for (const day of operationalWeekDays) {
      if (!String(guardChecks[day]?.checkedBy || "").trim()) {
        return `Enter Checked By for ${day} in Daily Guard Checks.`;
      }
      if (!String(guardChecks[day]?.operatorSignature || "").trim()) {
        return `Add operator signature for ${day} in Daily Guard Checks.`;
      }
    }

    for (const day of operationalWorkDays) {
      if (!String(maintenanceDaily[day]?.initials || "").trim()) {
        return `Enter initials for ${day} in Plant Maintenance Daily Checks.`;
      }
      for (const [task, status] of Object.entries(maintenanceDaily[day]?.tasks || {})) {
        if (!String(status || "").trim()) {
          return `Complete '${task}' for ${day} in Plant Maintenance Daily Checks.`;
        }
      }
    }

    const envGroups = BATCHING_INSPECTION_CONFIG.sheets[1].dailySections[0].groups;
    for (const day of operationalWeekDays) {
      for (const group of envGroups) {
        if (group.slots.includes("pre_start")) {
          const entry = envDailyLog[day]?.[group.key];
          if (!String(entry?.status || "").trim()) {
            return `Select a status for Environmental Pre Start on ${day}.`;
          }
          if (!String(entry?.initials || "").trim()) {
            return `Enter initials for Environmental Pre Start on ${day}.`;
          }
          if (entry.status === "unsatisfactory" && !String(entry.comment || "").trim()) {
            return `Enter a comment for Environmental Pre Start on ${day} when Unsatisfactory is selected.`;
          }
          continue;
        }
        for (const slot of group.slots) {
          const entry = envDailyLog[day]?.[group.key]?.[slot];
          if (!String(entry?.status || "").trim()) {
            return `Select a status for Environmental ${group.key.toUpperCase()} ${slot.toUpperCase()} on ${day}.`;
          }
          if (!String(entry?.initials || "").trim()) {
            return `Enter initials for Environmental ${group.key.toUpperCase()} ${slot.toUpperCase()} on ${day}.`;
          }
          if (
            group.key !== "F" &&
            entry.status === "unsatisfactory" &&
            !String(entry.comment || "").trim()
          ) {
            return `Enter a comment for Environmental ${group.key.toUpperCase()} ${slot.toUpperCase()} on ${day} when Unsatisfactory is selected.`;
          }
        }
      }

      const ratings = envEmissions[day]?.ratings || {};
      for (const [area, value] of Object.entries(ratings)) {
        if (!String(value || "").trim()) {
          return `Select a visual emissions rating for ${area} on ${day}.`;
        }
      }
    }

    for (const day of operationalWorkDays) {
      for (const [task, slots] of Object.entries(qualityDaily[day] || {})) {
        if (!String(slots?.am || "").trim() || !String(slots?.pm || "").trim()) {
          return `Complete AM and PM for '${task}' on ${day} in Quality.`;
        }
      }
    }

    return "";
  }

  async function submitForm() {
    const validationMessage = validateBeforeSubmit();
    if (validationMessage) {
      Alert.alert("Inspection Incomplete", validationMessage);
      return;
    }

    try {
      setSaving(true);
      const netState = await NetInfo.fetch();
      const isOnline = Boolean(netState.isConnected && netState.isInternetReachable);
      const userId = await getCurrentUserId({ silent: !isOnline });
      const checklistPayload = buildChecklistPayload(userId || null);
      const defectsPayload = [];

      if (!isOnline) {
        await enqueueSubmission({
          checklistPayload: {
            ...checklistPayload,
            status: "submitted",
          },
          defectsPayload,
          formCode: form?.templateCode || form?.id || "batching_weekly_inspection",
          reason: "No internet connection. Submission queued in Outbox and will sync when online.",
        });
        return;
      }

      if (!userId) {
        Alert.alert("Auth Error", "Could not identify signed-in user. Please sign in again.");
        return;
      }

      const result = await syncChecklistSubmission({
        checklistPayload: {
          ...checklistPayload,
          status: "submitted",
        },
        defectsPayload,
        formCode: form?.templateCode || form?.id || "batching_weekly_inspection",
      });

      if (result.routingWarning) {
        Alert.alert("Routing Note", result.routingWarning);
      }

      Alert.alert("Form Submitted", "Weekly inspection saved successfully.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      const userId = await getCurrentUserId();
      if (userId && isTransportError(error)) {
        await enqueueSubmission({
          checklistPayload: {
            ...buildChecklistPayload(userId),
            status: "submitted",
          },
          defectsPayload: [],
          formCode: form?.templateCode || form?.id || "batching_weekly_inspection",
          reason: "Could not reach the server. Submission queued in Outbox and can be retried manually anytime.",
        });
        return;
      }

      Alert.alert("Save Failed", String(error?.message || "Unknown error while saving form."));
    } finally {
      setSaving(false);
    }
  }

  function renderWeeklySection(sheetKey, section) {
    const completedMap = weeklyCompleted[sheetKey]?.[section.key] || {};
    const availableTasks = section.tasks.filter((task) => !completedMap[task]);
    const completedEntries = Object.entries(completedMap);
    const selecting = Boolean(groupSelect && groupSelect.sheetKey === sheetKey && groupSelect.sectionKey === section.key);
    const selectedTasks = selecting ? groupSelect.tasks.filter((task) => availableTasks.includes(task)) : [];

    return (
      <View style={styles.sectionCard} key={section.key}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionSubheading}>Available</Text>
        {!selecting && availableTasks.length > 1 ? (
          <Text style={styles.helper}>Press and hold a check to select several and sign them together.</Text>
        ) : null}
        {selecting ? (
          <View style={styles.dayCard}>
            <Text style={styles.dayHeading}>{selectedTasks.length} selected</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.buttonInline, styles.buttonGhost]} onPress={() => setGroupSelect(null)}>
                <Text style={styles.buttonGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.buttonInline, styles.buttonGhost]}
                onPress={() => setGroupSelect({ sheetKey, sectionKey: section.key, tasks: availableTasks })}
              >
                <Text style={styles.buttonGhostText}>Select all</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.buttonInline, selectedTasks.length === 0 && styles.buttonDisabled]}
                disabled={selectedTasks.length === 0}
                onPress={openGroupWeeklyModal}
              >
                <Text style={styles.buttonText}>Complete selected</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        {availableTasks.length === 0 ? (
          <Text style={styles.helper}>All weekly tasks for this section are completed.</Text>
        ) : (
          availableTasks.map((task) => {
            const picked = selectedTasks.includes(task);
            return (
              <TouchableOpacity
                key={task}
                style={[styles.availableTaskButton, picked && { borderColor: "#2563eb", backgroundColor: "#eff6ff" }]}
                delayLongPress={350}
                onPress={() => (selecting ? toggleGroupTask(task) : openWeeklyModal(sheetKey, section.key, task))}
                onLongPress={() => startGroupSelect(sheetKey, section.key, task)}
              >
                <Text style={styles.availableTaskText}>{picked ? `✓ ${task}` : task}</Text>
              </TouchableOpacity>
            );
          })
        )}

        <Text style={styles.sectionSubheading}>Completed</Text>
        {completedEntries.length === 0 ? (
          <Text style={styles.helper}>No weekly items completed yet.</Text>
        ) : (
          completedEntries.map(([task, value]) => (
            <View key={task} style={styles.completedCard}>
              <View style={styles.completedHeader}>
                <Text style={styles.completedTitle}>{value.not_applicable ? `${task} - N/A` : task}</Text>
                <TouchableOpacity onPress={() => removeWeeklyTask(sheetKey, section.key, task)}>
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
              {value.checked_by ? <Text style={styles.completedMeta}>Checked by: {value.checked_by}</Text> : null}
              {value.day ? <Text style={styles.completedMeta}>Day: {value.day}</Text> : null}
              {value.time ? <Text style={styles.completedMeta}>Time: {value.time}</Text> : null}
              {value.operator_signature ? <Text style={styles.completedMeta}>Operator signed</Text> : null}
              {value.defect_reported ? (
                <Text style={styles.completedMeta}>Defect: {value.defect_reported}</Text>
              ) : null}
              <TouchableOpacity
                style={styles.editInline}
                onPress={() => openWeeklyModal(sheetKey, section.key, task, value)}
              >
                <Text style={styles.editInlineText}>Edit</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    );
  }

  function renderHealthAndSafety() {
    const weeklySections = BATCHING_INSPECTION_CONFIG.sheets[0].weeklySections;
    const maintenanceTasks = BATCHING_INSPECTION_CONFIG.sheets[0].dailySections[1].tasks;

    return (
      <>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Daily Guard Checks</Text>
          <Text style={styles.helper}>
            All guards must be checked prior to production commencing to ensure they are safe, secure and in position.
          </Text>
          {BATCHING_WEEK_DAYS.map((day) => {
            const dayNotOperational = isGuardDayNotOperational(guardChecks[day]);
            return (
              <View key={day} style={styles.dayCard}>
                <Text style={styles.dayHeading}>{day}</Text>
                <SectionPills
                  options={[
                    { value: "operational", label: "Operational" },
                    { value: "not_operational", label: "Not Operational" },
                  ]}
                  colorByValue={OPERATIONAL_STATUS_COLORS}
                  selected={dayNotOperational ? "not_operational" : "operational"}
                  onSelect={(value) => {
                    const wantsNotOperational = value === "not_operational";
                    if (wantsNotOperational !== dayNotOperational) {
                      setGuardDayOperational(day, !wantsNotOperational);
                    }
                  }}
                />
                {dayNotOperational ? (
                  <Text style={styles.helper}>
                    Plant not operational on {day}. No checks are required for this day.
                  </Text>
                ) : (
                  <>
                    <TouchableOpacity style={styles.selectorButton} onPress={() => openTeamMemberPicker("guard_checked_by", day)}>
                      <Text style={guardChecks[day].checkedBy ? styles.selectorText : styles.selectorPlaceholder}>
                        {guardChecks[day].checkedBy || "Select checked by"}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.inlineActionRow}>
                      <TouchableOpacity style={styles.signatureButton} onPress={() => openGuardSignature(day)}>
                        <Text style={styles.signatureButtonText}>
                          {guardChecks[day].operatorSignature ? "Edit signature" : "Click to sign"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.secondaryActionButton} onPress={() => openGuardDefect(day)}>
                        <Text style={styles.secondaryActionButtonText}>
                          {guardChecks[day].defectReported ? "Edit defect report" : "Report defect"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {guardChecks[day].operatorSignature ? (
                      <Text style={styles.completedMeta}>Operator signature captured</Text>
                    ) : null}
                    {guardChecks[day].defectReported ? (
                      <Text style={styles.completedMeta}>Defect: {guardChecks[day].defectReported}</Text>
                    ) : null}
                  </>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Plant Maintenance Daily Checks</Text>
          {operationalWorkDays.length === 0 ? (
            <Text style={styles.helper}>Plant not operational Monday to Friday. No daily maintenance checks required.</Text>
          ) : (
            <>
          <SectionPills options={operationalWorkDays} selected={maintenanceDay} onSelect={setMaintenanceDay} />
          <TouchableOpacity style={styles.addButton} onPress={() => markAllMaintenanceTasksComplete(maintenanceDay)}>
            <Text style={styles.addButtonText}>Mark all as complete</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={maintenanceDaily[maintenanceDay].initials}
            onChangeText={(value) =>
              setMaintenanceDaily((prev) => ({
                ...prev,
                [maintenanceDay]: { ...prev[maintenanceDay], initials: value },
              }))
            }
            placeholder={`${maintenanceDay} initials`}
          />
          {maintenanceTasks.map((task) => (
            <View key={task} style={styles.taskCard}>
              <Text style={styles.taskLabel}>{task}</Text>
              <SectionPills
                options={BATCHING_STATUS_OPTIONS}
                selected={maintenanceDaily[maintenanceDay].tasks[task]}
                onSelect={(value) => setMaintenanceTaskStatus(maintenanceDay, task, value)}
              />
            </View>
          ))}
            </>
          )}
        </View>

        {weeklySections.map((section) => renderWeeklySection("health_and_safety", section))}
      </>
    );
  }

  // Deliveries can arrive on non-operational days, so every day stays selectable.
  function renderPowderDeliveries() {
    return (
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Powder Deliveries</Text>
        <SectionPills options={BATCHING_WEEK_DAYS} selected={powderDay} onSelect={setPowderDay} />
        <TouchableOpacity style={styles.addButton} onPress={() => addPowderDelivery(powderDay)}>
          <Text style={styles.addButtonText}>Add Delivery</Text>
        </TouchableOpacity>
        {(powderDeliveries[powderDay] || []).length === 0 ? (
          <Text style={styles.helper}>No powder deliveries added for {powderDay}.</Text>
        ) : (
          powderDeliveries[powderDay].map((entry, index) => (
            <View key={`${powderDay}-${index}`} style={styles.deliveryCard}>
              <Text style={styles.dayHeading}>Delivery {index + 1}</Text>
              <TouchableOpacity
                style={styles.selectorButton}
                onPress={() => openDeliveryTimePicker(powderDay, index, "start")}
              >
                <Text style={entry.start ? styles.selectorText : styles.selectorPlaceholder}>
                  {entry.start ? `Start: ${entry.start}` : "Select start time"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.selectorButton}
                onPress={() => openDeliveryTimePicker(powderDay, index, "finish")}
              >
                <Text style={entry.finish ? styles.selectorText : styles.selectorPlaceholder}>
                  {entry.finish ? `Finish: ${entry.finish}` : "Select finish time"}
                </Text>
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                value={entry.initials}
                onChangeText={(value) => updatePowderDelivery(powderDay, index, "initials", value)}
                placeholder="Initials"
              />
              <TouchableOpacity onPress={() => removePowderDelivery(powderDay, index)}>
                <Text style={styles.removeText}>Remove delivery</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    );
  }

  function renderEnvironmental() {
    const groups = BATCHING_INSPECTION_CONFIG.sheets[1].dailySections[0].groups;
    const areas = BATCHING_INSPECTION_CONFIG.sheets[1].dailySections[2].areas;
    if (operationalWeekDays.length === 0) {
      return (
        <>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Environmental Logbook</Text>
            <Text style={styles.helper}>Plant not operational all week. No daily environmental checks required.</Text>
          </View>
          {renderPowderDeliveries()}
          {BATCHING_INSPECTION_CONFIG.sheets[1].weeklySections.map((section) =>
            renderWeeklySection("environmental", section)
          )}
        </>
      );
    }
    return (
      <>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Environmental Logbook</Text>
          <SectionPills options={operationalWeekDays} selected={envDay} onSelect={setEnvDay} />
          {groups.map((group) => (
            <View key={group.key} style={styles.dayCard}>
              <Text style={styles.dayHeading}>
                {group.key === "pre_start" ? "Pre Start" : `${group.key} - ${group.title}`}
              </Text>
              {group.instruction ? <Text style={styles.helper}>{group.instruction}</Text> : null}
              {group.slots.includes("pre_start") ? (
                <>
                  <SectionPills
                    options={ENVIRONMENTAL_STATUS_OPTIONS}
                    selected={envDailyLog[envDay][group.key].status}
                    onSelect={(value) =>
                      setEnvDailyLog((prev) => ({
                        ...prev,
                        [envDay]: {
                          ...prev[envDay],
                          [group.key]: { ...prev[envDay][group.key], status: value },
                        },
                      }))
                    }
                    colorByValue={ENVIRONMENTAL_STATUS_COLORS}
                  />
                  <TextInput
                    style={styles.input}
                    value={envDailyLog[envDay][group.key].initials}
                    onChangeText={(value) =>
                      setEnvDailyLog((prev) => ({
                        ...prev,
                        [envDay]: {
                          ...prev[envDay],
                          [group.key]: { ...prev[envDay][group.key], initials: value },
                        },
                      }))
                    }
                    placeholder="Initials"
                  />
                  {envDailyLog[envDay][group.key].status === "unsatisfactory" ? (
                    <TextInput
                      style={styles.input}
                      value={envDailyLog[envDay][group.key].comment || ""}
                      onChangeText={(value) =>
                        setEnvDailyLog((prev) => ({
                          ...prev,
                          [envDay]: {
                            ...prev[envDay],
                            [group.key]: { ...prev[envDay][group.key], comment: value },
                          },
                        }))
                      }
                      placeholder="Comment (required for Unsatisfactory)"
                      multiline
                    />
                  ) : null}
                </>
              ) : (
                group.slots.map((slot) => (
                  <View key={slot} style={styles.slotBlock}>
                    <Text style={styles.slotHeading}>{slot.toUpperCase()}</Text>
                    <SectionPills
                      options={group.key === "F" ? ENVIRONMENTAL_WEATHER_OPTIONS : ENVIRONMENTAL_STATUS_OPTIONS}
                      selected={envDailyLog[envDay][group.key][slot].status}
                      onSelect={(value) =>
                        setEnvDailyLog((prev) => ({
                          ...prev,
                          [envDay]: {
                            ...prev[envDay],
                            [group.key]: {
                              ...prev[envDay][group.key],
                              [slot]: { ...prev[envDay][group.key][slot], status: value },
                            },
                          },
                        }))
                      }
                      colorByValue={ENVIRONMENTAL_STATUS_COLORS}
                    />
                    <TextInput
                      style={styles.input}
                      value={envDailyLog[envDay][group.key][slot].initials}
                      onChangeText={(value) =>
                        setEnvDailyLog((prev) => ({
                          ...prev,
                          [envDay]: {
                            ...prev[envDay],
                            [group.key]: {
                              ...prev[envDay][group.key],
                              [slot]: { ...prev[envDay][group.key][slot], initials: value },
                            },
                          },
                        }))
                      }
                      placeholder="Initials"
                    />
                    {group.key !== "F" && envDailyLog[envDay][group.key][slot].status === "unsatisfactory" ? (
                      <TextInput
                        style={styles.input}
                        value={envDailyLog[envDay][group.key][slot].comment || ""}
                        onChangeText={(value) =>
                          setEnvDailyLog((prev) => ({
                            ...prev,
                            [envDay]: {
                              ...prev[envDay],
                              [group.key]: {
                                ...prev[envDay][group.key],
                                [slot]: { ...prev[envDay][group.key][slot], comment: value },
                              },
                            },
                          }))
                        }
                        placeholder="Comment (required for Unsatisfactory)"
                        multiline
                      />
                    ) : null}
                  </View>
                ))
              )}
            </View>
          ))}
        </View>

        {renderPowderDeliveries()}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Visual Assessment Of Emissions To Air</Text>
          <Text style={styles.helper}>
            Visual Assessment of Emissions to Air: 1 - None, 2 - Minor, 3 - Serious, 4 - Major.
          </Text>
          <SectionPills options={operationalWeekDays} selected={envDay} onSelect={setEnvDay} />
          {areas.map((area) => (
            <View key={area} style={styles.taskCard}>
              <Text style={styles.taskLabel}>{area}</Text>
              <SectionPills
                options={["1", "2", "3", "4"]}
                selected={envEmissions[envDay].ratings[area]}
                onSelect={(value) =>
                  setEnvEmissions((prev) => ({
                    ...prev,
                    [envDay]: {
                      ...prev[envDay],
                      ratings: { ...prev[envDay].ratings, [area]: value },
                    },
                  }))
                }
              />
            </View>
          ))}
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={envEmissions[envDay].spillageAction}
            onChangeText={(value) =>
              setEnvEmissions((prev) => ({
                ...prev,
                [envDay]: { ...prev[envDay], spillageAction: value },
              }))
            }
            placeholder="Spillage due to plant defects / action item E (optional)"
            multiline
          />
        </View>

        {BATCHING_INSPECTION_CONFIG.sheets[1].weeklySections.map((section) =>
          renderWeeklySection("environmental", section)
        )}
      </>
    );
  }

  function renderQuality() {
    const tasks = BATCHING_INSPECTION_CONFIG.sheets[2].dailySections[0].tasks;
    return (
      <>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Daily Quality Checks</Text>
          {operationalWorkDays.length === 0 ? (
            <Text style={styles.helper}>Plant not operational Monday to Friday. No daily quality checks required.</Text>
          ) : (
            <>
          <SectionPills options={operationalWorkDays} selected={qualityDay} onSelect={setQualityDay} />
          <TouchableOpacity style={styles.addButton} onPress={() => markAllQualityTasksComplete(qualityDay)}>
            <Text style={styles.addButtonText}>Mark all as complete</Text>
          </TouchableOpacity>
          {tasks.map((task) => (
            <View key={task} style={styles.taskCard}>
              <Text style={styles.taskLabel}>{task}</Text>
              <Text style={styles.slotHeading}>AM</Text>
              <SectionPills
                options={BATCHING_STATUS_OPTIONS}
                selected={qualityDaily[qualityDay][task].am}
                onSelect={(value) => setQualityTaskStatus(qualityDay, task, "am", value)}
              />
              <Text style={styles.slotHeading}>PM</Text>
              <SectionPills
                options={BATCHING_STATUS_OPTIONS}
                selected={qualityDaily[qualityDay][task].pm}
                onSelect={(value) => setQualityTaskStatus(qualityDay, task, "pm", value)}
              />
            </View>
          ))}
            </>
          )}
        </View>

        {BATCHING_INSPECTION_CONFIG.sheets[2].weeklySections.map((section) =>
          renderWeeklySection("quality", section)
        )}
      </>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{form?.title || BATCHING_INSPECTION_CONFIG.title}</Text>
      <Text style={styles.helper}>
        Daily sections are required. Weekly checks stay available until you complete them, then move into the completed list.
      </Text>

      <Text style={styles.fieldLabel}>Version</Text>
      <TextInput style={styles.input} value={version} onChangeText={setVersion} />

      <Text style={styles.fieldLabel}>Completed By</Text>
      <TextInput style={styles.input} value={completedBy} onChangeText={setCompletedBy} />

      <Text style={styles.fieldLabel}>Job Title</Text>
      <TextInput style={styles.input} value={jobTitle} onChangeText={setJobTitle} />

      <Text style={styles.fieldLabel}>Week Ending Date</Text>
      <TextInput style={styles.input} value={weekEndingDate} onChangeText={setWeekEndingDate} />

      <Text style={styles.fieldLabel}>Plant</Text>
      <TouchableOpacity style={styles.selectorButton} onPress={() => setPlantPickerVisible(true)}>
        <Text style={styles.selectorText}>{plantName}</Text>
      </TouchableOpacity>
      <Modal
        visible={plantPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPlantPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.contractPickerCard}>
            <Text style={styles.modalTitle}>Select Plant</Text>
            <ScrollView style={styles.contractPickerList}>
              {plantOptions.map((option) => {
                const selected = option === plantName;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.contractPickerOption, selected && styles.contractPickerOptionSelected]}
                    onPress={() => {
                      setPlantName(option);
                      setPlantPickerVisible(false);
                    }}
                  >
                    <Text style={[styles.contractPickerOptionText, selected && styles.contractPickerOptionTextSelected]}>
                      {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.buttonInline, styles.buttonGhost]}
              onPress={() => setPlantPickerVisible(false)}
            >
              <Text style={styles.buttonGhostText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Text style={styles.fieldLabel}>Location</Text>
      {contractLocked ? (
        <TextInput
          style={[styles.input, styles.inputReadonly]}
          value={selectedContractChoice?.contractName || selectedContractChoice?.contractNo || currentContractName}
          editable={false}
        />
      ) : (
        <>
          <TouchableOpacity style={styles.selectorButton} onPress={() => setContractPickerVisible(true)}>
            <Text style={selectedContractChoice ? styles.selectorText : styles.selectorPlaceholder}>
              {selectedContractChoice ? formatContractChoice(selectedContractChoice) : "Select active contract"}
            </Text>
          </TouchableOpacity>
          <Modal
            visible={contractPickerVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setContractPickerVisible(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.contractPickerCard}>
                <Text style={styles.modalTitle}>Select Active Contract</Text>
                <ScrollView style={styles.contractPickerList}>
                  {contractOptions.map((option) => {
                    const selected =
                      option.id === selectedContractChoice?.id &&
                      option.contractNo === selectedContractChoice?.contractNo;
                    return (
                      <TouchableOpacity
                        key={`${option.id || option.contractNo || option.contractName}`}
                        style={[styles.contractPickerOption, selected && styles.contractPickerOptionSelected]}
                        onPress={() => {
                          setSelectedContractChoice(option);
                          setContractPickerVisible(false);
                        }}
                      >
                        <Text style={[styles.contractPickerOptionText, selected && styles.contractPickerOptionTextSelected]}>
                          {formatContractChoice(option)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <TouchableOpacity
                  style={[styles.buttonInline, styles.buttonGhost]}
                  onPress={() => setContractPickerVisible(false)}
                >
                  <Text style={styles.buttonGhostText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </>
      )}

      <SectionPills
        options={BATCHING_INSPECTION_CONFIG.sheets.map((sheet) => ({ value: sheet.key, label: sheet.title }))}
        selected={activeSheet}
        onSelect={setActiveSheet}
      />

      {activeSheet === "health_and_safety" ? renderHealthAndSafety() : null}
      {activeSheet === "environmental" ? renderEnvironmental() : null}
      {activeSheet === "quality" ? renderQuality() : null}

      <Text style={styles.fieldLabel}>General Notes</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={generalNotes}
        onChangeText={setGeneralNotes}
        multiline
        placeholder="Notes"
      />

      <View style={styles.bottomActionRow}>
        <TouchableOpacity
          style={[styles.submitButton, styles.secondaryButton, saving && styles.buttonDisabled]}
          onPress={saveDraft}
          disabled={saving}
        >
          <Text style={[styles.submitButtonText, styles.secondaryButtonText]}>
            {saving ? "Saving..." : "Save Draft"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.submitButton, saving && styles.buttonDisabled]} onPress={submitForm} disabled={saving}>
          <Text style={styles.submitButtonText}>{saving ? "Saving..." : "Submit Weekly Inspection"}</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={weeklyModal.visible && !weeklySubModalOpen}
        transparent
        animationType="none"
        onRequestClose={() => setWeeklyModal({ visible: false, sheetKey: "", sectionKey: "", task: "", values: {} })}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{weeklyModal.task || "Weekly Check"}</Text>
            {weeklyModal.groupTasks?.length ? (
              <Text style={styles.helper}>{weeklyModal.groupTasks.join("\n")}</Text>
            ) : null}
            <TouchableOpacity
              style={styles.naActionButton}
              onPress={saveWeeklyNotApplicable}
              accessibilityRole="button"
              accessibilityLabel={
                weeklyModal.groupTasks?.length
                  ? "Mark all selected checks as not applicable"
                  : "Mark check as not applicable"
              }
            >
              <Text style={styles.naActionButtonText}>
                {weeklyModal.groupTasks?.length
                  ? "Mark selected checks as N/A"
                  : "Mark check as N/A"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.selectorButton} onPress={() => openTeamMemberPicker("weekly_checked_by")}>
              <Text style={weeklyModal.values.checked_by ? styles.selectorText : styles.selectorPlaceholder}>
                {weeklyModal.values.checked_by || "Select checked by"}
              </Text>
            </TouchableOpacity>
            <SectionPills options={BATCHING_WEEK_DAYS} selected={weeklyModal.values.day || ""} onSelect={(value) =>
              setWeeklyModal((prev) => ({ ...prev, values: { ...prev.values, day: value } }))
            } />
            <Text style={styles.fieldLabel}>Time</Text>
            <TouchableOpacity
              style={styles.selectorButton}
              onPress={() => {
                setTimePickerTarget(null);
                setTimePickerVisible(true);
              }}
            >
              <Text style={weeklyModal.values.time ? styles.selectorText : styles.selectorPlaceholder}>
                {weeklyModal.values.time || "Select time"}
              </Text>
            </TouchableOpacity>
            <View style={styles.inlineActionRow}>
              <TouchableOpacity style={styles.signatureButton} onPress={openWeeklySignature}>
                <Text style={styles.signatureButtonText}>
                  {weeklyModal.values.operator_signature ? "Edit signature" : "Click to sign"}
                </Text>
              </TouchableOpacity>
              {weeklyModal.groupTasks?.length ? null : (
                <TouchableOpacity style={styles.secondaryActionButton} onPress={openWeeklyDefect}>
                  <Text style={styles.secondaryActionButtonText}>
                    {weeklyModal.values.defect_reported ? "Edit defect report" : "Report defect"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {weeklyModal.values.operator_signature ? (
              <Text style={styles.completedMeta}>Operator signature captured</Text>
            ) : null}
            {weeklyModal.values.defect_reported ? (
              <Text style={styles.completedMeta}>Defect: {weeklyModal.values.defect_reported}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.buttonInline, styles.buttonGhost]}
                onPress={() => setWeeklyModal({ visible: false, sheetKey: "", sectionKey: "", task: "", values: {} })}
              >
                <Text style={styles.buttonGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonInline} onPress={saveWeeklyModal}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={timePickerVisible}
        transparent
        animationType="none"
        onRequestClose={closeTimePicker}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.contractPickerCard}>
            <Text style={styles.modalTitle}>Select time</Text>
            <ScrollView ref={timePickerScrollRef} style={styles.contractPickerList}>
              {QUARTER_HOUR_OPTIONS.map((option) => {
                const selected = option === pickerCurrentValue;
                const scrollTarget = option === (pickerCurrentValue || getCurrentTimeValue());
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.contractPickerOption, selected && styles.contractPickerOptionSelected]}
                    onLayout={(event) => {
                      if (scrollTarget) {
                        timePickerScrollRef.current?.scrollTo({
                          y: Math.max(event.nativeEvent.layout.y - 80, 0),
                          animated: false,
                        });
                      }
                    }}
                    onPress={() => selectPickerTime(option)}
                  >
                    <Text style={styles.contractPickerOptionText}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.buttonInline, styles.buttonGhost]}
              onPress={closeTimePicker}
            >
              <Text style={styles.buttonGhostText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={teamPicker.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setTeamPicker({ visible: false, target: null, day: "", title: "Select team member" })}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.contractPickerCard}>
            <Text style={styles.modalTitle}>{teamPicker.title}</Text>
            <ScrollView style={styles.contractPickerList}>
              {teamMemberOptions.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={styles.contractPickerOption}
                  onPress={() => applyTeamMemberSelection(name)}
                >
                  <Text style={styles.contractPickerOptionText}>{name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.buttonInline, styles.buttonGhost]}
              onPress={() => setTeamPicker({ visible: false, target: null, day: "", title: "Select team member" })}
            >
              <Text style={styles.buttonGhostText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={defectModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setDefectModalVisible(false);
          setDefectTarget({ type: null, day: "", title: "Report Defect" });
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{defectTarget.title}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={getDefectText()}
              onChangeText={setDefectText}
              placeholder="Enter defect details"
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.buttonInline, styles.buttonGhost]}
                onPress={() => {
                  setDefectModalVisible(false);
                  setDefectTarget({ type: null, day: "", title: "Report Defect" });
                }}
              >
                <Text style={styles.buttonGhostText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSignatureModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowSignatureModal(false);
          setSignatureTarget({ type: null, day: "", title: "Sign Check" });
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.signatureModal}>
            <Text style={styles.modalTitle}>{signatureTarget.title}</Text>
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
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowSignatureModal(false);
                  setSignatureTarget({ type: null, day: "", title: "Sign Check" });
                }}
              >
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#fff",
  },
  contract: {
    color: "#666",
    fontSize: 12,
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  helper: {
    color: "#666",
    fontSize: 12,
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  inputReadonly: {
    backgroundColor: "#f5f6fa",
    color: "#666",
  },
  notesInput: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  selectorButton: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  selectorText: {
    color: "#111827",
  },
  selectorPlaceholder: {
    color: "#6b7280",
  },
  inlineActionRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  pillActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  pillText: {
    color: "#1f2937",
    fontSize: 12,
    fontWeight: "600",
  },
  pillTextActive: {
    color: "#fff",
  },
  sectionCard: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  sectionSubheading: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 6,
  },
  dayCard: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#fafafa",
  },
  dayHeading: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },
  slotBlock: {
    marginBottom: 8,
  },
  slotHeading: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 4,
  },
  taskCard: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
    marginTop: 8,
  },
  taskLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  availableTaskButton: {
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#eff6ff",
  },
  availableTaskText: {
    color: "#1d4ed8",
    fontWeight: "600",
  },
  completedCard: {
    borderWidth: 1,
    borderColor: "#d1fae5",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#f0fdf4",
  },
  completedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  completedTitle: {
    flex: 1,
    fontWeight: "700",
    color: "#065f46",
  },
  completedMeta: {
    color: "#065f46",
    marginTop: 4,
  },
  editInline: {
    marginTop: 8,
  },
  editInlineText: {
    color: "#1d4ed8",
    fontWeight: "600",
  },
  removeText: {
    color: "#b91c1c",
    fontWeight: "600",
  },
  addButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
    marginBottom: 10,
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  signatureButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#c7d2fe",
    borderRadius: 8,
    backgroundColor: "#eef2ff",
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  signatureButtonText: {
    color: "#1e3a8a",
    fontWeight: "600",
  },
  secondaryActionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  secondaryActionButtonText: {
    color: "#111827",
    fontWeight: "600",
  },
  naActionButton: {
    borderWidth: 1,
    borderColor: "#1d4ed8",
    borderRadius: 8,
    backgroundColor: "#eff6ff",
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  naActionButtonText: {
    color: "#1e3a8a",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  deliveryCard: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  submitButton: {
    backgroundColor: "#111827",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginVertical: 12,
    flex: 1,
  },
  bottomActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  submitButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: "#e2e8f0",
  },
  secondaryButtonText: {
    color: "#0f172a",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
  },
  signatureModal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  signaturePadWrap: {
    height: 260,
    overflow: "hidden",
    borderRadius: 10,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  buttonInline: {
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
  },
  buttonGhost: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  buttonGhostText: {
    color: "#111827",
    fontWeight: "700",
  },
  cancelButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: "#111827",
    fontWeight: "700",
  },
  clearButton: {
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fdba74",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  clearButtonText: {
    color: "#9a3412",
    fontWeight: "700",
  },
  confirmButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  confirmButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  contractPickerCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    maxHeight: "80%",
  },
  contractPickerList: {
    maxHeight: 320,
    marginBottom: 10,
  },
  contractPickerOption: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  contractPickerOptionSelected: {
    backgroundColor: "#eff6ff",
  },
  contractPickerOptionText: {
    color: "#111827",
  },
  contractPickerOptionTextSelected: {
    color: "#1d4ed8",
    fontWeight: "700",
  },
});
