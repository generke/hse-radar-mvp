export const sectionKeys=["overview","employees","positions","inventory","ppe","documents","tasks","learning","vision","team","audit","billing"] as const;
export type SectionKey=typeof sectionKeys[number];

export const sectionLabels:Record<SectionKey,string>={
  overview:"Оперативный центр",employees:"Работники",positions:"Должности",inventory:"Оборудование",
  ppe:"СИЗ",documents:"Документы",tasks:"Задачи",learning:"Обучение",vision:"Safety Vision",
  team:"Команда",audit:"Журнал действий",billing:"Тариф и оплата"
};

export const rolePermissionPresets:Record<string,SectionKey[]>={
  owner:[...sectionKeys],
  hse:["overview","employees","positions","inventory","ppe","documents","tasks","learning","vision","audit"],
  hr:["overview","employees","documents","learning"],
  manager:["overview","employees","tasks","learning","vision"],
  member:["overview","tasks","learning"]
};

export function normalizePermissions(role:string,value:unknown):SectionKey[]{
  if(role==="owner")return [...sectionKeys];
  if(!Array.isArray(value))return rolePermissionPresets[role]||rolePermissionPresets.member;
  const valid=value.filter((item):item is SectionKey=>sectionKeys.includes(item as SectionKey));
  return valid.includes("overview")?valid:["overview",...valid];
}
