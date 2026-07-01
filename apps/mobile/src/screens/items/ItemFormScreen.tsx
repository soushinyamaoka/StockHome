import React, { useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  NOTIFY_TARGET_TYPES,
  NOTIFY_TARGET_TYPE_LABELS,
  DEFAULTS,
  type Alternative,
} from '@stockhome/shared';

import { createItem, fetchItem, updateItem } from '../../api/items';
import { fetchUsers } from '../../api/misc';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { Section } from '../../components/Section';
import { ChipSelector } from '../../components/ChipSelector';
import { COLORS, FONTS, RADIUS, SPACING } from '../../theme';

interface AltRow {
  name: string;
  url: string;
  note: string;
}

export default function ItemFormScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const itemId: string | undefined = route.params?.itemId;
  // 取込候補の「新規品目として登録」から渡される品名（新規作成時のみ初期値に使う）
  const prefillName: string | undefined = route.params?.prefillName;
  const isEdit = !!itemId;
  const queryClient = useQueryClient();

  const { data: itemData } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => fetchItem(itemId!),
    enabled: isEdit,
  });
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });

  const [itemName, setItemName] = useState(!isEdit && prefillName ? prefillName : '');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [defaultPurchaseQty, setDefaultPurchaseQty] = useState('1');
  const [daysPerUnit, setDaysPerUnit] = useState('');
  const [leadDays, setLeadDays] = useState('0');
  const [safetyDays, setSafetyDays] = useState('0');
  const [thresholdQty, setThresholdQty] = useState('');
  const [purchaseUrl, setPurchaseUrl] = useState('');
  const [itemMemo, setItemMemo] = useState('');
  const [notifyTargetType, setNotifyTargetType] = useState<string | null>('all');
  const [notifyTargetUserId, setNotifyTargetUserId] = useState<string | null>(null);
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [isInventoryUnknown, setIsInventoryUnknown] = useState(false);
  const [alternatives, setAlternatives] = useState<AltRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? '消耗品編集' : '消耗品登録' });
  }, [navigation, isEdit]);

  // 編集時: 既存値をフォームに反映
  useEffect(() => {
    const item = itemData?.item;
    if (!item || loaded) return;
    setItemName(item.itemName);
    setCategory(item.category ?? '');
    setUnit(item.unit ?? '');
    setDefaultPurchaseQty(String(item.defaultPurchaseQty));
    setDaysPerUnit(String(item.daysPerUnit));
    setLeadDays(String(item.leadDays));
    setSafetyDays(String(item.safetyDays));
    setThresholdQty(item.lowStockThresholdQty != null ? String(item.lowStockThresholdQty) : '');
    setPurchaseUrl(item.purchaseUrl ?? '');
    setItemMemo(item.itemMemo ?? '');
    setNotifyTargetType(item.notifyTargetType);
    setNotifyTargetUserId(item.notifyTargetUserId);
    setNotificationEnabled(item.notificationEnabled);
    setIsInventoryUnknown(item.isInventoryUnknown);
    setAlternatives(
      (item.alternatives ?? []).map((a: Alternative) => ({
        name: a.name,
        url: a.url ?? '',
        note: a.note ?? '',
      }))
    );
    setLoaded(true);
  }, [itemData, loaded]);

  const mutation = useMutation({
    mutationFn: (input: any) => (isEdit ? updateItem(itemId!, input) : createItem(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (itemId) queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      Alert.alert('保存完了', isEdit ? '消耗品を更新しました' : '消耗品を登録しました', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (e: any) => {
      const errors = e?.response?.data?.errors?.fieldErrors;
      const detail = errors
        ? Object.values(errors).flat().join('\n')
        : e?.response?.data?.message ?? '保存に失敗しました';
      Alert.alert('エラー', detail);
    },
  });

  const submit = () => {
    if (!itemName.trim()) {
      Alert.alert('入力エラー', '品名を入力してください');
      return;
    }
    if (daysPerUnit === '' || Number.isNaN(Number(daysPerUnit)) || Number(daysPerUnit) <= 0) {
      Alert.alert('入力エラー', '1単位あたり消費日数は正の数で入力してください');
      return;
    }
    mutation.mutate({
      itemName: itemName.trim(),
      category,
      unit,
      defaultPurchaseQty: Number(defaultPurchaseQty) || 1,
      daysPerUnit: Number(daysPerUnit),
      leadDays: Number(leadDays) || 0,
      safetyDays: Number(safetyDays) || 0,
      lowStockThresholdQty: thresholdQty === '' ? undefined : Number(thresholdQty),
      purchaseUrl,
      alternatives: alternatives
        .filter((a) => a.name.trim())
        .map((a) => ({ name: a.name.trim(), url: a.url || undefined, note: a.note || undefined })),
      itemMemo,
      notifyTargetType: notifyTargetType ?? 'all',
      notifyTargetUserId: notifyTargetType === 'specific_user' ? notifyTargetUserId ?? '' : '',
      notificationEnabled,
      isInventoryUnknown,
    });
  };

  const updateAlt = (index: number, field: keyof AltRow, value: string) => {
    setAlternatives((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl * 2 }}
      >
        <Section title="基本情報">
          <TextField label="品名 *" value={itemName} onChangeText={setItemName} />
          <TextField label="カテゴリ" value={category} onChangeText={setCategory} placeholder="例: 日用品" />
          <TextField label="単位" value={unit} onChangeText={setUnit} placeholder="例: 箱、本、袋" />
          <TextField
            label="標準購入数"
            value={defaultPurchaseQty}
            onChangeText={setDefaultPurchaseQty}
            keyboardType="decimal-pad"
            helper="1回の購入で買う数（Gmail取込のセット数換算にも使用）"
          />
          <TextField
            label="1単位あたり消費日数 *"
            value={daysPerUnit}
            onChangeText={setDaysPerUnit}
            keyboardType="decimal-pad"
            helper="例: 1箱を10日で使うなら 10"
          />
        </Section>

        <Section title="通知設定">
          <TextField
            label="通知何日前"
            value={leadDays}
            onChangeText={setLeadDays}
            keyboardType="number-pad"
          />
          <TextField
            label="安全日数"
            value={safetyDays}
            onChangeText={setSafetyDays}
            keyboardType="number-pad"
            helper="残日数が（通知何日前＋安全日数）以下になると通知"
          />
          <TextField
            label="在庫数しきい値"
            value={thresholdQty}
            onChangeText={setThresholdQty}
            keyboardType="decimal-pad"
            placeholder="空欄可"
            helper="残数がこの値以下になると通知"
          />
          <ChipSelector
            label="通知先"
            options={NOTIFY_TARGET_TYPES.map((t) => ({
              value: t,
              label: NOTIFY_TARGET_TYPE_LABELS[t],
            }))}
            value={notifyTargetType}
            onChange={setNotifyTargetType}
          />
          {notifyTargetType === 'specific_user' ? (
            <ChipSelector
              label="通知先ユーザー"
              options={(usersData?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
              value={notifyTargetUserId}
              onChange={setNotifyTargetUserId}
            />
          ) : null}
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>通知を有効にする</Text>
            <Switch
              value={notificationEnabled}
              onValueChange={setNotificationEnabled}
              trackColor={{ true: COLORS.warnSoft, false: COLORS.paperDeep }}
              thumbColor={notificationEnabled ? COLORS.warn : COLORS.inkFaint}
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>在庫不明（アラート対象外にする）</Text>
            <Switch
              value={isInventoryUnknown}
              onValueChange={setIsInventoryUnknown}
              trackColor={{ true: COLORS.warnSoft, false: COLORS.paperDeep }}
              thumbColor={isInventoryUnknown ? COLORS.warn : COLORS.inkFaint}
            />
          </View>
        </Section>

        <Section title="購入先">
          <TextField
            label="購入先URL"
            value={purchaseUrl}
            onChangeText={setPurchaseUrl}
            autoCapitalize="none"
            placeholder="https://..."
          />
          <Text style={styles.altTitle}>代替購入候補（最大{DEFAULTS.MAX_ALTERNATIVES}件）</Text>
          {alternatives.map((alt, i) => (
            <View key={i} style={styles.altRow}>
              <View style={styles.altHeader}>
                <Text style={styles.altIndex}>代替 {i + 1}</Text>
                <TouchableOpacity onPress={() => setAlternatives((rows) => rows.filter((_, j) => j !== i))}>
                  <Ionicons name="close-circle" size={20} color={COLORS.accentDeep} />
                </TouchableOpacity>
              </View>
              <TextField placeholder="名前 *" value={alt.name} onChangeText={(v) => updateAlt(i, 'name', v)} />
              <TextField
                placeholder="URL（任意）"
                value={alt.url}
                onChangeText={(v) => updateAlt(i, 'url', v)}
                autoCapitalize="none"
              />
              <TextField placeholder="メモ（任意）" value={alt.note} onChangeText={(v) => updateAlt(i, 'note', v)} />
            </View>
          ))}
          {alternatives.length < DEFAULTS.MAX_ALTERNATIVES ? (
            <Button
              title="代替候補を追加"
              variant="outline"
              icon={<Ionicons name="add" size={16} color={COLORS.ink} />}
              onPress={() => setAlternatives((rows) => [...rows, { name: '', url: '', note: '' }])}
            />
          ) : null}
        </Section>

        <Section title="メモ">
          <TextField
            value={itemMemo}
            onChangeText={setItemMemo}
            multiline
            placeholder="こだわり・買う時の注意・家族への伝達事項など"
            maxLength={DEFAULTS.MAX_ITEM_MEMO_LENGTH}
          />
        </Section>

        <Button title={isEdit ? '更新する' : '登録する'} onPress={submit} loading={mutation.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.paper },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
  },
  switchLabel: { fontFamily: FONTS.medium, fontSize: 14, color: COLORS.ink, flex: 1 },
  altTitle: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.inkSub, marginBottom: SPACING.sm },
  altRow: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  altHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  altIndex: { fontFamily: FONTS.bold, fontSize: 12, color: COLORS.inkSub },
});
