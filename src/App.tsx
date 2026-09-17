import { useMemo, useState } from 'react'
import { RuleTable } from './RuleTable'
import { AuditResults } from './AuditResults'
import { ImportModal, ExportModal } from './Modals'
import { ReorderPreviewModal } from './ReorderPreviewModal'
import { audit, exportReport, newRuleInput, parseRulesJson } from './audit/engine'
import { previewReorder } from './audit/diff'
import type { ReorderPreview, RuleInput } from './audit/types'
import { createDemoRules } from './defaultRules'
import { formatSize } from './format'
import './styles.css'

export default function App() {
  const [rules, setRules] = useState<RuleInput[]>(() => createDemoRules())
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** 待确认的调序：候选顺序 + 影响预览；确认前 rules 保持原顺序 */
  const [pendingReorder, setPendingReorder] = useState<{
    candidate: RuleInput[]
    preview: ReorderPreview
  } | null>(null)

  const report = useMemo(() => audit(rules), [rules])
  const exportJson = useMemo(() => exportReport(report), [report])

  const patchRule = (index: number, patch: Partial<RuleInput>) =>
    setRules((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const removeRule = (index: number) =>
    setRules((rs) => rs.filter((_, i) => i !== index))

  const duplicateRule = (index: number) =>
    setRules((rs) => {
      const copy: RuleInput = { ...rs[index], id: Math.random().toString(36).slice(2, 10) }
      const next = [...rs]
      next.splice(index + 1, 0, copy)
      return next
    })

  const addRule = () => setRules((rs) => [...rs, newRuleInput(rs.length)])

  // 拖拽落点后不立即改动 rules：先对当前顺序与候选顺序分别审计并弹窗预览，
  // 用户确认后才一次性应用候选顺序，取消则保持原顺序
  const reorder = (from: number, to: number) =>
    setPendingReorder(previewReorder(rules, from, to))

  const applyReorder = () => {
    if (pendingReorder) setRules(pendingReorder.candidate)
    setPendingReorder(null)
  }

  const handleImport = (text: string, mode: 'replace' | 'append'): string[] => {
    const { rules: parsed, errors } = parseRulesJson(text)
    if (parsed.length === 0) return errors.length ? errors : ['未找到任何规则']
    setRules((rs) => (mode === 'replace' ? parsed : [...rs, ...parsed]))
    const ok: string[] = []
    if (errors.length > 0) {
      setNotice(`导入 ${parsed.length} 条；${errors.length} 条记录有提示：${errors[0]}${errors.length > 1 ? ' 等' : ''}`)
      setTimeout(() => setNotice(null), 5000)
    }
    return ok
  }

  const s = report.stats

  return (
    <div>
      <h1>首命中规则审计台</h1>
      <p className="subtitle">
        基于「自上而下、首条匹配」语义，精确计算每条 IPv4 CIDR × 端口区间 × 协议规则的实际可达区域；
        识别完全遮蔽、部分遮蔽与多规则共同覆盖，并给出可复现的示例报文与遮蔽来源。全部计算在浏览器本地完成。
      </p>

      <div className="toolbar">
        <button className="primary" onClick={addRule}>＋ 新增规则</button>
        <button onClick={() => setShowImport(true)}>粘贴 JSON 导入</button>
        <button onClick={() => setShowExport(true)}>导出审计结果</button>
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(rules, null, 2)], {
              type: 'application/json',
            })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'rules.json'
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          导出规则（可再导入）
        </button>
        <button
          className="danger ghost"
          onClick={() => {
            if (confirm('清空全部规则？')) setRules([])
          }}
        >
          清空
        </button>
        <button
          className="ghost"
          onClick={() => setRules(createDemoRules())}
        >
          恢复演示规则
        </button>
      </div>

      {notice && <div className="notice info">{notice}</div>}

      <div className="stats">
        <div className="stat-card">
          <div className="label">规则总数</div>
          <div className="value">{s.total}</div>
        </div>
        <div className="stat-card ok">
          <div className="label">完全可达</div>
          <div className="value">{s.reachable}</div>
        </div>
        <div className="stat-card warn">
          <div className="label">部分遮蔽</div>
          <div className="value">{s.partial}</div>
        </div>
        <div className="stat-card danger">
          <div className="label">完全遮蔽</div>
          <div className="value">{s.fullyShadowed}</div>
        </div>
        <div className="stat-card danger">
          <div className="label">非法（不参与分析）</div>
          <div className="value">{s.invalid}</div>
        </div>
        <div className="stat-card">
          <div className="label">有效 / 声明报文空间</div>
          <div className="value" style={{ fontSize: 14 }}>
            {formatSize(s.totalEffectiveSize)}
            <span className="muted-text"> / {formatSize(s.totalDeclaredSize)}</span>
          </div>
        </div>
      </div>

      <RuleTable
        rules={rules}
        entries={report.entries}
        onChange={patchRule}
        onRemove={removeRule}
        onDuplicate={duplicateRule}
        onReorder={reorder}
        onAdd={addRule}
      />

      <div className="section-gap">
        <h2>审计结果</h2>
        <p className="legend" style={{ marginTop: -6, marginBottom: 10 }}>
          遮蔽仅考虑位于其上方（更早匹配）的规则；「共同覆盖」表示没有任何单条规则能独立遮蔽全部区域，
          需多条规则的并集才会使其失效。点击条目可展开可达区域、遮蔽来源与示例报文。
        </p>
        {rules.length === 0 ? (
          <div className="notice info">
            还没有规则。点击「新增规则」或「粘贴 JSON 导入」开始。
          </div>
        ) : (
          <AuditResults report={report} />
        )}
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      )}
      {showExport && (
        <ExportModal json={exportJson} onClose={() => setShowExport(false)} />
      )}
      {pendingReorder && (
        <ReorderPreviewModal
          preview={pendingReorder.preview}
          onConfirm={applyReorder}
          onCancel={() => setPendingReorder(null)}
        />
      )}
    </div>
  )
}
