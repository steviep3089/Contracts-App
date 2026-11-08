import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity,
} from "react-native";
import { supabase } from "../supabase";
import { verifyRecoveryCode } from "../services/passwordRecovery";

export default function VerifyOtpScreen({ navigation, route }) {
  const email = route.params?.email?.trim() || "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  async function verify() {
    if (busyRef.current) return;
    if (!email || !code.trim()) {
      Alert.alert("Verification required", "Enter the code from your recovery email.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await verifyRecoveryCode(email, code.trim());
      navigation.replace("ResetPassword", { fromRecoveryCode: true });
    } catch (error) {
      const limited = error.status === 429 || /rate.limit|too many/i.test(error.message || "");
      Alert.alert(limited ? "Too many attempts" : "Verification failed",
        limited ? "Too many attempts. Please wait before trying again." :
          error.message || "The code may be invalid, expired or already used. Request a new code.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function resend() {
    if (busyRef.current || cooldown) return;
    if (!email) {
      Alert.alert("Email missing", "Return to Login and request a new code.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: "contractsapp://" });
      if (error) throw error;
      setCode("");
      setCooldown(60);
      Alert.alert("Code sent", "If the account exists, a new recovery email has been sent.");
    } catch (error) {
      const limited = error.status === 429 || /rate.limit|too many/i.test(error.message || "");
      Alert.alert("Unable to resend", limited ? "Too many requests. Please wait before trying again." :
        error.message || "Please check your connection and try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Enter Verification Code</Text>
        <Text style={styles.subtitle}>Enter the code sent to {email}.</Text>
        <TextInput placeholder="Verification code" keyboardType="number-pad" value={code}
          onChangeText={setCode} editable={!busy} style={styles.input} autoComplete="one-time-code" />
        <TouchableOpacity style={styles.button} onPress={verify} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify Code</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={resend} disabled={busy || cooldown > 0}>
          <Text>{cooldown ? `Resend code in ${cooldown}s` : "Resend Code"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 25 },
  title: { fontSize: 28, fontWeight: "600", textAlign: "center", marginBottom: 25 },
  subtitle: { textAlign: "center", marginBottom: 25 },
  input: { padding: 12, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: "#007aff", borderRadius: 8, padding: 15, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  link: { alignItems: "center", padding: 20 },
});
