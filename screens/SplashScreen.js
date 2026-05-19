import React, { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Image } from "react-native";

export default function SplashScreen({ navigation }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace("Login");
    }, 1500);

    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Image source={require("../assets/contracting-app.png")} style={styles.logo} resizeMode="contain" />
      <ActivityIndicator size="large" color="#007aff" />
      <Text style={styles.brand}>Contracting App</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  logo: {
    width: 146,
    height: 146,
    marginBottom: 14,
  },
  brand: {
    marginTop: 16,
    fontSize: 22,
    fontWeight: "700",
  },
});
