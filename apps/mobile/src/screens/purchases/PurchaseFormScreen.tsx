import React, { useEffect, useLayoutEffect, useState } from 'react';
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
import { VENDOR_LABELS, type ExternalVendor } from '@stockhome/shared';

import { createPurchase, fetchItems, fetchPurchases, updatePurchase } from '../../api/items';
import type { PurchaseDto } from '../../api/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { TextField } from '../../components/TextField';
import { DateField } from '../../components/DateField';
import { ItemPicker } from '../../components/ItemPicker';
import { COLORS, FONTS, SPACING } from '../../theme';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function sourceLabel(purchase: PurchaseDto): string {
  if (purchase.source === 'gmail') {
    return VENDOR_LABELS[purchase.externalVendor as ExternalVendor] ?? 'メール取込';
  }
  return purchase.source === 'manual' ? '手動' : purchase.source;
}

export default function PurchaseFormScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const purchaseId: string | undefined = route.params?.purchaseId;
  const isEdit = !!purchaseId;
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ['items'], queryFn: () => fetchItems() });
  const items = data?.items ?? [];

  const [itemId, setItemId] = useState<string | null>(route.params?.itemId ?? null);
  const [purchasedAt, setPurchasedAt] = useState(todayStr());
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');

  const { data: purchasesData } = useQuery({
    queryKey: ['purchases', itemId],
    queryFn: () => fetchPurchases(itemId!),
    enabled: isEdit && !!itemId,
  });
  const editing = isEdit ? purchasesData?.purchases.find((p) => p.id === purchaseId) : undefined;

  useLayoutEffect(() => {
    if (isEdit) navigation.setOptions({ title: '購入記録の編集' });
  }, [navigation, isEdit]);

  // 取得できた購入の値をフォームへ1回だけ反映する
  useEffect(() => {
    if (!editing) return;
    setQty(String(editing.qty));
    setPrice(editing.price != null ? String(editing.price) : '');
    setNote(editing.note ?? '');
  }, [editing?.id]);

  // 品目を選んだら標準購入数を初期値にする
  useEffect(() => {
    if (isEdit) return;
    if (!itemId || qty !== '') return;
    const item = items.find((i) => i.id === itemId);
    if (item) setQty(String(item.defaultPurchaseQty));
  }, [itemId, items.length, isEdit]);

  const mutation = useMutation({
    mutationFn: (input: { qty: number; price?: number; note?: string }) => {
      if (isEdit) return updatePurchase(purchaseId!, input);
      return createPurchase({
        itemId: itemId!,
        purchasedAt,
        ...input,
        source: source || undefined,
      });
    },
    onSuccess: () => {
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['purchases', itemId] });
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      Alert.alert(isEdit ? '保存しました' : '登録完了', isEdit ? '購入記録を更新しました' : '購入を記録しました', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (e: any) => {
      Alert.alert('エラー', e?.response?.data?.message ?? (isEdit ? '保存に失敗しました' : '登録に失敗しました'));
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
      qty: n,
      price: p,
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
        {isEdit ? (
          <Card>
            <Text style={styles.readOnlyTitle}>変更できない情報</Text>
            <Text style={styles.readOnlyValue}>
              品目: {items.find((item) => item.id === itemId)?.itemName ?? '読み込み中...'}
            </Text>
            <Text style={styles.readOnlyValue}>購入日: {editing?.purchasedAt ?? '読み込み中...'}</Text>
            <Text style={styles.readOnlyValue}>
              購入元: {editing ? sourceLabel(editing) : '読み込み中...'}
            </Text>
            <Text style={styles.readOnlyHelp}>品目・購入日・購入元は変更できません</Text>
          </Card>
        ) : (
          <>
            <ItemPicker label="品目 *" items={items} value={itemId} onChange={setItemId} />
            <DateField label="購入日 *" value={purchasedAt} onChange={setPurchasedAt} />
          </>
        )}
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
        {!isEdit ? (
          <TextField
            label="購入元"
            value={source}
            onChangeText={setSource}
            placeholder="例: スーパー、ドラッグストア"
          />
        ) : null}
        <TextField label="備考" value={note} onChangeText={setNote} multiline placeholder="任意" />

        <Button
          title={isEdit ? '保存する' : '買ったよ！を記録'}
          onPress={submit}
          loading={mutation.isPending}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  readOnlyTitle: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.inkSub, marginBottom: SPACING.sm },
  readOnlyValue: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.ink, marginBottom: SPACING.xs },
  readOnlyHelp: { fontFamily: FONTS.medium, fontSize: 12, color: COLORS.inkFaint, marginTop: SPACING.xs },
});
