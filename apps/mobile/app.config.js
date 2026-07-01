// StockHome Expo 設定（旧 app.json から移行）。
// EAS Update ＋ 開発ビルド運用（meal-planner-app 準拠）。
//
// 機密はここに書かない:
//   - owner       … process.env.EXPO_OWNER（apps/mobile/.env）
//   - VPS API URL … EXPO_PUBLIC_API_BASE_URL（apps/mobile/.env、src/api/client.ts が参照）
//
// projectId / updates.url は秘密ではないが eas init 後に確定する。
// TODO(eas init): `eas login` → `eas init` で発行された projectId を下記 EAS_PROJECT_ID に直書きする。
//   （未設定の間は updates / extra.eas を出力しないので eas init が正常に動く）

const IS_DEV = process.env.APP_VARIANT === "development";

// eas init 発行の projectId（公開識別子・秘密ではない）。env で上書きも可。
const EAS_PROJECT_ID =
  process.env.EAS_PROJECT_ID || "0efdea1f-3cf8-4d2d-83f3-ae10130972bd";

export default {
  expo: {
    name: IS_DEV ? "StockHome (dev)" : "StockHome",
    slug: "stockhome",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    scheme: "stockhome",
    splash: {
      resizeMode: "contain",
      backgroundColor: "#F6F0E3",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: IS_DEV
        ? "com.example.stockhome.dev"
        : "com.example.stockhome",
      // VPS API への HTTP(平文) 接続を許可（開発ビルドは実ネイティブビルドのため必須）
      infoPlist: {
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      },
    },
    android: {
      package: IS_DEV ? "com.example.stockhome.dev" : "com.example.stockhome",
    },
    runtimeVersion: {
      policy: "sdkVersion",
    },
    plugins: [
      "expo-secure-store",
      "@react-native-community/datetimepicker",
      [
        "expo-build-properties",
        {
          android: { usesCleartextTraffic: true },
        },
      ],
    ],
    extra: {
      gmailSettingsUrl:
        "https://script.google.com/macros/s/AKfycbzKFI_fiTSmHXX_WWuzVdiNCxBjFIREtaZcRqYx-NxEp8zFsjWV9PbTiV58Y1WL3-GwhQ/exec?page=gmailSettings",
      // eas init 後に EAS_PROJECT_ID を設定すると下記が出力される
      ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    },
    // eas init 後に EAS_PROJECT_ID を設定すると更新URLが出力される
    ...(EAS_PROJECT_ID
      ? { updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } }
      : {}),
    owner: process.env.EXPO_OWNER,
  },
};
