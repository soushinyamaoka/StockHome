// StockHome デザインシステム —「台所の買い物メモ」
// クリーム色の紙面 × 墨色の文字 × 朱色のアクセント。
// 和文具（手帳・付箋・スタンプ）の世界観で、家庭の道具らしい温かさを出す。
import { Platform } from 'react-native';

export const COLORS = {
  // 紙面
  paper: '#F6F0E3', // 画面の背景（生成りの紙）
  paperDeep: '#EEE5D0', // 一段沈んだ面（ツールバー等）
  surface: '#FFFDF6', // カード（白に近い紙）
  surfaceWarm: '#FBF6EA', // カード内の小面

  // 文字（墨）
  ink: '#33291E', // 主文字（焦げ茶寄りの墨色）
  inkSub: '#7A6E5C', // 補助文字
  inkFaint: '#B0A48D', // 弱い文字・プレースホルダ

  // アクセント
  accent: '#D6482E', // 朱色（アラート・主ボタン・朱印）
  accentDeep: '#B23A24',
  accentSoft: '#FBE3DB', // 朱の淡い面
  ok: '#6B7F45', // 抹茶（在庫OK・成功）
  okSoft: '#E9EDD9',
  warn: '#C58A1F', // からし（注意）
  warnSoft: '#F6E9C8',
  indigo: '#41597A', // 藍（リンク・情報）
  indigoSoft: '#E2E8F0',

  // 線・影
  border: '#E0D5BD', // 基本の枠線（温かいベージュ）
  borderInk: '#4A3F30', // 強い枠線（スタンプ・主ボタン縁）
  shadow: '#7E6E50',

  // マスキングテープ（メモ・装飾）
  tapeYellow: 'rgba(242, 201, 76, 0.55)',
  tapeGreen: 'rgba(143, 175, 96, 0.45)',
  tapePink: 'rgba(232, 145, 124, 0.45)',

  // 取込候補ステータス
  candidate: {
    detected: '#8C8472',
    ordered: '#41597A',
    shipped: '#C58A1F',
    confirmed: '#6B7F45',
    auto_confirmed: '#5E8268',
    ignored: '#A39A86',
    cancelled: '#B23A24',
    error: '#D6482E',
  } as Record<string, string>,
};

// フォント（App.tsx で読み込み）
// 和文UI: Zen Maru Gothic（丸ゴシック・文具の温かさ）
// 数字の主役: Fraunces（表情のあるセリフ。残日数カウンター等）
export const FONTS = {
  body: 'ZenMaruGothic_400Regular',
  medium: 'ZenMaruGothic_500Medium',
  bold: 'ZenMaruGothic_700Bold',
  black: 'ZenMaruGothic_900Black',
  display: 'Fraunces_700Bold', // 大きな数字・ロゴ
  displayBlack: 'Fraunces_900Black',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const RADIUS = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
};

// 紙の上の柔らかい影
export const SHADOW = {
  card: {
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  raised: {
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
};

// ナビゲーションヘッダーの共通スタイル（紙面に墨文字）
export const HEADER_OPTIONS = {
  headerStyle: { backgroundColor: COLORS.paper },
  headerTintColor: COLORS.ink,
  headerTitleStyle: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    color: COLORS.ink,
  },
  headerShadowVisible: false,
} as const;

// Android で elevation の影が黒くなりすぎるのを防ぐ共通値
export const HAIRLINE = Platform.select({ ios: 1, android: 1.2, default: 1 }) as number;
