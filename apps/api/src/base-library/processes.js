/**
 * 乳胶漆 / 艺术漆工艺。只进入提示词，不挂贴图。
 */

const PROCESSES = [
  { key: 'roller_matte', label: '标准滚涂哑光', prompt: '工艺是标准滚筒平涂，哑光，表面平整，没有橘皮，没有批刀印。' },
  { key: 'eggshell', label: '丝光蛋壳光', prompt: '工艺是蛋壳光丝光，低角度有柔和高光，没有镜面反射。' },
  { key: 'trowel_microcement', label: '批刮微水泥', prompt: '工艺是艺术漆批刮微水泥，细腻灰泥云痕和轻微批刀走势。颜色以指定色号为准，不是水泥灰，不要发脏。' },
  { key: 'velvet', label: '天鹅绒艺术漆', prompt: '工艺是天鹅绒艺术漆，短绒光泽随视角变化，没有颗粒坑。' },
  { key: 'lime_rammed', label: '粗粝石灰夯土', prompt: '工艺是石灰或夯土漆，粗粝矿物颗粒和云状深浅。这仍然是涂层，不是石材板。' }
];

function processPrompt(key) {
  const hit = PROCESSES.find((item) => item.key === key);
  return hit ? hit.prompt : '';
}

module.exports = { PROCESSES, processPrompt };
