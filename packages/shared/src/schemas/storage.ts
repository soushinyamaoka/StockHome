import { z } from 'zod';

// 保管場所管理（場所・物・置き場所・用途タグ）の入力スキーマ

export const STORAGE_LIMITS = {
  /** 場所名・物の名前・タグ名の最大文字数 */
  MAX_NAME_LENGTH: 100,
  /** メモの最大文字数 */
  MAX_MEMO_LENGTH: 500,
  /** 場所の階層の最大段数（例: 1階 › パントリー › A棚 › 3段目 で4段） */
  MAX_LOCATION_DEPTH: 8,
  /** 1つの物に付けられる用途タグの上限 */
  MAX_TAGS_PER_TARGET: 30,
  /** 一括登録1回あたりの件数上限 */
  MAX_IMPORT_ENTRIES: 200,
} as const;

/**
 * 名前の正規化（場所名・物の名前・タグ名で共通）。
 * 全角英数・半角カナのゆれを NFKC でそろえ、前後の空白を除き、連続空白を1つにする。
 * 保存時も照合時も同じ関数を通すことで「Ａ棚」と「A棚」を同じ場所として扱う。
 */
export function normalizeStorageName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

const storageName = z
  .string()
  .transform(normalizeStorageName)
  .pipe(
    z
      .string()
      .min(1, '名前を入力してください')
      .max(STORAGE_LIMITS.MAX_NAME_LENGTH, `名前は${STORAGE_LIMITS.MAX_NAME_LENGTH}文字以内で入力してください`)
  );

// 任意のメモ。空文字・null は「メモなし」(null)
const storageMemo = z
  .string()
  .trim()
  .max(STORAGE_LIMITS.MAX_MEMO_LENGTH, `メモは${STORAGE_LIMITS.MAX_MEMO_LENGTH}文字以内で入力してください`)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const tagNames = z
  .array(storageName)
  .max(STORAGE_LIMITS.MAX_TAGS_PER_TARGET, `用途タグは${STORAGE_LIMITS.MAX_TAGS_PER_TARGET}個までです`)
  .transform((names) => Array.from(new Set(names)));

// --- 場所 ---

export const storageLocationCreateSchema = z.object({
  name: storageName,
  parentId: z.string().min(1).nullable().optional(),
  memo: storageMemo,
  sortOrder: z.coerce.number().int().optional(),
});
export type StorageLocationCreateInput = z.infer<typeof storageLocationCreateSchema>;

export const storageLocationUpdateSchema = z
  .object({
    name: storageName.optional(),
    /** null で最上位へ移動 */
    parentId: z.string().min(1).nullable().optional(),
    memo: storageMemo,
    sortOrder: z.coerce.number().int().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), '変更する項目がありません');
export type StorageLocationUpdateInput = z.infer<typeof storageLocationUpdateSchema>;

export const storageLocationMergeSchema = z.object({
  targetId: z.string().min(1),
});

// --- 置き場所 ---

/** 消耗品(itemId)か物(thingId)のどちらか一方を指定する */
const placementTarget = {
  itemId: z.string().min(1).optional(),
  thingId: z.string().min(1).optional(),
};
const exactlyOneTarget = (v: { itemId?: string; thingId?: string }) => !!v.itemId !== !!v.thingId;
const exactlyOneTargetMessage = 'itemId と thingId のどちらか一方を指定してください';

export const storagePlacementCreateSchema = z
  .object({ ...placementTarget, locationId: z.string().min(1), memo: storageMemo })
  .refine(exactlyOneTarget, exactlyOneTargetMessage);
export type StoragePlacementCreateInput = z.infer<typeof storagePlacementCreateSchema>;

export const storagePlacementUpdateSchema = z
  .object({ locationId: z.string().min(1).optional(), memo: storageMemo })
  .refine((v) => v.locationId !== undefined || v.memo !== undefined, '変更する項目がありません');
export type StoragePlacementUpdateInput = z.infer<typeof storagePlacementUpdateSchema>;

// --- 物（場所だけ管理する物） ---

const thingPlacement = z.object({ locationId: z.string().min(1), memo: storageMemo });

export const storageThingCreateSchema = z.object({
  name: storageName,
  memo: storageMemo,
  placements: z.array(thingPlacement).default([]),
  tags: tagNames.default([]),
});
export type StorageThingCreateInput = z.infer<typeof storageThingCreateSchema>;

export const storageThingUpdateSchema = z
  .object({ name: storageName.optional(), memo: storageMemo })
  .refine((v) => v.name !== undefined || v.memo !== undefined, '変更する項目がありません');
export type StorageThingUpdateInput = z.infer<typeof storageThingUpdateSchema>;

// --- 用途タグ ---

export const usageTagCreateSchema = z.object({ name: storageName });
export const usageTagUpdateSchema = z.object({ name: storageName });
export const usageTagMergeSchema = z.object({ targetId: z.string().min(1) });

/** 対象（消耗品か物）の用途タグを、指定した名前の集合に置き換える。未登録の名前は新規作成 */
export const usageTagAssignSchema = z
  .object({ ...placementTarget, names: tagNames })
  .refine(exactlyOneTarget, exactlyOneTargetMessage);
export type UsageTagAssignInput = z.infer<typeof usageTagAssignSchema>;

// --- 検索 ---

export const storageSearchQuerySchema = z.object({
  q: z.string().trim().max(STORAGE_LIMITS.MAX_NAME_LENGTH).optional(),
  tagId: z.string().min(1).optional(),
  /** 指定した場所とその配下にある物に絞る */
  locationId: z.string().min(1).optional(),
  kind: z.enum(['item', 'thing']).optional(),
});
export type StorageSearchQuery = z.infer<typeof storageSearchQuerySchema>;

// --- 一括登録（チャット経由の初回登録用） ---

export const storageImportLocationSchema = z.object({
  /** 最上位からの場所名の並び。例: ["1階", "パントリー", "A棚", "3段目"] */
  path: z
    .array(storageName)
    .min(1, '場所を指定してください')
    .max(STORAGE_LIMITS.MAX_LOCATION_DEPTH, `場所の階層は${STORAGE_LIMITS.MAX_LOCATION_DEPTH}段までです`),
  memo: storageMemo,
});

export const storageImportEntrySchema = z
  .object({
    /** thing=場所だけ管理する物（同名の物があれば追記）、item=既存の消耗品へ場所・タグを付与 */
    kind: z.enum(['thing', 'item']),
    name: storageName,
    /** kind=item で品名ではなく ID で指定する場合 */
    itemId: z.string().min(1).optional(),
    /** kind=thing の物メモ（指定時のみ上書き） */
    memo: storageMemo,
    locations: z.array(storageImportLocationSchema).default([]),
    tags: tagNames.default([]),
  })
  .refine((v) => v.kind === 'item' || v.itemId === undefined, 'itemId は kind=item のときだけ指定できます');
export type StorageImportEntry = z.infer<typeof storageImportEntrySchema>;

export const storageImportSchema = z.object({
  /** true なら何も書き込まず、登録予定の内容だけを返す */
  dryRun: z.boolean().default(true),
  entries: z
    .array(storageImportEntrySchema)
    .min(1, '登録内容がありません')
    .max(STORAGE_LIMITS.MAX_IMPORT_ENTRIES, `一度に登録できるのは${STORAGE_LIMITS.MAX_IMPORT_ENTRIES}件までです`),
});
export type StorageImportInput = z.infer<typeof storageImportSchema>;
