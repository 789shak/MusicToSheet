import { View, Text, StyleSheet } from 'react-native';

export default function PublicDomainLibraryScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Public Domain Library</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111118' },
  text: { color: '#FFFFFF', fontSize: 20 },
});
