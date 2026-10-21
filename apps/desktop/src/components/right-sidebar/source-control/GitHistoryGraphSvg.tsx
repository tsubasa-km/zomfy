import type { GitHistoryGraphColorId } from '@acp-harness/protocol'
import {
  getGitHistoryItemColor,
  getGitHistoryItemLaneIndex,
  getGitHistoryMergeParentLaneIndex,
  isBoundaryRow,
  type GitHistoryItemViewModel
} from './git-history-graph'

// Orca's source-control/sync/git-history-graph-svg.tsx.

const SWIMLANE_HEIGHT = 24
const SWIMLANE_WIDTH = 11
const SWIMLANE_CURVE_RADIUS = 5
const SWIMLANE_NODE_Y = SWIMLANE_HEIGHT / 2
const CIRCLE_RADIUS = 3.5
const CIRCLE_STROKE_WIDTH = 1.5

export function graphColor(color: GitHistoryGraphColorId): string {
  return `var(--${color})`
}

function GraphPath({ d, color }: { d: string; color: GitHistoryGraphColorId }) {
  return <path d={d} fill="none" stroke={graphColor(color)} strokeLinecap="round" strokeWidth={1} />
}

export function GitHistoryGraphSvg({ viewModel }: { viewModel: GitHistoryItemViewModel }) {
  const { historyItem, inputSwimlanes, outputSwimlanes } = viewModel
  const inputIndex = inputSwimlanes.findIndex((node) => node.id === historyItem.id)
  const circleIndex = getGitHistoryItemLaneIndex(viewModel)
  const circleColor = getGitHistoryItemColor(viewModel)
  const W = SWIMLANE_WIDTH
  const paths: React.JSX.Element[] = []
  let outputIndex = 0

  for (let index = 0; index < inputSwimlanes.length; index++) {
    const lane = inputSwimlanes[index]!
    if (lane.id === historyItem.id) {
      if (index !== circleIndex) {
        paths.push(
          <GraphPath
            key={`base-${lane.id}`}
            color={lane.color}
            d={`M ${W * (index + 1)} 0 A ${W} ${W} 0 0 1 ${W * index} ${SWIMLANE_NODE_Y} H ${W * (circleIndex + 1)}`}
          />
        )
      } else if (historyItem.parentIds.length > 0) {
        outputIndex += 1
      }
      continue
    }
    if (outputIndex < outputSwimlanes.length && lane.id === outputSwimlanes[outputIndex]!.id) {
      if (index === outputIndex) {
        paths.push(<GraphPath key={`vertical-${lane.id}`} color={lane.color} d={`M ${W * (index + 1)} 0 V ${SWIMLANE_HEIGHT}`} />)
      } else {
        paths.push(
          <GraphPath
            key={`shift-${lane.id}-${outputSwimlanes[outputIndex]!.id}`}
            color={lane.color}
            d={[
              `M ${W * (index + 1)} 0`,
              'V 6',
              `A ${SWIMLANE_CURVE_RADIUS} ${SWIMLANE_CURVE_RADIUS} 0 0 1 ${W * (index + 1) - SWIMLANE_CURVE_RADIUS} ${SWIMLANE_HEIGHT / 2}`,
              `H ${W * (outputIndex + 1) + SWIMLANE_CURVE_RADIUS}`,
              `A ${SWIMLANE_CURVE_RADIUS} ${SWIMLANE_CURVE_RADIUS} 0 0 0 ${W * (outputIndex + 1)} ${SWIMLANE_HEIGHT / 2 + SWIMLANE_CURVE_RADIUS}`,
              `V ${SWIMLANE_HEIGHT}`
            ].join(' ')}
          />
        )
      }
      outputIndex += 1
    }
  }

  for (let index = 1; index < historyItem.parentIds.length; index++) {
    const parentId = historyItem.parentIds[index]!
    const parentOutputIndex = getGitHistoryMergeParentLaneIndex(viewModel, parentId)
    if (parentOutputIndex === -1) continue
    paths.push(
      <GraphPath
        key={`merge-parent-${parentId}`}
        color={outputSwimlanes[parentOutputIndex]!.color}
        d={[
          `M ${W * parentOutputIndex} ${SWIMLANE_HEIGHT / 2}`,
          `A ${W} ${W} 0 0 1 ${W * (parentOutputIndex + 1)} ${SWIMLANE_HEIGHT}`,
          `M ${W * parentOutputIndex} ${SWIMLANE_HEIGHT / 2}`,
          `H ${W * (circleIndex + 1)}`
        ].join(' ')}
      />
    )
  }

  if (inputIndex !== -1) {
    paths.push(
      <GraphPath key="into-node" color={inputSwimlanes[inputIndex]!.color} d={`M ${W * (circleIndex + 1)} 0 V ${SWIMLANE_HEIGHT / 2}`} />
    )
  }
  if (historyItem.parentIds.length > 0) {
    paths.push(<GraphPath key="out-of-node" color={circleColor} d={`M ${W * (circleIndex + 1)} ${SWIMLANE_HEIGHT / 2} V ${SWIMLANE_HEIGHT}`} />)
  }

  const cx = W * (circleIndex + 1)
  const cy = SWIMLANE_NODE_Y
  const width = W * (Math.max(inputSwimlanes.length, outputSwimlanes.length, 1) + 1)
  const boundary = isBoundaryRow(viewModel)
  const isMerge = historyItem.parentIds.length > 1
  const fill = graphColor(circleColor)

  return (
    <svg aria-hidden="true" className="shrink-0 overflow-visible" width={width} height={SWIMLANE_HEIGHT} viewBox={`0 0 ${width} ${SWIMLANE_HEIGHT}`}>
      {paths}
      {viewModel.kind === 'HEAD' && (
        <>
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 3} fill={fill} stroke="var(--background)" strokeWidth={CIRCLE_STROKE_WIDTH} />
          <circle cx={cx} cy={cy} r={CIRCLE_STROKE_WIDTH} fill="var(--background)" />
        </>
      )}
      {boundary && (
        <>
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 3} fill={fill} stroke="var(--background)" strokeWidth={CIRCLE_STROKE_WIDTH} />
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 1} fill="var(--background)" stroke="var(--background)" strokeWidth={CIRCLE_STROKE_WIDTH + 1} />
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 1} fill="none" stroke={fill} strokeDasharray="4 2" strokeWidth={CIRCLE_STROKE_WIDTH - 1} />
        </>
      )}
      {!boundary && viewModel.kind !== 'HEAD' && isMerge && (
        <>
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 1} fill={fill} />
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS - 1.5} fill="var(--background)" />
        </>
      )}
      {!boundary && viewModel.kind !== 'HEAD' && !isMerge && <circle cx={cx} cy={cy} r={CIRCLE_RADIUS} fill={fill} />}
    </svg>
  )
}
