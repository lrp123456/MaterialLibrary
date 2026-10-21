import { BaseNode, type AnyBaseNode } from "./base-node";

export interface TransitionNodeParams {
	/** 剪辑点左侧片段对应的节点（已按普通图层参数建好，未挂到树上） */
	fromNode: AnyBaseNode;
	/** 剪辑点右侧片段对应的节点 */
	toNode: AnyBaseNode;
	/** 渲染窗口起点 C - d/2（tick） */
	startTime: number;
	/** 窗口长度 d（tick） */
	duration: number;
	/** 资源包里的 mode 常量（见 transition.wgsl） */
	mode: number;
	/** x=softness y=amount z/w 预留 */
	scalars: [number, number, number, number];
	direction: [number, number];
}

export interface ResolvedTransitionNodeState {
	/** 0..1，已 clamp */
	progress: number;
}

/**
 * 转场节点。
 *
 * 它本身不产出画面，只是把 from / to 两个节点"打包"成一个帧项：
 * 帧描述阶段会为两者各生成一个 LayerDescriptor，再合成一条 transition item。
 * 窗口外 `resolved === null`，from / to 回到普通图层路径，互不影响。
 */
export class TransitionNode extends BaseNode<
	TransitionNodeParams,
	ResolvedTransitionNodeState
> {
	get fromNode() {
		return this.params.fromNode;
	}

	get toNode() {
		return this.params.toNode;
	}
}
