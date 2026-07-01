import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { CORRECTION_REASONS, CORRECTION_REASON_LABELS } from '@stockhome/shared';

import { createCorrection, fetchItem } from '../../api/items';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { ChipSelector } from '../../components/ChipSelector';
import { InfoRow } from '../../components/InfoRow';
import { COLORS, FONTS, SPACING } from '../../theme';
import { remainQtyLabel, daysLeftLabel } from '../../lib/stockUtils';

export default function StockCorrectionScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const itemId: string = route.params.itemId;
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ['item', itemId], queryFn: () => fetchItem(itemId) });
  const item = data?.item;

  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<string | null>('counted_actual_stock');
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: createCorrection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      Alert.alert('補正完了', '在庫を補正しました', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (e: any) => {
      Alert.alert('エラー', e?.response?.data?.message ?? '補正に失敗しました');
    },
  });

  const submit = () => {
    const n = Number(qty);
    if (qty === '' || Number.isNaN(n) || n < 0) {
      Alert.alert('入力エラー', '実際の残数は0以上の数値で入力してください');
      return;
    }
    if (!reason) {
      Alert.alert('入力エラー', '補正理由を選択してください');
      return;
    }
    mutation.mutate({
      itemId,
      correctedQty: n,
      correctionReason: reason as any,
      note: note || undefined,
    });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={{ padding: SPACING.lg }}>
        {item ? (
          <Card>
            <Text style={styles.itemName}>{item.itemName}</Text>
            <InfoRow label="現在の推定残数" value={remainQtyLabel(item.snapshot, item.unit)} />
            <InfoRow label="推定残日数" value={daysLeftLabel(item.snapshot)} />
          </Card>
        ) : null}

        <TextField
          label={`実際の残数${item?.unit ? `（${item.unit}）` : ''} *`}
          value={qty}
          onChangeText={setQty}
          keyboardType="decimal-pad"
          placeholder="例: 2.5"
        />
        <ChipSelector
          label="補正理由 *"
          options={CORRECTION_REASONS.map((r) => ({ value: r, label: CORRECTION_REASON_LABELS[r] }))}
          value={reason}
          onChange={setReason}
        />
        <TextField label="メモ" value={note} onChangeText={setNote} multiline placeholder="任意" />

        <Button title="この数になおす" onPress={submit} loading={mutation.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  itemName: { fontFamily: FONTS.bold, fontSize: 17, color: COLORS.ink, marginBottom: SPACING.sm },
});
