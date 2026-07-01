import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACING } from '../theme';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  helper?: string;
}

export const TextField: React.FC<Props> = ({
  label,
  error,
  helper,
  style,
  multiline,
  onFocus,
  onBlur,
  ...rest
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...rest}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          multiline && { minHeight: 100, textAlignVertical: 'top' },
          focused && styles.inputFocused,
          error ? { borderColor: COLORS.accentDeep } : null,
          style as any,
        ]}
        placeholderTextColor={COLORS.inkFaint}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
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
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1.5,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontFamily: FONTS.medium,
    fontSize: 16,
    color: COLORS.ink,
  },
  // フォーカスで墨の縁取りに（記入欄が「いま書く場所」だと分かる）
  inputFocused: { borderColor: COLORS.borderInk, backgroundColor: '#FFFFFF' },
  error: { fontFamily: FONTS.medium, color: COLORS.accentDeep, marginTop: SPACING.xs, fontSize: 12 },
  helper: { fontFamily: FONTS.body, color: COLORS.inkFaint, marginTop: SPACING.xs, fontSize: 12 },
});
