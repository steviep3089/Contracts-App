import React, { useEffect, useRef, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { Alert } from "react-native";
import { supabase } from "./supabase";
import MaintenanceGate from "./MaintenanceGate";
import { canUseExistingPasswordSetupSession, isRecoveryRequestInProgress, recordLinkRecovery } from "./services/passwordRecovery";
import { createInvitationLinking, isInvitationInProgress, isInvitationLink } from "./services/invitation";

import SplashScreen from "./screens/SplashScreen";
import LoginScreen from "./screens/LoginScreen";
import VerifyOtpScreen from "./screens/VerifyOtpScreen";
import ResetPasswordScreen from "./screens/ResetPasswordScreen";
import HomeScreen from "./screens/HomeScreen";
import ContractFormsScreen from "./screens/ContractFormsScreen";
import FillFormScreen from "./screens/FillFormScreen";
import OutboxScreen from "./screens/OutboxScreen";
import SelfCertApprovalsScreen from "./screens/SelfCertApprovalsScreen";
import MyDocumentsScreen from "./screens/MyDocumentsScreen";
import TimesheetScreen from "./screens/TimesheetScreen";
import TimesheetApprovalsScreen from "./screens/TimesheetApprovalsScreen";
import ApprovalsScreen from "./screens/ApprovalsScreen";

const Stack = createNativeStackNavigator();

const linkingConfig = {
  prefixes: ["contractsapp://"],
  config: {
    screens: {
      Login: "login",
      ResetPassword: "reset",
    },
  },
};

export default function App() {
  const navigationRef = useRef();
  const invitationLinking = useRef(null);
  if (!invitationLinking.current) {
    invitationLinking.current = createInvitationLinking({
      linking: Linking,
      navigationRef,
      alert: Alert.alert,
    });
  }
  const [routeName, setRouteName] = useState(null);

  useEffect(() => {
    const isInviteOrSignup = (url) =>
      url?.includes("type=invite") ||
      url?.includes("type=signup") ||
      url?.includes("from=invite") ||
      url?.includes("from=signup");

    const checkInitialURL = async () => {
      const url = await Linking.getInitialURL();
      if (!isInvitationLink(url) && (url?.includes("type=recovery") || url?.includes("reset") || isInviteOrSignup(url))) {
        setTimeout(() => {
          if (navigationRef.current?.isReady()) {
            navigationRef.current.navigate("ResetPassword");
          }
        }, 500);
      }
    };

    checkInitialURL();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recordLinkRecovery(session);
        setTimeout(() => {
          if (navigationRef.current?.isReady()) {
            navigationRef.current.navigate("ResetPassword");
          }
        }, 100);
        return;
      }

      if (event === "SIGNED_OUT") recordLinkRecovery(null);

      if (event === "SIGNED_IN" && session?.user?.invited_at) {
        supabase.auth.getUser().then(({ data: userData }) => {
          const needsReset = canUseExistingPasswordSetupSession(userData?.user || session?.user);
          if (!needsReset) {
            return;
          }
          setTimeout(() => {
            if (navigationRef.current?.isReady() && !isRecoveryRequestInProgress() && !isInvitationInProgress() &&
                navigationRef.current.getCurrentRoute()?.name !== "VerifyOtp" &&
                navigationRef.current.getCurrentRoute()?.name !== "ResetPassword") {
              navigationRef.current.navigate("ResetPassword");
            }
          }, 100);
        });
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <SafeAreaProvider>
    <MaintenanceGate routeName={routeName} navigationRef={navigationRef}>
    <NavigationContainer ref={navigationRef} linking={{ ...linkingConfig, getInitialURL: invitationLinking.current.getInitialURL, subscribe: invitationLinking.current.subscribe }} onReady={() => { setRouteName(navigationRef.current?.getCurrentRoute()?.name); invitationLinking.current.onReady(); }} onStateChange={() => setRouteName(navigationRef.current?.getCurrentRoute()?.name)}>
        <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerTitleAlign: "center" }}>
          <Stack.Screen name="Splash" component={SplashScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Login" }} />
          <Stack.Screen name="VerifyOtp" component={VerifyOtpScreen} options={{ title: "Verify Code" }} />
          <Stack.Screen
            name="ResetPassword"
            component={ResetPasswordScreen}
          options={{ title: "Reset Password" }}
        />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Contracting App" }} />
        <Stack.Screen
          name="ContractForms"
          component={ContractFormsScreen}
          options={{ title: "Contract Forms" }}
        />
        <Stack.Screen name="FillForm" component={FillFormScreen} options={{ title: "Fill Form" }} />
        <Stack.Screen name="Outbox" component={OutboxScreen} options={{ title: "Outbox" }} />
        <Stack.Screen
          name="MyDocuments"
          component={MyDocumentsScreen}
          options={{ title: "My Documents" }}
        />
        <Stack.Screen
          name="Approvals"
          component={ApprovalsScreen}
          options={{ title: "Approvals" }}
        />
        <Stack.Screen
          name="SelfCertApprovals"
          component={SelfCertApprovalsScreen}
          options={{ title: "Self Cert Approvals" }}
        />
        <Stack.Screen
          name="TimesheetApprovals"
          component={TimesheetApprovalsScreen}
          options={{ title: "Timesheet Approvals" }}
        />
        <Stack.Screen
          name="Timesheet"
          component={TimesheetScreen}
          options={{ title: "Timesheet" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
    </MaintenanceGate>
    </SafeAreaProvider>
  );
}
