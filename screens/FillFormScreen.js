import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView, Modal, Image } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../supabase";
import { enqueueOutboxItem } from "../services/outboxQueue";
import { syncChecklistSubmission } from "../services/checklistSync";

const STATUS_OPTIONS = ["X", "Y", "N/A", "R"];
const DEFECT_PHOTO_MAX_FILES = 5;
const DEFECT_CATEGORIES = ["Health and Safety", "Environmental", "Quality", "Other"];
const DEFECT_PRIORITIES = [
  { value: 1, label: "1 - Dangerous", desc: "Work must be STOPPED immediately", color: "#ff4d4d" },
  { value: 2, label: "2 - Major", desc: "Repair needed same shift", color: "#ff944d" },
  { value: 3, label: "3 - Routine", desc: "Repair within 2-3 days", color: "#ffd24d" },
  { value: 4, label: "4 - Minor", desc: "Repair within 1-2 weeks", color: "#4da6ff" },
  { value: 5, label: "5 - Cosmetic", desc: "Repair when convenient", color: "#d9d9d9" },
  {
    value: 6,
    label: "6 - Improvement / Preventative maintenance",
    desc: "Improvement / preventative maintenance",
    color: "#3cb371",
  },
];

const CHECK_ITEMS = [
  "Engine Oil - Level Correct",
  "Engine - Free From Leaks, Excessive Noise",
  "Coolant Level (Antifreeze)",
  "Fan Belt Condition",
  "Exhaust Visual Inspection, Free from leaks",
  "Adblue Level",
  "Service Sticker",
  "Hand Rails, Steps, Guards & Covers",
  "Floor Space, Mats & Rubbers",
  "360 Vision - Mirrors, Cameras, HFR Cameras & Screen",
  "Seats - Operates, Adjusts",
  "Seat Belt Operation",
  "Windscreen",
  "Washers & Wipers",
  "Main Drive Lever Forward & Reverse - Locks in Centre Position",
  "Fuel Tank - Security, Filler, Free From Leaks",
  "Cab/ROPS Hinges, Locks, Pins & Frame",
  "Air Conditioning/Heating",
  "Fire Extinguisher",
  "Emergency Hammer",
  "Body Panel Condition & Underneath Machine",
  "Reflectors/Chevrons - Side & Rear inc Reflective Tape & Decals",
  "Number Plate",
  "Dashboard Cover",
  "Operator Manual",
  "Batteries - Serviceable",
  "Isolator Switch",
  "Emergency Stops",
  "Reverse Alarm - Audible & Visual",
  "Lights - Brake, Side, Dipped, Indicator, Work, Beacons, Green Beacon, Exclusion Zone Lighting",
  "Dash Free From Fault Codes & Warning Symbols",
  "Horn",
  "Park Brake",
  "Seat Sensor Operation",
  "Hydraulic Oil Level",
  "Hydraulic Hoses",
  "Steering",
  "Rams - Free From Leaks",
  "All Hydraulic Functions",
  "Cutting Wheel Operation",
  "Drum Mats & Scraper",
  "Spray Bar, Jets, Water Tank & Filter",
  "Machine Greased",
  "Machine Cleanliness",
  "Other",
  "Tyre/Wheel Condition",
  "Wheel Nuts & Indicators",
  "Donkey Engine Oil - Level Correct",
  "Donkey Engine Pull Cord Condition",
  "Donkey Engine Pump & Clutch Condition",
];

function buildInitialChecklist() {
  return CHECK_ITEMS.reduce((acc, item) => {
    acc[item] = "";
    return acc;
  }, {});
}

function buildTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeAssetIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseDefectNotesByChecklistItem(notesText) {
  const map = {};
  String(notesText || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^Defect\s*-\s*(.*?):\s*(.*)$/i);
      if (!match) return;
      const item = String(match[1] || "").trim();
      const detail = String(match[2] || "").trim();
      if (item) {
        map[item] = detail;
      }
    });
  return map;
}

function isTransportError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("network") || msg.includes("fetch") || msg.includes("timed out");
}

