import { View, Text, StyleSheet } from 'react-native';

export default function ProcessingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Processing</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111118' },
  text: { color: '#FFFFFF', fontSize: 20 },
});
