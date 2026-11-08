import React, { useEffect, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import {
  getMaintenanceState, shouldShowMaintenanceOverlay, MAINTENANCE_POLL_MS,
  refreshMaintenanceStatus, setMaintenanceIdentity, subscribeMaintenance,
} from "./services/maintenanceStatus";

export default function MaintenanceGate({ children, routeName, navigationRef }) {
  const [maintenance, setMaintenance] = useState(getMaintenanceState);
  const [loginRequested, setLoginRequested] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let authChanged = false;
    const unsubscribe = subscribeMaintenance(setMaintenance);
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authChanged = true;
      setMaintenanceIdentity(session?.user?.id ?? null);
      setLoginRequested(false);
      setTimeout(() => refreshMaintenanceStatus(), 0);
    });
    supabase.auth.getSession().then(({ data: sessionData, error: sessionError }) => {
      if (!active || authChanged) return;
      if (sessionError) setError("Unable to check the current session.");
      setMaintenanceIdentity(sessionData?.session?.user?.id ?? null);
      refreshMaintenanceStatus();
    }).catch(() => {
      if (active) setError("Unable to check the current session.");
    });
    const timer = setInterval(refreshMaintenanceStatus, MAINTENANCE_POLL_MS);
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") refreshMaintenanceStatus();
    });
    const netUnsubscribe = NetInfo.addEventListener((net) => {
      if (net.isConnected && net.isInternetReachable) refreshMaintenanceStatus();
    });
    return () => {
      active = false;
      unsubscribe();
      data.subscription.unsubscribe();
      clearInterval(timer);
      appState.remove();
      netUnsubscribe();
    };
  }, []);

  const overlay = shouldShowMaintenanceOverlay(maintenance, routeName, loginRequested);
  const expected = maintenance.status?.expected_return_at ? new Date(maintenance.status.expected_return_at) : null;

  async function signOut() {
    setError("");
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      navigationRef.current?.resetRoot({ index: 0, routes: [{ name: "Login" }] });
      setLoginRequested(true);
    } catch {
      setError("Unable to sign out. Please try again.");
    }
  }

  function openLogin() {
    navigationRef.current?.resetRoot({ index: 0, routes: [{ name: "Login" }] });
    setLoginRequested(true);
  }

  function onMaintenanceLayout() {
    SplashScreen.hideAsync().catch((hideError) => {
      console.error("Unable to hide the splash screen for maintenance.", hideError);
    });
  }

  return (
    <View style={styles.fill}>
      <View style={styles.fill} accessibilityElementsHidden={overlay} importantForAccessibility={overlay ? "no-hide-descendants" : "auto"}>
        {children}
      </View>
      {overlay && <View style={styles.overlay} accessibilityViewIsModal onLayout={onMaintenanceLayout}>
        <SafeAreaView style={styles.fill} edges={["top", "bottom", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.overlayContent}>
        <Text style={styles.title}>Maintenance in progress</Text>
        <Text style={styles.message}>{maintenance.status?.message || "The Contracts app is undergoing maintenance. Please try again later."}</Text>
        {expected && !Number.isNaN(expected.getTime()) && <Text style={styles.message}>Expected back: {expected.toLocaleString()}</Text>}
        <Text style={styles.note}>Your session and queued submissions are preserved. Unsent form changes are not saved if you close the app.</Text>
        {!!maintenance.error && <Text style={styles.note}>{maintenance.error} Showing the last known status.</Text>}
        {!!error && <Text style={styles.note}>{error}</Text>}
        <Pressable style={styles.button} onPress={maintenance.userId ? signOut : openLogin}>
          <Text style={styles.buttonText}>{maintenance.userId ? "Sign out" : "Super User sign in"}</Text>
        </Pressable>
        </ScrollView>
        </SafeAreaView>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#fff", zIndex: 1000, elevation: 1000 },
  overlayContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 12, textAlign: "center" },
  message: { fontSize: 16, textAlign: "center", marginBottom: 12 },
  note: { fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 8 },
  button: { marginTop: 16, backgroundColor: "#1d4ed8", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  buttonText: { color: "#fff", fontWeight: "600" },
});
