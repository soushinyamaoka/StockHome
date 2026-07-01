import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../hooks/useAuth';
import { COLORS, FONTS, HEADER_OPTIONS, SPACING } from '../theme';

import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import DashboardScreen from '../screens/DashboardScreen';
import StockListScreen from '../screens/stocks/StockListScreen';
import StockCorrectionScreen from '../screens/stocks/StockCorrectionScreen';
import ItemListScreen from '../screens/items/ItemListScreen';
import ItemFormScreen from '../screens/items/ItemFormScreen';
import PurchaseHistoryScreen from '../screens/items/PurchaseHistoryScreen';
import PurchaseFormScreen from '../screens/purchases/PurchaseFormScreen';
import CandidateListScreen from '../screens/candidates/CandidateListScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import NotificationLogScreen from '../screens/settings/NotificationLogScreen';
import ChangePasswordScreen from '../screens/settings/ChangePasswordScreen';
import FamilyScreen from '../screens/settings/FamilyScreen';

import type {
  AuthStackParamList,
  HomeStackParamList,
  StocksStackParamList,
  ItemsStackParamList,
  CandidatesStackParamList,
  SettingsStackParamList,
  MainTabParamList,
} from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const StocksStack = createNativeStackNavigator<StocksStackParamList>();
const ItemsStack = createNativeStackNavigator<ItemsStackParamList>();
const CandidatesStack = createNativeStackNavigator<CandidatesStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

// 画面全体を「紙」の上に置く
const paperTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: COLORS.paper,
    card: COLORS.paper,
    text: COLORS.ink,
    primary: COLORS.accent,
    border: COLORS.border,
  },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ ...HEADER_OPTIONS, headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ headerShown: true, title: 'アカウント作成' }}
      />
    </AuthStack.Navigator>
  );
}

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={HEADER_OPTIONS}>
      <HomeStack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
    </HomeStack.Navigator>
  );
}

function StocksNavigator() {
  return (
    <StocksStack.Navigator screenOptions={HEADER_OPTIONS}>
      <StocksStack.Screen name="StockList" component={StockListScreen} options={{ title: '在庫よそく' }} />
      <StocksStack.Screen
        name="StockCorrection"
        component={StockCorrectionScreen}
        options={{ title: '在庫のなおし' }}
      />
      <StocksStack.Screen name="PurchaseForm" component={PurchaseFormScreen} options={{ title: '買ったよ記録' }} />
    </StocksStack.Navigator>
  );
}

function ItemsNavigator() {
  return (
    <ItemsStack.Navigator screenOptions={HEADER_OPTIONS}>
      <ItemsStack.Screen name="ItemList" component={ItemListScreen} options={{ title: '消耗品ずかん' }} />
      <ItemsStack.Screen name="ItemForm" component={ItemFormScreen} options={{ title: '消耗品の登録' }} />
      <ItemsStack.Screen
        name="PurchaseHistory"
        component={PurchaseHistoryScreen}
        options={{ title: '購入のきろく' }}
      />
      <ItemsStack.Screen name="PurchaseForm" component={PurchaseFormScreen} options={{ title: '買ったよ記録' }} />
    </ItemsStack.Navigator>
  );
}

function CandidatesNavigator() {
  return (
    <CandidatesStack.Navigator screenOptions={HEADER_OPTIONS}>
      <CandidatesStack.Screen
        name="CandidateList"
        component={CandidateListScreen}
        options={{ title: 'メールの取込便' }}
      />
    </CandidatesStack.Navigator>
  );
}

function SettingsNavigator() {
  return (
    <SettingsStack.Navigator screenOptions={HEADER_OPTIONS}>
      <SettingsStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'せってい' }} />
      <SettingsStack.Screen
        name="NotificationLog"
        component={NotificationLogScreen}
        options={{ title: 'お知らせのきろく' }}
      />
      <SettingsStack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ title: 'パスワード変更' }}
      />
      <SettingsStack.Screen name="Family" component={FamilyScreen} options={{ title: '家族のメンバー' }} />
    </SettingsStack.Navigator>
  );
}

const TAB_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  HomeTab: { icon: 'home', label: 'ホーム' },
  StocksTab: { icon: 'hourglass', label: '在庫' },
  ItemsTab: { icon: 'basket', label: '消耗品' },
  CandidatesTab: { icon: 'mail-open', label: '取込便' },
  SettingsTab: { icon: 'settings-sharp', label: 'せってい' },
};

// カスタムタブバー: 紙の帯にアイコン。選択中は朱印（朱色の丸）が押される
function PaperTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, SPACING.sm) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const meta = TAB_META[route.name] ?? { icon: 'ellipse', label: route.name };
        return (
          <TouchableOpacity
            key={route.key}
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
            }}
          >
            <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
              <Ionicons
                name={meta.icon}
                size={20}
                color={focused ? '#FFFDF6' : COLORS.inkSub}
              />
            </View>
            <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{meta.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function MainNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <PaperTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="HomeTab" component={HomeNavigator} />
      <Tab.Screen name="StocksTab" component={StocksNavigator} />
      <Tab.Screen name="ItemsTab" component={ItemsNavigator} />
      <Tab.Screen name="CandidatesTab" component={CandidatesNavigator} />
      <Tab.Screen name="SettingsTab" component={SettingsNavigator} />
    </Tab.Navigator>
  );
}

export const RootNavigator: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: COLORS.paper,
        }}
      >
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }
  return (
    <NavigationContainer theme={paperTheme}>
      {user ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.paper,
    borderTopWidth: 1.5,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  tabItem: { flex: 1, alignItems: 'center' },
  tabIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  tabIconWrapActive: {
    backgroundColor: COLORS.accent,
    borderWidth: 1.5,
    borderColor: COLORS.borderInk,
    transform: [{ rotate: '-4deg' }],
  },
  tabLabel: {
    fontFamily: FONTS.medium,
    fontSize: 10,
    color: COLORS.inkFaint,
    marginTop: 2,
  },
  tabLabelActive: { fontFamily: FONTS.bold, color: COLORS.ink },
});
