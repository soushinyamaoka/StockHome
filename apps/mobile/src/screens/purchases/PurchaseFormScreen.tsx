import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';

import { createPurchase, fetchItems } from '../../api/items';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { DateField } from '../../components/DateField';
import { ItemPicker } from '../../components/ItemPicker';
import { COLORS, SPACING } from '../../theme';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export default function PurchaseFormScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ['items'], queryFn: () => fetchItems() });
  const items = data?.items ?? [];

  const [itemId, setItemId] = useState<string | null>(route.params?.itemId ?? null);
  const [purchasedAt, setPurchasedAt] = useState(todayStr());
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');

  // 品目を選んだら標準購入数を初期値にする
  useEffect(() => {
    if (!itemId || qty !== '') return;
    const item = items.find((i) => i.id === itemId);
    if (item) setQty(String(item.defaultPurchaseQty));
  }, [itemId, items.length]);

  const mutation = useMutation({
    mutationFn: createPurchase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      Alert.alert('登録完了', '購入を記録しました', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (e: any) => {
      Alert.alert('エラー', e?.response?.data?.message ?? '登録に失敗しました');
    },
  });

  const submit = () => {
    if (!itemId) {
      Alert.alert('入力エラー', '品目を選択してください');
      return;
    }
    const n = Number(qty);
    if (qty === '' || Number.isNaN(n) || n < 1) {
      Alert.alert('入力エラー', '購入数は1以上で入力してください');
      return;
    }
    const p = price === '' ? undefined : Number(price);
    if (p !== undefined && (Number.isNaN(p) || p < 0)) {
      Alert.alert('入力エラー', '単価は0以上の数値で入力してください');
      return;
    }
    mutation.mutate({
      itemId,
      purchasedAt,
      qty: n,
      price: p,
      source: source || undefined,
      note: note || undefined,
    });
  };

  const selectedUnit = items.find((i) => i.id === itemId)?.unit;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.lg }}>
        <ItemPicker label="品目 *" items={items} value={itemId} onChange={setItemId} />
        <DateField label="購入日 *" value={purchasedAt} onChange={setPurchasedAt} />
        <TextField
          label={`購入数${selectedUnit ? `（${selectedUnit}）` : ''} *`}
          value={qty}
          onChangeText={setQty}
          keyboardType="decimal-pad"
        />
        <TextField
          label="1箱（1セット）の単価"
          value={price}
          onChangeText={setPrice}
          keyboardType="number-pad"
          placeholder="任意（円）"
        />
        <TextField
          label="購入元"
          value={source}
          onChangeText={setSource}
          placeholder="例: スーパー、ドラッグストア"
        />
        <TextField label="備考" value={note} onChangeText={setNote} multiline placeholder="任意" />

        <Button title="買ったよ！を記録" onPress={submit} loading={mutation.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
});
