import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, clearPersistedSupabaseSession, isRefreshTokenError } from "../supabase";
import { canUseExistingPasswordSetupSession, isRecoveryRequestInProgress, setRecoveryRequestInProgress } from "../services/passwordRecovery";

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const authBusy = useRef(false);

  const logoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(logoOpacity, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    loadRememberedLogin();
    let active = true;
    resetStaleSessionIfNeeded();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") return;
      if (event === "SIGNED_IN") {
        supabase.auth.getUser().then(({ data: userData }) => {
          if (active && !isRecoveryRequestInProgress() && navigation.isFocused() &&
              canUseExistingPasswordSetupSession(userData?.user || session?.user)) {
            navigation.replace("ResetPassword");
          }
        });
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function resetStaleSessionIfNeeded() {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error && isRefreshTokenError(error)) {
        await clearPersistedSupabaseSession();
        return true;
      }
      return !!session;
    } catch (error) {
      if (isRefreshTokenError(error)) {
        await clearPersistedSupabaseSession();
        return true;
      }
      return false;
    }
  }

  async function loadRememberedLogin() {
    try {
      await AsyncStorage.removeItem("savedPassword");
      const savedEmail = await AsyncStorage.getItem("savedEmail");
      if (savedEmail) {
        setEmail(savedEmail);
        setRemember(true);
      }
    } catch {
      Alert.alert("Saved login unavailable", "Could not remove the previously saved password or load the saved email.");
    }
  }

  async function rememberLogin() {
    await AsyncStorage.removeItem("savedPassword");
    if (remember) {
      await AsyncStorage.setItem("savedEmail", email.trim());
    } else {
      await AsyncStorage.removeItem("savedEmail");
    }
  }

  async function signIn() {
    if (authBusy.current) return;
    authBusy.current = true;
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        alert(error.message);
      } else {
        try {
          await rememberLogin();
        } catch {
          Alert.alert("Saved login unavailable", "Could not update saved login information or remove the previously saved password.");
        }
        const { data: userData } = await supabase.auth.getUser();
        if (navigation.isFocused()) {
          navigation.replace(canUseExistingPasswordSetupSession(userData?.user) ? "ResetPassword" : "Home");
        }
      }
    } finally {
      authBusy.current = false;
    }
  }

  async function forgotPassword() {
    if (!email.trim()) {
      alert("Enter your email first.");
      return;
    }

    if (authBusy.current) return;
    authBusy.current = true;
    setRecoveryRequestInProgress(true);
    setResetPending(true);
    try {
      const cleanEmail = email.trim();
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: "contractsapp://",
      });
      if (error) throw error;
      if (navigation.isFocused()) navigation.navigate("VerifyOtp", { email: cleanEmail });
    } catch (error) {
      const limited = error?.status === 429 || /rate.limit|too many/i.test(error?.message || "");
      Alert.alert("Unable to send code", limited ? "Too many requests. Please wait before trying again." :
        error?.message || "Please check your connection and try again.");
    } finally {
      setResetPending(false);
      setRecoveryRequestInProgress(false);
      authBusy.current = false;
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Animated.View style={{ opacity: logoOpacity, alignItems: "center" }}>
          <Image source={require("../assets/contracting-app.png")} style={styles.logoImage} resizeMode="contain" />
        </Animated.View>

        <Text style={styles.title}>Contracting App</Text>
        <Text style={styles.subTitle}>Sign in with your invited account. New accounts are issued by admin.</Text>

        <TextInput
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          autoCapitalize="none"
        />

        <View style={styles.passwordRow}>
          <TextInput
            placeholder="Password"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            style={[styles.input, styles.passwordInput]}
          />
          <TouchableOpacity
            onPress={() => setShowPassword((prev) => !prev)}
            style={styles.passwordToggle}
          >
            <Text style={styles.passwordToggleText}>{showPassword ? "Hide" : "Show"}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.rememberRow} onPress={() => setRemember(!remember)}>
          <View style={[styles.checkbox, remember && styles.checkboxChecked]} />
          <Text style={styles.rememberText}>Remember email</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={forgotPassword} disabled={resetPending}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={signIn} disabled={resetPending}>
          <Text style={styles.buttonText}>Sign In</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 25,
    paddingTop: 60,
  },
  logoImage: {
    width: 124,
    height: 124,
    marginBottom: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 10,
  },
  subTitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 25,
  },
  input: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 16,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  passwordInput: {
    flex: 1,
    marginBottom: 0,
  },
  passwordToggle: {
    marginLeft: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  passwordToggleText: {
    color: "#007aff",
    fontSize: 14,
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: "#555",
    marginRight: 10,
    borderRadius: 4,
  },
  checkboxChecked: {
    backgroundColor: "#007aff",
    borderColor: "#007aff",
  },
  rememberText: {
    fontSize: 16,
  },
  forgotText: {
    marginTop: 5,
    marginBottom: 20,
    color: "#007aff",
    textAlign: "right",
    fontSize: 16,
  },
  button: {
    backgroundColor: "#007aff",
    padding: 15,
    borderRadius: 8,
    marginTop: 10,
  },
  buttonText: {
    color: "white",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
  },
});
