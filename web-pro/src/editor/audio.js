import { activeScene, clamp, mediaById } from './model.js';
import { getAudioContext } from './compositor.js';

function trackAllowed(track) {
  if (!track || track.hidden) return false;
  if (track.type === 'audio' && track.muted) return false;
  return true;
}

function collectAudioClips(project, scene, time) {
  const out = [];
  for (const track of scene?.tracks || []) {
    if (!trackAllowed(track)) continue;
    for (const clip of track.elements || []) {
      if (clip.hidden) continue;
      let audible = false;
      if (clip.type === 'audio') audible = true;
      if (clip.type === 'video' && clip.sourceAudioEnabled !== false) audible = true;
      if (!audible) continue;
      if (time < clip.start - 0.25 || time >= clip.start + clip.duration) continue;
      const media = mediaById(project, clip.mediaId);
      if (!media || !media.audioUrl) continue;
      out.push({ clip, media });
    }
  }
  return out;
}

function gainAt(rel, clip) {
  const vol = clamp((Number(clip.volume) == null ? 100 : Number(clip.volume)) / 100, 0, 4);
  let g = vol;
  const fin = clamp(Number(clip.fadeIn) || 0, 0, clip.duration);
  const fout = clamp(Number(clip.fadeOut) || 0, 0, clip.duration);
  if (fin > 0 && rel < fin) g *= rel / fin;
  if (fout > 0 && rel > clip.duration - fout) g *= Math.max(0, (clip.duration - rel) / fout);
  return Math.max(0, g);
}

export class AudioPreview {
  constructor() {
    this.entries = new Map();
    this.project = null;
    this.scene = null;
  }

  setProject(project, scene) {
    this.project = project;
    this.scene = scene;
  }

  async start(time) {
    const ctx = getAudioContext();
    await ctx.resume().catch(() => {});
    this.stop();
    for (const { clip, media } of collectAudioClips(this.project, this.scene, time)) {
      this.startEntry(clip, media, time);
    }
  }

  startEntry(clip, media, time) {
    const ctx = getAudioContext();
    const el = document.createElement('audio');
    el.src = media.audioUrl;
    el.preload = 'auto';
    el.preservesPitch = clip.maintainPitch !== false;
    el.webkitPreservesPitch = clip.maintainPitch !== false;
    const rel = Math.max(0, time - clip.start);
    const sourceTime = Math.max(0, (Number(clip.trimStart) || 0) + rel * (Number(clip.speed) || 1));
    el.currentTime = sourceTime;
    el.playbackRate = clamp(Number(clip.speed) || 1, 0.25, 4);

    let sourceNode;
    try {
      sourceNode = ctx.createMediaElementSource(el);
    } catch {
      return;
    }
    const gain = ctx.createGain();
    const vol = gainAt(rel, clip);
    gain.gain.value = vol;
    sourceNode.connect(gain).connect(ctx.destination);
    el.play().catch(() => {});
    this.entries.set(clip.id, { el, gain, sourceNode, clip, media, startedAt: sourceTime });
  }

  sync(time) {
    if (!this.project || !this.scene) return;
    const active = new Map();
    for (const { clip, media } of collectAudioClips(this.project, this.scene, time)) active.set(clip.id, { clip, media });

    for (const [id, entry] of [...this.entries]) {
      if (!active.has(id)) {
        this.stopEntry(id);
        continue;
      }
      const rel = Math.max(0, time - entry.clip.start);
      const expected = Math.max(0, (Number(entry.clip.trimStart) || 0) + rel * (Number(entry.clip.speed) || 1));
      if (Math.abs(entry.el.currentTime - expected) > 0.35) {
        entry.el.currentTime = expected;
      }
      entry.gain.gain.value = gainAt(rel, entry.clip);
      if (entry.el.paused) entry.el.play().catch(() => {});
    }

    for (const [id, { clip, media }] of active) {
      if (!this.entries.has(id)) this.startEntry(clip, media, time);
    }
  }

  stopEntry(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    try { entry.el.pause(); } catch { /* ignore */ }
    try { entry.sourceNode.disconnect(); entry.gain.disconnect(); } catch { /* ignore */ }
    entry.el.removeAttribute('src');
    this.entries.delete(id);
  }

  stop() {
    for (const id of [...this.entries.keys()]) this.stopEntry(id);
  }
}
