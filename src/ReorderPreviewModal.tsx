import { useState } from 'react'
import type { ActionChangeSample, ReorderPreview } from './audit/types'
import type { AuditEntry } from './audit/types'
import { formatPacket, formatSize } from './format'

const STATUS_TEXT: Record<AuditEntry['status'], string> = {
  reachable: '可达',
  'partial-shadowed': '部分遮蔽',
  'fully-shadowed': '完全遮蔽',
  empty: '空区域',
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${formatSize(delta)}`
  if (delta < 0) return `-${formatSize(-delta)}`
  return '0'
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="copy-mini"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function SampleLine({ sample }: { sample: ActionChangeSample }) {
  return (
    <div className="packet-box">
      <span className="tag shadowed">动作变化</span>
      <span>{formatPacket(sample)}</span>
      <span className="arrow-note">
        变更前命中 #{sample.before.ruleIndex + 1} {sample.before.ruleName}（{sample.before.action}）
        → 变更后命中 #{sample.after.ruleIndex + 1} {sample.after.ruleName}（{sample.after.action}）
      </span>
      <CopyButton text={formatPacket(sample)} />
    </div>
  )
}

interface Props {
  preview: ReorderPreview
  /** 确认：一次性应用候选顺序 */
  onConfirm: () => void
  /** 取消：保持原顺序 */
  onCancel: () => void
}

export function ReorderPreviewModal({ preview, onConfirm, onCancel }: Props) {
  const {
    changes,
    ownerChangedCells,
    actionChangedCells,
    actionChangeSamples,
    hasDifferences,
    invalidCount,
  } = preview

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          调序影响预览：「{preview.movedName}」 #{preview.fromIndex + 1} → #{preview.toIndex + 1}
        </div>
        <div className="modal-body">
          {!hasDifferences ? (
            <div className="notice info" style={{ marginTop: 0 }}>
              本次调序对审计结果<b>无实际影响</b>：没有任何规则的状态或有效报文空间发生变化，
              也没有任何流量的首命中规则改变。确认后仅改变列表中的排列顺序，取消则保持原顺序。
            </div>
          ) : (
            <>
              <div className="notice info" style={{ marginTop: 0 }}>
                共 <b>{changes.length}</b> 条规则的审计结果发生变化；
                {ownerChangedCells > 0 ? (
                  <>
                    首命中规则发生变化的报文单元 <b>{ownerChangedCells}</b> 个，
                    其中首命中<b>动作</b>发生变化 <b>{actionChangedCells}</b> 个。
                  </>
                ) : (
                  <>没有流量的首命中规则发生改变。</>
                )}
              </div>

              {changes.length > 0 && (
                <table className="rule-table preview-table">
                  <thead>
                    <tr>
                      <th>规则</th>
                      <th>序号（旧 → 新）</th>
                      <th>状态（旧 → 新）</th>
                      <th>有效报文空间（旧 → 新）</th>
                      <th style={{ textAlign: 'right' }}>变化量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td className="idx-cell">
                          #{c.beforeIndex + 1} → #{c.afterIndex + 1}
                        </td>
                        <td>
                          <span className={`badge ${c.beforeStatus}`}>
                            {STATUS_TEXT[c.beforeStatus]}
                          </span>
                          <span className="muted-text"> → </span>
                          <span className={`badge ${c.afterStatus}`}>
                            {STATUS_TEXT[c.afterStatus]}
                          </span>
                        </td>
                        <td className="idx-cell">
                          {formatSize(c.beforeEffectiveSize)} → {formatSize(c.afterEffectiveSize)}
                        </td>
                        <td
                          className={`idx-cell ${
                            c.effectiveDelta > 0
                              ? 'delta-pos'
                              : c.effectiveDelta < 0
                                ? 'delta-neg'
                                : ''
                          }`}
                          style={{ textAlign: 'right' }}
                        >
                          {formatDelta(c.effectiveDelta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {actionChangeSamples.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <h3 className="preview-subhead">
                    首命中动作发生变化的流量 · 可复现样例（共 {actionChangedCells} 个单元）
                  </h3>
                  {actionChangeSamples.map((s, i) => (
                    <SampleLine key={i} sample={s} />
                  ))}
                </div>
              )}

              {ownerChangedCells > actionChangedCells && (
                <div className="legend" style={{ marginTop: 10 }}>
                  另有 {ownerChangedCells - actionChangedCells} 个单元的首命中规则发生变化，
                  但前后动作相同，流量实际处置不变。
                </div>
              )}
            </>
          )}

          {invalidCount > 0 && (
            <div className="legend" style={{ marginTop: 10 }}>
              列表中有 {invalidCount} 条非法规则，按既有语义不参与分析，也不参与本次对比。
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onCancel}>取消（保持原顺序）</button>
          <button className="primary" onClick={onConfirm}>
            确认应用新顺序
          </button>
        </div>
      </div>
    </div>
  )
}
