/**
 * 首命中规则审计台 —— 类型定义
 *
 * 流量空间为三个维度的笛卡尔积：
 *   源 IPv4（CIDR 划分的原子块）× 源端口（区间边界划分的原子段）× 协议
 * 每条规则声明一个长方体区域；按列表顺序，首个覆盖某单元的规则即该单元的命中者。
 */

export type Protocol = 'TCP' | 'UDP' | 'ANY'
export type Action = string

/** UI / 导入中的规则原始形态 */
export interface RuleInput {
  id: string
  name: string
  cidr: string
  portStart: string | number
  portEnd: string | number
  protocol: string
  action: string
  enabled: boolean
}

/** 校验通过后的规范规则 */
export interface NormalizedRule {
  id: string
  name: string
  index: number
  ipStart: number
  ipEnd: number
  prefix: number
  cidrText: string
  portStart: number
  portEnd: number
  protocol: Protocol
  action: Action
  enabled: boolean
}

export interface InvalidRule {
  id: string
  index: number
  name: string
  errors: string[]
  raw: {
    cidr: string
    portStart: string | number
    portEnd: string | number
    protocol: string
    action: string
    enabled: boolean
  }
}

/** 由 CIDR 边界递归切割得到的 IP 原子块（始终对齐某个 CIDR 前缀） */
export interface IpAtom {
  start: number
  end: number
  prefix: number
}

export interface PortAtom {
  start: number
  end: number
}

export type StatusLevel = 'reachable' | 'partial-shadowed' | 'fully-shadowed' | 'invalid' | 'empty'

/** 遮蔽来源：单个单元可同时被多条更早的规则覆盖（共同覆盖） */
export interface ShadowSource {
  ruleIndex: number
  ruleName: string
  action: Action
  /** 该来源在此规则上贡献的单元数 */
  cells: number
}

/** 可复现的示例报文 */
export interface ExamplePacket {
  srcIp: string
  srcPort: number
  protocol: Exclude<Protocol, 'ANY'>
  matchedRuleIndex: number
  matchedRuleName: string
  action: Action
  /** reachable = 命中当前规则；shadowed = 命中的是更早的遮蔽规则 */
  kind: 'reachable' | 'shadowed'
}

/** 有效区域中按协议合并后的展示块 */
export interface RegionGroup {
  protocol: Exclude<Protocol, 'ANY'>
  cidrs: string[]
  portRanges: Array<{ start: number; end: number }>
  /** 该组覆盖的报文空间大小（IP 数 × 端口数） */
  size: number
}

export interface AuditEntry {
  kind: 'valid'
  id: string
  index: number
  name: string
  cidrText: string
  portStart: number
  portEnd: number
  protocol: Protocol
  action: Action
  enabled: boolean

  status: Exclude<StatusLevel, 'invalid'>
  /** 声明区域的报文空间大小 */
  declaredSize: number
  /** 首条命中语义下真正落到本规则的大小 */
  effectiveSize: number
  effectiveRatio: number

  region: RegionGroup[]
  shadowSources: ShadowSource[]
  /** 该规则被遮蔽的单元数（一个单元可被多个来源共同遮蔽，此为去重后的单元数） */
  blockedCells: number
  declaredCells: number
  effectiveCells: number

  reachableExample: ExamplePacket | null
  shadowedExamples: ExamplePacket[]
  /** 完全遮蔽且没有任何单条前序规则能独立遮蔽全部单元（即多规则共同覆盖） */
  collectiveCover: boolean
}

export interface AuditInvalidEntry {
  kind: 'invalid'
  id: string
  index: number
  name: string
  errors: string[]
  raw: InvalidRule['raw']
}

export type AuditResultEntry = AuditEntry | AuditInvalidEntry

export interface AuditStats {
  total: number
  invalid: number
  reachable: number
  partial: number
  fullyShadowed: number
  totalDeclaredSize: number
  totalEffectiveSize: number
}

export interface AuditReport {
  generatedAt: string
  stats: AuditStats
  entries: AuditResultEntry[]
}

// ---------------------------------------------------------------------------
// 调序影响预览
// ---------------------------------------------------------------------------

/** 单条规则在两种顺序下的审计差异（按规则 id 对齐） */
export interface ReorderRuleChange {
  id: string
  name: string
  /** 旧顺序中的序号（0 起） */
  beforeIndex: number
  /** 新顺序中的序号（0 起） */
  afterIndex: number
  beforeStatus: AuditEntry['status']
  afterStatus: AuditEntry['status']
  /** 声明区域的报文空间大小（调序不变，仅作参照） */
  declaredSize: number
  beforeEffectiveSize: number
  afterEffectiveSize: number
  /** afterEffectiveSize - beforeEffectiveSize */
  effectiveDelta: number
}

/** 首命中动作发生变化的流量的可复现样例 */
export interface ActionChangeSample {
  srcIp: string
  srcPort: number
  protocol: Exclude<Protocol, 'ANY'>
  /** 变更前首命中的规则与动作 */
  before: { ruleIndex: number; ruleName: string; action: Action }
  /** 变更后首命中的规则与动作 */
  after: { ruleIndex: number; ruleName: string; action: Action }
}

/** 一次调序的完整影响预览 */
export interface ReorderPreview {
  movedId: string
  movedName: string
  /** 拖拽源序号（0 起） */
  fromIndex: number
  /** 目标序号（0 起） */
  toIndex: number
  /** 审计结果发生变化的规则（状态或有效报文空间），按 |变化量| 降序 */
  changes: ReorderRuleChange[]
  /** 首命中规则发生变化的单元数 */
  ownerChangedCells: number
  /** 首命中动作发生变化的单元数（ownerChangedCells 的子集） */
  actionChangedCells: number
  /** 动作变化的可复现样例（确定性选取，最多 3 个） */
  actionChangeSamples: ActionChangeSample[]
  /** 是否存在任何实际差异（规则审计结果或单元首命中者） */
  hasDifferences: boolean
  /** 非法规则数量：按既有语义不参与分析，也不参与对比 */
  invalidCount: number
}
