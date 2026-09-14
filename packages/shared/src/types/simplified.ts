/**
 * 简化类型定义
 * 用于下拉选择、关联显示等场景，只需 id 和 name
 */

/** 简化的员工信息 */
export interface ISimpleEmployee {
  id: string;
  name: string;
}

/** 简化的客户信息 */
export interface ISimpleCustomer {
  id: string;
  customerName: string;
}

/** 简化的项目信息 */
export interface ISimpleProject {
  id: string;
  name: string;
}

/** 通用的 ID-Name 对 */
export interface IIdNamePair {
  id: string;
  name: string;
}
