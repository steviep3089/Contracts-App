import React, { useEffect, useRef } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import { supabase } from "./supabase";

import SplashScreen from "./screens/SplashScreen";
import LoginScreen from "./screens/LoginScreen";
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

const linking = {
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

  useEffect(() => {
    const isInviteOrSignup = (url) =>
      url?.includes("type=invite") ||
      url?.includes("type=signup") ||
      url?.includes("from=invite") ||
      url?.includes("from=signup");

    const checkInitialURL = async () => {
      const url = await Linking.getInitialURL();
      if (url?.includes("type=recovery") || url?.includes("reset") || isInviteOrSignup(url)) {
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
        setTimeout(() => {
          if (navigationRef.current?.isReady()) {
            navigationRef.current.navigate("ResetPassword");
          }
        }, 100);
        return;
      }

      if (event === "SIGNED_IN" && session?.user?.invited_at) {
        supabase.auth.getUser().then(({ data: userData }) => {
          const needsReset =
            userData?.user?.user_metadata?.password_set !== true &&
            userData?.user?.invited_at;
          if (!needsReset) {
            return;
          }
          setTimeout(() => {
            if (navigationRef.current?.isReady()) {
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
    <NavigationContainer ref={navigationRef} linking={linking}>
        <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerTitleAlign: "center" }}>
          <Stack.Screen name="Splash" component={SplashScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Login" }} />
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
  );
}
