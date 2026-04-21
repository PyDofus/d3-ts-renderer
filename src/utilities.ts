export function getEnumKeyByValue<T extends Record<string, unknown>>(enumObject: T, value: T[keyof T]): keyof T | undefined {
  return Object.keys(enumObject).find(key => enumObject[key] === value);
}
