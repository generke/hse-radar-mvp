export const roles=["owner","hse","manager","hr","member","viewer"] as const;
export type Role=typeof roles[number];

export const permissions=[
  "employees.view","employees.manage","employees.import",
  "requirements.assign","requirements.complete","requirements.verify",
  "tasks.view","tasks.manage",
  "documents.view","documents.manage",
  "inventory.view","inventory.manage",
  "members.manage","audit.view","organization.manage",
] as const;
export type Permission=typeof permissions[number];

const all=[...permissions] as Permission[];
export const rolePermissions:Record<Role,readonly Permission[]>={
  owner:all,
  hse:["employees.view","employees.manage","employees.import","requirements.assign","requirements.complete","requirements.verify","tasks.view","tasks.manage","documents.view","documents.manage","inventory.view","inventory.manage","audit.view"],
  manager:["employees.view","requirements.complete","requirements.verify","tasks.view","tasks.manage","documents.view","inventory.view"],
  hr:["employees.view","employees.manage","employees.import","tasks.view","documents.view"],
  member:["employees.view","requirements.complete","tasks.view","documents.view"],
  viewer:["employees.view","tasks.view","documents.view","inventory.view"],
};

export function isRole(value:unknown):value is Role{
  return typeof value==="string"&&(roles as readonly string[]).includes(value);
}

export function hasPermission(role:string,permission:Permission):boolean{
  return isRole(role)&&rolePermissions[role].includes(permission);
}
