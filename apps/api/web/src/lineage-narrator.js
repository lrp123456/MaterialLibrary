/**
 * 单张资产流水线路径「人话」解读工具
 * 规范将节点输入输出、错误与状态翻译为人人可懂的一行结论。
 */

export const CATEGORY_LABELS = {
  interior: '室内空间',
  furniture: '家具单品',
  material: '材质纹理',
  exterior: '室外建筑',
  none: '非素材',
  excluded: '排除'
}

export const NODE_TYPE_NAMES = {
  materialize: '落盘原图',
  gate: '室内闸门',
  qc: '本地质检',
  tag: '空间打标',
  tag_furniture: '单品打标',
  cluster: '查重归组',
  clean: '去水印',
  restage_dual: 'AI画幅重构',
  restage_9_16: '9:16重构',
  index: '向量入库',
  backup: '备份槽'
}

/**
 * 为单个节点运行记录生成一行人话结论
 * @param {string} nodeType 节点类型
 * @param {string} status 状态: done / skipped / failed / queued / running / unreachable
 * @param {object} input 输入摘要
 * @param {object} output 输出摘要
 * @param {string} error 错误信息
 * @param {object} asset 资产对象
 * @returns {string} 一行人话解释
 */
export function narrateNodeStep(nodeType, status, input = {}, output = {}, error = '', asset = {}) {
  const st = String(status || '').toLowerCase()

  if (st === 'unreachable') {
    return '未到达 · 上游已中断或排队等待中'
  }
  if (st === 'queued') {
    return '排队中 · 等待 Worker 调度执行'
  }
  if (st === 'running') {
    return '处理中 · 正在调用引擎计算'
  }
  if (st === 'failed') {
    const msg = error || output?.error || '执行异常'
    return `执行失败 · ${msg}`
  }

  // done 或 skipped
  switch (nodeType) {
    case 'materialize': {
      if (st === 'skipped') return '原图已在本地缓存，跳过重复拉取'
      const w = output?.width || asset?.width || '—'
      const h = output?.height || asset?.height || '—'
      const fmt = (output?.format || output?.mime || 'JPG').toUpperCase().replace('IMAGE/', '')
      return `原图落盘成功 · 分辨率 ${w}×${h} (${fmt})`
    }

    case 'gate': {
      const isMat = output?.is_material !== false
      const cat = output?.category || asset?.category || 'interior'
      const catName = CATEGORY_LABELS[cat] || cat
      const reason = output?.reason || ''
      if (!isMat || cat === 'none' || asset?.status === 'excluded') {
        return `排除 · ${reason || '经 VLM 判定非室内设计素材'}`
      }
      return `通过 · 类别: ${catName}${reason ? ` (${reason})` : ''}`
    }

    case 'qc': {
      const w = output?.width || asset?.width || '—'
      const h = output?.height || asset?.height || '—'
      const ori = output?.orientation || asset?.orientation || '—'
      const color = output?.dominant_color || asset?.dominant_color || '标准色'
      return `质检通过 · ${w}×${h} · 画幅 ${ori} · 主色: ${color}`
    }

    case 'tag':
    case 'tag_furniture': {
      if (st === 'skipped') return output?.reason || '跳过打标'
      const tags = []
      if (output?.style) tags.push(`风格: ${output.style}`)
      if (output?.space) tags.push(`空间: ${output.space}`)
      if (output?.category) tags.push(`品类: ${output.category}`)
      if (output?.material) tags.push(`材质: ${output.material}`)
      if (output?.tags && Array.isArray(output.tags)) {
        tags.push(...output.tags.slice(0, 3))
      }
      const summary = tags.length ? tags.join(' · ') : (output?.summary || '打标成功')
      return `打标完成 · ${summary}`
    }

    case 'cluster': {
      if (st === 'skipped') return output?.reason || '跳过查重'
      if (output?.independent || (!asset?.dup_group_id && !output?.groupId)) {
        return '查重完毕 · 确认为独立素材，未并入重复组'
      }
      if (output?.is_new_group || output?.createdGroup) {
        return `查重归组 · 新建连拍组 (${output.reason || '同场景连拍'})`
      }
      const gid = output?.groupId || asset?.dup_group_id || '组'
      const r = output?.reason || '同空间相似匹配'
      return `查重归组 · 并入组 ${gid} (${r})`
    }

    case 'clean': {
      if (st === 'skipped') return output?.reason || '未配置去水印或未检测到水印，自动跳过'
      return '去水印完成 · 画面净画已落盘'
    }

    case 'restage_dual':
    case 'restage_9_16': {
      if (st === 'skipped') {
        const reason = output?.reason || error
        if (reason === 'backlog_skip_restage') {
          return '积压批次跳过画幅重构 (backlog_skip_restage)，直通入库'
        }
        return `跳过重构 (${reason || '已满足画幅或规则豁免'})`
      }
      const ratios = Array.isArray(output?.ratios) ? output.ratios.join(' & ') : (output?.ratio || '9:16')
      return `AI 画幅重构成功 · 产出 ${ratios} 净图`
    }

    case 'index': {
      if (st === 'skipped') return '跳过向量入库'
      const model = output?.embeddingModel || output?.model || 'text-embedding-3-small'
      const isReady = asset?.status === 'ready' || asset?.status === 'ready_with_flags' || st === 'done'
      return `${isReady ? '已入库 ready' : '入库完成'} · 向量模型: ${model}`
    }

    case 'backup': {
      if (st === 'skipped') return '备份槽未启用'
      return output?.message || '已完成 NAS / 云端备份归档'
    }

    default:
      return st === 'done' ? '步骤执行完成' : `步骤状态: ${st}`
  }
}

