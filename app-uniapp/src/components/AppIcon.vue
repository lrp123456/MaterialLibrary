<template>
  <view
    class="app-icon"
    :style="[computedBaseStyle, computedMaskStyle]"
  />
</template>

<script>
import { getSvgDataUri } from './iconData.js'

export default {
  name: 'AppIcon',
  props: {
    name: {
      type: String,
      required: true,
    },
    size: {
      type: [Number, String],
      default: 18,
    },
    color: {
      type: String,
      default: '#1C1C1E',
    },
    strokeWidth: {
      type: [Number, String],
      default: 2,
    },
  },
  computed: {
    computedBaseStyle() {
      const sz = (Number(this.size) || 18) + 'px'
      const col = (!this.color || this.color === 'currentColor') ? '#1C1C1E' : this.color
      return {
        width: sz,
        height: sz,
        minWidth: sz,
        minHeight: sz,
        backgroundColor: col,
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
      }
    },
    computedMaskStyle() {
      const uri = getSvgDataUri(this.name)
      const maskVal = `url("${uri}") no-repeat center / contain`
      return {
        mask: maskVal,
        WebkitMask: maskVal,
      }
    },
  },
}
</script>

<style scoped>
.app-icon {
  pointer-events: none;
}
</style>
