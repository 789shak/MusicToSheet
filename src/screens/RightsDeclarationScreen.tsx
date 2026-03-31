import { View, Text, StyleSheet } from 'react-native';

export default function RightsDeclarationScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Rights Declaration</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111118' },
  text: { color: '#FFFFFF', fontSize: 20 },
});
