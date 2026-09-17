/**
 * 调序影响预览。
 *
 * 用当前顺序与候选顺序分别执行既有 audit，并按规则 id 对齐结果，
 * 得出每条受影响规则的旧/新序号、状态、有效报文空间及变化量；
 * 再逐报文单元对比两种顺序下的首个命中者，找出首命中动作发生变化的流量，
 * 并为其生成确定性的可复现样例（IP、端口、协议 + 变更前后命中规则与动作）。
 *
 * 非法规则按既有语义排除：不参与分析，也不出现在差异列表中。
 * 同一批合法规则无论顺序如何，原子空间与单元集合都相同，故可逐单元对齐。
 */
import { audit, computeCellOwnership, exampleIp } from './engine'
import { intToIpv4 } from './iputil'
import {
  ActionChangeSample,
  AuditResultEntry,
  Protocol,
  ReorderPreview,
  ReorderRuleChange,
  RuleInput,
} from './types'

const CONCRETE_PROTOCOLS: Array<Exclude<Protocol, 'ANY'>> = ['TCP', 'UDP']

/**
 * 按规则 id 对齐两种顺序的审计条目。
 * 正常情况下 id 唯一；对导入产生的重复 id，用出现次序区分，保证仍能一一对应。
 */
function entryMapById(entries: AuditResultEntry[]): Map<string, AuditResultEntry> {
  const seen = new Map<string, number>()
  const map = new Map<string, AuditResultEntry>()
  for (const entry of entries) {
    const n = seen.get(entry.id) ?? 0
    seen.set(entry.id, n + 1)
    map.set(n === 0 ? entry.id : `${entry.id}#${n}`, entry)
  }
  return map
}

function decodeKey(key: string): { ip: number; port: number; proto: number } {
  const [ip, port, proto] = key.split('.').map(Number)
  return { ip, port, proto }
}

/** 对比两种规则顺序的审计结果，产出调序预览。before / after 均不会被修改。 */
export function diffRuleOrder(
  before: RuleInput[],
  after: RuleInput[],
  move: { fromIndex: number; toIndex: number; movedId: string },
): ReorderPreview {
  const reportBefore = audit(before)
  const reportAfter = audit(after)
  const mapBefore = entryMapById(reportBefore.entries)
  const mapAfter = entryMapById(reportAfter.entries)

  const changes: ReorderRuleChange[] = []
  for (const [key, a] of mapBefore) {
    const b = mapAfter.get(key)
    if (!b) continue // 纯调序不会发生，防御性跳过
    // 非法规则不参与分析，其“状态”不可能因调序改变，直接排除
    if (a.kind !== 'valid' || b.kind !== 'valid') continue
    if (a.status === b.status && a.effectiveSize === b.effectiveSize) continue
    changes.push({
      id: a.id,
      name: a.name,
      beforeIndex: a.index,
      afterIndex: b.index,
      beforeStatus: a.status,
      afterStatus: b.status,
      declaredSize: a.declaredSize,
      beforeEffectiveSize: a.effectiveSize,
      afterEffectiveSize: b.effectiveSize,
      effectiveDelta: b.effectiveSize - a.effectiveSize,
    })
  }
  changes.sort(
    (x, y) =>
      Math.abs(y.effectiveDelta) - Math.abs(x.effectiveDelta) || x.beforeIndex - y.beforeIndex,
  )

  // 逐单元对比首命中者，找出首命中规则 / 动作发生变化的流量
  const ownBefore = computeCellOwnership(before)
  const ownAfter = computeCellOwnership(after)
  let ownerChangedCells = 0
  let actionChangedCells = 0
  const actionChangeSamples: ActionChangeSample[] = []
  const sampledTransitions = new Set<string>()

  const keys = [...ownBefore.owner.keys()].sort()
  for (const key of keys) {
    const posA = ownBefore.owner.get(key)!
    const posB = ownAfter.owner.get(key)
    if (posB === undefined) continue // 同一批合法规则单元集合相同，防御性跳过
    const ruleA = ownBefore.valid[posA]
    const ruleB = ownAfter.valid[posB]
    // 按 id 判断首命中者是否改变（重复 id 的极端情形按同一规则处理）
    if (ruleA.id === ruleB.id) continue
    ownerChangedCells++
    if (ruleA.action === ruleB.action) continue
    actionChangedCells++
    // 样例确定性选取：按单元 key 升序，每个「前规则 -> 后规则」组合至多一个，最多 3 个
    const transition = `${posA}->${posB}`
    if (actionChangeSamples.length < 3 && !sampledTransitions.has(transition)) {
      sampledTransitions.add(transition)
      const { ip, port, proto } = decodeKey(key)
      actionChangeSamples.push({
        srcIp: intToIpv4(exampleIp(ownBefore.ipAtoms[ip])),
        srcPort: ownBefore.portAtoms[port].start,
        protocol: CONCRETE_PROTOCOLS[proto],
        before: { ruleIndex: ruleA.index, ruleName: ruleA.name, action: ruleA.action },
        after: { ruleIndex: ruleB.index, ruleName: ruleB.name, action: ruleB.action },
      })
    }
  }

  const moved = before[move.fromIndex]
  return {
    movedId: move.movedId,
    movedName: (moved?.name ?? '').trim() || `规则 #${move.fromIndex + 1}`,
    fromIndex: move.fromIndex,
    toIndex: move.toIndex,
    changes,
    ownerChangedCells,
    actionChangedCells,
    actionChangeSamples,
    hasDifferences: changes.length > 0 || ownerChangedCells > 0,
    invalidCount: reportBefore.stats.invalid,
  }
}

/**
 * 生成「把 before[from] 移动到 before[to]」的候选顺序及其影响预览。
 * 不修改 before；确认应用时直接使用返回的 candidate。
 */
export function previewReorder(
  before: RuleInput[],
  from: number,
  to: number,
): { candidate: RuleInput[]; preview: ReorderPreview } {
  const candidate = [...before]
  const [moved] = candidate.splice(from, 1)
  candidate.splice(to, 0, moved)
  const preview = diffRuleOrder(before, candidate, {
    fromIndex: from,
    toIndex: to,
    movedId: moved.id,
  })
  return { candidate, preview }
}