/**
 * 组装某张资产在当前工作流图下的完整有序节点步骤
 * @param {Array} workflowNodes 当前图的节点列表（按拓扑或视觉顺序）
 * @param {Array} assetNodeRuns 该资产在该批次的实际 node_runs 记录
 * @param {object} asset 资产对象
 * @returns {Array} 每个节点的完整生命周期与人话结论
 */
export function buildAssetLineagePath(workflowNodes = [], assetNodeRuns = [], asset = {}) {
  const runMap = new Map()
  for (const nr of assetNodeRuns) {
    runMap.set(nr.node_id || nr.node_type, nr)
    runMap.set(nr.node_type, nr)
  }

  let stopEncountered = false
  let stopReason = ''

  return workflowNodes.map(node => {
    const record = runMap.get(node.id) || runMap.get(node.type)

    if (stopEncountered) {
      return {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name || NODE_TYPE_NAMES[node.type] || node.id,
        status: 'unreachable',
        narrative: `未到达 · 停留在上一步骤 (${stopReason})`,
        record: null
      }
    }

    if (!record) {
      // 当前还没跑到此节点
      return {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name || NODE_TYPE_NAMES[node.type] || node.id,
        status: 'unreachable',
        narrative: '未到达 · 等待调度流转',
        record: null
      }
    }

    const st = record.status
    const input = parseJson(record.input_summary)
    const output = parseJson(record.output_summary)
    const error = record.error || ''
    const narrative = narrateNodeStep(node.type, st, input, output, error, asset)

    // 如果闸门排除或节点致命失败，下游标记为未到达
    if (st === 'failed') {
      stopEncountered = true
      stopReason = `${node.name || node.id} 失败`
    } else if (node.type === 'gate') {
      const isMat = output?.is_material !== false
      if (!isMat || output?.category === 'none' || asset?.status === 'excluded') {
        stopEncountered = true
        stopReason = '闸门已排除非素材'
      }
    }

    return {
      nodeId: node.id,
      nodeType: node.type,
      nodeName: node.name || NODE_TYPE_NAMES[node.type] || node.id,
      status: st,
      durationMs: record.duration_ms || 0,
      input,
      output,
      error,
      narrative,
      record
    }
  })
}

function parseJson(str) {
  if (!str) return {}
  if (typeof str === 'object') return str
  try { return JSON.parse(str) } catch { return {} }
}
