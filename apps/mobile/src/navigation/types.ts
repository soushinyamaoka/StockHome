import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type HomeStackParamList = {
  Dashboard: undefined;
  OperatorNotices: undefined;
};

export type StocksStackParamList = {
  StockList: { highlightItemId?: string } | undefined;
  StockCorrection: { itemId: string };
  PurchaseForm: { itemId?: string; purchaseId?: string } | undefined;
};

export type ItemsStackParamList = {
  ItemList: undefined;
  ItemForm: { itemId?: string; prefillName?: string; returnToCandidateId?: string } | undefined;
  PurchaseHistory: { itemId: string };
  PurchaseForm: { itemId?: string; purchaseId?: string } | undefined;
};

export type CandidatesStackParamList = {
  CandidateList: { linkCandidateId?: string; linkItemId?: string } | undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
  NotificationLog: undefined;
  ReflectionLog: undefined;
  ChangePassword: undefined;
  Family: undefined;
  OperatorNotices: undefined;
};

export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  StocksTab: NavigatorScreenParams<StocksStackParamList>;
  ItemsTab: NavigatorScreenParams<ItemsStackParamList>;
  CandidatesTab: NavigatorScreenParams<CandidatesStackParamList>;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList>;
};
