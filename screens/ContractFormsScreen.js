import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../supabase";

const FALLBACK_FORMS = [
  {
    id: "roller_inspection",
    contractNo: "ROLLER",
    contractName: "Roller",
    title: "Roller Inspection",
    detail: "Complete daily roller checklist",
  },
];

export default function ContractFormsScreen({ navigation }) {
  const isFocused = useIsFocused();
  const [forms, setForms] = useState(FALLBACK_FORMS);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (isFocused) {
      fetchContracts({ showSpinner: false });
    }
  }, [isFocused]);

  async function fetchContracts(options = {}) {
    const showSpinner = options.showSpinner !== false;
    if (showSpinner) setRefreshing(true);

    try {
      const { data, error } = await supabase
        .from("contracts")
        .select("id, name, contract_number, client")
        .order("created_at", { ascending: false });

      if (error || !Array.isArray(data) || data.length === 0) {
        setForms(FALLBACK_FORMS);
        return;
      }

      const mapped = data.map((row) => ({
        id: row.id,
        contractNo: row.contract_number || "-",
        contractName: row.name || row.contract_number || "Contract",
        title: "Roller Inspection",
        detail: row.client ? `Client: ${row.client}` : "Complete daily roller checklist",
      }));

      setForms(mapped);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Assigned Contract Forms</Text>

      <FlatList
        data={forms}
        keyExtractor={(item) => item.id}
        refreshing={refreshing}
        onRefresh={() => fetchContracts({ showSpinner: true })}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate("FillForm", { form: item })}
          >
            <Text style={styles.contractNo}>{item.contractNo}</Text>
            <Text style={styles.formTitle}>{item.title}</Text>
            <Text style={styles.formDetail}>{item.detail}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: "#d7d7d7",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  contractNo: {
    fontSize: 12,
    color: "#666",
    marginBottom: 6,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  formDetail: {
    marginTop: 6,
    fontSize: 13,
    color: "#5e5e5e",
  },
});
