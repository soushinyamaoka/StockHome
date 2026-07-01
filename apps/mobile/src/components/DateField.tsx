import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface Props {
  label?: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  helper?: string;
}

function parseDateOnly(value?: string): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function autoFormatDateText(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const DateField: React.FC<Props> = ({
  label,
  value,
  onChange,
  placeholder,
  error,
  helper,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [draft, setDraft] = useState<string>(value ?? '');

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const commitText = (text: string) => {
    if (!text) {
      onChange('');
      return;
    }
    if (!DATE_REGEX.test(text)) return;
    const date = parseDateOnly(text);
    if (!date) return;
    onChange(text);
  };

  const handleTextChange = (raw: string) => {
    const formatted = autoFormatDateText(raw);
    setDraft(formatted);
    commitText(formatted);
  };

  const handleBlur = () => {
    if (draft && !DATE_REGEX.test(draft)) {
      setDraft(value ?? '');
    }
  };

  const handlePickerChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS !== 'ios') {
      setShowPicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      const formatted = formatDateOnly(selectedDate);
      setDraft(formatted);
      onChange(formatted);
    }
  };

  const currentDate = parseDateOnly(value) ?? new Date();

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputRow, error ? { borderColor: COLORS.accentDeep } : null]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={handleTextChange}
          onBlur={handleBlur}
          placeholder={placeholder ?? 'YYYY-MM-DD'}
          placeholderTextColor={COLORS.inkFaint}
          keyboardType="number-pad"
          maxLength={10}
          autoCorrect={false}
        />
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setShowPicker(true)}
          accessibilityLabel="カレンダーを開く"
        >
          <Ionicons name="calendar-outline" size={22} color={COLORS.accent} />
        </TouchableOpacity>
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}

      {showPicker && (
        <>
          <DateTimePicker
            value={currentDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handlePickerChange}
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={styles.iosDoneBtn} onPress={() => setShowPicker(false)}>
              <Text style={styles.iosDoneText}>完了</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  label: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    color: COLORS.inkSub,
    marginBottom: SPACING.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1.5,
    borderRadius: RADIUS.md,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
  },
  input: {
    flex: 1,
    paddingVertical: SPACING.md,
    fontFamily: FONTS.medium,
    fontSize: 16,
    color: COLORS.ink,
  },
  iconBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  error: { fontFamily: FONTS.medium, color: COLORS.accentDeep, marginTop: SPACING.xs, fontSize: 12 },
  helper: { fontFamily: FONTS.body, color: COLORS.inkFaint, marginTop: SPACING.xs, fontSize: 12 },
  iosDoneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  iosDoneText: { fontFamily: FONTS.bold, color: COLORS.accent, fontSize: 16 },
});
