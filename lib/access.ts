import { hasPermission, isRole, permissions, rolePermissions, roles, type Permission, type Role } from "./permissions";

export { hasPermission, isRole, permissions, rolePermissions, roles };
export type { Permission, Role };

export const sectionKeys=["overview","employees","positions","tmc","documents","tasks","learning","vision","team","audit","billing"] as const;
export type SectionKey=typeof sectionKeys[number];

export const sectionLabels:Record<SectionKey,string>={
  overview:"Оперативный центр",employees:"Работники",positions:"Должности",tmc:"ТМЦ",
  documents:"Документы",tasks:"Задачи",learning:"Обучение",vision:"Safety Vision",
  team:"Руководители",audit:"Журнал действий",billing:"Тариф и оплата"
};

export const rolePermissionPresets:Record<string,SectionKey[]>={
  owner:[...sectionKeys],
  hse:["overview","employees","positions","tmc","documents","tasks","learning","vision","audit"],
  hr:["overview","employees","documents","learning"],
  manager:["overview","employees","tasks","learning","vision"],
  member:["overview","tasks","learning"],
  viewer:["overview","employees","tmc","documents","tasks"],
};

export function normalizePermissions(role:string,value:unknown):SectionKey[]{
  if(role==="owner")return [...sectionKeys];
  if(!Array.isArray(value))return rolePermissionPresets[role]||rolePermissionPresets.viewer;
  const valid=value.filter((item):item is SectionKey=>sectionKeys.includes(item as SectionKey));
  return valid.includes("overview")?valid:["overview",...valid];
}
