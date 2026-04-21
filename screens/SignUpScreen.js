import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from "react-native";
import { supabase } from "../supabase";

export default function SignUpScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function signUp() {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: "contractsapp://login",
      },
    });

    if (error) {
      alert(error.message);
    } else {
      alert("Account created. Please check your email to verify.");
      navigation.replace("Login");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Contract Account</Text>

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

      <TouchableOpacity style={styles.button} onPress={signUp}>
        <Text style={styles.buttonText}>Sign Up</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.linkButton} onPress={() => navigation.replace("Login")}>
        <Text style={styles.linkText}>Already have an account? Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
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
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
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
  button: {
    backgroundColor: "#007aff",
    padding: 14,
    borderRadius: 8,
    marginTop: 10,
  },
  buttonText: {
    textAlign: "center",
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  linkButton: {
    marginTop: 16,
  },
  linkText: {
    textAlign: "center",
    color: "#007aff",
  },
});
