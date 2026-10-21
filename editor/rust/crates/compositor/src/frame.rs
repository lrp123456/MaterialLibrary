use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::BlendMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDescriptor {
    pub width: u32,
    pub height: u32,
    pub clear: CanvasClearDescriptor,
    pub items: Vec<FrameItemDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasClearDescriptor {
    pub color: [f32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrameItemDescriptor {
    Layer(LayerDescriptor),
    SceneEffect {
        effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    },
    /// 双输入转场：from / to 各自渲染成一张纹理，再走 transition.wgsl 混合。
    /// 不经过 effects 管线（effects 是单输入，扩它会污染既有 shader）。
    Transition {
        from: LayerDescriptor,
        to: LayerDescriptor,
        progress: f32,
        mode: u32,
        scalars: [f32; 4],
        direction: [f32; 2],
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerDescriptor {
    pub texture_id: String,
    pub transform: QuadTransformDescriptor,
    pub opacity: f32,
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    pub mask: Option<LayerMaskDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuadTransformDescriptor {
    pub center_x: f32,
    pub center_y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation_degrees: f32,
    pub flip_x: bool,
    pub flip_y: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerMaskDescriptor {
    pub texture_id: String,
    pub feather: f32,
    pub inverted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectPassDescriptor {
    pub shader: String,
    pub uniforms: HashMap<String, EffectUniformValueDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EffectUniformValueDescriptor {
    Number(f32),
    Vector(Vec<f32>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasTextureDescriptor {
    pub id: String,
    pub width: u32,
    pub height: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 与 apps/web/src/services/renderer/compositor/types.ts 的
    /// TransitionItemDescriptor 逐字对齐：字段名或 tag 任一处改名都会在这里炸。
    #[test]
    fn deserializes_transition_frame_item() {
        let json = r#"{
            "type": "transition",
            "from": {
                "textureId": "root:0:source",
                "transform": {
                    "centerX": 960.0, "centerY": 540.0,
                    "width": 1920.0, "height": 1080.0,
                    "rotationDegrees": 0.0, "flipX": false, "flipY": false
                },
                "opacity": 1.0,
                "blendMode": "normal",
                "effectPassGroups": [],
                "mask": null
            },
            "to": {
                "textureId": "root:1:source",
                "transform": {
                    "centerX": 960.0, "centerY": 540.0,
                    "width": 1920.0, "height": 1080.0,
                    "rotationDegrees": 0.0, "flipX": false, "flipY": false
                },
                "opacity": 1.0,
                "blendMode": "normal",
                "effectPassGroups": [],
                "mask": null
            },
            "progress": 0.42,
            "mode": 7,
            "scalars": [0.45, 0.0, 0.0, 0.0],
            "direction": [1.0, 0.0]
        }"#;

        let item: FrameItemDescriptor = serde_json::from_str(json).unwrap();
        match item {
            FrameItemDescriptor::Transition {
                from,
                to,
                progress,
                mode,
                scalars,
                direction,
            } => {
                assert_eq!(from.texture_id, "root:0:source");
                assert_eq!(to.texture_id, "root:1:source");
                assert!((progress - 0.42).abs() < f32::EPSILON);
                assert_eq!(mode, 7);
                assert_eq!(scalars, [0.45, 0.0, 0.0, 0.0]);
                assert_eq!(direction, [1.0, 0.0]);
            }
            other => panic!("expected transition item, got {other:?}"),
        }
    }
}
