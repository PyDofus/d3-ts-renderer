export const enum SubEntityCategory {
  UNUSED = 0,
  PET = 1,
  MOUNT_DRIVER = 2,
  LIFTED_ENTITY = 3,
  BASE_BACKGROUND = 4,
  BASE_FOREGROUND = 6,
  PET_FOLLOWER = 7,
  UNDERWATER_BUBBLES = 8,
  RIDER_LEG = 9,
  CATEGORY_10 = 10,
  CATEGORY_11 = 11,
  CATEGORY_12 = 12,
  CATEGORY_13 = 13,
  CATEGORY_14 = 14,
}

/** Runtime name → value mapping (needed for Look.fromDict which receives a string). */
export const SubEntityCategoryByName: Readonly<Record<string, number>> = {
  UNUSED: 0,
  PET: 1,
  MOUNT_DRIVER: 2,
  LIFTED_ENTITY: 3,
  BASE_BACKGROUND: 4,
  BASE_FOREGROUND: 6,
  PET_FOLLOWER: 7,
  UNDERWATER_BUBBLES: 8,
  RIDER_LEG: 9,
  CATEGORY_10: 10,
  CATEGORY_11: 11,
  CATEGORY_12: 12,
  CATEGORY_13: 13,
  CATEGORY_14: 14,
};