export default function FillFormScreen({ route, navigation }) {
  const form = route?.params?.form;
  const isFocused = useIsFocused();
  const defaultContractLocation = form?.contractName || form?.contractNo || "ROLLER";
  const [version, setVersion] = useState("1");
  const [completedBy, setCompletedBy] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [date, setDate] = useState(buildTodayIsoDate());
  const [machineReg, setMachineReg] = useState("");
  const [assetTag, setAssetTag] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [machineHours, setMachineHours] = useState("");
  const [machineType, setMachineType] = useState("Roller");
  const [location, setLocation] = useState(defaultContractLocation);
  const [checklist, setChecklist] = useState(buildInitialChecklist());
  const [notes, setNotes] = useState("");
  const [assetDirectory, setAssetDirectory] = useState([]);
  const [assetLookupTrace, setAssetLookupTrace] = useState("");
  const [prefillTrace, setPrefillTrace] = useState("");
  const [defectPromptVisible, setDefectPromptVisible] = useState(false);
  const [defectPromptItem, setDefectPromptItem] = useState("");
  const [defectPromptText, setDefectPromptText] = useState("");
  const [defectReviewVisible, setDefectReviewVisible] = useState(false);
  const [defectRows, setDefectRows] = useState([]);
  const [defectSubmitting, setDefectSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);

  const defectFound = useMemo(
    () => Object.values(checklist).some((value) => value === "X"),
    [checklist]
  );

  const allMarkedChecked = useMemo(
    () => CHECK_ITEMS.every((item) => checklist[item] === "Y"),
    [checklist]
  );

  const assetDirectoryLookup = useMemo(() => {
    const byMachineReg = new Map();
    const byAssetNo = new Map();
    const bySerialNo = new Map();

    const push = (map, key, row) => {
      if (!key) return;
      const existing = map.get(key) || [];
      existing.push(row);
      map.set(key, existing);
    };

    assetDirectory.forEach((row) => {
      push(byMachineReg, normalizeAssetIdentifier(row.machine_reg), row);
      push(byAssetNo, normalizeAssetIdentifier(row.asset_no), row);
      push(bySerialNo, normalizeAssetIdentifier(row.serial_no), row);
    });

    return { byMachineReg, byAssetNo, bySerialNo };
  }, [assetDirectory]);

  useEffect(() => {
    if (!isFocused) return;

    // Ensure each checklist starts from contract context and today's date.
    setDate(buildTodayIsoDate());
    setLocation(defaultContractLocation);
    initializeUserDefaults();
    fetchAssetDirectory();
  }, [isFocused, form?.id, defaultContractLocation]);

  async function initializeUserDefaults() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const sessionUser = session?.user || null;
    let user = sessionUser;

    if (!user) {
      const {
        data: { user: fetchedUser },
        error,
      } = await supabase.auth.getUser();

      if (error || !fetchedUser) {
        setPrefillTrace("User defaults unavailable (no active session yet).");
        return;
      }

      user = fetchedUser;
    }

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
    setJobTitle((prev) => (String(prev || "").trim() ? prev : defaultRole));
    setPrefillTrace(`Prefilled user defaults from ${profile ? "profile" : "auth metadata"}.`);
  }

  async function fetchAssetDirectory() {
    const { data: functionData, error: functionError } = await supabase.functions.invoke(
      "list-maintenance-plant-assets"
    );

    if (!functionError && functionData?.success && Array.isArray(functionData.assets)) {
      setAssetDirectory(
        functionData.assets.map((row) => ({
          machine_reg: row.machine_reg || "",
          asset_no: row.asset_no || "",
          serial_no: row.serial_no || "",
        }))
      );
      setAssetLookupTrace(`Loaded ${functionData.assets.length} asset records.`);
      return;
    }

    const { data } = await supabase
      .from("roller_daily_checks")
      .select("machine_reg, asset_no, serial_no")
      .order("created_at", { ascending: false })
      .limit(500);

    setAssetDirectory(
      (data || []).map((row) => ({
        machine_reg: row.machine_reg || "",
        asset_no: row.asset_no || "",
        serial_no: row.serial_no || "",
      }))
    );
    setAssetLookupTrace(`Loaded ${(data || []).length} recent records (fallback).`);
  }

  function rankAssetMatch(row, field) {
    const values = [row?.machine_reg, row?.asset_no, row?.serial_no].map((v) => String(v || "").trim());
    const totalFilled = values.filter(Boolean).length;

    const otherFilled =
      field === "machine_reg"
        ? [row?.asset_no, row?.serial_no]
        : field === "asset_no"
          ? [row?.machine_reg, row?.serial_no]
          : [row?.machine_reg, row?.asset_no];

    const otherCount = otherFilled.map((v) => String(v || "").trim()).filter(Boolean).length;
    return otherCount * 10 + totalFilled;
  }

  function findBestAssetMatch(field, rawValue) {
    const key = normalizeAssetIdentifier(rawValue);
    if (!key) return null;

    const source =
      field === "machine_reg"
        ? assetDirectoryLookup.byMachineReg
        : field === "asset_no"
          ? assetDirectoryLookup.byAssetNo
          : assetDirectoryLookup.bySerialNo;

    const matches = source.get(key) || [];
    if (matches.length === 0) return null;

    return [...matches].sort((a, b) => rankAssetMatch(b, field) - rankAssetMatch(a, field))[0] || null;
  }

  function handleMachineRegInput(value) {
    setMachineReg(value);
    if (!String(value || "").trim()) {
      setAssetLookupTrace("");
      return;
    }

    const match = findBestAssetMatch("machine_reg", value);
    if (!match) {
      setAssetLookupTrace("No match for Machine Reg.");
      return;
    }

    setAssetLookupTrace("Machine Reg matched. Auto-filled Asset No and Serial No.");
    setAssetTag(match.asset_no || "");
    setSerialNo(match.serial_no || "");
  }

  function handleAssetNoInput(value) {
    setAssetTag(value);
    if (!String(value || "").trim()) {
      setAssetLookupTrace("");
      return;
    }

    const match = findBestAssetMatch("asset_no", value);
    if (!match) {
      setAssetLookupTrace("No match for Asset No.");
      return;
    }

    setAssetLookupTrace("Asset No matched. Auto-filled Machine Reg and Serial No.");
    setMachineReg(match.machine_reg || "");
    setSerialNo(match.serial_no || "");
  }

  function handleSerialNoInput(value) {
    setSerialNo(value);
    if (!String(value || "").trim()) {
      setAssetLookupTrace("");
      return;
    }

    const match = findBestAssetMatch("serial_no", value);
    if (!match) {
      setAssetLookupTrace("No match for Serial No.");
      return;
    }

    setAssetLookupTrace("Serial No matched. Auto-filled Machine Reg and Asset No.");
    setMachineReg(match.machine_reg || "");
    setAssetTag(match.asset_no || "");
  }

  function openDefectPrompt(item) {
    setDefectPromptItem(item);
    setDefectPromptText("");
    setDefectPromptVisible(true);
  }

  function closeDefectPrompt() {
    setDefectPromptVisible(false);
    setDefectPromptItem("");
    setDefectPromptText("");
  }

  function confirmDefectPrompt() {
    const detail = defectPromptText.trim();
    if (!detail) {
      Alert.alert("Defect Detail Required", "Please enter defect details before marking this item as defect.");
      return;
    }

    const item = defectPromptItem;
    if (!item) {
      closeDefectPrompt();
      return;
    }

    setChecklist((prev) => ({ ...prev, [item]: "X" }));
    setNotes((prev) => {
      const prefix = prev && prev.trim() ? `${prev.trim()}\n` : "";
      return `${prefix}Defect - ${item}: ${detail}`;
    });
    closeDefectPrompt();
  }

  function setItemStatus(item, status) {
    if (status === "X" && checklist[item] !== "X") {
      openDefectPrompt(item);
      return;
    }

    setChecklist((prev) => ({ ...prev, [item]: status }));
  }

  function buildDefectDrafts() {
    const notesByItem = parseDefectNotesByChecklistItem(notes);
    const defectItems = CHECK_ITEMS.filter((item) => checklist[item] === "X");

    return defectItems.map((item, index) => ({
      id: `${index}-${item}`,
      checklist_item: item,
      should_send: true,
      title: item,
      description: notesByItem[item] || `Defect identified in checklist item: ${item}`,
      category: "Health and Safety",
      other_category_text: "",
      priority: 3,
      photos: [],
    }));
  }

  function setDefectRowField(id, field, value) {
    setDefectRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function resolveDefectCategory(row) {
    const category = String(row?.category || "").trim();
    if (category !== "Other") return category;
    const other = String(row?.other_category_text || "").trim();
    return other ? `Other: ${other}` : "Other";
  }

  function addPhotoToRow(rowId, photo) {
    setDefectRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const current = Array.isArray(row.photos) ? row.photos : [];
        if (current.length >= DEFECT_PHOTO_MAX_FILES) {
          return row;
        }
        return { ...row, photos: [...current, photo] };
      })
    );
  }

  function removePhotoFromRow(rowId, index) {
    setDefectRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const next = [...(Array.isArray(row.photos) ? row.photos : [])];
        next.splice(index, 1);
        return { ...row, photos: next };
      })
    );
  }

  async function handlePickPhotoFromGallery(rowId) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Gallery permission is required to add photos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType || "image/jpeg";
    const name = asset.fileName || `gallery_${Date.now()}.jpg`;
    const dataUrl = asset.base64 ? `data:${mimeType};base64,${asset.base64}` : "";

    if (!dataUrl) {
      Alert.alert("Photo Error", "Could not read selected image.");
      return;
    }

    addPhotoToRow(rowId, {
      name,
      type: mimeType,
      uri: asset.uri,
      dataUrl,
    });
  }

  async function handleTakePhoto(rowId) {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Camera permission is required to take photos.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType || "image/jpeg";
    const name = asset.fileName || `camera_${Date.now()}.jpg`;
    const dataUrl = asset.base64 ? `data:${mimeType};base64,${asset.base64}` : "";

    if (!dataUrl) {
      Alert.alert("Photo Error", "Could not read captured image.");
      return;
    }

    addPhotoToRow(rowId, {
      name,
      type: mimeType,
      uri: asset.uri,
      dataUrl,
    });
  }

  function buildChecklistPayload(userId = null) {
    const contractName = location.trim() || defaultContractLocation;
    return {
      created_by: userId || null,
      sheet_version: version,
      completed_by_name: completedBy.trim(),
      job_title: jobTitle.trim() || null,
      check_date: date,
      machine_reg: machineReg.trim(),
      asset_no: assetTag.trim() || null,
      serial_no: serialNo.trim() || null,
      machine_hours: machineHours ? Number(machineHours) : null,
      machine_type: machineType.trim() || "Roller",
      location: contractName,
      contract_name: contractName,
      contract_number: form?.contractNo || defaultContractLocation,
      checklist,
      notes: notes.trim() || null,
      has_defects: defectFound,
    };
  }

  function buildDefectPayload(selectedRows) {
    return selectedRows.map((row) => ({
      asset: machineReg || assetTag || machineType || "Unknown",
      title: row.title,
      description: row.description,
      category: resolveDefectCategory(row),
      priority: Number(row.priority) || 3,
      submitted_by: completedBy || "Contracts App",
      status: "Reported",
      contract_name: location || defaultContractLocation,
      contract_number: form?.contractNo || defaultContractLocation,
      checklist_item: row.checklist_item,
      machine_reg: machineReg || null,
      asset_no: assetTag || null,
      serial_no: serialNo || null,
      check_date: date || null,
      photos: Array.isArray(row.photos)
        ? row.photos
            .filter((p) => p?.dataUrl)
            .map((p) => ({
              name: p.name,
              type: p.type,
              dataUrl: p.dataUrl,
            }))
        : [],
    }));
  }

  async function getCurrentUserId({ silent = false } = {}) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.id) {
      if (!silent) {
        Alert.alert("Auth Error", "Could not identify signed-in user. Please sign in again.");
      }
      return "";
    }

    return user.id;
  }

  async function enqueueSubmission({ checklistPayload, defectsPayload, reason }) {
    await enqueueOutboxItem({ checklistPayload, defectsPayload });
    setDefectReviewVisible(false);
    Alert.alert(
      "Saved To Outbox",
      reason || "Submission stored on this device and will retry automatically when online.",
      [{ text: "OK", onPress: () => navigation.goBack() }]
    );
  }

  function showSuccess(defectSummaryText = "") {
    Alert.alert(
      "Form Submitted",
      defectSummaryText || (defectFound ? "Form saved with defects flagged." : "Form saved successfully."),
      [{ text: "OK", onPress: () => navigation.goBack() }]
    );
  }

  async function handleConfirmDefectsAndSubmit() {
    const selected = defectRows.filter((row) => row.should_send);

    for (const row of selected) {
      if (!DEFECT_CATEGORIES.includes(String(row.category || ""))) {
        Alert.alert("Missing Field", `Choose category for ${row.checklist_item}.`);
        return;
      }

      if (row.category === "Other" && !String(row.other_category_text || "").trim()) {
        Alert.alert("Missing Field", `Enter Other category detail for ${row.checklist_item}.`);
        return;
      }
    }

    setDefectSubmitting(true);

    try {
      const netState = await NetInfo.fetch();
      const isOnline = Boolean(netState.isConnected && netState.isInternetReachable);
      const userId = await getCurrentUserId({ silent: !isOnline });

      const checklistPayload = buildChecklistPayload(userId || null);
      const defectsPayload = buildDefectPayload(selected);

      if (!isOnline) {
        await enqueueSubmission({
          checklistPayload,
          defectsPayload,
          reason: "No internet connection. Submission queued in Outbox and will sync when online.",
        });
        return;
      }

      if (!userId) {
        Alert.alert("Auth Error", "Could not identify signed-in user. Please sign in again.");
        return;
      }

      const result = await syncChecklistSubmission({
        checklistPayload,
        defectsPayload,
      });

      setDefectReviewVisible(false);
      if (result.photoFallbackUsed) {
        Alert.alert("Photos Skipped", "Defects were sent without photos due upload/network limits.");
      }

      showSuccess(
        selected.length > 0
          ? `Form saved. ${result.sentDefectCount} defect(s) sent to Maintenance Defect System.`
          : "Form saved. No defects were sent."
      );
    } catch (error) {
      const userId = await getCurrentUserId();
      if (userId && isTransportError(error)) {
        await enqueueSubmission({
          checklistPayload: buildChecklistPayload(userId),
          defectsPayload: buildDefectPayload(selected),
          reason:
            "Could not reach the server. Submission queued in Outbox and can be retried manually anytime.",
        });
        return;
      }

      Alert.alert("Defect Handoff Failed", String(error?.message || "Unknown error."));
    } finally {
      setDefectSubmitting(false);
    }
  }

  function handleMarkAllToggle() {
    if (!allMarkedChecked) {
      Alert.alert(
        "Mark All As Checked",
        "Are you sure you have checked all components and happy to proceed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Mark All",
            onPress: () => {
              const completed = CHECK_ITEMS.reduce((acc, item) => {
                acc[item] = "Y";
                return acc;
              }, {});
              setChecklist(completed);
            },
          },
        ]
      );
      return;
    }

    const cleared = CHECK_ITEMS.reduce((acc, item) => {
      acc[item] = "";
      return acc;
    }, {});
    setChecklist(cleared);
  }

  async function submitForm() {
    const unanswered = CHECK_ITEMS.filter((item) => !checklist[item]);
    if (unanswered.length > 0) {
      Alert.alert(
        "Checklist Incomplete",
        `Please complete all checklist items. Remaining: ${unanswered.length}`
      );
      return;
    }

    if (!completedBy.trim()) {
      Alert.alert("Missing Field", "Completed By is required.");
      return;
    }

    if (!machineReg.trim()) {
      Alert.alert("Missing Field", "Machine Reg is required.");
      return;
    }

    if (defectFound) {
      const drafts = buildDefectDrafts();
      if (drafts.length > 0) {
        setDefectRows(drafts);
        setDefectReviewVisible(true);
        return;
      }
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
          checklistPayload,
          defectsPayload,
          reason: "No internet connection. Submission queued in Outbox and will sync when online.",
        });
        return;
      }

      if (!userId) {
        Alert.alert("Auth Error", "Could not identify signed-in user. Please sign in again.");
        return;
      }

      await syncChecklistSubmission({ checklistPayload, defectsPayload });
      showSuccess();
    } catch (err) {
      const userId = await getCurrentUserId();
      if (userId && isTransportError(err)) {
        await enqueueSubmission({
          checklistPayload: buildChecklistPayload(userId),
          defectsPayload: [],
          reason:
            "Could not reach the server. Submission queued in Outbox and can be retried manually anytime.",
        });
        return;
      }

      Alert.alert("Save Failed", err?.message || "Unknown error while saving form.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.contract}>{form?.contractNo || "No Contract"}</Text>
      <Text style={styles.title}>{form?.title || "Roller Inspection"}</Text>

      <Text style={styles.fieldLabel}>Version</Text>
      <TextInput style={styles.input} value={version} onChangeText={setVersion} />

      <Text style={styles.fieldLabel}>Completed By</Text>
      <TextInput style={styles.input} value={completedBy} onChangeText={setCompletedBy} />

      <Text style={styles.fieldLabel}>Job Title</Text>
      <TextInput style={styles.input} value={jobTitle} onChangeText={setJobTitle} />

      <Text style={styles.fieldLabel}>Date</Text>
      <TextInput style={styles.input} value={date} onChangeText={setDate} />

      <Text style={styles.fieldLabel}>Machine Reg</Text>
      <TextInput style={styles.input} value={machineReg} onChangeText={handleMachineRegInput} />

      <Text style={styles.fieldLabel}>Asset No</Text>
      <TextInput style={styles.input} value={assetTag} onChangeText={handleAssetNoInput} />

      <Text style={styles.fieldLabel}>Serial No</Text>
      <TextInput style={styles.input} value={serialNo} onChangeText={handleSerialNoInput} />

      <Text style={styles.fieldLabel}>Machine Hours</Text>
      <TextInput style={styles.input} value={machineHours} onChangeText={setMachineHours} keyboardType="numeric" />

      <Text style={styles.fieldLabel}>Machine Type</Text>
      <TextInput style={styles.input} value={machineType} onChangeText={setMachineType} />

      <Text style={styles.fieldLabel}>Location</Text>
      <TextInput
        style={[styles.input, styles.inputReadonly]}
        value={location || defaultContractLocation}
        editable={false}
        placeholder="Contract location"
      />

      <View style={styles.checklistHeaderRow}>
        <Text style={styles.sectionTitle}>Checklist Status</Text>
        <TouchableOpacity style={styles.checkAllInline} onPress={handleMarkAllToggle}>
          <Text style={styles.checkAllBox}>{allMarkedChecked ? "[x]" : "[ ]"}</Text>
          <Text style={styles.checkAllText}>Mark all as checked</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.legend}>X Defect | Y Checked | N/A Not Applicable | R Replaced</Text>

      {CHECK_ITEMS.map((item) => (
        <View key={item} style={styles.checkRow}>
          <Text style={styles.checkLabel}>{item}</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map((status) => {
              const selected = checklist[item] === status;
              return (
                <TouchableOpacity
                  key={`${item}-${status}`}
                  style={[styles.statusPill, selected && styles.statusPillSelected]}
                  onPress={() => setItemStatus(item, status)}
                >
                  <Text style={[styles.statusPillText, selected && styles.statusPillTextSelected]}>
                    {status}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      <TextInput
        style={[styles.input, styles.notes]}
        placeholder="Notes"
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <View style={[styles.toggle, defectFound && styles.toggleActive]}>
        <Text style={[styles.toggleText, defectFound && styles.toggleTextActive]}>
          Defect Found: {defectFound ? "Yes" : "No"}
        </Text>
      </View>

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={submitForm} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? "Saving..." : "Submit Form"}</Text>
      </TouchableOpacity>

      <Modal visible={defectPromptVisible} transparent animationType="fade" onRequestClose={closeDefectPrompt}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Defect details for:</Text>
            <Text style={styles.modalItem}>{defectPromptItem}</Text>

            <TextInput
              style={[styles.input, styles.modalInput]}
              value={defectPromptText}
              onChangeText={setDefectPromptText}
              multiline
              placeholder="Describe the defect"
              autoFocus
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.buttonInline, styles.buttonGhost]} onPress={closeDefectPrompt}>
                <Text style={styles.buttonGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonInline} onPress={confirmDefectPrompt}>
                <Text style={styles.buttonText}>Save Defect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={defectReviewVisible} animationType="slide" onRequestClose={() => !defectSubmitting && setDefectReviewVisible(false)}>
        <View style={styles.reviewContainer}>
          <Text style={styles.title}>Record Defects</Text>
          <Text style={styles.legend}>Review defects before form submit and send to Maintenance Defect System.</Text>

          <ScrollView>
            {defectRows.map((row) => (
              <View key={row.id} style={styles.reviewCard}>
                <TouchableOpacity
                  style={styles.reviewCheckboxRow}
                  onPress={() => setDefectRowField(row.id, "should_send", !row.should_send)}
                >
                  <Text style={styles.checkAllBox}>{row.should_send ? "[x]" : "[ ]"}</Text>
                  <Text style={styles.checkLabel}>{row.checklist_item}</Text>
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  value={row.title}
                  onChangeText={(value) => setDefectRowField(row.id, "title", value)}
                  editable={row.should_send}
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.notes]}
                  value={row.description}
                  onChangeText={(value) => setDefectRowField(row.id, "description", value)}
                  editable={row.should_send}
                  multiline
                />

                <Text style={styles.fieldLabel}>Photos</Text>
                <View style={styles.photoButtonsRow}>
                  <TouchableOpacity
                    style={styles.photoButton}
                    onPress={() => handlePickPhotoFromGallery(row.id)}
                    disabled={!row.should_send || defectSubmitting || (row.photos || []).length >= DEFECT_PHOTO_MAX_FILES}
                  >
                    <Text style={styles.photoButtonText}>Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoButton}
                    onPress={() => handleTakePhoto(row.id)}
                    disabled={!row.should_send || defectSubmitting || (row.photos || []).length >= DEFECT_PHOTO_MAX_FILES}
                  >
                    <Text style={styles.photoButtonText}>Camera</Text>
                  </TouchableOpacity>
                </View>

                {(row.photos || []).length > 0 && (
                  <View style={styles.photoPreviewContainer}>
                    {row.photos.map((photo, index) => (
                      <View key={`${row.id}-photo-${index}`} style={styles.photoWrapper}>
                        <Image source={{ uri: photo.uri }} style={styles.photo} />
                        <TouchableOpacity
                          style={styles.deletePhotoButton}
                          onPress={() => removePhotoFromRow(row.id, index)}
                          disabled={defectSubmitting}
                        >
                          <Text style={styles.deletePhotoText}>X</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <Text style={styles.lookupTrace}>Up to {DEFECT_PHOTO_MAX_FILES} photos per defect.</Text>

                <Text style={styles.fieldLabel}>Category</Text>
                <View style={styles.categoryRowWrap}>
                  {DEFECT_CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={`${row.id}-${category}`}
                      style={[
                        styles.statusPill,
                        row.category === category && styles.statusPillSelected,
                      ]}
                      onPress={() => setDefectRowField(row.id, "category", category)}
                      disabled={!row.should_send}
                    >
                      <Text style={[styles.statusPillText, row.category === category && styles.statusPillTextSelected]}>
                        {category}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {row.category === "Other" && (
                  <TextInput
                    style={styles.input}
                    value={row.other_category_text}
                    onChangeText={(value) => setDefectRowField(row.id, "other_category_text", value)}
                    placeholder="State relevant category"
                    editable={row.should_send}
                  />
                )}

                <Text style={styles.fieldLabel}>Priority</Text>
                {DEFECT_PRIORITIES.map((p) => (
                  <TouchableOpacity
                    key={`${row.id}-p-${p.value}`}
                    style={[
                      styles.priorityCard,
                      {
                        borderColor: Number(row.priority) === p.value ? p.color : "#ccc",
                        backgroundColor: Number(row.priority) === p.value ? `${p.color}22` : "#f3f3f3",
                      },
                    ]}
                    onPress={() => setDefectRowField(row.id, "priority", p.value)}
                    disabled={!row.should_send}
                  >
                    <Text style={[styles.priorityTitle, { color: p.color }]}>{p.label}</Text>
                    <Text style={styles.priorityDesc}>{p.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>

          <View style={styles.reviewActions}>
            <TouchableOpacity
              style={[styles.buttonInline, styles.buttonGhost]}
              onPress={() => setDefectReviewVisible(false)}
              disabled={defectSubmitting}
            >
              <Text style={styles.buttonGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonInline, defectSubmitting && styles.buttonDisabled]}
              onPress={handleConfirmDefectsAndSubmit}
              disabled={defectSubmitting}
            >
              <Text style={styles.buttonText}>{defectSubmitting ? "Sending..." : "Send Defects & Submit"}</Text>
            </TouchableOpacity>
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
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  checklistHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  legend: {
    color: "#666",
    marginBottom: 10,
    fontSize: 12,
  },
  checkAllInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  checkAllBox: {
    fontSize: 13,
    color: "#666",
  },
  checkAllText: {
    fontSize: 12,
    color: "#666",
  },
  checkRow: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  checkLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    color: "#222",
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  statusPill: {
    borderWidth: 1,
    borderColor: "#b8c8e8",
    backgroundColor: "#eef4ff",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    marginBottom: 6,
  },
  statusPillSelected: {
    borderColor: "#007aff",
    backgroundColor: "#007aff",
  },
  statusPillText: {
    color: "#1e4b88",
    fontWeight: "700",
    fontSize: 12,
  },
  statusPillTextSelected: {
    color: "#fff",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  notes: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  lookupTrace: {
    fontSize: 12,
    color: "#4b5563",
    marginTop: -8,
    marginBottom: 10,
  },
  inputReadonly: {
    backgroundColor: "#f4f6f8",
    color: "#4b5563",
  },
  toggle: {
    borderWidth: 1,
    borderColor: "#007aff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  toggleActive: {
    backgroundColor: "#007aff",
  },
  toggleText: {
    color: "#007aff",
    textAlign: "center",
    fontWeight: "600",
  },
  toggleTextActive: {
    color: "#fff",
  },
  button: {
    backgroundColor: "#007aff",
    borderRadius: 8,
    padding: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
  },
  modalTitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  modalItem: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },
  modalInput: {
    minHeight: 100,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  buttonInline: {
    backgroundColor: "#007aff",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  buttonGhost: {
    backgroundColor: "#eef4ff",
  },
  buttonGhostText: {
    color: "#1e4b88",
    fontWeight: "600",
  },
  reviewContainer: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 16,
  },
  reviewCard: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  reviewCheckboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  categoryRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  priorityCard: {
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  priorityTitle: {
    fontWeight: "800",
    fontSize: 18,
    marginBottom: 2,
  },
  priorityDesc: {
    color: "#3c3c3c",
    fontSize: 16,
    fontWeight: "600",
  },
  reviewActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  photoButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 10,
  },
  photoButton: {
    backgroundColor: "#eef4ff",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flex: 1,
    alignItems: "center",
  },
  photoButtonText: {
    color: "#1e4b88",
    fontWeight: "600",
  },
  photoPreviewContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  photoWrapper: {
    position: "relative",
  },
  photo: {
    width: 84,
    height: 84,
    borderRadius: 8,
    backgroundColor: "#e5e7eb",
  },
  deletePhotoButton: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  deletePhotoText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
});
