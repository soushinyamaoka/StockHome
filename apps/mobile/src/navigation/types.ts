import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type HomeStackParamList = {
  Dashboard: undefined;
};

export type StocksStackParamList = {
  StockList: { highlightItemId?: string } | undefined;
  StockCorrection: { itemId: string };
  PurchaseForm: { itemId?: string } | undefined;
};

export type ItemsStackParamList = {
  ItemList: undefined;
  ItemForm: { itemId?: string; prefillName?: string } | undefined;
  PurchaseHistory: { itemId: string };
  PurchaseForm: { itemId?: string } | undefined;
};

export type CandidatesStackParamList = {
  CandidateList: undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
  NotificationLog: undefined;
  ChangePassword: undefined;
  Family: undefined;
};

export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  StocksTab: NavigatorScreenParams<StocksStackParamList>;
  ItemsTab: NavigatorScreenParams<ItemsStackParamList>;
  CandidatesTab: NavigatorScreenParams<CandidatesStackParamList>;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList>;
};
