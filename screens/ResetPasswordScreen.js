import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase";
import { canUseExistingPasswordSetupSession, recordLinkRecovery, recoverySessionReady, updateRecoveryPassword } from "../services/passwordRecovery";

export default function ResetPasswordScreen({ navigation, route }) {
  const headerHeight = useHeaderHeight();
  const fromRecoveryCode = route?.params?.fromRecoveryCode === true;
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [setupUserId, setSetupUserId] = useState(null);

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    if (fromRecoveryCode) {
      try {
        if (await recoverySessionReady()) {
          setSessionReady(true);
        } else {
          Alert.alert("Session Expired", "Request a new recovery code.", [{ text: "OK", onPress: () => navigation.replace("Login") }]);
        }
      } catch {
        Alert.alert("Session Error", "Could not check the recovery session. Request a new code.", [{ text: "OK", onPress: () => navigation.replace("Login") }]);
      }
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (canUseExistingPasswordSetupSession(data?.session?.user)) {
        setSetupUserId(data.session.user.id);
        setSessionReady(true);
      } else {
        Alert.alert(
          "Session Expired",
          "The password reset link has expired. Please request a new one.",
          [{ text: "OK", onPress: () => navigation.replace("Login") }]
        );
      }
    } catch {
      Alert.alert("Session Error", "Could not check the password setup session. Please try again.",
        [{ text: "OK", onPress: () => navigation.replace("Login") }]);
    }
    setLoading(false);
  }

  async function handleResetPassword() {
    if (!password || !confirmPassword) {
      Alert.alert("Error", "Please fill in both password fields");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match");
      return;
    }

    if (fromRecoveryCode && password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    if (fromRecoveryCode) {
      try {
        await updateRecoveryPassword(password, () => AsyncStorage.removeItem("savedPassword"));
        Alert.alert("Success", "Password updated successfully", [
          { text: "OK", onPress: () => navigation.reset({ index: 0, routes: [{ name: "Login" }] }) },
        ]);
      } catch (error) {
        Alert.alert("Unable to complete reset", error.message || "Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    try {
      const { data: currentData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || currentData?.session?.user?.id !== setupUserId ||
          !canUseExistingPasswordSetupSession(currentData.session.user)) {
        Alert.alert("Session Expired", "The password setup session has changed. Please request a new link.");
        return;
      }
      const { error } = await supabase.auth.updateUser({
        password,
        data: { password_set: true, invited: false, force_password_change: false },
      });
      if (error) {
        Alert.alert("Error", error.message);
      } else {
        await AsyncStorage.removeItem("savedPassword");
        recordLinkRecovery(null);
        Alert.alert("Success", "Password updated successfully", [
          { text: "OK", onPress: () => navigation.replace("Login") },
        ]);
      }
    } catch (error) {
      Alert.alert("Error", error.message || "Unable to update the password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: "center" }]}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 20 }}>Loading...</Text>
      </View>
    );
  }

  if (!sessionReady) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Reset Password</Text>

        <TextInput
          placeholder="New Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />

        <TextInput
          placeholder="Confirm Password"
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          style={styles.input}
        />

        <TouchableOpacity style={styles.button} onPress={handleResetPassword} disabled={submitting}>
          <Text style={styles.buttonText}>Reset Password</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  form: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 26,
    marginBottom: 30,
    textAlign: "center",
  },
  input: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 5,
    marginBottom: 10,
  },
  button: {
    backgroundColor: "#007aff",
    padding: 14,
    borderRadius: 8,
    marginTop: 8,
  },
  buttonText: {
    textAlign: "center",
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
});
